import { decryptBotSecrets } from './bot-secrets';
import { ModalClient } from 'modal';
import { randomBytes } from 'node:crypto';
import { database, getArtifact, putArtifact, secret } from './cloud';
import type { BotArtifact } from './cloud-store';
import type { BotDefinition, ClockConfig, EvaluationReport, Mode } from '../types';
import { QUALIFICATION_BASELINES } from './baselines';
import { applyRatings } from './ratings';
import { evaluationGames } from '../ratings';
import imageConfig from '../../modal-image.json';
export interface RunInput {
  bots: BotDefinition[];
  pairs: number;
  mode: Mode;
  clockConfig: ClockConfig;
  seed: string;
}
export const PRACTICE_MEMORY_MIB = 512,
  EVALUATION_MEMORY_MIB = 2048;
export const JOB_TIMEOUT_MS = 30 * 60 * 1000;
export function modalClient() {
  return new ModalClient({
    tokenId: secret('MODAL_TOKEN_ID'),
    tokenSecret: secret('MODAL_TOKEN_SECRET'),
    timeoutMs: 25000,
    maxRetries: 2,
  });
}
export async function startSandbox(input: RunInput, practice: boolean) {
  const client = modalClient();
  let sandbox;
  try {
    const app = await client.apps.fromName(imageConfig.app, { createIfMissing: true });
    const image = await client.images.fromId(process.env.MODAL_IMAGE_ID ?? imageConfig.imageId);
    const memory = practice ? PRACTICE_MEMORY_MIB : EVALUATION_MEMORY_MIB;
    sandbox = await client.sandboxes.create(app, image, {
      command: ['node', '--max-old-space-size=192', '/app/.runtime/modal-runner.mjs'],
      workdir: '/app',
      memoryMiB: memory,
      memoryLimitMiB: memory,
      cpu: 1,
      cpuLimit: 1,
      blockNetwork: false,
      timeoutMs: JOB_TIMEOUT_MS,
      env: { NODE_ENV: 'production', SPLENDOR_MEMORY_LIMIT_MIB: String(memory) },
      tags: { project: 'splendor', kind: practice ? 'practice' : 'evaluation' },
    });
    await sandbox.stdin.writeText(JSON.stringify(input));
    await sandbox.stdin.close();
    return sandbox.sandboxId;
  } catch (error) {
    await sandbox?.terminate();
    throw error;
  } finally {
    await client.close();
  }
}
export async function launchQualification(botId: string) {
  const db = database();
  const { data: bot, error } = await db
    .from('splendor_bots')
    .update({ launch_claimed_at: new Date().toISOString() })
    .eq('id', botId)
    .eq('qualification', 'pending')
    .is('launch_claimed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!bot) return;
  if (bot.qualification !== 'pending' || bot.sandbox_id) return;
  const { data: baselines, error: be } = await db
    .from('splendor_bots')
    .select('*')
    .eq('baseline', true)
    .eq('qualification', 'passed')
    .in('name', [...QUALIFICATION_BASELINES])
    .order('created_at', { ascending: false });
  if (be) throw be;
  const selected = (baselines ?? [])
    .filter((b, i, all) => all.findIndex((v) => v.name === b.name) === i)
    .slice(0, QUALIFICATION_BASELINES.length);
  if (selected.length !== QUALIFICATION_BASELINES.length)
    throw new Error('Random and Greedy baselines must be seeded first');
  const bots: BotDefinition[] = [];
  for (const b of [bot, ...selected]) {
    const a = await getArtifact<BotArtifact>(b.artifact_key);
    bots.push({
      id: b.id,
      source: a.source,
      secrets: decryptBotSecrets(b.owner_id, b.id, b.secrets_encrypted),
    });
  }
  const id = await startSandbox(
    {
      bots,
      pairs: 1,
      mode: 'ranked',
      clockConfig: { initialMs: 60000, incrementMs: 1000 },
      seed: randomBytes(32).toString('hex'),
    },
    true,
  );
  const { error: e } = await db
    .from('splendor_bots')
    .update({ sandbox_id: id, started_at: new Date().toISOString() })
    .eq('id', botId)
    .is('sandbox_id', null);
  if (e) {
    const client = modalClient();
    try {
      await (await client.sandboxes.fromId(id)).terminate();
    } finally {
      await client.close();
    }
    throw e;
  }
}
export async function launchEvaluation(jobId: string) {
  const db = database();
  const { data: job, error } = await db
    .from('splendor_evaluations')
    .update({ launch_claimed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued')
    .is('launch_claimed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!job) return;
  if (job.status !== 'queued' || job.sandbox_id) return;
  const bots: BotDefinition[] = [];
  for (const id of job.config.botIds) {
    const { data: b, error: e } = await db
      .from('splendor_bots')
      .select('*')
      .eq('id', id)
      .eq('qualification', 'passed')
      .single();
    if (e) throw new Error('All contenders must pass qualification');
    if (b.secrets_encrypted && b.owner_id !== job.owner_id)
      throw new Error('This bot can only be run by its credential owner');
    bots.push({
      id,
      source: (await getArtifact<BotArtifact>(b.artifact_key)).source,
      secrets: decryptBotSecrets(b.owner_id, b.id, b.secrets_encrypted),
    });
  }
  const id = await startSandbox(
    { bots, ...job.config, seed: randomBytes(32).toString('hex') },
    job.config.mode === 'practice',
  );
  const { error: e } = await db
    .from('splendor_evaluations')
    .update({ sandbox_id: id, status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued');
  if (e) {
    const client = modalClient();
    try {
      await (await client.sandboxes.fromId(id)).terminate();
    } finally {
      await client.close();
    }
    throw e;
  }
}
export async function reconcileRun(kind: 'bot' | 'evaluation', id: string) {
  const db = database(),
    table = kind === 'bot' ? 'splendor_bots' : 'splendor_evaluations';
  const { data: row, error } = await db.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  if (
    kind === 'bot' ? row.qualification !== 'pending' : !['queued', 'running'].includes(row.status)
  )
    return;
  if (!row.sandbox_id) {
    if (Date.now() - Date.parse(row.created_at) > 120000)
      await db
        .from(table)
        .update(
          kind === 'bot'
            ? {
                qualification: 'failed',
                qualification_error: 'Sandbox launch was interrupted. Submit a new version.',
              }
            : { status: 'failed', error: 'Sandbox launch was interrupted. Run again.' },
        )
        .eq('id', id);
    return;
  }
  const client = modalClient();
  try {
    const sandbox = await client.sandboxes.fromId(row.sandbox_id);
    const exit = await sandbox.poll();
    if (exit === null) return;
    if (exit !== 0) throw new Error('Sandbox stopped: timeout, resource limit, or runner failure');
    let output = '';
    const reader = sandbox.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += value;
        if (Buffer.byteLength(output) > 32 * 1024 * 1024) throw new Error('Report exceeded 32 MiB');
      }
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(output) as {
      report: EvaluationReport;
      memoryLimitMiB: number;
      maxRssKiB: number;
    };
    if (!result.report?.games?.length) throw new Error('Sandbox returned an empty report');
    const expected = kind === 'bot' || row.config.mode === 'practice' ? 512 : 2048;
    if (result.memoryLimitMiB !== expected)
      throw new Error('Sandbox memory limit did not match the required profile');
    const key = `reports/${id}/result.json`;
    await putArtifact(key, result.report);
    if (kind === 'bot') {
      const games = result.report.games.filter((g) => g.bots.some((b) => b.id === id));
      const passed =
        games.length === 4 &&
        games.every((g) => {
          const seat = g.bots.findIndex((b) => b.id === id);
          return (
            g.faults[seat] === 0 &&
            g.result.reason !== 'turn_limit' &&
            g.result.reason !== 'no_legal_action' &&
            g.result.ratingEligible
          );
        });
      const { error: e } = await db
        .from(table)
        .update({
          qualification: passed ? 'passed' : 'failed',
          qualification_error: passed
            ? null
            : 'Qualification requires four complete, fault-free games against the public bots.',
          qualification_report_key: key,
        })
        .eq('id', id)
        .eq('qualification', 'pending');
      if (e) throw e;
    } else {
      // Ranked games feed the global ladder once per evaluation, before the job is marked
      // complete: a failure here is retried by the next reconciliation.
      await applyRatings(`evaluation:${id}`, evaluationGames(result.report));
      const { error: e } = await db
        .from(table)
        .update({
          status: 'completed',
          completed_games: result.report.games.length,
          total_games: result.report.games.length,
          report_key: key,
          error: null,
        })
        .eq('id', id)
        .eq('status', 'running');
      if (e) throw e;
    }
  } catch (error) {
    // Transient API errors must not fail a still-running sandbox.
    if (
      Date.now() - Date.parse(row.started_at ?? row.created_at) < JOB_TIMEOUT_MS + 60000 &&
      !(error instanceof SyntaxError) &&
      !/Sandbox stopped|Report exceeded|empty report|memory limit/.test(
        error instanceof Error ? error.message : '',
      )
    )
      throw error;
    const message = error instanceof Error ? error.message : 'Sandbox failed';
    await db
      .from(table)
      .update(
        kind === 'bot'
          ? { qualification: 'failed', qualification_error: message }
          : { status: 'failed', error: message },
      )
      .eq('id', id);
  } finally {
    await client.close();
  }
}
