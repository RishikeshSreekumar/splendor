import { randomUUID, randomBytes } from 'node:crypto';
import { BotRunner } from '../sandbox';
import { ChessClock, DEFAULT_CLOCK } from '../clock';
import { createGame, observe } from '../engine';
import {
  appendHistory,
  humanStep,
  playBots,
  stepFor,
  type HistoryEntry,
} from '../practice/bot-turns';
import {
  arrangeSeats,
  chooseHumanSeat,
  humanSeats,
  INVITED_HUMAN,
  type PracticeOptions,
  type PracticeSeat,
  type PracticeStep,
  type PracticeView,
} from '../practice/types';
import { getStore, type StoredBot } from './store';
import { HttpError } from './http';
import { LOCAL_OWNER } from './cloud';
import {
  rateAbandonedPractice,
  rateFinishedPractice,
  type PracticeRating,
  type SeatUsers,
} from './ratings';
import type { ClockConfig, GameState } from '../types';
export type { PracticeView } from '../practice/types';
/**
 * An in-memory table for local mode: the host's seat, 0–3 sandboxed bots and any open seats
 * that friends join from the invite link. Joined players act with their seat token.
 */
export class PracticeSession {
  readonly id = randomUUID();
  readonly seats: PracticeSeat[];
  /** The host's seat. */
  readonly humanSeat: number;
  private state: GameState;
  private drivers: (BotRunner | null)[];
  private clock: ChessClock;
  private disabled = new Set<number>();
  /** Seat token → seat, for players who joined from the invite link. */
  private guests = new Map<string, number>();
  private history: HistoryEntry[] = [];
  busy = false;
  touchedAt = Date.now();
  /** `null` opponents are open seats for invited players. */
  constructor(
    opponents: (StoredBot | null)[],
    options: PracticeOptions & { name?: string },
    config: ClockConfig,
  ) {
    const seed = randomBytes(32).toString('hex'),
      players = opponents.length + 1;
    this.humanSeat = chooseHumanSeat(options.order, players);
    this.seats = arrangeSeats(
      this.humanSeat,
      opponents.map((b) => b ?? { id: INVITED_HUMAN, name: '' }),
      options.name,
    );
    this.state = createGame({ players, seed });
    this.clock = new ChessClock(players, config);
    const bots = opponents.filter((b) => b !== null);
    let next = 0;
    this.drivers = this.seats.map((s) =>
      s.kind === 'human'
        ? null
        : new BotRunner(bots[next++].source, { seed: `${seed}:bot:${next}` }),
    );
  }
  /** Local mode has one account: only the host's seat is rated. */
  private get users(): SeatUsers {
    return { [this.humanSeat]: LOCAL_OWNER };
  }
  /** The host's seat without a token; a joined player's seat with theirs. */
  seatOf(token?: string): number {
    if (token === undefined) return this.humanSeat;
    const seat = this.guests.get(token);
    if (seat === undefined) throw new HttpError('You are not seated at this table', 403);
    return seat;
  }
  /** Starts every bot and plays their opening turns when the human does not sit first. */
  async initialize(): Promise<PracticeView> {
    await Promise.all(this.drivers.map((d) => d?.ready));
    return this.advance(this.humanSeat, []);
  }
  private view(
    seat: number,
    steps: PracticeStep[],
    notices: string[],
    ratings?: PracticeRating['ratings'],
  ): PracticeView {
    return {
      id: this.id,
      revision: this.state.decision,
      humanSeat: seat,
      seats: this.seats,
      view: { ...observe(this.state, seat), clock: this.clock.snapshot() },
      steps,
      notices,
      ratings,
      pending: this.botsToMove,
    };
  }
  private get botsToMove(): boolean {
    return this.state.status === 'playing' && this.seats[this.state.currentPlayer].kind === 'bot';
  }
  /** Closes the bots and rates the game once it has finished. */
  private async settle(): Promise<PracticeRating> {
    if (this.state.status !== 'finished') return { notices: [] };
    await this.close();
    return rateFinishedPractice(this.id, this.users, this.seats, this.state);
  }
  private record(entries: HistoryEntry[]) {
    this.history = appendHistory(this.history, entries, this.seats.length);
  }
  private async advance(seat: number, steps: PracticeStep[]): Promise<PracticeView> {
    const result = await playBots({
      state: this.state,
      clock: this.clock,
      humanSeat: seat,
      humanSeats: humanSeats(this.seats),
      drivers: this.drivers,
      disabled: this.disabled,
    });
    this.state = result.state;
    this.record(result.history);
    const rated = await this.settle();
    return this.view(
      seat,
      [...steps, ...result.steps],
      [...result.notices, ...rated.notices],
      rated.ratings,
    );
  }
  get finished(): boolean {
    return this.state.status === 'finished';
  }
  /**
   * The current board for a seat. With `since` (a revision the caller has shown), it also
   * carries the decisions made after it, so a waiting player can replay others' moves.
   */
  current(seat = this.humanSeat, since?: number): PracticeView {
    const steps =
      since === undefined
        ? []
        : this.history.filter((e) => e.state.decision > since).map((e) => stepFor(e, seat));
    return { ...this.view(seat, steps, []), busy: this.busy };
  }
  /** Seats the caller at the first open seat and returns their view with a seat token. */
  join(name: string): PracticeView {
    if (this.finished) throw new HttpError('This game has finished', 409);
    const seat = this.seats.findIndex((s) => s.kind === 'human' && s.open);
    if (seat < 0) throw new HttpError('This table has no open seat', 409);
    this.seats[seat] = { kind: 'human', name };
    const token = randomBytes(24).toString('base64url');
    this.guests.set(token, seat);
    this.touchedAt = Date.now();
    return { ...this.current(seat), seatToken: token };
  }
  private claim(revision: number) {
    if (this.finished) throw new HttpError('This game has finished', 409);
    if (this.busy || revision !== this.state.decision)
      throw new HttpError('The board changed; refresh and try again.', 409, {
        revision: this.state.decision,
      });
  }
  /**
   * Applies the human's move. With `split`, returns straight away so the board (the card dealt
   * into the gap, a visiting noble) updates at once; the bots then run on `advance`.
   */
  async act(
    action: unknown,
    revision: number,
    split = false,
    seat = this.humanSeat,
  ): Promise<PracticeView> {
    this.claim(revision);
    this.busy = true;
    this.touchedAt = Date.now();
    try {
      const { state, step, entry } = humanStep(
        { state: this.state, clock: this.clock, humanSeat: seat },
        action,
      );
      this.state = state;
      this.record([entry]);
      if (!split) return await this.advance(seat, [step]);
      const rated = await this.settle();
      return this.view(seat, [step], rated.notices, rated.ratings);
    } finally {
      this.busy = false;
    }
  }
  /** Plays the bots' replies after a split human move. */
  async advanceBots(revision: number, seat = this.humanSeat): Promise<PracticeView> {
    this.claim(revision);
    if (!this.botsToMove) return this.view(seat, [], []);
    this.busy = true;
    this.touchedAt = Date.now();
    try {
      return await this.advance(seat, []);
    } finally {
      this.busy = false;
    }
  }
  async close(): Promise<void> {
    await Promise.all(this.drivers.map((d) => d?.close()));
  }
  /** Ends the game; past the free turns it is rated as the human's loss. */
  async abandon(): Promise<string[]> {
    const notices = await rateAbandonedPractice(
      this.id,
      this.users,
      this.seats,
      this.state,
      this.humanSeat,
    );
    await this.close();
    return notices;
  }
}
const globals = globalThis as typeof globalThis & {
  splendorPractice?: Map<string, PracticeSession>;
};
export function practiceSessions(): Map<string, PracticeSession> {
  return (globals.splendorPractice ??= new Map());
}
/** Resolves requested opponents against saved bots; `INVITED_HUMAN` is an open seat (null). */
export function practiceOpponents(ids: string[]): (StoredBot | null)[] {
  const bots = getStore().listBots();
  return ids.map((id) => {
    if (id === INVITED_HUMAN) return null;
    const bot = bots.find((b) => b.id === id);
    if (!bot) throw new Error('Unknown opponent bot');
    return bot;
  });
}
/** Unfinished games idle this long are abandoned (and rated) like the hosted weekly sweep. */
const IDLE_MS = 7 * 86400000;
/** Finished boards linger briefly so joined players can still see the final moves. */
const FINISHED_MS = 10 * 60000;
/** Drops finished and idle boards; returns the one unfinished game, if any. */
async function sweep(): Promise<PracticeSession | undefined> {
  const sessions = practiceSessions();
  for (const [id, s] of sessions)
    if (!s.busy && Date.now() - s.touchedAt > (s.finished ? FINISHED_MS : IDLE_MS)) {
      await s.abandon();
      sessions.delete(id);
    }
  return [...sessions.values()].find((s) => !s.finished);
}
/** Local mode has one owner, so it keeps one unfinished game like each hosted account. */
export async function currentPractice(): Promise<PracticeView | null> {
  return (await sweep())?.current() ?? null;
}
export async function createPractice(
  options: PracticeOptions & { replace?: boolean; name?: string },
  config: ClockConfig = DEFAULT_CLOCK,
): Promise<{ session: PracticeSession; view: PracticeView }> {
  const sessions = practiceSessions();
  const active = await sweep();
  let abandoned: string[] = [];
  if (active) {
    if (!options.replace)
      throw new HttpError('Finish or abandon your unfinished game first', 409, {
        activeGameId: active.id,
      });
    if (active.busy)
      throw new HttpError('A move is still running in your current game; try again shortly', 409);
    abandoned = await active.abandon();
    sessions.delete(active.id);
  }
  const session = new PracticeSession(practiceOpponents(options.opponents), options, config);
  sessions.set(session.id, session);
  try {
    session.busy = true;
    const view = await session.initialize();
    return { session, view: { ...view, notices: [...abandoned, ...view.notices] } };
  } catch (error) {
    sessions.delete(session.id);
    await session.close();
    throw error;
  } finally {
    session.busy = false;
  }
}
