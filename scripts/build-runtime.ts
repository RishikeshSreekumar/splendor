import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('.runtime', { recursive: true });
await build({
  entryPoints: ['src/player.ts'],
  outfile: '.runtime/sdk.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
await build({
  entryPoints: ['src/bot-worker.ts'],
  outfile: '.runtime/bot-worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
});
// The evaluation entrypoint is added when the web job service is available.
await build({
  entryPoints: ['src/server/evaluation-worker.ts'],
  outfile: '.runtime/evaluation-worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
});

await build({
  entryPoints: ['src/server/modal-runner.ts'],
  outfile: '.runtime/modal-runner.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
});
