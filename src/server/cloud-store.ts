import { randomUUID, createHash } from 'node:crypto';
import { encryptBotSecrets, secretFingerprint } from './bot-secrets';
import { database, getArtifact, putArtifact } from './cloud';
import { evaluationGameCount } from '../fixtures';
import type { StoredBot, EvaluationConfig, EvaluationJob } from './store';
import type { ProjectFile } from '../submissions/bundle';
import type { EvaluationReport } from '../types';
export interface BotArtifact {
  source: string;
  files: ProjectFile[];
  projectHash: string;
}
export interface CloudBot extends StoredBot {
  ownerId?: string;
  projectHash: string;
  qualification: 'pending' | 'passed' | 'failed';
  qualificationError?: string;
  artifactKey: string;
}
interface BotRow {
  id: string;
  owner_id: string | null;
  name: string;
  source_hash: string;
  project_hash: string;
  artifact_key: string;
  baseline: boolean;
  qualification: CloudBot['qualification'];
  qualification_error: string | null;
  created_at: string;
  secrets_encrypted: string | null;
}
interface JobRow {
  id: string;
  owner_id: string;
  status: EvaluationJob['status'];
  config: EvaluationConfig;
  completed_games: number;
  total_games: number;
  created_at: string;
  error: string | null;
  report_key: string | null;
}
function bot(r: BotRow): CloudBot {
  return {
    id: r.id,
    ownerId: r.owner_id ?? undefined,
    privateExecution: Boolean(r.secrets_encrypted),
    name: r.name,
    source: '',
    sourceHash: r.source_hash,
    projectHash: r.project_hash,
    baseline: r.baseline,
    qualification: r.qualification,
    qualificationError: r.qualification_error ?? undefined,
    artifactKey: r.artifact_key,
    createdAt: r.created_at,
  };
}
function job(r: JobRow): EvaluationJob {
  return {
    id: r.id,
    status: r.status,
    config: r.config,
    completedGames: r.completed_games,
    totalGames: r.total_games,
    createdAt: r.created_at,
    error: r.error,
  };
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
export class CloudStore {
  async listBots(ownerId?: string): Promise<CloudBot[]> {
    let q = database()
      .from('splendor_bots')
      .select('*')
      .order('baseline', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    q = ownerId
      ? q.or(`and(qualification.eq.passed,secrets_encrypted.is.null),owner_id.eq.${ownerId}`)
      : q.eq('qualification', 'passed').is('secrets_encrypted', null);
    const { data, error } = await q;
    check(error);
    return (data as BotRow[]).map(bot);
  }
  async getBot(id: string, ownerId?: string) {
    const { data, error } = await database()
      .from('splendor_bots')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    check(error);
    if (!data) return undefined;
    const b = bot(data as BotRow);
    if ((b.qualification !== 'passed' || b.privateExecution) && b.ownerId !== ownerId)
      return undefined;
    return { ...b, ...(await getArtifact<BotArtifact>(b.artifactKey)) };
  }
  async saveProject(
    ownerId: string,
    name: string,
    artifact: BotArtifact,
    secrets: Record<string, string> = {},
  ): Promise<CloudBot> {
    const db = database();
    const fingerprint = secretFingerprint(ownerId, secrets);
    const { data: existing, error: e } = await db
      .from('splendor_bots')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('name', name)
      .eq('project_hash', artifact.projectHash)
      .eq('secrets_fingerprint', fingerprint)
      .maybeSingle();
    check(e);
    if (existing) return bot(existing as BotRow);
    const id = randomUUID(),
      key = `bots/${id}/project.json`,
      sourceHash = createHash('sha256').update(artifact.source).digest('hex');
    const { error } = await db.rpc('splendor_reserve_work', {
      p_owner: ownerId,
      p_kind: 'bot',
      p_id: id,
      p_payload: {
        name,
        source_hash: sourceHash,
        project_hash: artifact.projectHash,
        artifact_key: key,
        secrets_encrypted: encryptBotSecrets(ownerId, id, secrets),
        secrets_fingerprint: fingerprint,
      },
    });
    check(error);
    try {
      await putArtifact(key, artifact);
    } catch (error) {
      await db
        .from('splendor_bots')
        .update({
          qualification: 'failed',
          qualification_error: 'Artifact upload failed; submit a new version.',
        })
        .eq('id', id);
      throw error;
    }
    const { data: created, error: readError } = await db
      .from('splendor_bots')
      .select('*')
      .eq('id', id)
      .single();
    check(readError);
    return bot(created as BotRow);
  }
  async listJobs(ownerId: string) {
    const { data, error } = await database()
      .from('splendor_evaluations')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(50);
    check(error);
    return (data as JobRow[]).map(job);
  }
  async getJob(id: string, ownerId: string) {
    const { data, error } = await database()
      .from('splendor_evaluations')
      .select('*')
      .eq('id', id)
      .eq('owner_id', ownerId)
      .maybeSingle();
    check(error);
    if (!data) return undefined;
    const r = data as JobRow;
    return {
      ...job(r),
      ...(r.status === 'completed' && r.report_key
        ? { report: await getArtifact<EvaluationReport>(r.report_key) }
        : {}),
    };
  }
  async createJob(config: EvaluationConfig, ownerId: string) {
    const id = randomUUID();
    const { error } = await database().rpc('splendor_reserve_work', {
      p_owner: ownerId,
      p_kind: 'evaluation',
      p_id: id,
      p_payload: {
        config,
        total_games: evaluationGameCount(config.botIds.length, config.pairs),
      },
    });
    check(error);
    return (await this.getJob(id, ownerId))!;
  }
  async fail(id: string, error: string) {
    const { error: e } = await database()
      .from('splendor_evaluations')
      .update({ status: 'failed', error })
      .eq('id', id)
      .in('status', ['queued', 'running']);
    check(e);
  }
}
