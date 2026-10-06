import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { database, getArtifact } from '../src/server/cloud';
import { CloudStore } from '../src/server/cloud-store';
const origin = 'https://splendor.sudipmondal.co.in';
const headers = {
  authorization: `Bearer ${process.env.QA_TOKEN}`,
  'content-type': 'application/json',
};
const api = async (path: string, body?: unknown) => {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(data)}`);
  return data;
};
if (process.argv[2] === 'submit') {
  const key = 'qa-' + randomBytes(16).toString('hex');
  const bot = await api('/api/bots', {
    name: 'Private HTTPS verification',
    secrets: { API_KEY: key },
    files: [
      {
        path: 'index.ts',
        content: `import {SplendorPlayer} from 'splendor';export default class B extends SplendorPlayer{async chooseAction(v){if(!this.checked){if(!this.getSecret('API_KEY')?.startsWith('qa-'))throw new Error('Missing private key');if(this.getSecret('SUPABASE_SERVICE_ROLE_KEY'))throw new Error('Platform key exposed');const r=await fetch('https://example.com');if(!r.ok||!(await r.text()).includes('Example Domain'))throw new Error('HTTPS failed');this.checked=true;}return this.getLegalActions(v,'buy')[0]??this.chooseRandomAction(v)}}`,
      },
    ],
  });
  assert.equal(bot.privateExecution, true);
  assert.ok(!JSON.stringify(bot).includes(key));
  await appendFile('.env.qa', `QA_BOT_ID=${bot.id}\n`);
  const { data: row, error } = await database()
    .from('splendor_bots')
    .select('*')
    .eq('id', bot.id)
    .single();
  if (error) throw error;
  assert.ok(row.secrets_encrypted);
  assert.ok(!row.secrets_encrypted.includes(key));
  assert.ok(!JSON.stringify(await getArtifact(row.artifact_key)).includes(key));
  assert.equal(
    await new CloudStore().getBot(bot.id, '00000000-0000-4000-8000-000000000099'),
    undefined,
  );
  assert.equal((await fetch(origin + '/api/bots/' + bot.id)).status, 404);
  console.log({
    submitted: bot.id,
    privateExecution: true,
    keyEncrypted: true,
    keyAbsentFromArtifact: true,
    otherOwnerDenied: true,
  });
} else if (process.argv[2] === 'result') {
  const bots = await api('/api/bots'),
    bot = bots.find((b: { id: string }) => b.id === process.env.QA_BOT_ID);
  assert.equal(bot.qualification, 'passed', bot.qualificationError);
  const publicBots = await (await fetch(origin + '/api/bots')).json();
  assert.ok(!publicBots.some((b: { id: string }) => b.id === bot.id));
  const job = await api('/api/evaluations', {
    botIds: [bot.id, bots.find((b: { name: string }) => b.name === 'Greedy').id],
    pairs: 1,
    mode: 'ranked',
    clockConfig: { initialMs: 60000, incrementMs: 1000 },
  });
  await appendFile('.env.qa', `QA_JOB_ID=${job.id}\n`);
  console.log({ qualification: 'passed', privateBotAbsentFromPublicLibrary: true, job: job.id });
}
