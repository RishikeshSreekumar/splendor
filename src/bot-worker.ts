import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS, type QuickJSHandle } from 'quickjs-emscripten';
import { random } from './random';
import { NetworkBridge } from './network-bridge';
import type { Observation } from './types';
const data = workerData as {
  source: string;
  sdkSource: string;
  seed: string;
  memoryMb: number;
  initializationMs: number;
  secrets: Record<string, string>;
};
const port = parentPort!;
const QuickJS = await getQuickJS();
const runtime = QuickJS.newRuntime();
runtime.setMemoryLimit(data.memoryMb * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
// The platform's own setup is never interrupted; the bot's budget starts with its module.
let deadline = Infinity;
runtime.setInterruptHandler(() => performance.now() >= deadline);
runtime.setModuleLoader((name) => {
  if (name === 'splendor') return data.sdkSource;
  if (name === 'submission') return data.source;
  throw new Error('Only the splendor SDK import is available');
});
const vm = runtime.newContext();
function evaluate(code: string, module = false): QuickJSHandle {
  const result = vm.evalCode(code, module ? 'entry' : 'decision', {
    type: module ? 'module' : 'global',
  });
  if (result.error) {
    result.error.dispose();
    throw new Error(performance.now() >= deadline ? 'TIMEOUT' : 'BOT_ERROR');
  }
  return result.value;
}
function pumpJobs(): void {
  while (runtime.hasPendingJob()) {
    if (performance.now() >= deadline) throw new Error('TIMEOUT');
    const result = runtime.executePendingJobs(1);
    if (result.error) {
      result.error.dispose();
      throw new Error(performance.now() >= deadline ? 'TIMEOUT' : 'BOT_ERROR');
    }
  }
}
let rejectDecision: ((error: unknown) => void) | undefined;
const network = new NetworkBridge(vm, pumpJobs, (error) => rejectDecision?.(error));
try {
  evaluate(
    `globalThis.__botSecrets = Object.freeze(${JSON.stringify(data.secrets ?? {})});`,
  ).dispose();
  evaluate(
    `globalThis.Date = undefined; Math.random = (${random.toString()})(${JSON.stringify(data.seed)});`,
  ).dispose();
  deadline = performance.now() + data.initializationMs;
  evaluate(
    `
    import Player from 'submission';
    import { SplendorPlayer } from 'splendor';
    if (typeof Player !== 'function' || !(Player.prototype instanceof SplendorPlayer)) throw new Error('Invalid player class');
    const player = new Player();
    if (typeof player.chooseAction !== 'function') throw new Error('Missing chooseAction');
    const stringify = JSON.stringify;
    globalThis.__choose = async input => {
      const action = await player.chooseAction(input);
      const output = stringify(action);
      if (typeof output !== 'string' || output.length > 16384) throw new Error('Invalid output');
      return output;
    };
  `,
    true,
  ).dispose();
  pumpJobs();
  // Top-level await must finish during initialization rather than run during a later turn.
  evaluate(
    `if (typeof __choose !== 'function') throw new Error('Initialization did not complete')`,
  ).dispose();
  port.postMessage({ ready: true });
} catch (error) {
  port.postMessage({
    error: error instanceof Error && error.message === 'TIMEOUT' ? 'TIMEOUT' : 'BOT_ERROR',
  });
}
port.on(
  'message',
  async ({
    id,
    observation,
    budgetMs,
  }: {
    id: number;
    observation: Observation;
    budgetMs: number;
  }) => {
    deadline = performance.now() + budgetMs;
    network.begin(deadline);
    let handle: QuickJSHandle | undefined;
    const failed = new Promise<never>((_resolve, reject) => {
      rejectDecision = reject;
    });
    try {
      handle = evaluate(`__choose(${JSON.stringify(observation)})`);
      const pending = vm.resolvePromise(handle);
      pumpJobs();
      const result = await Promise.race([pending, failed]);
      if (result.error) {
        result.error.dispose();
        throw new Error('BOT_ERROR');
      }
      let output: string;
      try {
        output = vm.getString(result.value);
      } finally {
        result.value.dispose();
      }
      if (output.length > 16384) throw new Error('BOT_ERROR');
      if (performance.now() >= deadline) throw new Error('TIMEOUT');
      port.postMessage({ id, action: JSON.parse(output) });
    } catch (error) {
      port.postMessage({
        id,
        error:
          performance.now() >= deadline || (error instanceof Error && error.message === 'TIMEOUT')
            ? 'TIMEOUT'
            : 'BOT_ERROR',
      });
    } finally {
      network.end();
      rejectDecision = undefined;
      handle?.dispose();
    }
  },
);
