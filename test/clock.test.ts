import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessClock, DEFAULT_CLOCK } from '../src/clock';
import { simulate } from '../src/simulation';
import { BotRunner } from '../src/sandbox';
import { createGame, observe } from '../src/engine';

test('defaults give each bot 60 seconds and a one-second Fischer increment', () => {
  const clock = new ChessClock(4);
  assert.deepEqual(DEFAULT_CLOCK, { initialMs: 60000, incrementMs: 1000 });
  assert.deepEqual(clock.snapshot().remainingMs, [60000, 60000, 60000, 60000]);
});
test('only the active bot loses time; platform and opponent time are excluded', () => {
  let now = 0;
  const c = new ChessClock(2, DEFAULT_CLOCK, () => now);
  c.beginDecision(0);
  now = 750;
  c.endDecision(0);
  now += 20_000;
  assert.deepEqual(c.snapshot().remainingMs, [59250, 60000]);
  c.completeTurn(0, 0);
  assert.equal(c.getRemaining(0), 60250);
  c.beginDecision(1);
  now += 2000;
  c.endDecision(1);
  c.completeTurn(1, 1);
  assert.deepEqual(c.snapshot().remainingMs, [60250, 59000]);
});
test('main, discard, and noble share a budget and award exactly one increment', () => {
  let now = 0;
  const c = new ChessClock(2, DEFAULT_CLOCK, () => now);
  for (const time of [200, 300, 400]) {
    c.beginDecision(0);
    now += time;
    c.endDecision(0);
  }
  assert.equal(c.getRemaining(0), 59100);
  c.completeTurn(0, 0);
  assert.equal(c.getRemaining(0), 60100);
  assert.throws(() => c.completeTurn(0, 0), /already processed/);
});
test('expiry at the deadline cannot be rescued by increment, even with zero increment', () => {
  let now = 0;
  const c = new ChessClock(2, { initialMs: 100, incrementMs: 1000 }, () => now);
  c.beginDecision(0);
  now = 100;
  assert.equal(c.endDecision(0).expired, true);
  c.completeTurn(0, 0);
  assert.equal(c.getRemaining(0), 0);
  assert.throws(() => c.beginDecision(0), /expired/);
  const zero = new ChessClock(2, { initialMs: 100, incrementMs: 0 });
  zero.completeTurn(0, 0);
  assert.equal(zero.getRemaining(0), 100);
});
test('assistance never earns increments; clock configs and simultaneous starts are validated', () => {
  const c = new ChessClock(2);
  c.completeTurn(0, 0, true);
  assert.equal(c.getRemaining(0), 60000);
  c.beginDecision(0);
  assert.throws(() => c.beginDecision(1), /already running/);
  for (const cfg of [
    { initialMs: 0, incrementMs: 0 },
    { initialMs: 100, incrementMs: -1 },
    { initialMs: NaN, incrementMs: 0 },
  ])
    assert.throws(() => new ChessClock(2, cfg));
});
test('async bot decisions are supported and SDK helpers execute inside the sandbox', async () => {
  const source = `import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer {
    async chooseAction(v) { await Promise.resolve(); return { self: this.getSelf(v).points, cost: this.getCost(v.market[0][0], this.getSelf(v)), legal: this.getLegalActions(v).length, points: this.getPoints(this.getSelf(v)), action: this.chooseRandomAction(v) }; }
  }`;
  const r = new BotRunner(source);
  try {
    const v = observe(createGame());
    const action = (await r.chooseAction(v)) as {
      self: number;
      legal: number;
      points: number;
      cost: unknown;
    };
    assert.equal(action.self, 0);
    assert.equal(action.points, 0);
    assert.equal(action.legal, v.legalActions.length);
    assert.deepEqual(action.cost, v.market[0][0].cost);
  } finally {
    await r.close();
  }
});
test('clock is visible per bot; a forfeiting bot never consumes the opponent clock', async () => {
  const looper = {
    id: 'loop',
    source:
      "import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer { chooseAction() { while(true) {} } }",
  };
  const legal = {
    id: 'legal',
    source:
      "import { SplendorPlayer } from 'splendor'; export default class Bot extends SplendorPlayer { chooseAction(v) { return this.chooseRandomAction(v); } }",
  };
  const r = await simulate({
    bots: [looper, legal],
    clockConfig: { initialMs: 30, incrementMs: 1000 },
  });
  assert.equal(r.result.reason, 'forfeit');
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(r.clock.remainingMs[1], 30);
  assert.equal(r.clock.remainingMs[0], 0);
  assert.equal(r.assistedDecisions, 0);
});

test('persisted practice clocks preserve balances and reject active or corrupt snapshots', () => {
  const snapshot = {
    config: { initialMs: 60000, incrementMs: 1000 },
    remainingMs: [0, 73456.25],
    activeSeat: null,
  };
  const restored = ChessClock.restore(snapshot);
  snapshot.remainingMs[1] = 1;
  assert.deepEqual(restored.snapshot().remainingMs, [0, 73456.25]);
  assert.throws(() => restored.beginDecision(0), /expired/);
  for (const remainingMs of [
    [-1, 10],
    [NaN, 10],
    [Infinity, 10],
  ]) {
    assert.throws(() => ChessClock.restore({ ...snapshot, remainingMs }), /Invalid saved clock/);
  }
  assert.throws(() => ChessClock.restore({ ...snapshot, activeSeat: 1 }), /Invalid saved clock/);
});
