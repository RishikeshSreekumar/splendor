import { timingSafeEqual } from 'node:crypto';
import { database } from '@/src/server/cloud';
import { reconcileRun } from '@/src/server/modal-jobs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const actual = Buffer.from(request.headers.get('authorization') ?? ''),
    expected = Buffer.from(`Bearer ${process.env.CRON_SECRET ?? ''}`);
  if (
    !process.env.CRON_SECRET ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return new Response('Unauthorized', { status: 401 });
  const db = database();
  let completed = 0;
  const { data: bots, error: be } = await db
    .from('splendor_bots')
    .select('id')
    .eq('qualification', 'pending')
    .limit(10);
  if (be) throw be;
  const { data: jobs, error: je } = await db
    .from('splendor_evaluations')
    .select('id')
    .in('status', ['queued', 'running'])
    .limit(10);
  if (je) throw je;
  for (const b of bots ?? []) {
    await reconcileRun('bot', b.id);
    completed++;
  }
  for (const j of jobs ?? []) {
    await reconcileRun('evaluation', j.id);
    completed++;
  }
  // Human boards are temporary. An interrupted move becomes usable again without changing its state.
  await db
    .from('splendor_practice_sessions')
    .update({ busy: false })
    .eq('busy', true)
    .lt('updated_at', new Date(Date.now() - 120000).toISOString());
  await db
    .from('splendor_practice_sessions')
    .delete()
    .lt('updated_at', new Date(Date.now() - 86400000).toISOString());
  return Response.json({ checked: completed });
}
