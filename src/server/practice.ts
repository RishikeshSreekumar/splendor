import { randomUUID, randomBytes } from 'node:crypto';
import { BotRunner, BotFault } from '../sandbox';
import { ChessClock, DEFAULT_CLOCK } from '../clock';
import {
  createGame,
  applyAction,
  legalActions,
  observe,
  assertInvariants,
  InvalidAction,
} from '../engine';
import { getStore } from './store';
import type { ClockConfig, GameState, Observation } from '../types';
export interface PracticeView {
  id: string;
  view: Observation;
  notices: string[];
  revision: number;
}
export class PracticeSession {
  readonly id = randomUUID();
  private state: GameState;
  private runner: BotRunner;
  private clock: ChessClock;
  private disabled = false;
  private busy = false;
  private notices: string[] = [];
  touchedAt = Date.now();
  constructor(config: ClockConfig = DEFAULT_CLOCK) {
    const seed = randomBytes(32).toString('hex');
    this.state = createGame({ seed });
    const baseline = getStore()
      .listBots()
      .find((b) => b.baseline && b.name === 'Greedy')!;
    this.runner = new BotRunner(baseline.source, { seed: `${seed}:bot` });
    this.clock = new ChessClock(2, config);
  }
  async initialize(): Promise<void> {
    await this.runner.ready;
  }
  snapshot(): PracticeView {
    return {
      id: this.id,
      view: { ...observe(this.state, 0), clock: this.clock.snapshot() },
      notices: this.notices,
      revision: this.state.decision,
    };
  }
  async act(action: unknown, revision: number): Promise<PracticeView> {
    if (this.busy || revision !== this.state.decision)
      throw new Error('The board changed; refresh and try again.');
    if (this.state.currentPlayer !== 0) throw new Error('Wait for your turn');
    this.busy = true;
    this.touchedAt = Date.now();
    this.notices = [];
    try {
      this.state = applyAction(this.state, action);
      await this.runner.ready;
      let assistedTurn = false;
      while (this.state.status === 'playing' && this.state.currentPlayer === 1) {
        const actions = legalActions(this.state);
        if (!actions.length) {
          this.notices.push('The bot has no legal action. This practice session is incomplete.');
          break;
        }
        const oldTurn = this.state.turn;
        let next: GameState | undefined;
        if (!this.disabled) {
          const view = observe(this.state),
            budget = this.clock.beginDecision(1);
          try {
            const candidate = await this.runner.chooseAction(
              { ...view, clock: this.clock.snapshot() },
              budget,
            );
            const charge = this.clock.endDecision(1);
            if (charge.expired) throw new BotFault('TIMEOUT');
            next = applyAction(this.state, candidate);
          } catch (error) {
            if (!(error instanceof BotFault) && !(error instanceof InvalidAction)) throw error;
            if (this.clock.snapshot().activeSeat !== null) this.clock.endDecision(1);
            this.disabled = true;
            this.notices.push(
              'The bot could not complete its decision. Legal fallback is active for this practice game.',
            );
          }
        }
        if (!next) {
          next = applyAction(this.state, actions[0]);
          assistedTurn = true;
        }
        if (next.turn > oldTurn) {
          this.clock.completeTurn(1, oldTurn, assistedTurn);
          assistedTurn = false;
        }
        this.state = next;
        assertInvariants(this.state);
      }
      if (this.state.status === 'finished') await this.close();
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }
  close(): Promise<void> {
    return this.runner.close();
  }
}
const globals = globalThis as typeof globalThis & {
  splendorPractice?: Map<string, PracticeSession>;
};
export function practiceSessions(): Map<string, PracticeSession> {
  return (globals.splendorPractice ??= new Map());
}
export async function createPractice(config: ClockConfig): Promise<PracticeSession> {
  const sessions = practiceSessions();
  for (const [id, s] of sessions)
    if (Date.now() - s.touchedAt > 3600000) {
      await s.close();
      sessions.delete(id);
    }
  if (sessions.size >= 20)
    throw new Error('Too many practice sessions. Close an existing board first.');
  const session = new PracticeSession(config);
  try {
    await session.initialize();
    sessions.set(session.id, session);
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}
