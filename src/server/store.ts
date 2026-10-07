import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../simulation';
import { BASELINES } from './baselines';
import { evaluationGameCount } from '../fixtures';
import {
  rateGames,
  ratingKey,
  type RatedGame,
  type Rating,
  type RatingChange,
  type RatingKind,
} from '../ratings';
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
  /** Global ladder rating; absent or 1200 with no games before a bot is rated. */
  elo?: number;
  ratedGames?: number;
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
interface RawRating {
  key: string;
  kind: RatingKind;
  subject_id: string;
  elo: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
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
      CREATE TABLE IF NOT EXISTS ratings (key TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL, elo REAL NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, losses INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rating_sources (source TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  seedBaselines(): void {
    for (const { file, name } of BASELINES)
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
      total = evaluationGameCount(config.botIds.length, config.pairs);
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
  ratings(keys?: string[]): Rating[] {
    const rows = (keys
      ? keys.length
        ? this.db
            .prepare(`SELECT * FROM ratings WHERE key IN (${keys.map(() => '?').join(',')})`)
            .all(...keys)
        : []
      : this.db.prepare('SELECT * FROM ratings ORDER BY elo DESC').all()) as unknown as RawRating[];
    return rows.map((r) => ({
      key: r.key,
      kind: r.kind,
      subjectId: r.subject_id,
      elo: r.elo,
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
    }));
  }
  /** Applies a source's games once, atomically. Returns null when it was already applied. */
  applyRatings(source: string, games: RatedGame[]): RatingChange[] | null {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT 1 FROM rating_sources WHERE source=?').get(source)) {
        this.db.exec('ROLLBACK');
        return null;
      }
      const keys = [...new Set(games.flatMap((g) => g.participants.map(ratingKey)))];
      const current = new Map(this.ratings(keys).map((r) => [r.key, r]));
      const changes = rateGames(current, games);
      const now = new Date().toISOString();
      const upsert = this.db.prepare('INSERT OR REPLACE INTO ratings VALUES(?,?,?,?,?,?,?,?,?)');
      for (const r of current.values())
        upsert.run(r.key, r.kind, r.subjectId, r.elo, r.games, r.wins, r.draws, r.losses, now);
      this.db.prepare('INSERT INTO rating_sources VALUES(?,?)').run(source, now);
      this.db.exec('COMMIT');
      return changes;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
}
const globalStore = globalThis as typeof globalThis & { splendorStore?: LabStore };
export function getStore(): LabStore {
  // After a dev hot reload the cached instance belongs to the previous class, without newer
  // methods or tables: open a fresh one, which applies the schema again.
  if (!(globalStore.splendorStore instanceof LabStore)) {
    globalStore.splendorStore = new LabStore();
    globalStore.splendorStore.seedBaselines();
  }
  return globalStore.splendorStore;
}
