import { enforceRateLimit, RATE_LIMITS } from '@/src/server/rate-limit';
import { isCloud, owner } from '@/src/server/cloud';
import { CloudStore } from '@/src/server/cloud-store';
import { reconcileRun } from '@/src/server/modal-jobs';
import { apiError, streamJson } from '@/src/server/http';
import { getStore } from '@/src/server/store';
import { getQueue } from '@/src/server/jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isCloud()) {
    try {
      const id = (await params).id,
        user = await owner(_request),
        store = new CloudStore();
      await enforceRateLimit(_request, RATE_LIMITS.statusRead, user);
      const existing = await store.getJob(id, user);
      if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });
      await reconcileRun('evaluation', id);
      return streamJson(await store.getJob(id, user));
    } catch (error) {
      return apiError(error);
    }
  }
  try {
    await enforceRateLimit(_request, RATE_LIMITS.statusRead, await owner(_request));
  } catch (error) {
    return apiError(error);
  }
  getQueue();
  const job = getStore().getJob((await params).id);
  return job
    ? Response.json(job)
    : Response.json({ error: 'Evaluation not found' }, { status: 404 });
}
