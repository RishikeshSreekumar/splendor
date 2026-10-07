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
import type { Action, ClockSnapshot, GameState, Observation } from '../types';
import type { PracticeStep } from './types';
/** The part of BotRunner the practice table needs; tests can supply a stub. */
export interface BotDriver {
  chooseAction(observation: Observation, budgetMs: number): Promise<unknown>;
}
export interface TableInput {
  state: GameState;
  clock: ChessClock;
  /** The seat whose view each step carries (the requesting player). */
  humanSeat: number;
  /** Every seat played by a person; the bots stop at any of them. Defaults to `humanSeat`. */
  humanSeats?: number[];
  /** Indexed by seat; null for the human seat or a bot that never started. */
  drivers: (BotDriver | null)[];
  /** Seats whose bot already faulted this game; they play the legal fallback. */
  disabled: Set<number>;
}
/** One applied decision with the full state after it, so any seat's view can be derived. */
export interface HistoryEntry {
  seat: number;
  action: Action;
  assisted: boolean;
  state: GameState;
  clock: ClockSnapshot;
}
export interface TableResult {
  state: GameState;
  steps: PracticeStep[];
  history: HistoryEntry[];
  notices: string[];
}
const snapshot = (state: GameState, clock: ChessClock, humanSeat: number): Observation => ({
  ...observe(state, humanSeat),
  clock: clock.snapshot(),
});
/** A recorded decision as one seat saw it. */
export const stepFor = (entry: HistoryEntry, viewer: number): PracticeStep => ({
  seat: entry.seat,
  action: entry.action,
  assisted: entry.assisted,
  view: { ...observe(entry.state, viewer), clock: entry.clock },
});
/** Keeps the latest decisions: enough for a polling player to replay what they missed. */
export function appendHistory(
  history: HistoryEntry[],
  entries: HistoryEntry[],
  players: number,
): HistoryEntry[] {
  return [...history, ...entries].slice(-4 * players);
}
/** Applies the human decision. Throws InvalidAction without changing anything. */
export function humanStep(
  input: Pick<TableInput, 'state' | 'clock' | 'humanSeat'>,
  action: unknown,
): { state: GameState; step: PracticeStep; entry: HistoryEntry } {
  if (input.state.status !== 'playing' || input.state.currentPlayer !== input.humanSeat)
    throw new Error('Wait for your turn');
  const legal = validateAction(input.state, action);
  const state = applyAction(input.state, legal);
  assertInvariants(state);
  const entry = {
    seat: input.humanSeat,
    action: legal,
    assisted: false,
    state,
    clock: input.clock.snapshot(),
  };
  return { state, step: stepFor(entry, input.humanSeat), entry };
}
/**
 * Runs every bot decision until a human seat must act or the game ends. A faulting bot
 * keeps playing through the deterministic legal fallback and earns no increment.
 */
export async function playBots(input: TableInput): Promise<TableResult> {
  const { clock, humanSeat, drivers, disabled } = input;
  const people = input.humanSeats ?? [humanSeat];
  let state = input.state;
  const history: HistoryEntry[] = [],
    notices: string[] = [];
  while (state.status === 'playing' && !people.includes(state.currentPlayer)) {
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
    history.push({ seat, action: chosen!, assisted, state, clock: clock.snapshot() });
  }
  return { state, steps: history.map((e) => stepFor(e, humanSeat)), history, notices };
}
