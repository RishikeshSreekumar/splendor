import type { Action, Observation } from '../types';
/** Client-safe contracts for the practice table. Server modules implement them. */
export type SeatOrder = 'first' | 'random' | 'last';
export type PracticeSeat =
  { kind: 'human'; name: string } | { kind: 'bot'; name: string; botId: string };
/** One applied decision plus the human seat's view immediately after it. */
export interface PracticeStep {
  seat: number;
  action: Action;
  assisted: boolean;
  view: Observation;
}
export interface PracticeView {
  id: string;
  revision: number;
  humanSeat: number;
  seats: PracticeSeat[];
  view: Observation;
  /** Decisions applied by this request, in order: the human move (if any) and every bot reply. */
  steps: PracticeStep[];
  notices: string[];
}
export interface PracticeOptions {
  opponents: string[];
  order: SeatOrder;
}
export const MAX_OPPONENTS = 3;
export function chooseHumanSeat(order: SeatOrder, players: number, roll = Math.random()): number {
  if (order === 'first') return 0;
  if (order === 'last') return players - 1;
  return Math.min(players - 1, Math.floor(roll * players));
}
/** Seats bots around the human, numbering repeated bot names ("Greedy", "Greedy 2"). */
export function arrangeSeats(
  humanSeat: number,
  bots: { id: string; name: string }[],
  humanName = 'You',
): PracticeSeat[] {
  const seen = new Map<string, number>();
  const named: PracticeSeat[] = bots.map((b) => {
    const n = (seen.get(b.name) ?? 0) + 1;
    seen.set(b.name, n);
    return { kind: 'bot', botId: b.id, name: n > 1 ? `${b.name} ${n}` : b.name };
  });
  named.splice(humanSeat, 0, { kind: 'human', name: humanName });
  return named;
}
