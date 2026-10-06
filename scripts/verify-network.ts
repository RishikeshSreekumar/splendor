import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { BotRunner } from '../src/sandbox';
import { createGame, observe } from '../src/engine';
import { startSandbox, modalClient } from '../src/server/modal-jobs';
import type { EvaluationReport } from '../src/types';
const probe = `import {SplendorPlayer} from 'splendor'; export default class NetworkProbe extends SplendorPlayer {
  async chooseAction(view) {
    if (!this.checked) {
      const response = await fetch('https://example.com');
      if (!response.ok || !(await response.text()).includes('Example Domain')) throw new Error('HTTPS probe failed');
      if (this.getSecret('API_KEY') !== 'verification-only') throw new Error('Secret isolation failed');
      this.checked = true;
    }
    return this.getLegalActions(view,'buy')[0] ?? this.chooseRandomAction(view);
  }
}`;
if (process.argv.includes('--local')) {
  const runner = new BotRunner(probe, {}, { API_KEY: 'verification-only' });
  try {
    const action = await runner.chooseAction(observe(createGame()), 15000);
    assert.ok(action);
    console.log('Local HTTPS bot passed');
  } finally {
    await runner.close();
  }
} else {
  const source = await readFile('bots/greedy.js', 'utf8');
  const client = modalClient();
  try {
    for (const practice of [true, false]) {
      const id = await startSandbox(
        {
          bots: [
            { id: 'network', source: probe, secrets: { API_KEY: 'verification-only' } },
            { id: 'greedy', source },
          ],
          pairs: 1,
          mode: 'ranked',
          clockConfig: { initialMs: 60000, incrementMs: 1000 },
          seed: 'network-verification',
        },
        practice,
      );
      const sandbox = await client.sandboxes.fromId(id);
      try {
        const output = await sandbox.stdout.readText();
        assert.equal(await sandbox.wait(), 0);
        const result = JSON.parse(output) as { report: EvaluationReport; memoryLimitMiB: number };
        assert.equal(result.report.games.length, 2);
        assert.ok(
          result.report.games.every(
            (g) => g.faults.every((n) => n === 0) && g.result.reason === 'completed',
          ),
        );
        assert.ok(!output.includes('verification-only'));
        await writeFile(`results/network-${result.memoryLimitMiB}.json`, output);
        console.log({
          memoryMiB: result.memoryLimitMiB,
          games: 2,
          faults: 0,
          secretsInReport: false,
        });
      } finally {
        await sandbox.terminate();
      }
    }
  } finally {
    await client.close();
  }
}
