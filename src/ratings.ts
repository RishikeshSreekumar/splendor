import { points } from './engine';
import type { GameRecord, GameState } from './types';
export const INITIAL_ELO = 1200;
export const ELO_K = 32;
/**
 * Beyond this rating gap a game cannot widen it: the lower-rated side never loses points and
 * the higher-rated side never gains. Upsets still move both ratings normally. This keeps
 * mismatched games (including against one's own bots) from farming rating.
 */
export const MISMATCH_GAP = 500;
/** One pairwise Elo update. `score` is a's result: 1 win, 0.5 draw, 0 loss. Zero-sum. */
export function eloPair(a: number, b: number, score: number, k = ELO_K) {
  if (![a, b, score, k].every(Number.isFinite) || score < 0 || score > 1 || k <= 0)
    throw new RangeError('Invalid Elo input');
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  let change = k * (score - expected);
  // Clamping a's change also clamps b's, since b moves by exactly −change.
  if (a - b > MISMATCH_GAP) change = Math.min(0, change);
  else if (b - a > MISMATCH_GAP) change = Math.max(0, change);
  return [a + change, b - change];
}
/**
 * Finishing order: 0 is first, tied seats share a rank (competition ranking). Live seats rank
 * by points, then fewer development cards (the rulebook tiebreak). Forfeited seats rank below
 * every live seat; whoever forfeited earlier ranks lower.
 */
export function placements(state: GameState, forfeited: number[] = []): number[] {
  const live = state.players
    .map((p, seat) => ({ seat, points: points(p), cards: p.cards.length }))
    .filter((p) => !forfeited.includes(p.seat))
    .sort((a, b) => b.points - a.points || a.cards - b.cards);
  const ranks = state.players.map(() => 0);
  live.forEach((p, i) => {
    const prev = live[i - 1];
    ranks[p.seat] =
      prev && prev.points === p.points && prev.cards === p.cards ? ranks[prev.seat] : i;
  });
  forfeited.forEach((seat, i) => (ranks[seat] = live.length + forfeited.length - 1 - i));
  return ranks;
}
/** Ranks for a stored game: recorded placements, or winners-first for older records. */
export function recordRanks(record: GameRecord): number[] {
  return (
    record.result.ranks ?? record.bots.map((_, s) => (record.result.winners.includes(s) ? 0 : 1))
  );
}
export type RatingKind = 'bot' | 'user';
export interface Participant {
  kind: RatingKind;
  id: string;
}
export const ratingKey = (p: Participant) => `${p.kind}:${p.id}`;
export interface RatedGame {
  participants: Participant[];
  ranks: number[];
  /** Rate only pairs that include this participant (an abandoned game is the human's loss). */
  focus?: number;
}
export interface Rating {
  key: string;
  kind: RatingKind;
  subjectId: string;
  elo: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
}
export interface RatingChange {
  key: string;
  before: number;
  after: number;
}
export function newRating(p: Participant): Rating {
  return {
    key: ratingKey(p),
    kind: p.kind,
    subjectId: p.id,
    elo: INITIAL_ELO,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
  };
}
/**
 * Applies games in order. Within one game every pair is compared by placement from the
 * pre-game ratings; K is split across opponents so a game weighs the same at any table size.
 * The same subject seated twice is only compared with the others. Mutates and returns `ratings`.
 */
export function rateGames(ratings: Map<string, Rating>, games: RatedGame[]): RatingChange[] {
  const before = new Map<string, number>();
  for (const game of games) {
    const keys = game.participants.map(ratingKey);
    for (const [i, p] of game.participants.entries()) {
      if (!ratings.has(keys[i])) ratings.set(keys[i], newRating(p));
      if (!before.has(keys[i])) before.set(keys[i], ratings.get(keys[i])!.elo);
    }
    const start = keys.map((k) => ratings.get(k)!.elo);
    const delta = keys.map(() => 0);
    const k = ELO_K / Math.max(1, keys.length - 1);
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        if (keys[i] === keys[j]) continue;
        if (game.focus !== undefined && i !== game.focus && j !== game.focus) continue;
        const score = game.ranks[i] < game.ranks[j] ? 1 : game.ranks[i] === game.ranks[j] ? 0.5 : 0;
        const [a, b] = eloPair(start[i], start[j], score, k);
        delta[i] += a - start[i];
        delta[j] += b - start[j];
      }
    const best = Math.min(...game.ranks);
    const seen = new Set<string>();
    keys.forEach((key, i) => {
      const r = ratings.get(key)!;
      r.elo += delta[i];
      if (seen.has(key)) return;
      seen.add(key);
      const ranks = keys.flatMap((k2, s) => (k2 === key ? [game.ranks[s]] : []));
      const top = Math.min(...ranks);
      r.games++;
      if (game.focus !== undefined && key !== keys[game.focus]) {
        // Only the focused participant was compared: record this side's result against it.
        const other = game.ranks[game.focus];
        if (top < other) r.wins++;
        else if (top === other) r.draws++;
        else r.losses++;
      } else if (top !== best) r.losses++;
      else if (game.ranks.filter((x) => x === best).length > 1) r.draws++;
      else r.wins++;
    });
  }
  return [...before].map(([key, b]) => ({ key, before: b, after: ratings.get(key)!.elo }));
}
/** Rated games from an evaluation report: ranked, rating-eligible games only. */
export function evaluationGames(report: { mode: string; games: GameRecord[] }): RatedGame[] {
  if (report.mode !== 'ranked') return [];
  return report.games
    .filter((g) => g.result.ratingEligible)
    .map((g) => ({
      participants: g.bots.map((b) => ({ kind: 'bot' as const, id: b.id })),
      ranks: recordRanks(g),
    }));
}
