import { isCloud, owner, optionalOwner } from '@/src/server/cloud';
import { CloudStore } from '@/src/server/cloud-store';
import { launchEvaluation, reconcileRun } from '@/src/server/modal-jobs';
import { z } from 'zod';
import { getStore } from '@/src/server/store';
import { getQueue } from '@/src/server/jobs';
import { apiError, clockSchema, jsonBody, mutationOrigin } from '@/src/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (isCloud()) {
    try {
      const user = await optionalOwner(request);
      if (!user) return Response.json([]);
      const store = new CloudStore();
      const jobs = await store.listJobs(user);
      for (const j of jobs
        .filter((j) => j.status === 'running' || j.status === 'queued')
        .slice(0, 2))
        await reconcileRun('evaluation', j.id);
      return Response.json(await store.listJobs(user));
    } catch (error) {
      return apiError(error);
    }
  }
  getQueue();
  return Response.json(getStore().listJobs());
}
export async function POST(request: Request) {
  try {
    mutationOrigin(request);
    const user = await owner(request);
    const config = z
      .object({
        botIds: z.array(z.string().uuid()).min(2).max(6),
        pairs: z.number().int().min(1).max(10),
        mode: z.enum(['ranked', 'practice']),
        clockConfig: clockSchema,
      })
      .parse(await jsonBody(request));
    if (new Set(config.botIds).size !== config.botIds.length)
      throw new Error('Select distinct bot versions');
    const bots = isCloud() ? await new CloudStore().listBots(user) : getStore().listBots();
    if (config.botIds.some((id) => !bots.some((b) => b.id === id)))
      throw new Error('Unknown bot version');
    if (isCloud()) {
      const store = new CloudStore();
      const job = await store.createJob(config, user);
      try {
        await launchEvaluation(job.id);
      } catch (error) {
        await store.fail(job.id, 'Could not launch evaluation');
        throw error;
      }
      return Response.json(job, { status: 202 });
    }
    return Response.json(getQueue().submit(config), { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
