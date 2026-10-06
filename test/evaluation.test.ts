import type { Mode } from '../src/types';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { simulate, replay } from '../src/simulation';
import { evaluate, eloPair, winInterval } from '../src/evaluation';
import { assertInvariants } from '../src/engine';
const greedy = {
  id: 'greedy',
  source: await readFile(new URL('../bots/greedy.js', import.meta.url), 'utf8'),
};
const random = {
  id: 'random',
  source: await readFile(new URL('../bots/random.js', import.meta.url), 'utf8'),
};
const invalid = {
  id: 'invalid',
  source:
    "import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer { chooseAction() { return { type: 'cheat' }; } }",
};
const looping = {
  id: 'looping',
  source: invalid.source.replace("return { type: 'cheat' };", 'while(true) {}'),
};
const broken = { id: 'broken', source: 'export default class {' };
test('ranked invalid action forfeits without applying fallback or changing board', async () => {
  const r = await simulate({ bots: [invalid, greedy] });
  assert.deepEqual(r.result, { reason: 'forfeit', winners: [1], ratingEligible: true });
  assert.equal(r.turns, 0);
  assert.deepEqual(r.faults, [1, 0]);
  assert.equal(r.assistedDecisions, 0);
  assert.equal(r.log[0].kind === 'fault' ? r.log[0].code : '', 'INVALID_ACTION');
  assertInvariants(replay(r));
});
test('practice logs fallback decisions and never awards rating eligibility', async () => {
  const r = await simulate({ bots: [invalid, greedy], mode: 'practice', seed: 'assisted' });
  assert.ok(r.assistedDecisions > 0);
  assert.equal(r.result.ratingEligible, false);
  assert.ok(r.faults[0] > 0);
  assertInvariants(replay(r));
  const again = await simulate({ bots: [invalid, greedy], mode: 'practice', seed: 'assisted' });
  assert.equal(r.finalStateHash, again.finalStateHash);
  assert.deepEqual(
    r.log.filter((e) => e.kind === 'action').map((e) => e.action),
    again.log.filter((e) => e.kind === 'action').map((e) => e.action),
  );
});
test('timeouts forfeit ranked games and become automatic fallback for remaining practice decisions', async () => {
  const r = await simulate({
    bots: [looping, greedy],
    clockConfig: { initialMs: 50, incrementMs: 0 },
    runnerOptions: { initializationMs: 20 },
  });
  assert.equal(r.result.reason, 'forfeit');
  assert.equal(r.log[0].kind === 'fault' ? r.log[0].code : '', 'TIMEOUT');
  const p = await simulate({
    bots: [looping, greedy],
    mode: 'practice',
    maxTurns: 8,
    clockConfig: { initialMs: 50, incrementMs: 0 },
    runnerOptions: { initializationMs: 20 },
  });
  assert.equal(p.decisions[0], 1);
  assert.equal(p.faults[0], 1);
  assert.ok(p.assistedDecisions >= 4);
});
test('startup failures are attributed, and two failed bots do not create a rated match', async () => {
  const r = await simulate({ bots: [greedy, broken] });
  assert.deepEqual(r.result, { reason: 'forfeit', winners: [0], ratingEligible: true });
  assert.equal(r.log[0].kind === 'fault' ? r.log[0].stage : '', 'startup');
  const both = await simulate({ bots: [broken, { ...broken, id: 'also-broken' }] });
  assert.deepEqual(both.result, { reason: 'both_failed', winners: [], ratingEligible: false });
});
test('seeded successful games replay exactly and reject corrupt or wrong-version artifacts', async () => {
  const options = { bots: [greedy, random], seed: 'replay' };
  const a = await simulate(options),
    b = await simulate(options);
  assert.equal(a.result.reason, 'completed');
  assert.equal(a.finalStateHash, b.finalStateHash);
  assertInvariants(replay(a));
  const corrupt = structuredClone(a);
  assert.ok(corrupt.log[0].kind === 'action');
  corrupt.log[0].stateHash = 'tampered';
  assert.throws(() => replay(corrupt), /hash mismatch/);
  assert.throws(() => replay({ ...a, rulesVersion: 'next' }), /version mismatch/);
});
test('turn cap reports incomplete game without inventing a winner or rating', async () => {
  const r = await simulate({ bots: [greedy, random], maxTurns: 2 });
  assert.deepEqual(r.result, { reason: 'turn_limit', winners: [], ratingEligible: false });
  assert.equal(r.turns, 2);
});
test('three- and four-player practice work; multiplayer ranked is rejected', async () => {
  for (const n of [3, 4]) {
    const bots = Array.from({ length: n }, (_, i) => ({ ...greedy, id: `greedy-${i}` }));
    const r = await simulate({ bots, mode: 'practice', seed: 'multi' });
    assert.equal(r.result.reason, 'completed');
    assert.equal(r.result.ratingEligible, false);
    assertInvariants(replay(r));
    await assert.rejects(simulate({ bots, mode: 'ranked' }), /two players/);
  }
});
test('Elo is zero-sum, symmetric and handles draws', () => {
  assert.deepEqual(eloPair(1200, 1200, 1), [1216, 1184]);
  assert.deepEqual(eloPair(1200, 1200, 0.5), [1200, 1200]);
  const [a, b] = eloPair(1500, 1100, 0.5);
  assert.ok(a < 1500 && b > 1100);
  assert.equal(a + b, 2600);
  assert.throws(() => eloPair(1200, 1200, 2));
  assert.deepEqual(winInterval(0, 0), [0, 1]);
  assert.ok(winInterval(10, 10)[0] < 0.8);
});
test('paired evaluation swaps seats with independent deals and pins source versions', async () => {
  const r = await evaluate({ bots: [greedy, random], pairs: 2, seed: 'league' });
  assert.equal(r.dealPolicy, 'independent');
  assert.equal(new Set(r.games.map((g) => g.seed)).size, 4);
  assert.equal(r.games.length, 4);
  for (let i = 0; i < 4; i += 2) {
    assert.notEqual(r.games[i].seed, r.games[i + 1].seed);
    assert.deepEqual(
      r.games[i].bots.map((b) => b.id),
      r.games[i + 1].bots.map((b) => b.id).reverse(),
    );
  }
  assert.equal(
    r.leaderboard.reduce((n, r) => n + r.elo, 0),
    2400,
  );
  for (const row of r.leaderboard) {
    assert.equal(row.ratedGames, 4);
    assert.equal(row.sourceHash.length, 64);
    assert.equal(row.provisional, true);
  }
});
test('practice and capped pairs never move Elo', async () => {
  for (const options of [
    { mode: 'practice' as Mode, maxTurns: 4 },
    { mode: 'ranked' as Mode, maxTurns: 1 },
  ]) {
    const r = await evaluate({ bots: [greedy, random], pairs: 1, ...options });
    assert.ok(
      r.leaderboard.every((r) => r.elo === 1200 && r.ratedGames === 0 && r.unratedGames === 2),
    );
  }
});
test('input validation rejects ambiguous IDs and unsupported modes', async () => {
  await assert.rejects(simulate({ bots: [greedy, greedy] }), /unique IDs/);
  await assert.rejects(simulate({ bots: [greedy, random], mode: 'anything' as Mode }), /Unknown/);
  await assert.rejects(evaluate({ bots: [greedy, greedy] }), /distinct/);
  await assert.rejects(evaluate({ bots: [greedy, random], pairs: 0 }), /pairs/);
});
