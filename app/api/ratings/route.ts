import { isCloud, optionalOwner, owner } from '@/src/server/cloud';
import { CloudStore } from '@/src/server/cloud-store';
import { getStore } from '@/src/server/store';
import { apiError } from '@/src/server/http';
import { enforceRateLimit, RATE_LIMITS } from '@/src/server/rate-limit';
import { ratingsFor, topPlayers, withRatings } from '@/src/server/ratings';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Pseudonymous player handles: account emails are never published. */
const handle = (id: string) => `Player ${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
/**
 * The global ladder. Bots: every bot the caller can see (qualified public bots and their own),
 * unrated ones at the initial rating. Players: the top 100 human ratings.
 */
export async function GET(request: Request) {
  try {
    // Local mode has one implicit account; hosted callers may be anonymous.
    const user = isCloud() ? await optionalOwner(request) : await owner(request);
    await enforceRateLimit(request, RATE_LIMITS.statusRead, user);
    const listed = isCloud() ? await new CloudStore().listBots(user) : getStore().listBots();
    const bots = (
      await withRatings(listed.filter((b) => (b.qualification ?? 'passed') === 'passed'))
    )
      .map((b) => ({
        id: b.id,
        name: b.name,
        baseline: b.baseline,
        mine: Boolean(user && 'ownerId' in b && b.ownerId === user),
        elo: Math.round(b.elo),
        games: b.ratedGames,
        createdAt: b.createdAt,
      }))
      .sort((a, b) => b.elo - a.elo || b.games - a.games);
    const players = (await topPlayers()).map((r) => ({
      name: r.subjectId === user ? 'You' : handle(r.subjectId),
      you: r.subjectId === user,
      elo: Math.round(r.elo),
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
    }));
    const mine = user
      ? (await ratingsFor([{ kind: 'user', id: user }])).get(`user:${user}`)
      : undefined;
    const me = mine ? { elo: Math.round(mine.elo), games: mine.games } : null;
    return Response.json(
      { bots, players, me },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
