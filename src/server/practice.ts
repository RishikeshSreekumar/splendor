import { randomUUID, randomBytes } from 'node:crypto';
import { BotRunner } from '../sandbox';
import { ChessClock, DEFAULT_CLOCK } from '../clock';
import { createGame, observe } from '../engine';
import { humanStep, playBots } from '../practice/bot-turns';
import {
  arrangeSeats,
  chooseHumanSeat,
  type PracticeOptions,
  type PracticeSeat,
  type PracticeStep,
  type PracticeView,
} from '../practice/types';
import { getStore, type StoredBot } from './store';
import { HttpError } from './http';
import { LOCAL_OWNER } from './cloud';
import { rateAbandonedPractice, rateFinishedPractice } from './ratings';
import type { ClockConfig, GameState } from '../types';
export type { PracticeView } from '../practice/types';
/** An in-memory table for local mode: one human seat and 1–3 sandboxed bots. */
export class PracticeSession {
  readonly id = randomUUID();
  readonly seats: PracticeSeat[];
  readonly humanSeat: number;
  private state: GameState;
  private drivers: (BotRunner | null)[];
  private clock: ChessClock;
  private disabled = new Set<number>();
  busy = false;
  touchedAt = Date.now();
  constructor(opponents: StoredBot[], options: PracticeOptions, config: ClockConfig) {
    const seed = randomBytes(32).toString('hex'),
      players = opponents.length + 1;
    this.humanSeat = chooseHumanSeat(options.order, players);
    this.seats = arrangeSeats(this.humanSeat, opponents);
    this.state = createGame({ players, seed });
    this.clock = new ChessClock(players, config);
    let next = 0;
    this.drivers = this.seats.map((s) =>
      s.kind === 'human'
        ? null
        : new BotRunner(opponents[next++].source, { seed: `${seed}:bot:${next}` }),
    );
  }
  /** Starts every bot and plays their opening turns when the human does not sit first. */
  async initialize(): Promise<PracticeView> {
    await Promise.all(this.drivers.map((d) => d?.ready));
    return this.advance([]);
  }
  private view(steps: PracticeStep[], notices: string[]): PracticeView {
    return {
      id: this.id,
      revision: this.state.decision,
      humanSeat: this.humanSeat,
      seats: this.seats,
      view: { ...observe(this.state, this.humanSeat), clock: this.clock.snapshot() },
      steps,
      notices,
    };
  }
  private async advance(steps: PracticeStep[]): Promise<PracticeView> {
    const result = await playBots({
      state: this.state,
      clock: this.clock,
      humanSeat: this.humanSeat,
      drivers: this.drivers,
      disabled: this.disabled,
    });
    this.state = result.state;
    const notices = [...result.notices];
    if (this.state.status === 'finished') {
      await this.close();
      notices.push(...(await rateFinishedPractice(this.id, LOCAL_OWNER, this.seats, this.state)));
    }
    return this.view([...steps, ...result.steps], notices);
  }
  get finished(): boolean {
    return this.state.status === 'finished';
  }
  /** The current board without replaying earlier moves, for resuming a game. */
  current(): PracticeView {
    return { ...this.view([], []), busy: this.busy };
  }
  async act(action: unknown, revision: number): Promise<PracticeView> {
    if (this.finished) throw new HttpError('This game has finished', 409);
    if (this.busy || revision !== this.state.decision)
      throw new HttpError('The board changed; refresh and try again.', 409, {
        revision: this.state.decision,
      });
    this.busy = true;
    this.touchedAt = Date.now();
    try {
      const { state, step } = humanStep(
        { state: this.state, clock: this.clock, humanSeat: this.humanSeat },
        action,
      );
      this.state = state;
      return await this.advance([step]);
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
      LOCAL_OWNER,
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
/** Resolves requested opponents against saved bots; unknown IDs are rejected. */
export function practiceOpponents(ids: string[]): StoredBot[] {
  const bots = getStore().listBots();
  return ids.map((id) => {
    const bot = bots.find((b) => b.id === id);
    if (!bot) throw new Error('Unknown opponent bot');
    return bot;
  });
}
/** Unfinished games idle this long are abandoned (and rated) like the hosted weekly sweep. */
const IDLE_MS = 7 * 86400000;
/** Drops finished and idle boards; returns the one unfinished game, if any. */
async function sweep(): Promise<PracticeSession | undefined> {
  const sessions = practiceSessions();
  for (const [id, s] of sessions)
    if (!s.busy && (s.finished || Date.now() - s.touchedAt > IDLE_MS)) {
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
  options: PracticeOptions & { replace?: boolean },
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
