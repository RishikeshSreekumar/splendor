import type { RunnerOptions } from '../src/types';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BotRunner } from '../src/sandbox';
import { createGame, observe } from '../src/engine';
const source = (body: string) =>
  `import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer { chooseAction(view) { ${body} } }`;
const view = observe(createGame());
async function run(
  code: string,
  fn: (runner: BotRunner) => Promise<unknown>,
  options: RunnerOptions = {},
) {
  const runner = new BotRunner(code, options);
  try {
    await fn(runner);
  } finally {
    await runner.close();
  }
}
test('SDK abstract contract, persistent instance state, and independent per-game instances', async () => {
  const code = source('this.n = (this.n ?? 0) + 1; return { n: this.n };');
  await run(code, async (r) => {
    assert.deepEqual(await r.chooseAction(view), { n: 1 });
    assert.deepEqual(await r.chooseAction(view), { n: 2 });
  });
  await run(code, async (r) => assert.deepEqual(await r.chooseAction(view), { n: 1 }));
  await run('export default class Bot { chooseAction() {} }', async (r) =>
    assert.rejects(r.ready, /BOT_ERROR/),
  );
});
test('sandbox exposes bounded fetch but no Node, filesystem, sockets, timers or real clock', async () => {
  await run(
    source(
      'return [typeof process, typeof require, typeof fetch, typeof WebSocket, typeof setTimeout, typeof Date];',
    ),
    async (r) => {
      assert.deepEqual(await r.chooseAction(view), [
        'undefined',
        'undefined',
        'function',
        'undefined',
        'undefined',
        'undefined',
      ]);
    },
  );
  await run("import fs from 'node:fs'; export default class Bot {}", async (r) =>
    assert.rejects(r.ready, /BOT_ERROR/),
  );
});
test('mutation of bot input never mutates authoritative state', async () => {
  await run(source('view.bank.gold = 999; return view.legalActions[0];'), async (r) => {
    assert.deepEqual(await r.chooseAction(view), view.legalActions[0]);
    assert.equal(view.bank.gold, 5);
  });
});
test('seeded Math.random produces reproducible bot decisions', async () => {
  const code = source('return [Math.random(), Math.random(), Math.random()];');
  let first: unknown;
  await run(
    code,
    async (r) => {
      first = await r.chooseAction(view);
    },
    { seed: 'same' },
  );
  await run(code, async (r) => assert.deepEqual(await r.chooseAction(view), first), {
    seed: 'same',
  });
  await run(code, async (r) => assert.notDeepEqual(await r.chooseAction(view), first), {
    seed: 'different',
  });
});
test('infinite loops during move, constructor and module initialization are bounded', async () => {
  for (const code of [
    source('while (true) {}'),
    "import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer { constructor() { super(); while(true) {} } }",
    'while (true) {}; export default class Bot {}',
  ]) {
    const start = Date.now();
    await run(code, async (r) => assert.rejects(r.chooseAction(view, 20), /TIMEOUT/), {
      initializationMs: 20,
    });
    assert.ok(Date.now() - start < 3000);
  }
});
test('throws, undefined, unresolved promises, cycles, oversized outputs and hostile getters become bounded faults', async () => {
  for (const body of [
    "throw new Error('secret');",
    'return undefined;',
    'return new Promise(() => {});',
    'const a = {}; a.a = a; return a;',
    "return 'x'.repeat(20000);",
    'return { get type() { while (true) {} } };',
  ])
    await run(
      source(body),
      async (r) => assert.rejects(r.chooseAction(view, 30), /BOT_ERROR|TIMEOUT/),
      { initializationMs: 20 },
    );
});
test('memory exhaustion is contained and does not break another bot', async () => {
  await run(
    source('const a=[]; while(true) a.push(new Array(100000).fill(1));'),
    async (r) => {
      await assert.rejects(r.chooseAction(view, 100), /BOT_ERROR|TIMEOUT|BOT_EXIT/);
    },
    { memoryMb: 4, initializationMs: 100 },
  );
  await run(source('return view.legalActions[0];'), async (r) =>
    assert.deepEqual(await r.chooseAction(view), view.legalActions[0]),
  );
});
test('syntax errors and missing chooseAction are bot faults; invalid limits reject early', async () => {
  await run('export default class {', async (r) => assert.rejects(r.ready, /BOT_ERROR/));
  await run(
    "import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer {}",
    async (r) => assert.rejects(r.chooseAction(view), /BOT_ERROR/),
  );
  assert.throws(() => new BotRunner('x'.repeat(129 * 1024)), /128 KiB/);
  assert.throws(() => new BotRunner(source(''), { initializationMs: 0 }), /initializationMs/);
  assert.throws(() => new BotRunner(source(''), { memoryMb: 0 }), /memoryMb/);
});
