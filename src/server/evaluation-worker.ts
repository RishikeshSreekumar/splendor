import { parentPort, workerData } from 'node:worker_threads';
import { evaluate } from '../evaluation';
import type { BotDefinition, ClockConfig, Mode } from '../types';
const data = workerData as {
  bots: BotDefinition[];
  pairs: number;
  seed: string;
  mode: Mode;
  clockConfig: ClockConfig;
};
try {
  const report = await evaluate({
    ...data,
    onGame: (_, count) => {
      parentPort!.postMessage({ type: 'progress', count });
    },
  });
  parentPort!.postMessage({ type: 'complete', report });
} catch (error) {
  parentPort!.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : 'Evaluation failed',
  });
}
