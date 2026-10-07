import type { Action, Observation } from '../types';
/** Client-safe contracts for the practice table. Server modules implement them. */
export type SeatOrder = 'first' | 'random' | 'last';
/** A human seat is `open` until someone joins it from the table's invite link. */
export type PracticeSeat =
  { kind: 'human'; name: string; open?: boolean } | { kind: 'bot'; name: string; botId: string };
/** Opponent ID that seats an invited human instead of a bot. */
export const INVITED_HUMAN = 'human';
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
  /** A move (the human's and the bots' replies) is still being computed on the server. */
  busy?: boolean;
  /** The bots are to move: the human's move was applied alone; POST `advance` to run them. */
  pending?: boolean;
  /** Elo per seat once a finished game has been rated. */
  ratings?: SeatRating[];
  /** Returned once to a player joining a shared table; it authorizes their later requests. */
  seatToken?: string;
}
export interface SeatRating {
  seat: number;
  before: number;
  after: number;
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
/**
 * Seats bots around the human, numbering repeated bot names ("Greedy", "Greedy 2"). An
 * opponent with the `INVITED_HUMAN` ID becomes an open seat for a friend to join.
 */
export function arrangeSeats(
  humanSeat: number,
  bots: { id: string; name: string }[],
  humanName = 'You',
): PracticeSeat[] {
  const seen = new Map<string, number>();
  const named: PracticeSeat[] = bots.map((b) => {
    if (b.id === INVITED_HUMAN) return { kind: 'human', name: 'Open seat', open: true };
    const n = (seen.get(b.name) ?? 0) + 1;
    seen.set(b.name, n);
    return { kind: 'bot', botId: b.id, name: n > 1 ? `${b.name} ${n}` : b.name };
  });
  named.splice(humanSeat, 0, { kind: 'human', name: humanName });
  return named;
}
/** Seats played by people (joined or still open); the bots stop at each of them. */
export const humanSeats = (seats: PracticeSeat[]) =>
  seats.flatMap((s, i) => (s.kind === 'human' ? [i] : []));
