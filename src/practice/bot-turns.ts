import {
  applyAction,
  assertInvariants,
  InvalidAction,
  legalActions,
  observe,
  validateAction,
} from '../engine';
import { BotFault } from '../sandbox';
import type { ChessClock } from '../clock';
import type { Action, GameState, Observation } from '../types';
import type { PracticeStep } from './types';
/** The part of BotRunner the practice table needs; tests can supply a stub. */
export interface BotDriver {
  chooseAction(observation: Observation, budgetMs: number): Promise<unknown>;
}
export interface TableInput {
  state: GameState;
  clock: ChessClock;
  humanSeat: number;
  /** Indexed by seat; null for the human seat or a bot that never started. */
  drivers: (BotDriver | null)[];
  /** Seats whose bot already faulted this game; they play the legal fallback. */
  disabled: Set<number>;
}
export interface TableResult {
  state: GameState;
  steps: PracticeStep[];
  notices: string[];
}
const snapshot = (state: GameState, clock: ChessClock, humanSeat: number): Observation => ({
  ...observe(state, humanSeat),
  clock: clock.snapshot(),
});
/** Applies the human decision. Throws InvalidAction without changing anything. */
export function humanStep(
  input: Pick<TableInput, 'state' | 'clock' | 'humanSeat'>,
  action: unknown,
): { state: GameState; step: PracticeStep } {
  if (input.state.status !== 'playing' || input.state.currentPlayer !== input.humanSeat)
    throw new Error('Wait for your turn');
  const legal = validateAction(input.state, action);
  const state = applyAction(input.state, legal);
  assertInvariants(state);
  return {
    state,
    step: {
      seat: input.humanSeat,
      action: legal,
      assisted: false,
      view: snapshot(state, input.clock, input.humanSeat),
    },
  };
}
/**
 * Runs every bot decision until the human seat must act or the game ends. A faulting bot
 * keeps playing through the deterministic legal fallback and earns no increment.
 */
export async function playBots(input: TableInput): Promise<TableResult> {
  const { clock, humanSeat, drivers, disabled } = input;
  let state = input.state;
  const steps: PracticeStep[] = [],
    notices: string[] = [];
  while (state.status === 'playing' && state.currentPlayer !== humanSeat) {
    const seat = state.currentPlayer,
      actions = legalActions(state);
    if (!actions.length) {
      notices.push('A bot has no legal action. This practice game cannot continue.');
      break;
    }
    const before = state.turn;
    let next: GameState | undefined, chosen: Action | undefined;
    const driver = drivers[seat];
    if (driver && !disabled.has(seat)) {
      try {
        if (clock.getRemaining(seat) <= 0) throw new BotFault('TIMEOUT');
        const budget = clock.beginDecision(seat);
        const candidate = await driver.chooseAction(snapshot(state, clock, seat), budget);
        if (clock.endDecision(seat).expired) throw new BotFault('TIMEOUT');
        chosen = validateAction(state, candidate);
        next = applyAction(state, chosen);
      } catch (error) {
        if (!(error instanceof BotFault) && !(error instanceof InvalidAction)) throw error;
        if (clock.snapshot().activeSeat !== null) clock.endDecision(seat);
        disabled.add(seat);
        notices.push(
          `Seat ${seat + 1}'s bot faulted (${error instanceof BotFault ? error.code : 'INVALID_ACTION'}); it now plays a legal fallback.`,
        );
      }
    } else disabled.add(seat);
    const assisted = !next;
    if (!next) {
      chosen = actions[0];
      next = applyAction(state, chosen);
    }
    if (next.turn > before) clock.completeTurn(seat, before, assisted);
    state = next;
    assertInvariants(state);
    steps.push({ seat, action: chosen!, assisted, view: snapshot(state, clock, humanSeat) });
  }
  return { state, steps, notices };
}
