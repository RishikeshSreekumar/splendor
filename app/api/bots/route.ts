import { withRatings } from '@/src/server/ratings';
import { enforceRateLimit, RATE_LIMITS } from '@/src/server/rate-limit';
import { botSecretsSchema } from '@/src/server/bot-secrets';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { getStore } from '@/src/server/store';
import { QUALIFICATION_BASELINES } from '@/src/server/baselines';
import { bundleProject, projectSchema } from '@/src/submissions/bundle';
import { isCloud, authenticatedOwner, optionalOwner, database } from '@/src/server/cloud';
import { CloudStore } from '@/src/server/cloud-store';
import { launchQualification, reconcileRun } from '@/src/server/modal-jobs';
import { evaluate } from '@/src/evaluation';
import { apiError, jsonBody, mutationOrigin } from '@/src/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const user = await optionalOwner(request);
    await enforceRateLimit(request, RATE_LIMITS.statusRead, user);
    if (!isCloud()) return Response.json(await withRatings(getStore().listBots()));
    const store = new CloudStore();
    let bots = await store.listBots(user);
    for (const b of bots
      .filter((b) => b.ownerId === user && b.qualification === 'pending')
      .slice(0, 2))
      await reconcileRun('bot', b.id);
    bots = await store.listBots(user);
    return Response.json(await withRatings(bots));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationOrigin(request);
    const user = await authenticatedOwner(request);
    await enforceRateLimit(request, RATE_LIMITS.botSubmit, user);
    const { name, source, files, secrets } = z
      .object({
        name: z.string().trim().min(1).max(50),
        source: z.string().min(1).max(131072).optional(),
        files: projectSchema.optional(),
        secrets: botSecretsSchema.default({}),
      })
      .parse(await jsonBody(request, 1200000));
    const artifact = await bundleProject(files ?? [{ path: 'index.ts', content: source ?? '' }]);
    if (isCloud()) {
      const store = new CloudStore(),
        bot = await store.saveProject(user, name, artifact, secrets);
      try {
        await launchQualification(bot.id);
      } catch (error) {
        await database()
          .from('splendor_bots')
          .update({
            qualification: 'failed',
            qualification_error: 'Could not launch qualification; submit a new version.',
          })
          .eq('id', bot.id);
        throw error;
      }
      return Response.json(bot, { status: 202 });
    }
    if (Object.keys(secrets).length) throw new Error('Private bot credentials require hosted mode');
    // Local checks use the same game protocol; only Modal provides the machine memory boundary.
    const baselines = getStore()
      .listBots()
      .filter((b) => b.baseline);
    const publicBots = QUALIFICATION_BASELINES.map((name) => {
      const bot = baselines.find((b) => b.name === name);
      if (!bot) throw new Error(`${name} baseline is missing`);
      return bot;
    });
    const report = await evaluate({
      bots: [
        { id: 'candidate', source: artifact.source },
        ...publicBots.map((b) => ({ id: b.id, source: b.source })),
      ],
      pairs: 1,
      runnerOptions: { memoryMb: 64 },
    });
    const games = report.games.filter((g) => g.bots.some((b) => b.id === 'candidate'));
    if (
      games.length !== 4 ||
      games.some(
        (g) =>
          g.faults[g.bots.findIndex((b) => b.id === 'candidate')] > 0 || !g.result.ratingEligible,
      )
    )
      throw new Error(
        'Qualification failed: complete four fault-free games against the public bots',
      );
    const bot = getStore().saveBot(name, artifact.source);
    await mkdir('storage/projects', { recursive: true });
    await writeFile(`storage/projects/${bot.id}.json`, JSON.stringify(artifact));
    return Response.json({ ...bot, qualification: 'passed' }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
