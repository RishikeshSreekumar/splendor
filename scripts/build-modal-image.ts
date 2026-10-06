import { ModalClient } from 'modal';
import { readFile, writeFile } from 'node:fs/promises';
const modal = new ModalClient();
try {
  const app = await modal.apps.fromName('splendor-strategy-lab', { createIfMissing: true });
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
  const image = await modal.images
    .fromRegistry('node:22-bookworm-slim')
    .dockerfileCommands(commands)
    .build(app);
  await writeFile(
    'modal-image.json',
    JSON.stringify(
      { imageId: image.imageId, app: 'splendor-strategy-lab', builtAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  console.log('Built Modal runner image:', image.imageId);
} finally {
  await modal.close();
}
