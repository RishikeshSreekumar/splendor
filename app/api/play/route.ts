import { isCloud, owner } from '@/src/server/cloud';
import { cloudPractice } from '@/src/server/cloud-practice';
import { z } from 'zod';
import { createPractice, practiceSessions } from '@/src/server/practice';
import { apiError, clockSchema, jsonBody, mutationOrigin } from '@/src/server/http';
import { MAX_OPPONENTS } from '@/src/practice/types';
export const runtime = 'nodejs';
export const maxDuration = 60;
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
    if (isCloud()) return Response.json(await cloudPractice(await owner(request), body));
    if (body.type === 'new')
      return Response.json((await createPractice(body, body.clockConfig)).view);
    const session = practiceSessions().get(body.id);
    if (!session)
      return Response.json({ error: 'Session expired. Start a new game.' }, { status: 404 });
    if (body.type === 'close') {
      await session.close();
      practiceSessions().delete(body.id);
      return Response.json({ closed: true });
    }
    return Response.json(await session.act(body.action, body.revision));
  } catch (error) {
    return apiError(error);
  }
}
