import { ModalClient } from 'modal';
import imageConfig from '../modal-image.json';
const c = new ModalClient();
try {
  const app = await c.apps.fromName(imageConfig.app),
    image = await c.images.fromId(imageConfig.imageId);
  const s = await c.sandboxes.create(app, image, {
    command: [
      'node',
      '-e',
      'const allocations=[];setInterval(()=>{allocations.push(Buffer.alloc(32*1024*1024,1));console.log(allocations.length*32)},50)',
    ],
    memoryMiB: 512,
    memoryLimitMiB: 512,
    cpu: 1,
    cpuLimit: 1,
    blockNetwork: true,
    timeoutMs: 30000,
  });
  try {
    const output = await s.stdout.readText();
    const exit = await s.wait();
    console.log(
      JSON.stringify({ profileMiB: 512, allocatedMiB: output.trim().split('\n').at(-1), exit }),
    );
    if (exit === 0) throw new Error('Expected allocation to terminate');
  } finally {
    await s.terminate();
  }
} finally {
  await c.close();
}
