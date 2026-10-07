import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createGame, observe, validateAction } from '../engine';
import { appendHistory, humanStep, stepFor, type HistoryEntry } from '../practice/bot-turns';
import { ChessClock } from '../clock';
import { database, getArtifact } from './cloud';
import { HttpError } from './http';
import {
  rateAbandonedPractice,
  rateFinishedPractice,
  type PracticeRating,
  type SeatUsers,
} from './ratings';
import { decryptBotSecrets } from './bot-secrets';
import type { BotArtifact } from './cloud-store';
import { modalClient } from './modal-jobs';
import {
  arrangeSeats,
  chooseHumanSeat,
  humanSeats,
  type PracticeOptions,
  type PracticeSeat,
  type PracticeStep,
  type PracticeView,
  INVITED_HUMAN,
} from '../practice/types';
import type { PracticeTurnInput } from './practice-turn';
import type { ClockConfig, ClockSnapshot, GameState } from '../types';
import imageConfig from '../../modal-image.json';
/** A player who joined a shared table: the hash of their seat token and their account. */
interface Guest {
  seat: number;
  token_hash: string;
  user_id: string;
}
interface SessionRow {
  id: string;
  owner_id: string;
  state: GameState;
  clock: ClockSnapshot;
  revision: number;
  busy: boolean;
  seats: PracticeSeat[] | null;
  /** Absent until the practice-seats migration is applied. */
  human_seat?: number;
  /** Absent until the practice-multiplayer migration is applied. */
  guests?: Guest[];
  history?: HistoryEntry[];
  updated_at: string;
}
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** The account behind each human seat: the host's and every joined player's. */
const usersOf = (s: SessionRow): SeatUsers => ({
  [s.human_seat ?? 0]: s.owner_id,
  ...Object.fromEntries((s.guests ?? []).map((g) => [g.seat, g.user_id])),
});
/** The caller's seat: a joined player's by seat token, otherwise the host's by account. */
function seatOf(session: SessionRow, user: string, token?: string): number {
  if (token !== undefined) {
    const hash = hashToken(token);
    const guest = session.guests?.find((g) => g.token_hash === hash && g.user_id === user);
    if (guest) return guest.seat;
  } else if (session.owner_id === user) return session.human_seat ?? 0;
  throw new HttpError('You are not seated at this table', 403);
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
/** One table as a seated player sees it, with the moves made after revision `since`. */
export async function cloudPracticeTable(
  user: string,
  query: { id: string; token?: string; since?: number },
): Promise<PracticeView> {
  const { data, error } = await database()
    .from('splendor_practice_sessions')
    .select('*')
    .eq('id', query.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError('This game has ended.', 404);
  const session = data as SessionRow;
  const seat = seatOf(session, user, query.token);
  const steps =
    query.since === undefined
      ? []
      : (session.history ?? [])
          .filter((e) => e.state.decision > query.since!)
          .map((e) => stepFor(e, seat));
  return {
    ...view(session.id, session.seats ?? (await legacySeats()), seat, { ...session, steps }),
    revision: session.revision,
    busy: moveRunning(session),
  };
}
interface TurnResult {
  state: GameState;
  clock: ClockSnapshot;
  steps?: PracticeStep[];
  history?: HistoryEntry[];
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
    pending: result.state.status === 'playing' && seats[result.state.currentPlayer]?.kind === 'bot',
  };
}
/** Bots the user may seat: public qualified versions and their own qualified versions. */
async function loadBots(user: string, ids: string[]) {
  if (!ids.length) return [];
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
    | ({
        type: 'new';
        clockConfig: ClockConfig;
        replace?: boolean;
        name?: string;
      } & PracticeOptions)
    | { type: 'close'; id: string }
    | { type: 'join'; id: string; name: string }
    | {
        type: 'action';
        id: string;
        action: unknown;
        revision: number;
        split?: boolean;
        token?: string;
      }
    | { type: 'advance'; id: string; revision: number; token?: string },
): Promise<PracticeView | { closed: true; notices: string[] }> {
  const db = database();
  if (body.type === 'new') {
    const invited = new Set(body.opponents.flatMap((id, i) => (id === INVITED_HUMAN ? [i] : [])));
    const bots = await loadBots(
      user,
      body.opponents.filter((_, i) => !invited.has(i)),
    );
    let next = 0;
    const humanSeat = chooseHumanSeat(body.order, body.opponents.length + 1),
      seats = arrangeSeats(
        humanSeat,
        body.opponents.map((id, i) => (invited.has(i) ? { id, name: '' } : bots[next++])),
        body.name,
      ),
      botsFirst = seats[0].kind === 'bot';
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
        await rateFinishedPractice(old.id, usersOf(old), oldSeats, old.state);
      else if (body.replace) {
        if (moveRunning(old))
          throw new HttpError(
            'A move is still running in your current game; try again shortly',
            409,
          );
        result.notices.push(
          ...(await rateAbandonedPractice(
            old.id,
            usersOf(old),
            oldSeats,
            old.state,
            old.human_seat ?? 0,
          )),
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
      p_busy: botsFirst,
    });
    if (error) throw slotError(error);
    if (botsFirst) {
      try {
        const abandoned = result.notices;
        result = await runSandbox({
          ...result,
          action: null,
          humanSeat,
          humanSeats: humanSeats(seats),
          seats: await seatCode(user, seats),
        });
        const { error: e } = await db
          .from('splendor_practice_sessions')
          .update({
            state: result.state,
            clock: result.clock,
            revision: result.state.decision,
            ...(result.history ? { history: appendHistory([], result.history, seats.length) } : {}),
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
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError('This game has ended.', 404);
  const session = data as SessionRow;
  if (body.type === 'join') {
    // Seats the caller atomically: two friends opening the link at once get different seats.
    const token = randomBytes(24).toString('base64url');
    const { error: je } = await db.rpc('splendor_join_practice', {
      p_id: body.id,
      p_name: body.name,
      p_user: user,
      p_token_hash: hashToken(token),
    });
    if (je) throw je.code === 'SPL09' ? new HttpError(je.message, 409) : new Error(je.message);
    return { ...(await cloudPracticeTable(user, { id: body.id, token })), seatToken: token };
  }
  if (body.type === 'close') {
    if (session.owner_id !== user) throw new HttpError('Only the host can end a shared game', 403);
    if (moveRunning(session))
      throw new HttpError('A move is still running; abandon the game once it finishes', 409);
    // Rate before deleting, so a failure cannot turn into a free escape from a losing game.
    const rated = await rateAbandonedPractice(
      session.id,
      usersOf(session),
      session.seats ?? (await legacySeats()),
      session.state,
      session.human_seat ?? 0,
    );
    const { error: e } = await db.from('splendor_practice_sessions').delete().eq('id', body.id);
    if (e) throw e;
    return { closed: true, notices: rated };
  }
  const humanSeat = seatOf(session, user, body.token);
  if (session.state.status === 'finished') throw new HttpError('This game has finished', 409);
  if (session.revision !== body.revision || session.busy)
    throw new HttpError('The board changed; refresh and try again', 409, {
      revision: session.revision,
    });
  const seats = session.seats ?? (await legacySeats());
  const record = (entries: HistoryEntry[] = []) =>
    appendHistory(session.history ?? [], entries, seats.length);
  /** Rates a game that just ended; a failure is retried when the next game starts. */
  const settle = async (result: TurnResult): Promise<PracticeView> => {
    let rated: PracticeRating = { notices: [] };
    if (result.state.status === 'finished')
      rated = await rateFinishedPractice(body.id, usersOf(session), seats, result.state).catch(
        () => ({
          notices: ['Ratings will update when you start your next game.'],
        }),
      );
    const out = view(body.id, seats, humanSeat, {
      ...result,
      notices: [...result.notices, ...rated.notices],
    });
    return { ...out, ratings: rated.ratings };
  };
  if (body.type === 'action' && body.split) {
    // The human's move needs no sandbox: apply it here and answer at once, so the board
    // (new card, visiting noble) updates before the bots start. `advance` runs them.
    const { state, step, entry } = humanStep(
      { state: session.state, clock: ChessClock.restore(session.clock), humanSeat },
      body.action,
    );
    const { data: saved, error: se } = await db
      .from('splendor_practice_sessions')
      .update({
        state,
        revision: state.decision,
        history: record([entry]),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('revision', body.revision)
      .eq('busy', false)
      .select('id')
      .maybeSingle();
    if (se) throw se;
    if (!saved) throw new HttpError('The board changed; refresh and try again', 409);
    return settle({ state, clock: session.clock, steps: [step], notices: [] });
  }
  if (body.type === 'advance') {
    if (seats[session.state.currentPlayer]?.kind !== 'bot')
      return view(body.id, seats, humanSeat, { ...session, notices: [] });
  } else {
    if (session.state.currentPlayer !== humanSeat) throw new Error('Wait for your turn');
    validateAction(session.state, body.action);
  }
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
      action: body.type === 'action' ? body.action : null,
      humanSeat,
      humanSeats: humanSeats(seats),
      seats: await seatCode(session.owner_id, seats),
    });
    const { error: e } = await db
      .from('splendor_practice_sessions')
      .update({
        state: result.state,
        clock: result.clock,
        revision: result.state.decision,
        history: record(result.history),
        busy: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('revision', body.revision);
    if (e) throw e;
    return await settle(result);
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
      usersOf(row),
      row.seats ?? (await legacySeats()),
      row.state,
      row.human_seat ?? 0,
    );
    await db.from('splendor_practice_sessions').delete().eq('id', row.id);
  }
  return data.length;
}
