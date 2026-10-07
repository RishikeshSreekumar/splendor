import { ModalClient } from 'modal';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
/**
 * Builds the Modal runner image from `.runtime` (run `npm run build:runtime` first) and pins it
 * in `modal-image.json`. With `--if-changed`, skips the build when the pinned image was made
 * from the same runtime files (`--force` always builds). In GitHub Actions it reports `built=true|false` as a step output.
 */
const BASE = 'node:22-bookworm-slim';
const runtimeFiles = ['sdk.js', 'bot-worker.mjs', 'modal-runner.mjs'];
const commands = [
  'WORKDIR /app',
  `RUN npm init -y && npm install --omit=dev quickjs-emscripten@0.32.0`,
  `RUN mkdir -p /app/.runtime`,
];
for (const file of runtimeFiles) {
  const base64 = (await readFile(`.runtime/${file}`)).toString('base64');
  commands.push(`RUN printf '%s' '${base64}' | base64 -d > /app/.runtime/${file}`);
}
const runtimeHash = createHash('sha256')
  .update(JSON.stringify([BASE, commands]))
  .digest('hex');
const pinned = JSON.parse(await readFile('modal-image.json', 'utf8').catch(() => '{}')) as {
  runtimeHash?: string;
};
async function report(built: boolean) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `built=${built}\n`);
}
if (process.argv.includes('--if-changed') && pinned.runtimeHash === runtimeHash) {
  console.log('Runner unchanged; keeping the pinned Modal image.');
  await report(false);
} else {
  const modal = new ModalClient();
  try {
    const app = await modal.apps.fromName('splendor-strategy-lab', { createIfMissing: true });
    const image = await modal.images.fromRegistry(BASE).dockerfileCommands(commands).build(app);
    await writeFile(
      'modal-image.json',
      JSON.stringify(
        {
          imageId: image.imageId,
          app: 'splendor-strategy-lab',
          builtAt: new Date().toISOString(),
          runtimeHash,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Built Modal runner image:', image.imageId);
    await report(true);
  } finally {
    await modal.close();
  }
}
