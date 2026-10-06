import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleProject, validateProject } from '../src/submissions/bundle';
import { BotRunner } from '../src/sandbox';
import { createGame, observe, validateAction } from '../src/engine';
test('TypeScript folder with local helper bundles and runs in the SDK sandbox', async () => {
  const { source, projectHash } = await bundleProject([
    {
      path: 'index.ts',
      content:
        "import {SplendorPlayer} from 'splendor';import {pick} from './lib/pick';export default class Bot extends SplendorPlayer {chooseAction(view: any){return pick(view.legalActions)}}",
    },
    { path: 'lib/pick.ts', content: 'export const pick = <T>(xs:T[]):T => xs[0];' },
  ]);
  assert.equal(projectHash.length, 64);
  const runner = new BotRunner(source);
  try {
    const state = createGame();
    validateAction(state, await runner.chooseAction(observe(state)));
  } finally {
    await runner.close();
  }
});
test('folder validator rejects traversal, duplicate files, missing entry and excessive files', () => {
  for (const files of [
    [{ path: '../index.ts', content: '' }],
    [
      { path: 'index.ts', content: '' },
      { path: 'index.ts', content: '' },
    ],
    [{ path: 'main.ts', content: '' }],
    [{ path: 'index.ts', content: '💎'.repeat(40000) }],
    Array.from({ length: 65 }, (_, i) => ({ path: `f${i}.ts`, content: '' })),
  ])
    assert.throws(() => validateProject(files));
});
test('bundler denies npm, host files, URL imports and escaping project paths', async () => {
  for (const path of ['node:fs', 'https://example.com/code', '/etc/passwd', '../secret', 'lodash'])
    await assert.rejects(
      bundleProject([{ path: 'index.ts', content: `import x from '${path}'; export default x;` }]),
    );
});
test('project hash is stable across file order and includes unused files', async () => {
  const a = { path: 'index.ts', content: 'export default 1;' },
    b = { path: 'notes.json', content: '{}' };
  assert.equal(
    (await bundleProject([a, b])).projectHash,
    (await bundleProject([b, a])).projectHash,
  );
  assert.notEqual(
    (await bundleProject([a])).projectHash,
    (await bundleProject([a, b])).projectHash,
  );
});
