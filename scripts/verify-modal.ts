import { ModalClient } from 'modal';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ChessClock } from '../src/clock';
import { createGame, legalActions } from '../src/engine';
import imageConfig from '../modal-image.json';
/** Plays full games at both memory profiles and one shared-table practice turn; throws on any fault. */
const sandboxOptions = (memory: number) => ({
  command: ['node', '--max-old-space-size=192', '/app/.runtime/modal-runner.mjs'],
  workdir: '/app',
  memoryMiB: memory,
  memoryLimitMiB: memory,
  cpu: 1,
  cpuLimit: 1,
  blockNetwork: false,
  timeoutMs: 120000,
  env: { SPLENDOR_MEMORY_LIMIT_MIB: String(memory) },
});
await mkdir('results', { recursive: true });
const client = new ModalClient();
try {
  const app = await client.apps.fromName(imageConfig.app);
  const bots = await Promise.all(
    ['random', 'greedy'].map(async (id) => ({
      id,
      source: await readFile(`bots/${id}.js`, 'utf8'),
    })),
  );
  for (const memory of [512, 2048]) {
    const sb = await client.sandboxes.create(
      app,
      await client.images.fromId(imageConfig.imageId),
      sandboxOptions(memory),
    );
    try {
      await sb.stdin.writeText(
        JSON.stringify({
          bots,
          pairs: 1,
          mode: 'ranked',
          clockConfig: { initialMs: 60000, incrementMs: 1000 },
          seed: 'modal-verification',
        }),
      );
      await sb.stdin.close();
      const output = await sb.stdout.readText();
      const err = await sb.stderr.readText();
      await writeFile(`results/modal-${memory}.json`, output);
      const exit = await sb.wait();
      console.log(
        JSON.stringify({ memory, exit, bytes: output.length, error: err.slice(0, 1000) }),
      );
      if (exit !== 0 || !output) throw new Error(`Runner failed at ${memory} MiB (exit ${exit})`);
      const r = JSON.parse(output);
      const faults = r.report.leaderboard.map((b: { faults: number }) => b.faults);
      console.log(
        JSON.stringify({ memoryLimitMiB: r.memoryLimitMiB, games: r.report.games.length, faults }),
      );
      if (!r.report.games.length || faults.some((f: number) => f > 0))
        throw new Error(`Baseline games faulted at ${memory} MiB`);
    } finally {
      await sb.terminate();
    }
  }
  // A shared table: people at seats 0 and 2, so one bot reply must stop at seat 2.
  const state = createGame({ players: 3, seed: 'modal-shared-table' });
  const sb = await client.sandboxes.create(
    app,
    await client.images.fromId(imageConfig.imageId),
    sandboxOptions(512),
  );
  try {
    await sb.stdin.writeText(
      JSON.stringify({
        kind: 'practice-turn',
        input: {
          state,
          clock: new ChessClock(3).snapshot(),
          action: legalActions(state)[0],
          humanSeat: 0,
          humanSeats: [0, 2],
          seats: [null, { source: bots[1].source }, null],
        },
      }),
    );
    await sb.stdin.close();
    const output = await sb.stdout.readText();
    const exit = await sb.wait();
    const turn = output ? JSON.parse(output) : undefined;
    const seats = turn?.steps?.map((s: { seat: number }) => s.seat);
    console.log(JSON.stringify({ practice: true, exit, seats }));
    if (exit !== 0 || JSON.stringify(seats) !== '[0,1]' || turn.state.currentPlayer !== 2)
      throw new Error('The runner does not stop at every human seat; rebuild the image');
  } finally {
    await sb.terminate();
  }
} finally {
  await client.close();
}
