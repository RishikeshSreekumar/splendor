import { ChessClock, DEFAULT_CLOCK } from './clock';
import type {
  Action,
  BotDefinition,
  ClockConfig,
  GameEvent,
  GameRecord,
  MatchResult,
  Mode,
  RunnerOptions,
} from './types';
import { createHash } from 'node:crypto';
import { BotRunner, BotFault } from './sandbox';
import {
  createGame,
  observe,
  applyAction,
  legalActions,
  assertInvariants,
  points,
  RULES_VERSION,
  InvalidAction,
} from './engine';
import { random } from './random';
import { placements } from './ratings';
export const digest = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export async function simulate({
  bots,
  seed = 'game',
  mode = 'ranked',
  maxTurns = 400,
  runnerOptions = {},
  clockConfig = DEFAULT_CLOCK,
}: {
  bots: BotDefinition[];
  seed?: string;
  mode?: Mode;
  maxTurns?: number;
  runnerOptions?: RunnerOptions;
  clockConfig?: ClockConfig;
}): Promise<GameRecord> {
  if (!Array.isArray(bots) || bots.length < 2 || bots.length > 4)
    throw new RangeError('Expected 2–4 bots');
  if (!['ranked', 'practice'].includes(mode)) throw new RangeError('Unknown evaluation mode');
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 10000)
    throw new RangeError('maxTurns must be 1–10000');
  if (
    bots.some((b) => !b || typeof b.id !== 'string' || !b.id || typeof b.source !== 'string') ||
    new Set(bots.map((b) => b.id)).size !== bots.length
  )
    throw new TypeError('Bots need unique IDs and JavaScript source');
  let state = createGame({ players: bots.length, seed });
  const clock = new ChessClock(bots.length, clockConfig);
  const assistedTurns = bots.map(() => false);
  const log: GameEvent[] = [];
  const faults = bots.map(() => 0),
    decisions = bots.map(() => 0),
    disabled = bots.map(() => false);
  const fallbackRng = random(`${seed}:fallback`),
    runners: BotRunner[] = [];
  let result: MatchResult | null = null;
  /** Ranked seats eliminated by a fault, in order. They keep moving by fallback, unranked. */
  const forfeited: number[] = [];
  const survivors = () => bots.flatMap((_, s) => (forfeited.includes(s) ? [] : [s]));
  const forfeitResult = (): MatchResult => ({
    reason: 'forfeit',
    winners: survivors(),
    ranks: placements(state, forfeited),
    ratingEligible: true,
  });
  const recordFault = (
    seat: number,
    code: string,
    stage: 'startup' | 'decision',
    attempted?: unknown,
  ) => {
    faults[seat]++;
    log.push({
      kind: 'fault',
      seat,
      code,
      stage,
      clock: clock.snapshot(),
      decision: state.decision,
      ...(attempted === undefined || Object.keys(bots[seat].secrets ?? {}).length
        ? {}
        : { attempted }),
    });
  };
  try {
    for (const bot of bots)
      runners.push(
        new BotRunner(
          bot.source,
          { ...runnerOptions, seed: digest(`${seed}:bot:${bot.id}`) },
          bot.secrets,
        ),
      );
    const starts = await Promise.allSettled(runners.map((r) => r.ready));
    starts.forEach((start, seat) => {
      if (start.status === 'rejected') {
        disabled[seat] = true;
        recordFault(seat, start.reason.code ?? 'BOT_ERROR', 'startup');
      }
    });
    if (mode === 'ranked' && disabled.some(Boolean)) {
      disabled.forEach((v, seat) => v && forfeited.push(seat));
      if (disabled.every(Boolean))
        result = { reason: 'both_failed', winners: [], ratingEligible: false };
      // With two or more healthy bots left, a multiplayer table plays on.
      else if (survivors().length === 1) result = forfeitResult();
    }
    while (!result && state.status === 'playing') {
      if (state.turn >= maxTurns) {
        result = { reason: 'turn_limit', winners: [], ratingEligible: false };
        break;
      }
      const seat = state.currentPlayer,
        actions = legalActions(state);
      if (!actions.length) {
        result = { reason: 'no_legal_action', winners: [], ratingEligible: false };
        break;
      }
      let action: unknown,
        next,
        assisted = false,
        elapsedMs = 0;
      if (!disabled[seat]) {
        decisions[seat]++;
        const observation = observe(state);
        const budgetMs = clock.beginDecision(seat);
        let fault: BotFault | undefined;
        try {
          action = await runners[seat].chooseAction(
            { ...observation, clock: clock.snapshot() },
            budgetMs,
          );
        } catch (error) {
          if (!(error instanceof BotFault)) throw error;
          fault = error;
        } finally {
          const charge = clock.endDecision(seat);
          elapsedMs = charge.elapsedMs;
          if (charge.expired) fault = new BotFault('TIMEOUT');
        }
        if (fault) {
          disabled[seat] = true;
          recordFault(seat, fault.code, 'decision');
        }
        if (!disabled[seat]) {
          try {
            next = applyAction(state, action);
          } catch (error) {
            // Engine failures must fail the job, never penalize a bot or become fallbacks.
            if (!(error instanceof InvalidAction)) throw error;
            recordFault(seat, 'INVALID_ACTION', 'decision', action);
          }
        }
      }
      if (!next) {
        if (mode === 'ranked') {
          if (!forfeited.includes(seat)) forfeited.push(seat);
          if (survivors().length <= 1) {
            result = forfeitResult();
            break;
          }
        }
        assisted = true;
        action = actions[Math.floor(fallbackRng() * actions.length)];
        next = applyAction(state, action);
      }
      assertInvariants(next);
      assistedTurns[seat] ||= assisted;
      if (next.turn > state.turn) {
        clock.completeTurn(seat, state.turn, assistedTurns[seat]);
        assistedTurns[seat] = false;
      }
      log.push({
        kind: 'action',
        seat,
        decision: state.decision,
        action: action as Action,
        assisted,
        stateHash: digest(next),
        elapsedMs,
        clock: clock.snapshot(),
      });
      state = next;
    }
    if (!result) {
      const ranks = placements(state, forfeited);
      result = {
        reason: 'completed',
        winners: forfeited.length ? ranks.flatMap((r, s) => (r === 0 ? [s] : [])) : state.winners,
        ranks,
        ratingEligible: mode === 'ranked',
      };
    }
    return {
      formatVersion: 2,
      rulesVersion: RULES_VERSION,
      seed,
      mode,
      maxTurns,
      bots: bots.map((b) => ({ id: b.id, sourceHash: digest(b.source) })),
      clock: clock.snapshot(),
      runnerOptions: { initializationMs: 1000, memoryMb: 16, startupMs: 5000, ...runnerOptions },
      result,
      scores: state.players.map(points),
      turns: state.turn,
      decisions,
      faults,
      assistedDecisions: log.filter((e) => e.kind === 'action' && e.assisted).length,
      log,
      finalStateHash: digest(state),
    };
  } finally {
    await Promise.all(runners.map((r) => r.close()));
  }
}
/** Private replay artifact: contains the deal seed. Publish only after a match ends. */
export function replay(record: GameRecord) {
  if (record.rulesVersion !== RULES_VERSION || ![1, 2].includes(record.formatVersion))
    throw new Error('Replay version mismatch');
  let state = createGame({ players: record.bots.length, seed: record.seed });
  for (const event of record.log) {
    if (event.kind !== 'action') continue;
    if (event.seat !== state.currentPlayer || event.decision !== state.decision)
      throw new Error('Replay turn mismatch');
    state = applyAction(state, event.action);
    if (digest(state) !== event.stateHash) throw new Error('Replay state hash mismatch');
  }
  if (digest(state) !== record.finalStateHash) throw new Error('Replay final hash mismatch');
  return state;
}
