import { isCloud, owner } from '@/src/server/cloud';
import {
  cloudPractice,
  cloudPracticeTable,
  currentCloudPractice,
} from '@/src/server/cloud-practice';
import { z } from 'zod';
import { createPractice, currentPractice, practiceSessions } from '@/src/server/practice';
import { apiError, clockSchema, HttpError, jsonBody, mutationOrigin } from '@/src/server/http';
import { enforceRateLimit, RATE_LIMITS } from '@/src/server/rate-limit';
import { MAX_OPPONENTS } from '@/src/practice/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const playerName = z.string().trim().min(1).max(24);
const seatToken = z.string().min(16).max(128).optional();
/**
 * The caller's unfinished game (one per user), or `{ game: null }`. With `id` (and a joined
 * player's `token`), that table's board; `since` adds the moves made after that revision.
 */
export async function GET(request: Request) {
  try {
    const user = await owner(request);
    await enforceRateLimit(request, RATE_LIMITS.gameRead, user);
    const params = new URL(request.url).searchParams;
    if (params.has('id')) {
      const query = z
        .object({
          id: z.string().uuid(),
          token: seatToken,
          since: z.coerce.number().int().optional(),
        })
        .parse(Object.fromEntries(params));
      if (isCloud()) return Response.json({ game: await cloudPracticeTable(user, query) });
      const session = practiceSessions().get(query.id);
      if (!session) throw new HttpError('This game has ended.', 404);
      return Response.json({ game: session.current(session.seatOf(query.token), query.since) });
    }
    return Response.json({
      game: isCloud() ? await currentCloudPractice(user) : await currentPractice(),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationOrigin(request);
    const body = z
      .discriminatedUnion('type', [
        z.object({
          type: z.literal('new'),
          clockConfig: clockSchema,
          opponents: z.array(z.string().min(1).max(64)).min(1).max(MAX_OPPONENTS),
          order: z.enum(['first', 'random', 'last']).default('first'),
          /** The host's name at a table with invited players. */
          name: playerName.optional(),
          /** Abandon the caller's unfinished game instead of refusing with 409. */
          replace: z.boolean().default(false),
        }),
        z.object({
          type: z.literal('action'),
          id: z.string().uuid(),
          action: z.unknown(),
          revision: z.number().int(),
          /** Apply only the human's move and answer at once; the bots run on `advance`. */
          split: z.boolean().default(false),
          token: seatToken,
        }),
        z.object({
          type: z.literal('advance'),
          id: z.string().uuid(),
          revision: z.number().int(),
          token: seatToken,
        }),
        z.object({ type: z.literal('close'), id: z.string().uuid() }),
        /** Takes an open seat at a shared table; the answer carries the seat token. */
        z.object({ type: z.literal('join'), id: z.string().uuid(), name: playerName }),
      ])
      .parse(await jsonBody(request));
    const user = await owner(request);
    // A split human move runs no sandbox; its bots are charged on `advance`.
    if (body.type !== 'close')
      await enforceRateLimit(
        request,
        body.type === 'new'
          ? RATE_LIMITS.gameStart
          : (body.type === 'action' && body.split) || body.type === 'join'
            ? RATE_LIMITS.gameRead
            : RATE_LIMITS.gameMove,
        user,
      );
    if (isCloud()) return Response.json(await cloudPractice(user, body));
    if (body.type === 'new')
      return Response.json((await createPractice(body, body.clockConfig)).view);
    const session = practiceSessions().get(body.id);
    if (!session)
      return Response.json({ error: 'Session expired. Start a new game.' }, { status: 404 });
    if (body.type === 'join') return Response.json(session.join(body.name));
    if (body.type === 'close') {
      if (session.busy)
        throw new HttpError('A move is still running; abandon the game once it finishes', 409);
      const notices = await session.abandon();
      practiceSessions().delete(body.id);
      return Response.json({ closed: true, notices });
    }
    const seat = session.seatOf(body.token);
    if (body.type === 'advance')
      return Response.json(await session.advanceBots(body.revision, seat));
    return Response.json(await session.act(body.action, body.revision, body.split, seat));
  } catch (error) {
    return apiError(error);
  }
}
