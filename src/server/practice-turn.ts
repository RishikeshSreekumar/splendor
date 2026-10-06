import { applyAction, observe, legalActions, InvalidAction } from '../engine';
import { ChessClock } from '../clock';
import { BotRunner, BotFault } from '../sandbox';
import type { GameState, ClockSnapshot } from '../types';
export async function practiceTurn(input: {
  state: GameState;
  clock: ClockSnapshot;
  action: unknown;
  source: string;
}) {
  let state = applyAction(input.state, input.action);
  const clock = ChessClock.restore(input.clock);
  const notices: string[] = [];
  if (state.status === 'finished' || state.currentPlayer === 0)
    return { state, clock: clock.snapshot(), notices };
  const runner = new BotRunner(input.source, {
    memoryMb: 64,
    startupMs: 15000,
    seed: `practice-${state.turn}`,
  });
  let assisted = false;
  try {
    await runner.ready;
    while (state.status === 'playing' && state.currentPlayer === 1) {
      const before = state.turn;
      const view = observe(state);
      try {
        if (clock.getRemaining(1) <= 0) throw new BotFault('TIMEOUT');
        const budget = clock.beginDecision(1);
        const action = await runner.chooseAction({ ...view, clock: clock.snapshot() }, budget);
        const charge = clock.endDecision(1);
        if (charge.expired) throw new BotFault('TIMEOUT');
        state = applyAction(state, action);
      } catch (error) {
        if (!(error instanceof BotFault) && !(error instanceof InvalidAction)) throw error;
        if (clock.snapshot().activeSeat !== null) clock.endDecision(1);
        const fallback = legalActions(state)[0];
        if (!fallback) throw new Error('No legal action');
        state = applyAction(state, fallback);
        assisted = true;
        notices.push('Greedy required a legal fallback; no increment awarded.');
      }
      if (state.turn > before) clock.completeTurn(1, before, assisted);
    }
  } finally {
    await runner.close();
  }
  return { state, clock: clock.snapshot(), notices };
}
