import { DEFAULT_CLOCK } from './clock';
import type {
  BotDefinition,
  ClockConfig,
  EvaluationReport,
  GameRecord,
  LeaderboardRow,
  Mode,
  RunnerOptions,
} from './types';
import { simulate, digest } from './simulation';
export function eloPair(a: number, b: number, score: number, k = 32) {
  if (![a, b, score, k].every(Number.isFinite) || score < 0 || score > 1 || k <= 0)
    throw new RangeError('Invalid Elo input');
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  const change = k * (score - expected);
  return [a + change, b - change];
}
export function winInterval(wins: number, games: number) {
  if (!games) return [0, 1];
  const z = 1.96,
    p = wins / games,
    d = 1 + (z * z) / games;
  const center = (p + (z * z) / (2 * games)) / d;
  const margin = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / d;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
/** Paired round robin, with independent deals and both seats for each fixture. */
export async function evaluate({
  bots,
  pairs = 5,
  seed = 'evaluation',
  mode = 'ranked',
  maxTurns = 400,
  runnerOptions = {},
  clockConfig = DEFAULT_CLOCK,
  onGame = () => {},
}: {
  bots: BotDefinition[];
  pairs?: number;
  seed?: string;
  mode?: Mode;
  maxTurns?: number;
  runnerOptions?: RunnerOptions;
  clockConfig?: ClockConfig;
  onGame?: (game: GameRecord, count: number) => void | Promise<void>;
}): Promise<EvaluationReport> {
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > 1000)
    throw new RangeError('pairs must be 1–1000');
  if (
    !Array.isArray(bots) ||
    bots.length < 2 ||
    new Set(bots.map((b) => b.id)).size !== bots.length
  )
    throw new TypeError('Need at least two distinct bot IDs');
  const ordered = [...bots].sort((a, b) => a.id.localeCompare(b.id));
  const rows = new Map<string, Omit<LeaderboardRow, 'provisional' | 'winRate' | 'winRate95'>>(
    ordered.map((b) => [
      b.id,
      {
        id: b.id,
        sourceHash: digest(b.source),
        elo: 1200,
        games: 0,
        ratedGames: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        forfeits: 0,
        faults: 0,
        decisions: 0,
        assistedDecisions: 0,
        unratedGames: 0,
      },
    ]),
  );
  const games: GameRecord[] = [];
  for (let round = 0; round < pairs; round++) {
    for (let i = 0; i < ordered.length; i++)
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i],
          b = ordered[j],
          fixture: GameRecord[] = [];
        const gameSeed = digest(`${seed}:${round}:${a.id}:${b.id}`);
        for (const seating of [
          [a, b],
          [b, a],
        ]) {
          const game = await simulate({
            bots: seating,
            seed: digest(`${gameSeed}:game:${fixture.length}`),
            mode,
            maxTurns,
            runnerOptions,
            clockConfig,
          });
          fixture.push(game);
          games.push(game);
          game.bots.forEach((bot, seat) => {
            const row = rows.get(bot.id)!;
            row.games++;
            row.faults += game.faults[seat];
            row.decisions += game.decisions[seat];
            row.assistedDecisions += game.log.filter(
              (e) => e.kind === 'action' && e.seat === seat && e.assisted,
            ).length;
            if (game.result.reason === 'forfeit' && !game.result.winners.includes(seat))
              row.forfeits++;
            if (!game.result.ratingEligible) row.unratedGames++;
          });
          await onGame(game, games.length);
        }
        // An incomplete/capped pair never changes ratings, avoiding first-seat bias.
        if (fixture.every((g) => g.result.ratingEligible)) {
          let aScore = 0;
          for (const game of fixture) {
            game.bots.forEach((bot, seat) => {
              const row = rows.get(bot.id)!,
                draw = game.result.winners.length !== 1;
              const score = draw ? 0.5 : Number(game.result.winners.includes(seat));
              row.ratedGames++;
              if (draw) row.draws++;
              else if (score === 1) row.wins++;
              else row.losses++;
              if (bot.id === a.id) aScore += score;
            });
          }
          const ra = rows.get(a.id)!,
            rb = rows.get(b.id)!;
          [ra.elo, rb.elo] = eloPair(ra.elo, rb.elo, aScore / 2);
        } else {
          // Count the otherwise-eligible half as unrated as well.
          for (const game of fixture.filter((g) => g.result.ratingEligible))
            for (const bot of game.bots) rows.get(bot.id)!.unratedGames++;
        }
      }
  }
  return {
    formatVersion: 2,
    dealPolicy: 'independent',
    seed,
    mode,
    pairs,
    clockConfig: { ...clockConfig },
    leaderboard: [...rows.values()]
      .map((row) => ({
        ...row,
        provisional: row.ratedGames < 30,
        winRate: row.ratedGames ? row.wins / row.ratedGames : null,
        winRate95: winInterval(row.wins, row.ratedGames),
      }))
      .sort((a, b) => b.elo - a.elo || a.id.localeCompare(b.id)),
    games,
  };
}
