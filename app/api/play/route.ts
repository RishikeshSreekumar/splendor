import { isCloud, owner } from '@/src/server/cloud';
import { cloudPractice, currentCloudPractice } from '@/src/server/cloud-practice';
import { z } from 'zod';
import { createPractice, currentPractice, practiceSessions } from '@/src/server/practice';
import { apiError, clockSchema, HttpError, jsonBody, mutationOrigin } from '@/src/server/http';
import { enforceRateLimit, RATE_LIMITS } from '@/src/server/rate-limit';
import { MAX_OPPONENTS } from '@/src/practice/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** The caller's unfinished game (one per user), or `{ game: null }`. */
export async function GET(request: Request) {
  try {
    const user = await owner(request);
    await enforceRateLimit(request, RATE_LIMITS.gameRead, user);
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
          /** Abandon the caller's unfinished game instead of refusing with 409. */
          replace: z.boolean().default(false),
        }),
        z.object({
          type: z.literal('action'),
          id: z.string().uuid(),
          action: z.unknown(),
          revision: z.number().int(),
        }),
        z.object({ type: z.literal('close'), id: z.string().uuid() }),
      ])
      .parse(await jsonBody(request));
    const user = await owner(request);
    if (body.type !== 'close')
      await enforceRateLimit(
        request,
        body.type === 'new' ? RATE_LIMITS.gameStart : RATE_LIMITS.gameMove,
        user,
      );
    if (isCloud()) return Response.json(await cloudPractice(user, body));
    if (body.type === 'new')
      return Response.json((await createPractice(body, body.clockConfig)).view);
    const session = practiceSessions().get(body.id);
    if (!session)
      return Response.json({ error: 'Session expired. Start a new game.' }, { status: 404 });
    if (body.type === 'close') {
      if (session.busy)
        throw new HttpError('A move is still running; abandon the game once it finishes', 409);
      const notices = await session.abandon();
      practiceSessions().delete(body.id);
      return Response.json({ closed: true, notices });
    }
    return Response.json(await session.act(body.action, body.revision));
  } catch (error) {
    return apiError(error);
  }
}
