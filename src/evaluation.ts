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
import { eloPair, recordRanks } from './ratings';
import { fixtureTables } from './fixtures';
export * from './fixtures';
export { eloPair } from './ratings';
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
    for (const table of fixtureTables(ordered)) {
      const fixture: GameRecord[] = [];
      // For two bots this is the original `${seed}:${round}:${a}:${b}` fixture seed.
      const tableSeed = digest(`${seed}:${round}:${table.map((b) => b.id).join(':')}`);
      // Rotations give every bot every seat once, with a fresh deal each game.
      for (let r = 0; r < table.length; r++) {
        const seating = table.map((_, i) => table[(i + r) % table.length]);
        const game = await simulate({
          bots: seating,
          seed: digest(`${tableSeed}:game:${fixture.length}`),
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
          if (mode === 'ranked' && game.faults[seat] > 0) row.forfeits++;
          if (!game.result.ratingEligible) row.unratedGames++;
        });
        await onGame(game, games.length);
      }
      // An incomplete fixture never changes ratings, avoiding seat-order bias.
      if (fixture.every((g) => g.result.ratingEligible)) {
        const score = new Map<string, number>();
        for (const game of fixture) {
          const ranks = recordRanks(game),
            best = Math.min(...ranks),
            shared = ranks.filter((r) => r === best).length > 1;
          game.bots.forEach((bot, seat) => {
            const row = rows.get(bot.id)!;
            row.ratedGames++;
            if (ranks[seat] !== best) row.losses++;
            else if (shared) row.draws++;
            else row.wins++;
            game.bots.forEach((other, o) => {
              if (o === seat) return;
              const key = `${bot.id}\n${other.id}`;
              const s = ranks[seat] < ranks[o] ? 1 : ranks[seat] === ranks[o] ? 0.5 : 0;
              score.set(key, (score.get(key) ?? 0) + s);
            });
          });
        }
        // Each pair's averaged result, from the ratings before this fixture.
        const start = new Map(table.map((b) => [b.id, rows.get(b.id)!.elo]));
        const k = 32 / (table.length - 1);
        for (let i = 0; i < table.length; i++)
          for (let j = i + 1; j < table.length; j++) {
            const a = table[i].id,
              b = table[j].id;
            const [na, nb] = eloPair(
              start.get(a)!,
              start.get(b)!,
              score.get(`${a}\n${b}`)! / fixture.length,
              k,
            );
            rows.get(a)!.elo += na - start.get(a)!;
            rows.get(b)!.elo += nb - start.get(b)!;
          }
      } else {
        // Count the otherwise-eligible games as unrated as well.
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
