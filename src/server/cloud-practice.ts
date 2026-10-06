import { randomBytes, randomUUID } from 'node:crypto';
import { createGame, observe, validateAction } from '../engine';
import { ChessClock } from '../clock';
import { database, getArtifact } from './cloud';
import { CloudStore, type BotArtifact } from './cloud-store';
import { modalClient } from './modal-jobs';
import type { ClockConfig, ClockSnapshot, GameState } from '../types';
import imageConfig from '../../modal-image.json';
function view(id: string, state: GameState, clock: ClockSnapshot, notices: string[] = []) {
  return { id, view: { ...observe(state, 0), clock }, revision: state.decision, notices };
}
export async function cloudPractice(
  user: string,
  body:
    | { type: 'new'; clockConfig: ClockConfig }
    | { type: 'close'; id: string }
    | { type: 'action'; id: string; action: unknown; revision: number },
) {
  const db = database();
  if (body.type === 'new') {
    const id = randomUUID(),
      state = createGame({ seed: randomBytes(32).toString('hex') }),
      clock = new ChessClock(2, body.clockConfig).snapshot();
    const { error } = await db.rpc('splendor_create_practice', {
      p_owner: user,
      p_id: id,
      p_state: state,
      p_clock: clock,
    });
    if (error) throw error;
    return view(id, state, clock);
  }
  const { data: session, error } = await db
    .from('splendor_practice_sessions')
    .select('*')
    .eq('id', body.id)
    .eq('owner_id', user)
    .maybeSingle();
  if (error) throw error;
  if (!session) throw new Error('Practice session expired');
  if (body.type === 'close') {
    const { error: e } = await db
      .from('splendor_practice_sessions')
      .delete()
      .eq('id', body.id)
      .eq('owner_id', user);
    if (e) throw e;
    return { closed: true };
  }
  if (session.revision !== body.revision || session.busy)
    throw new Error('The board changed; refresh and try again');
  validateAction(session.state as GameState, body.action);
  const { data: locked, error: le } = await db
    .from('splendor_practice_sessions')
    .update({ busy: true, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('revision', body.revision)
    .eq('busy', false)
    .select('id')
    .maybeSingle();
  if (le) throw le;
  if (!locked) throw new Error('Another move is running');
  const client = modalClient();
  let sandbox;
  try {
    const baseline = (await new CloudStore().listBots()).find(
      (b) => b.baseline && b.name === 'Greedy',
    );
    if (!baseline) throw new Error('Baseline unavailable');
    const source = (await getArtifact<BotArtifact>(baseline.artifactKey)).source;
    const app = await client.apps.fromName(imageConfig.app),
      image = await client.images.fromId(process.env.MODAL_IMAGE_ID ?? imageConfig.imageId);
    sandbox = await client.sandboxes.create(app, image, {
      command: ['node', '--max-old-space-size=192', '/app/.runtime/modal-runner.mjs'],
      workdir: '/app',
      memoryMiB: 512,
      memoryLimitMiB: 512,
      cpu: 1,
      cpuLimit: 1,
      blockNetwork: false,
      timeoutMs: 45000,
    });
    await sandbox.stdin.writeText(
      JSON.stringify({
        kind: 'practice-turn',
        input: { state: session.state, clock: session.clock, action: body.action, source },
      }),
    );
    await sandbox.stdin.close();
    const output = await sandbox.stdout.readText();
    const exit = await sandbox.wait();
    if (exit !== 0) throw new Error(`Practice runner stopped (exit ${exit})`);
    const result = JSON.parse(output) as {
      state: GameState;
      clock: ClockSnapshot;
      notices: string[];
    };
    const { error: e } = await db
      .from('splendor_practice_sessions')
      .update({
        state: result.state,
        clock: result.clock,
        revision: result.state.decision,
        busy: false,
      })
      .eq('id', body.id)
      .eq('revision', body.revision);
    if (e) throw e;
    return view(body.id, result.state, result.clock, result.notices);
  } finally {
    await sandbox?.terminate();
    await client.close();
    await db
      .from('splendor_practice_sessions')
      .update({ busy: false })
      .eq('id', body.id)
      .eq('revision', body.revision);
  }
}
