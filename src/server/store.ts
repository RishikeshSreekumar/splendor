import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../simulation';
import type { ClockConfig, EvaluationReport, Mode } from '../types';
export interface StoredBot {
  privateExecution?: boolean;
  qualification?: 'pending' | 'passed' | 'failed';
  qualificationError?: string;
  id: string;
  name: string;
  source: string;
  sourceHash: string;
  baseline: boolean;
  createdAt: string;
}
export interface EvaluationConfig {
  botIds: string[];
  pairs: number;
  mode: Mode;
  clockConfig: ClockConfig;
}
export interface EvaluationJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  config: EvaluationConfig;
  completedGames: number;
  totalGames: number;
  createdAt: string;
  error: string | null;
  report?: EvaluationReport;
}
interface RawBot {
  id: string;
  name: string;
  source: string;
  source_hash: string;
  baseline: number;
  created_at: string;
}
interface RawJob {
  id: string;
  status: EvaluationJob['status'];
  config: string;
  completed_games: number;
  total_games: number;
  created_at: string;
  error: string | null;
  report: string | null;
}
export class LabStore {
  private readonly db: DatabaseSync;
  constructor(path = process.env.SPLENDOR_DB_PATH ?? resolve('storage/lab.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, source_hash TEXT NOT NULL, baseline INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS bot_versions ON bots(name, source_hash);
      CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, status TEXT NOT NULL, config TEXT NOT NULL, completed_games INTEGER NOT NULL DEFAULT 0, total_games INTEGER NOT NULL, created_at TEXT NOT NULL, error TEXT, report TEXT);
      PRAGMA user_version=1;`);
  }
  seedBaselines(): void {
    for (const [file, name] of [
      ['random.js', 'Random'],
      ['greedy.js', 'Greedy'],
    ])
      this.saveBot(name, readFileSync(resolve('bots', file), 'utf8'), true);
  }
  listBots(): StoredBot[] {
    return (
      this.db
        .prepare('SELECT * FROM bots ORDER BY baseline DESC, created_at DESC')
        .all() as unknown as RawBot[]
    ).map((b) => ({
      id: b.id,
      name: b.name,
      source: b.source,
      sourceHash: b.source_hash,
      baseline: Boolean(b.baseline),
      createdAt: b.created_at,
    }));
  }
  saveBot(name: string, source: string, baseline = false): StoredBot {
    const hash = digest(source);
    this.db
      .prepare('INSERT OR IGNORE INTO bots VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), name, source, hash, Number(baseline), new Date().toISOString());
    return this.listBots().find((b) => b.name === name && b.sourceHash === hash)!;
  }
  createJob(config: EvaluationConfig): EvaluationJob {
    const id = randomUUID(),
      total = config.botIds.length * (config.botIds.length - 1) * config.pairs;
    this.db
      .prepare('INSERT INTO evaluations(id,status,config,total_games,created_at) VALUES(?,?,?,?,?)')
      .run(id, 'queued', JSON.stringify(config), total, new Date().toISOString());
    return this.getJob(id)!;
  }
  listJobs(): EvaluationJob[] {
    return (
      this.db
        .prepare(
          'SELECT id,status,config,completed_games,total_games,created_at,error,NULL as report FROM evaluations ORDER BY created_at DESC LIMIT 50',
        )
        .all() as unknown as RawJob[]
    ).map((r) => this.decodeJob(r));
  }
  getJob(id: string): EvaluationJob | undefined {
    const row = this.db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id) as unknown as
      RawJob | undefined;
    return row ? this.decodeJob(row) : undefined;
  }
  private decodeJob(r: RawJob): EvaluationJob {
    return {
      id: r.id,
      status: r.status,
      config: JSON.parse(r.config),
      completedGames: r.completed_games,
      totalGames: r.total_games,
      createdAt: r.created_at,
      error: r.error,
      ...(r.report ? { report: JSON.parse(r.report) } : {}),
    };
  }
  start(id: string): void {
    this.db
      .prepare("UPDATE evaluations SET status='running' WHERE id=? AND status='queued'")
      .run(id);
  }
  progress(id: string, count: number): void {
    this.db
      .prepare("UPDATE evaluations SET completed_games=? WHERE id=? AND status='running'")
      .run(count, id);
  }
  complete(id: string, report: EvaluationReport): void {
    this.db
      .prepare(
        "UPDATE evaluations SET status='completed',report=?,completed_games=total_games WHERE id=? AND status='running'",
      )
      .run(JSON.stringify(report), id);
  }
  fail(id: string, message: string): void {
    this.db
      .prepare(
        "UPDATE evaluations SET status='failed',error=? WHERE id=? AND status IN ('queued','running')",
      )
      .run(message.slice(0, 500), id);
  }
  recover(): void {
    this.db
      .prepare(
        "UPDATE evaluations SET status='failed',error='Server restarted; run this evaluation again.' WHERE status IN ('queued','running')",
      )
      .run();
  }
  close(): void {
    this.db.close();
  }
}
const globalStore = globalThis as typeof globalThis & { splendorStore?: LabStore };
export function getStore(): LabStore {
  if (!globalStore.splendorStore) {
    globalStore.splendorStore = new LabStore();
    globalStore.splendorStore.seedBaselines();
  }
  return globalStore.splendorStore;
}
