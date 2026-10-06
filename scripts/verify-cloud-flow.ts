import { appendFile, writeFile } from 'node:fs/promises';
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
async function api(path: string, body?: unknown, auth = true) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(auth ? { authorization: `Bearer ${process.env.QA_TOKEN}` } : {}),
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(data)}`);
  return data;
}
const phase = process.argv[2];
if (phase === 'submit') {
  const bot = await api('/api/bots', {
    name: 'Folder demonstration',
    files: [
      {
        path: 'index.ts',
        content:
          "import {SplendorPlayer} from 'splendor';import {pick} from './strategy';export default class Demo extends SplendorPlayer {chooseAction(view:any){return pick(this.getLegalActions(view,'buy'))??this.chooseRandomAction(view)}}",
      },
      {
        path: 'strategy.ts',
        content: 'export function pick<T>(items:T[]):T|undefined{return items[0]}',
      },
    ],
  });
  await appendFile('.env.qa', `QA_BOT_ID=${bot.id}\n`);
  console.log(JSON.stringify({ submitted: bot.id, qualification: bot.qualification }));
} else if (phase === 'evaluate') {
  const bots = await api('/api/bots');
  console.log(
    bots.map((b: { name: string; qualification: string; qualificationError: string }) => ({
      name: b.name,
      status: b.qualification,
      error: b.qualificationError,
    })),
  );
  const candidate = bots.find((b: { id: string }) => b.id === process.env.QA_BOT_ID);
  if (candidate?.qualification !== 'passed') throw new Error('Candidate not qualified');
  const job = await api('/api/evaluations', {
    botIds: [
      candidate.id,
      bots.find((b: { baseline: boolean; name: string }) => b.baseline && b.name === 'Greedy').id,
    ],
    pairs: 1,
    mode: 'ranked',
    clockConfig: { initialMs: 60000, incrementMs: 1000 },
  });
  await appendFile('.env.qa', `QA_JOB_ID=${job.id}\n`);
  console.log({ job: job.id, status: job.status });
} else if (phase === 'result') {
  const job = await api(`/api/evaluations/${process.env.QA_JOB_ID}`);
  console.log({ status: job.status, games: job.report?.games.length, error: job.error });
  if (job.status === 'completed') {
    await writeFile('results/cloud-evaluation.json', JSON.stringify(job));
    const replay = await api(`/api/evaluations/${job.id}/games/0`);
    console.log({ replayFrames: replay.frames.length, clocks: replay.game.clock.remainingMs });
  }
} else if (phase === 'practice') {
  const session = await api('/api/play', {
    type: 'new',
    clockConfig: { initialMs: 60000, incrementMs: 1000 },
  });
  const moved = await api('/api/play', {
    type: 'action',
    id: session.id,
    revision: session.revision,
    action: session.view.legalActions[0],
  });
  console.log({
    practiceRound: moved.view.round,
    revision: moved.revision,
    clocks: moved.view.clock.remainingMs,
  });
  await api('/api/play', { type: 'close', id: session.id });
} else if (phase === 'boundaries') {
  const denied = await fetch(base + '/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'unauthorized', source: 'no' }),
  });
  if (denied.ok) throw new Error('Unauthenticated mutation accepted');
  console.log({ unauthenticatedMutationStatus: denied.status });
  const r2 = await fetch(process.env.PLATFORM_URL + '/__platform/artifacts/bots/test/project.json');
  if (r2.status !== 401) throw new Error('R2 gateway unprotected');
  console.log({ r2UnauthenticatedStatus: r2.status });
}
