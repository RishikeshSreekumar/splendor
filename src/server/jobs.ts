import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { getStore, type EvaluationConfig, type EvaluationJob } from './store';
import type { EvaluationReport } from '../types';
export class JobQueue {
  private pending: string[] = [];
  private active?: Worker;
  constructor() {
    getStore().recover();
  }
  submit(config: EvaluationConfig): EvaluationJob {
    if (this.pending.length >= 10)
      throw new Error('Evaluation queue is full; try again after a job finishes.');
    const job = getStore().createJob(config);
    this.pending.push(job.id);
    this.next();
    return job;
  }
  private next(): void {
    if (this.active) return;
    const id = this.pending.shift();
    if (!id) return;
    const store = getStore(),
      job = store.getJob(id)!;
    try {
      const allBots = store.listBots();
      const bots = job.config.botIds.map((id) => {
        const bot = allBots.find((b) => b.id === id);
        if (!bot) throw new Error('A selected bot version no longer exists');
        return { id: bot.id, source: bot.source };
      });
      store.start(id);
      const worker = new Worker(resolve('.runtime/evaluation-worker.mjs'), {
        workerData: {
          bots,
          pairs: job.config.pairs,
          mode: job.config.mode,
          clockConfig: job.config.clockConfig,
          seed: randomBytes(32).toString('hex'),
        },
      });
      this.active = worker;
      let finished = false;
      worker.on(
        'message',
        (m: { type: string; count: number; report: EvaluationReport; message: string }) => {
          if (m.type === 'progress') store.progress(id, m.count);
          if (m.type === 'complete') {
            store.complete(id, m.report);
            finished = true;
          }
          if (m.type === 'error') {
            store.fail(id, m.message);
            finished = true;
          }
        },
      );
      worker.on('error', (error) => {
        store.fail(id, error.message);
        finished = true;
      });
      worker.on('exit', () => {
        if (!finished) store.fail(id, 'Evaluation worker stopped unexpectedly');
        this.active = undefined;
        this.next();
      });
    } catch (error) {
      store.fail(id, error instanceof Error ? error.message : 'Unable to start evaluation');
      this.active = undefined;
      this.next();
    }
  }
}
const globals = globalThis as typeof globalThis & { splendorQueue?: JobQueue };
export function getQueue(): JobQueue {
  return (globals.splendorQueue ??= new JobQueue());
}
