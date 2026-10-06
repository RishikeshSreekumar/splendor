import { practiceTurn } from './practice-turn';
import { evaluate } from '../evaluation';
import type { BotDefinition, ClockConfig, Mode } from '../types';
import { readFile } from 'node:fs/promises';
// Only trusted runner code touches stdin/stdout. Submitted code lives inside QuickJS.
const input = await new Promise<string>((resolve, reject) => {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c: string) => {
    s += c;
    if (s.length > 1024 * 1024) {
      reject(new Error('Input too large'));
      process.stdin.destroy();
    }
  });
  process.stdin.on('end', () => resolve(s));
  process.stdin.on('error', reject);
});
try {
  const message = JSON.parse(input);
  if (message.kind === 'practice-turn') {
    const result = await practiceTurn(message.input);
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    const data = message as {
      bots: BotDefinition[];
      pairs: number;
      mode: Mode;
      clockConfig: ClockConfig;
      seed: string;
    };
    const report = await evaluate({ ...data, runnerOptions: { memoryMb: 64, startupMs: 15000 } });
    const memoryMax = await readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(
      () => 'unavailable',
    );
    process.stdout.write(
      JSON.stringify({
        report,
        memoryLimitBytes: memoryMax.trim(),
        memoryLimitMiB: Number(process.env.SPLENDOR_MEMORY_LIMIT_MIB),
        maxRssKiB: process.resourceUsage().maxRSS,
      }) + '\n',
    );
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Runner failed');
  process.exitCode = 1;
}
