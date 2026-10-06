import { ChessClock } from '../clock';
import { BotRunner } from '../sandbox';
import { humanStep, playBots } from '../practice/bot-turns';
import type { PracticeStep } from '../practice/types';
import type { GameState, ClockSnapshot } from '../types';
export interface PracticeTurnInput {
  state: GameState;
  clock: ClockSnapshot;
  /** null advances bots without a human move, e.g. when the human does not sit first. */
  action: unknown;
  humanSeat?: number;
  /** Bot code per seat; null at the human seat. */
  seats?: ({ source: string; secrets?: Record<string, string> } | null)[];
  /** Legacy two-seat payload: the human at seat 0 against this source. */
  source?: string;
}
/** Runs inside a Modal sandbox: applies one human move, then every bot reply. */
export async function practiceTurn(input: PracticeTurnInput) {
  const humanSeat = input.humanSeat ?? 0;
  const seats = input.seats ?? [null, { source: input.source ?? '' }];
  const clock = ChessClock.restore(input.clock);
  let state = input.state;
  const steps: PracticeStep[] = [];
  if (input.action !== null) {
    const human = humanStep({ state, clock, humanSeat }, input.action);
    state = human.state;
    steps.push(human.step);
  }
  if (state.status === 'finished' || state.currentPlayer === humanSeat)
    return { state, clock: clock.snapshot(), steps, notices: [] };
  const drivers = seats.map((s, seat) =>
    s && seat !== humanSeat
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
    const result = await playBots({ state, clock, humanSeat, drivers, disabled });
    return {
      state: result.state,
      clock: clock.snapshot(),
      steps: [...steps, ...result.steps],
      notices: result.notices,
    };
  } finally {
    await Promise.all(drivers.map((d) => d?.close()));
  }
}
