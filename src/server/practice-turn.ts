import { ChessClock } from '../clock';
import { BotRunner } from '../sandbox';
import { humanStep, playBots, type HistoryEntry } from '../practice/bot-turns';
import type { PracticeStep } from '../practice/types';
import type { GameState, ClockSnapshot } from '../types';
export interface PracticeTurnInput {
  state: GameState;
  clock: ClockSnapshot;
  /** null advances bots without a human move, e.g. when the human does not sit first. */
  action: unknown;
  humanSeat?: number;
  /** Every seat played by a person on a shared table; defaults to `humanSeat`. */
  humanSeats?: number[];
  /** Bot code per seat; null at the human seat. */
  seats?: ({ source: string; secrets?: Record<string, string> } | null)[];
  /** Legacy two-seat payload: the human at seat 0 against this source. */
  source?: string;
}
/** Runs inside a Modal sandbox: applies one human move, then every bot reply. */
export async function practiceTurn(input: PracticeTurnInput) {
  const humanSeat = input.humanSeat ?? 0;
  const people = input.humanSeats ?? [humanSeat];
  const seats = input.seats ?? [null, { source: input.source ?? '' }];
  const clock = ChessClock.restore(input.clock);
  let state = input.state;
  const steps: PracticeStep[] = [],
    history: HistoryEntry[] = [];
  if (input.action !== null) {
    const human = humanStep({ state, clock, humanSeat }, input.action);
    state = human.state;
    steps.push(human.step);
    history.push(human.entry);
  }
  if (state.status === 'finished' || people.includes(state.currentPlayer))
    return { state, clock: clock.snapshot(), steps, history, notices: [] };
  const drivers = seats.map((s, seat) =>
    s && !people.includes(seat)
      ? new BotRunner(
          s.source,
          { memoryMb: 64, startupMs: 15000, seed: `practice-${seat}-${state.turn}` },
          s.secrets,
        )
      : null,
  );
  try {
    const disabled = new Set<number>();
    await Promise.all(drivers.map((d, seat) => d?.ready.catch(() => void disabled.add(seat))));
    const result = await playBots({
      state,
      clock,
      humanSeat,
      humanSeats: people,
      drivers,
      disabled,
    });
    return {
      state: result.state,
      clock: clock.snapshot(),
      steps: [...steps, ...result.steps],
      history: [...history, ...result.history],
      notices: result.notices,
    };
  } finally {
    await Promise.all(drivers.map((d) => d?.close()));
  }
}
