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
  private busy = false;
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
    if (this.state.status === 'finished') await this.close();
    return this.view([...steps, ...result.steps], result.notices);
  }
  async act(action: unknown, revision: number): Promise<PracticeView> {
    if (this.busy || revision !== this.state.decision)
      throw new Error('The board changed; refresh and try again.');
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
export async function createPractice(
  options: PracticeOptions,
  config: ClockConfig = DEFAULT_CLOCK,
): Promise<{ session: PracticeSession; view: PracticeView }> {
  const sessions = practiceSessions();
  for (const [id, s] of sessions)
    if (Date.now() - s.touchedAt > 3600000) {
      await s.close();
      sessions.delete(id);
    }
  if (sessions.size >= 20)
    throw new Error('Too many practice sessions. Close an existing board first.');
  const session = new PracticeSession(practiceOpponents(options.opponents), options, config);
  try {
    const view = await session.initialize();
    sessions.set(session.id, session);
    return { session, view };
  } catch (error) {
    await session.close();
    throw error;
  }
}
