import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Observation, RunnerOptions } from './types';
export class BotFault extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BotFault';
  }
}
interface Pending {
  id: number | undefined;
  resolve: (action: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  deadline: number;
}
/** QuickJS exposes only bounded HTTPS and per-bot secrets; the worker supplies a killable wall-clock boundary. */
export class BotRunner {
  private worker: Worker;
  private nextId = 0;
  private pending: Pending | null = null;
  private closed = false;
  private failure?: string;
  readonly ready: Promise<void>;
  constructor(
    source: string,
    { seed = 'bot', initializationMs = 1000, memoryMb = 16, startupMs = 5000 }: RunnerOptions = {},
    secrets: Record<string, string> = {},
  ) {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 128 * 1024)
      throw new RangeError('Bot source must be at most 128 KiB');
    if (!Number.isInteger(initializationMs) || initializationMs < 1 || initializationMs > 5000)
      throw new RangeError('initializationMs must be 1–5000');
    if (!Number.isInteger(memoryMb) || memoryMb < 4 || memoryMb > 64)
      throw new RangeError('memoryMb must be 4–64');
    if (!Number.isInteger(startupMs) || startupMs < 1 || startupMs > 30000)
      throw new RangeError('startupMs must be 1–30000');
    this.worker = new Worker(resolve('.runtime/bot-worker.mjs'), {
      workerData: {
        source,
        secrets,
        sdkSource: readFileSync(resolve('.runtime/sdk.js'), 'utf8'),
        seed,
        initializationMs,
        memoryMb,
      },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    this.worker.on('message', (message: { id?: number; error?: string; action?: unknown }) => {
      if (!this.pending || message.id !== this.pending.id) return;
      const { resolve, reject, timer, deadline } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      const code = performance.now() >= deadline ? 'TIMEOUT' : message.error;
      if (code) {
        this.failure = code;
        reject(new BotFault(code));
        void this.close();
      } else resolve(message.action);
    });
    this.worker.on('error', () => this.fail('BOT_ERROR'));
    this.worker.on('exit', () => {
      if (!this.closed) this.fail('BOT_EXIT');
    });
    this.ready = this.wait(undefined, startupMs).then(() => undefined);
    this.ready.catch(() => {});
  }
  private wait(id: number | undefined, budgetMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const deadline = performance.now() + budgetMs;
      const expire = () => {
        const remaining = deadline - performance.now();
        if (remaining > 0 && this.pending) {
          this.pending.timer = setTimeout(expire, Math.ceil(remaining));
          return;
        }
        this.fail('TIMEOUT');
        void this.close();
      };
      const timer = setTimeout(expire, Math.ceil(budgetMs));
      this.pending = { id, resolve, reject, timer, deadline };
    });
  }
  private fail(code: string): void {
    this.failure = code;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new BotFault(code));
      this.pending = null;
    }
  }
  async chooseAction(observation: Observation, budgetMs = 60_000): Promise<unknown> {
    await this.ready;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new BotFault('TIMEOUT');
    if (this.closed || this.failure) throw new BotFault(this.failure ?? 'BOT_CLOSED');
    if (this.pending) throw new Error('Concurrent decisions on the same bot are unsupported');
    const id = this.nextId++,
      result = this.wait(id, budgetMs);
    this.worker.postMessage({ id, observation, budgetMs });
    return result;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.fail(this.failure ?? 'BOT_CLOSED');
    await this.worker.terminate();
  }
}
