import { ModalClient } from 'modal';
import { readFile, writeFile } from 'node:fs/promises';
import imageConfig from '../modal-image.json';
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
    const sb = await client.sandboxes.create(app, await client.images.fromId(imageConfig.imageId), {
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
      console.log(
        JSON.stringify({
          memory,
          exit: await sb.poll(),
          bytes: output.length,
          error: err.slice(0, 1000),
        }),
      );
      if (output) {
        const r = JSON.parse(output);
        console.log(
          JSON.stringify({
            memoryLimitMiB: r.memoryLimitMiB,
            games: r.report.games.length,
            faults: r.report.leaderboard.map((b: { faults: number }) => b.faults),
          }),
        );
      }
    } finally {
      await sb.terminate();
    }
  }
} finally {
  await client.close();
}
