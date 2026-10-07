import { database, isCloud } from './cloud';
import { getStore } from './store';
import {
  INITIAL_ELO,
  placements,
  rateGames,
  ratingKey,
  type Participant,
  type RatedGame,
  type Rating,
  type RatingChange,
} from '../ratings';
import type { PracticeSeat } from '../practice/types';
import type { GameState } from '../types';
/** Abandoning before your third turn is free (misclicks, changed setup); later it is a loss. */
export const FREE_ABANDON_TURNS = 3;
interface RatingRow {
  key: string;
  kind: Rating['kind'];
  subject_id: string;
  elo: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  version: number;
}
const fromRow = (r: RatingRow): Rating => ({
  key: r.key,
  kind: r.kind,
  subjectId: r.subject_id,
  elo: r.elo,
  games: r.games,
  wins: r.wins,
  draws: r.draws,
  losses: r.losses,
});
async function cloudRatings(keys: string[]): Promise<RatingRow[]> {
  const rows: RatingRow[] = [];
  // Keep PostgREST `in` filters to a modest URL length.
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await database()
      .from('splendor_ratings')
      .select('*')
      .in('key', keys.slice(i, i + 100));
    if (error) throw new Error(error.message);
    rows.push(...(data as RatingRow[]));
  }
  return rows;
}
/**
 * Applies a source's games to the global ladder exactly once. Returns the changes, or null
 * when the source was already applied (retries and repeated reconciliation are harmless).
 */
export async function applyRatings(
  source: string,
  games: RatedGame[],
): Promise<RatingChange[] | null> {
  if (!games.length) return [];
  if (!isCloud()) return getStore().applyRatings(source, games);
  const keys = [...new Set(games.flatMap((g) => g.participants.map(ratingKey)))];
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await cloudRatings(keys);
    const versions = new Map(rows.map((r) => [r.key, r.version]));
    const ratings = new Map(rows.map((r) => [r.key, fromRow(r)]));
    const changes = rateGames(ratings, games);
    const { error } = await database().rpc('splendor_apply_ratings', {
      p_source: source,
      p_rows: [...ratings.values()].map((r) => ({
        key: r.key,
        kind: r.kind,
        subject_id: r.subjectId,
        elo: r.elo,
        games: r.games,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        version: versions.get(r.key) ?? 0,
      })),
    });
    if (!error) return changes;
    if (error.code === 'SPL41') return null;
    if (error.code !== 'SPL40') throw new Error(error.message);
  }
  throw new Error('Ratings are busy; they will be applied on the next attempt');
}
/** Current ratings for the given subjects; missing subjects are unrated. */
export async function ratingsFor(participants: Participant[]): Promise<Map<string, Rating>> {
  const keys = [...new Set(participants.map(ratingKey))];
  const found = isCloud() ? (await cloudRatings(keys)).map(fromRow) : getStore().ratings(keys);
  return new Map(found.map((r) => [r.key, r]));
}
export async function topPlayers(limit = 100): Promise<Rating[]> {
  if (!isCloud())
    return getStore()
      .ratings()
      .filter((r) => r.kind === 'user')
      .slice(0, limit);
  const { data, error } = await database()
    .from('splendor_ratings')
    .select('*')
    .eq('kind', 'user')
    .order('elo', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as RatingRow[]).map(fromRow);
}
/** Adds global ratings to bot listings. */
export async function withRatings<T extends { id: string }>(
  bots: T[],
): Promise<(T & { elo: number; ratedGames: number })[]> {
  const ratings = await ratingsFor(bots.map((b) => ({ kind: 'bot', id: b.id })));
  return bots.map((b) => {
    const r = ratings.get(`bot:${b.id}`);
    return { ...b, elo: r?.elo ?? INITIAL_ELO, ratedGames: r?.games ?? 0 };
  });
}
function practiceGame(user: string, seats: PracticeSeat[]) {
  return seats.map((s): Participant =>
    s.kind === 'human' ? { kind: 'user', id: user } : { kind: 'bot', id: s.botId },
  );
}
function notices(changes: RatingChange[] | null, user: string, seats: PracticeSeat[]) {
  if (!changes?.length) return [];
  const names = new Map<string, string>([[`user:${user}`, 'You']]);
  for (const s of seats) if (s.kind === 'bot') names.set(`bot:${s.botId}`, s.name);
  const line = changes
    .map((c) => {
      const d = Math.round(c.after) - Math.round(c.before);
      return `${names.get(c.key) ?? c.key} ${Math.round(c.after)} (${d >= 0 ? '+' : '−'}${Math.abs(d)})`;
    })
    .join(' · ');
  return [`Ratings: ${line}`];
}
/** Rates a finished practice game by final placement: the human and every bot. */
export async function rateFinishedPractice(
  id: string,
  user: string,
  seats: PracticeSeat[],
  state: GameState,
): Promise<string[]> {
  if (state.status !== 'finished') return [];
  const changes = await applyRatings(`practice:${id}`, [
    { participants: practiceGame(user, seats), ranks: placements(state) },
  ]);
  return notices(changes, user, seats);
}
export const abandonIsRated = (state: GameState, humanSeat: number) =>
  state.status === 'playing' && state.players[humanSeat].turns >= FREE_ABANDON_TURNS;
/** An abandoned game after the free turns is the human's loss to every bot at the table. */
export async function rateAbandonedPractice(
  id: string,
  user: string,
  seats: PracticeSeat[],
  state: GameState,
  humanSeat: number,
): Promise<string[]> {
  if (!abandonIsRated(state, humanSeat)) return [];
  const changes = await applyRatings(`practice:${id}`, [
    {
      participants: practiceGame(user, seats),
      ranks: seats.map((_, s) => (s === humanSeat ? 1 : 0)),
      focus: humanSeat,
    },
  ]);
  return notices(changes, user, seats);
}
