import { randomBytes, randomUUID } from 'node:crypto';
import { createGame, observe, validateAction } from '../engine';
import { ChessClock } from '../clock';
import { database, getArtifact } from './cloud';
import { HttpError } from './http';
import { rateAbandonedPractice, rateFinishedPractice } from './ratings';
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
  updated_at: string;
}
/** Interrupted moves are released by the reconcile job after two minutes. */
const moveRunning = (s: SessionRow) => s.busy && Date.now() - Date.parse(s.updated_at) < 120000;
/** Maps the single-game slot RPC's custom SQLSTATEs to client-actionable conflicts. */
function slotError(error: { code?: string; message: string; details?: string }) {
  if (error.code === 'SPL09')
    return new HttpError(error.message, 409, { activeGameId: error.details });
  if (error.code === 'SPL29') return new HttpError(error.message, 409);
  return new Error(error.message);
}
/** The user's unfinished game, if any, for resuming in the browser or over MCP. */
export async function currentCloudPractice(user: string): Promise<PracticeView | null> {
  const { data, error } = await database()
    .from('splendor_practice_sessions')
    .select('*')
    .eq('owner_id', user)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const session = data as SessionRow | null;
  if (!session || session.state.status !== 'playing') return null;
  const seats = session.seats ?? (await legacySeats());
  return {
    ...view(session.id, seats, session.human_seat ?? 0, session),
    revision: session.revision,
    busy: moveRunning(session),
  };
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
    | ({ type: 'new'; clockConfig: ClockConfig; replace?: boolean } & PracticeOptions)
    | { type: 'close'; id: string }
    | { type: 'action'; id: string; action: unknown; revision: number },
): Promise<PracticeView | { closed: true; notices: string[] }> {
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
    const id = randomUUID();
    // Settle the previous board's rating first: a finished game (if its rating was missed) or
    // an unfinished one this request abandons. Both are idempotent per game.
    const { data: previous, error: pe } = await db
      .from('splendor_practice_sessions')
      .select('*')
      .eq('owner_id', user)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pe) throw new Error(pe.message);
    if (previous) {
      const old = previous as SessionRow,
        oldSeats = old.seats ?? (await legacySeats());
      if (old.state.status === 'finished')
        await rateFinishedPractice(old.id, user, oldSeats, old.state);
      else if (body.replace) {
        if (moveRunning(old))
          throw new HttpError(
            'A move is still running in your current game; try again shortly',
            409,
          );
        result.notices.push(
          ...(await rateAbandonedPractice(old.id, user, oldSeats, old.state, old.human_seat ?? 0)),
        );
      }
    }
    // Claim the user's single game slot before spending a sandbox on the bots' opening turns.
    const { error } = await db.rpc('splendor_create_practice', {
      p_owner: user,
      p_id: id,
      p_state: result.state,
      p_clock: result.clock,
      p_seats: seats,
      p_human_seat: humanSeat,
      p_replace: body.replace ?? false,
      p_busy: humanSeat !== 0,
    });
    if (error) throw slotError(error);
    if (humanSeat !== 0) {
      try {
        const abandoned = result.notices;
        result = await runSandbox({
          ...result,
          action: null,
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
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (e) throw e;
        result.notices = [...abandoned, ...result.notices];
      } catch (error) {
        await db.from('splendor_practice_sessions').delete().eq('id', id);
        throw error;
      }
    }
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
    if (moveRunning(session))
      throw new HttpError('A move is still running; abandon the game once it finishes', 409);
    // Rate before deleting, so a failure cannot turn into a free escape from a losing game.
    const rated = await rateAbandonedPractice(
      session.id,
      user,
      session.seats ?? (await legacySeats()),
      session.state,
      session.human_seat ?? 0,
    );
    const { error: e } = await db
      .from('splendor_practice_sessions')
      .delete()
      .eq('id', body.id)
      .eq('owner_id', user);
    if (e) throw e;
    return { closed: true, notices: rated };
  }
  if (session.state.status === 'finished') throw new HttpError('This game has finished', 409);
  if (session.revision !== body.revision || session.busy)
    throw new HttpError('The board changed; refresh and try again', 409, {
      revision: session.revision,
    });
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('revision', body.revision);
    if (e) throw e;
    if (result.state.status === 'finished')
      result.notices.push(
        ...(await rateFinishedPractice(body.id, user, seats, result.state).catch(() => [
          'Ratings will update when you start your next game.',
        ])),
      );
    return view(body.id, seats, humanSeat, result);
  } finally {
    await db
      .from('splendor_practice_sessions')
      .update({ busy: false })
      .eq('id', body.id)
      .eq('revision', body.revision);
  }
}

/** Unfinished games idle for a week are abandoned: rated as losses after the free turns. */
export async function sweepIdlePractice(): Promise<number> {
  const db = database();
  const { data, error } = await db
    .from('splendor_practice_sessions')
    .select('*')
    .eq('state->>status', 'playing')
    .eq('busy', false)
    .lt('updated_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(20);
  if (error) throw new Error(error.message);
  for (const row of data as (SessionRow & { owner_id: string })[]) {
    await rateAbandonedPractice(
      row.id,
      row.owner_id,
      row.seats ?? (await legacySeats()),
      row.state,
      row.human_seat ?? 0,
    );
    await db.from('splendor_practice_sessions').delete().eq('id', row.id);
  }
  return data.length;
}
