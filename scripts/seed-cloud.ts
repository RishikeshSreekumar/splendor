import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { bundleProject } from '../src/submissions/bundle';
import { database, putArtifact } from '../src/server/cloud';
const db = database();
for (const name of ['Random', 'Greedy']) {
  const artifact = await bundleProject([
    { path: 'index.ts', content: await readFile(`bots/${name.toLowerCase()}.js`, 'utf8') },
  ]);
  const { data, error } = await db
    .from('splendor_bots')
    .select('id')
    .eq('baseline', true)
    .eq('name', name)
    .eq('project_hash', artifact.projectHash)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    console.log(name + ' already seeded');
    continue;
  }
  const id = randomUUID(),
    key = `bots/${id}/project.json`;
  await putArtifact(key, artifact);
  const { error: e } = await db.from('splendor_bots').insert({
    id,
    name,
    source_hash: createHash('sha256').update(artifact.source).digest('hex'),
    project_hash: artifact.projectHash,
    artifact_key: key,
    baseline: true,
    qualification: 'passed',
  });
  if (e) throw e;
  console.log(name + ' seeded');
}
