import { randomBytes, randomUUID } from 'node:crypto';
import { createGame, observe, validateAction } from '../engine';
import { ChessClock } from '../clock';
import { database, getArtifact } from './cloud';
import { decryptBotSecrets } from './bot-secrets';
import type { BotArtifact } from './cloud-store';
import { modalClient } from './modal-jobs';
import {
  arrangeSeats,
  chooseHumanSeat,
  type PracticeOptions,
  type PracticeSeat,
  type PracticeStep,
  type PracticeView,
} from '../practice/types';
import type { PracticeTurnInput } from './practice-turn';
import type { ClockConfig, ClockSnapshot, GameState } from '../types';
import imageConfig from '../../modal-image.json';
interface SessionRow {
  id: string;
  state: GameState;
  clock: ClockSnapshot;
  revision: number;
  busy: boolean;
  seats: PracticeSeat[] | null;
  /** Absent until the practice-seats migration is applied. */
  human_seat?: number;
}
interface TurnResult {
  state: GameState;
  clock: ClockSnapshot;
  steps?: PracticeStep[];
  notices: string[];
}
function view(
  id: string,
  seats: PracticeSeat[],
  humanSeat: number,
  result: Omit<TurnResult, 'notices'> & { notices?: string[] },
): PracticeView {
  return {
    id,
    revision: result.state.decision,
    humanSeat,
    seats,
    view: { ...observe(result.state, humanSeat), clock: result.clock },
    steps: result.steps ?? [],
    notices: result.notices ?? [],
  };
}
/** Bots the user may seat: public qualified versions and their own qualified versions. */
async function loadBots(user: string, ids: string[]) {
  const db = database();
  const { data, error } = await db
    .from('splendor_bots')
    .select('id,name,owner_id,artifact_key,qualification,secrets_encrypted')
    .in('id', [...new Set(ids)]);
  if (error) throw error;
  return ids.map((id) => {
    const b = data?.find((row) => row.id === id);
    if (!b || b.qualification !== 'passed' || (b.secrets_encrypted && b.owner_id !== user))
      throw new Error('Unknown opponent bot');
    return b as {
      id: string;
      name: string;
      owner_id: string | null;
      artifact_key: string;
      secrets_encrypted: string | null;
    };
  });
}
/** Sessions created before seat selection existed play the public Greedy baseline. */
async function legacySeats(): Promise<PracticeSeat[]> {
  const { data, error } = await database()
    .from('splendor_bots')
    .select('id')
    .eq('baseline', true)
    .eq('name', 'Greedy')
    .eq('qualification', 'passed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Baseline unavailable');
  return arrangeSeats(0, [{ id: data.id, name: 'Greedy' }]);
}
async function seatCode(user: string, seats: PracticeSeat[]): Promise<PracticeTurnInput['seats']> {
  const ids = seats.flatMap((s) => (s.kind === 'bot' ? [s.botId] : []));
  const bots = await loadBots(user, ids);
  let next = 0;
  return Promise.all(
    seats.map(async (s) => {
      if (s.kind === 'human') return null;
      const b = bots[next++];
      const { source } = await getArtifact<BotArtifact>(b.artifact_key);
      return {
        source,
        secrets: b.owner_id ? decryptBotSecrets(b.owner_id, b.id, b.secrets_encrypted) : {},
      };
    }),
  );
}
async function runSandbox(input: PracticeTurnInput): Promise<TurnResult> {
  // Older runner images only read `source`: keep human-first, one-bot tables working on them.
  const [human, bot, ...rest] = input.seats ?? [];
  if ((input.humanSeat ?? 0) === 0 && !human && bot && !rest.length)
    input = { ...input, source: bot.source };
  const client = modalClient();
  let sandbox;
  try {
    const app = await client.apps.fromName(imageConfig.app),
      image = await client.images.fromId(process.env.MODAL_IMAGE_ID ?? imageConfig.imageId);
    sandbox = await client.sandboxes.create(app, image, {
      command: ['node', '--max-old-space-size=192', '/app/.runtime/modal-runner.mjs'],
      workdir: '/app',
      memoryMiB: 512,
      memoryLimitMiB: 512,
      cpu: 1,
      cpuLimit: 1,
      blockNetwork: false,
      timeoutMs: 45000,
    });
    await sandbox.stdin.writeText(JSON.stringify({ kind: 'practice-turn', input }));
    await sandbox.stdin.close();
    const output = await sandbox.stdout.readText();
    const exit = await sandbox.wait();
    if (exit !== 0) throw new Error(`Practice runner stopped (exit ${exit})`);
    return JSON.parse(output) as TurnResult;
  } finally {
    await sandbox?.terminate();
    await client.close();
  }
}
export async function cloudPractice(
  user: string,
  body:
    | ({ type: 'new'; clockConfig: ClockConfig } & PracticeOptions)
    | { type: 'close'; id: string }
    | { type: 'action'; id: string; action: unknown; revision: number },
): Promise<PracticeView | { closed: true }> {
  const db = database();
  if (body.type === 'new') {
    const bots = await loadBots(user, body.opponents);
    const humanSeat = chooseHumanSeat(body.order, bots.length + 1),
      seats = arrangeSeats(humanSeat, bots);
    let result: TurnResult = {
      state: createGame({ players: seats.length, seed: randomBytes(32).toString('hex') }),
      clock: new ChessClock(seats.length, body.clockConfig).snapshot(),
      notices: [],
    };
    if (humanSeat !== 0)
      result = await runSandbox({
        ...result,
        action: null,
        humanSeat,
        seats: await seatCode(user, seats),
      });
    const id = randomUUID();
    const { error } = await db.rpc('splendor_create_practice', {
      p_owner: user,
      p_id: id,
      p_state: result.state,
      p_clock: result.clock,
      p_seats: seats,
      p_human_seat: humanSeat,
    });
    if (error) throw error;
    return view(id, seats, humanSeat, result);
  }
  const { data, error } = await db
    .from('splendor_practice_sessions')
    .select('*')
    .eq('id', body.id)
    .eq('owner_id', user)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Practice session expired');
  const session = data as SessionRow;
  if (body.type === 'close') {
    const { error: e } = await db
      .from('splendor_practice_sessions')
      .delete()
      .eq('id', body.id)
      .eq('owner_id', user);
    if (e) throw e;
    return { closed: true };
  }
  if (session.revision !== body.revision || session.busy)
    throw new Error('The board changed; refresh and try again');
  const humanSeat = session.human_seat ?? 0;
  if (session.state.currentPlayer !== humanSeat) throw new Error('Wait for your turn');
  validateAction(session.state, body.action);
  const seats = session.seats ?? (await legacySeats());
  const { data: locked, error: le } = await db
    .from('splendor_practice_sessions')
    .update({ busy: true, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('revision', body.revision)
    .eq('busy', false)
    .select('id')
    .maybeSingle();
  if (le) throw le;
  if (!locked) throw new Error('Another move is running');
  try {
    const result = await runSandbox({
      state: session.state,
      clock: session.clock,
      action: body.action,
      humanSeat,
      seats: await seatCode(user, seats),
    });
    const { error: e } = await db
      .from('splendor_practice_sessions')
      .update({
        state: result.state,
        clock: result.clock,
        revision: result.state.decision,
        busy: false,
      })
      .eq('id', body.id)
      .eq('revision', body.revision);
    if (e) throw e;
    return view(body.id, seats, humanSeat, result);
  } finally {
    await db
      .from('splendor_practice_sessions')
      .update({ busy: false })
      .eq('id', body.id)
      .eq('revision', body.revision);
  }
}
