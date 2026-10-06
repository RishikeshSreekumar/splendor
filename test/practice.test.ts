import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGame, legalActions, observe, applyAction, assertInvariants } from '../src/engine';
import { ChessClock } from '../src/clock';
import { BotFault } from '../src/sandbox';
import { humanStep, playBots, type BotDriver } from '../src/practice/bot-turns';
import { arrangeSeats, chooseHumanSeat } from '../src/practice/types';
import {
  bagAction,
  buyOptions,
  canAddGem,
  nobleAction,
  previewAction,
  reserveAction,
} from '../src/practice/moves';
import { practiceTurn } from '../src/server/practice-turn';
import { simulate } from '../src/simulation';
import { tokens } from '../src/catalog';
import type { GameState, Observation } from '../src/types';
const first: BotDriver = {
  chooseAction: async (view: Observation) => view.legalActions[0],
};
const faulty: BotDriver = {
  chooseAction: async () => {
    throw new BotFault('BOT_ERROR');
  },
};
const source = (name: string) => readFile(new URL(`../bots/${name}.js`, import.meta.url), 'utf8');

test('seats place the human and number repeated bot names', () => {
  assert.equal(chooseHumanSeat('first', 4), 0);
  assert.equal(chooseHumanSeat('last', 4), 3);
  assert.equal(chooseHumanSeat('random', 3, 0.99), 2);
  const seats = arrangeSeats(1, [
    { id: 'g', name: 'Greedy' },
    { id: 'g', name: 'Greedy' },
  ]);
  assert.deepEqual(
    seats.map((s) => s.name),
    ['Greedy', 'You', 'Greedy 2'],
  );
  assert.equal(seats[1].kind, 'human');
});

test('bots play until the human seat must act and every step carries the human view', async () => {
  const state = createGame({ players: 3, seed: 'table' });
  const clock = new ChessClock(3);
  const result = await playBots({
    state,
    clock,
    humanSeat: 2,
    drivers: [first, first, null],
    disabled: new Set(),
  });
  assert.equal(result.state.currentPlayer, 2);
  assert.deepEqual(
    result.steps.map((s) => s.seat),
    [0, 1],
  );
  for (const step of result.steps) {
    assert.equal(step.view.you, 2);
    assert.ok(step.view.clock);
  }
  assert.ok(result.steps.at(-1)!.view.legalActions.length > 0, 'human can act after bots');
  assert.equal(
    result.steps[0].view.legalActions.length,
    0,
    'mid-sequence views are not actionable',
  );
});

test('a faulting bot falls back to legal moves without increment and is reported once', async () => {
  const clock = new ChessClock(2, { initialMs: 1000, incrementMs: 500 });
  const disabled = new Set<number>();
  let state: GameState = humanStep(
    { state: createGame({ seed: 'fault' }), clock, humanSeat: 0 },
    legalActions(createGame({ seed: 'fault' }))[0],
  ).state;
  const r1 = await playBots({ state, clock, humanSeat: 0, drivers: [null, faulty], disabled });
  assert.equal(r1.steps.length, 1);
  assert.ok(r1.steps[0].assisted);
  assert.equal(r1.notices.length, 1);
  assert.ok(disabled.has(1));
  assert.ok(clock.snapshot().remainingMs[1] <= 1000, 'no increment for assisted turns');
  state = applyAction(r1.state, legalActions(r1.state)[0]);
  const r2 = await playBots({ state, clock, humanSeat: 0, drivers: [null, faulty], disabled });
  assert.equal(r2.notices.length, 0);
  assert.ok(r2.steps.every((s) => s.assisted));
});

test('human moves are validated and normalized before they change the board', () => {
  const state = createGame({ seed: 'human' });
  const clock = new ChessClock(2);
  assert.throws(() => humanStep({ state, clock, humanSeat: 0 }, { type: 'cheat' }));
  assert.throws(
    () => humanStep({ state, clock, humanSeat: 1 }, legalActions(state)[0]),
    /Wait for your turn/,
  );
  const legal = legalActions(state).find((a) => a.type === 'take')!;
  const reordered = {
    tokens: Object.fromEntries(Object.entries(legal.tokens).reverse()),
    type: 'take',
  };
  const { step } = humanStep({ state, clock, humanSeat: 0 }, reordered);
  assert.deepEqual(step.action, legal);
  assert.equal(state.decision, 0, 'input state is immutable');
});

test('click helpers only ever produce legal actions', () => {
  const s = structuredClone(createGame({ seed: 'moves' }));
  const view = observe(s, 0);
  assert.ok(canAddGem(view, 'take', {}, 'red'));
  assert.ok(canAddGem(view, 'take', { red: 1 }, 'red'), 'two of a color with 4 in the bank');
  assert.ok(!canAddGem(view, 'take', { red: 2 }, 'blue'));
  assert.ok(!canAddGem(view, 'take', { red: 1, blue: 1 }, 'red'));
  assert.ok(!canAddGem(view, 'take', {}, 'gold'));
  assert.equal(bagAction(view, 'take', { red: 1, blue: 1 }), undefined);
  assert.deepEqual(bagAction(view, 'take', { red: 1, blue: 1, green: 1 }), {
    type: 'take',
    tokens: tokens({ red: 1, blue: 1, green: 1 }),
  });
  const card = view.market[0][0];
  assert.deepEqual(reserveAction(view, { cardId: card.id }), { type: 'reserve', cardId: card.id });
  assert.deepEqual(reserveAction(view, { tier: 2 }), { type: 'reserve', tier: 2 });
  assert.equal(buyOptions(view, card.id).length, 0);
  assert.equal(nobleAction(view, view.nobles[0].id), undefined);
  // Gold alternatives are offered, cheapest in gold first.
  s.players[0].tokens = tokens({ ...card.cost, gold: 1 });
  const rich = observe(s, 0);
  const options = buyOptions(rich, card.id);
  assert.ok(options.length > 1);
  assert.equal(options[0].payment.gold, 0);
});

test('the Modal practice turn runs the human move and every bot reply in one call', async () => {
  const greedy = await source('greedy');
  const state = createGame({ players: 3, seed: 'modal' });
  const clock = new ChessClock(3).snapshot();
  const result = await practiceTurn({
    state,
    clock,
    action: legalActions(state)[0],
    humanSeat: 0,
    seats: [null, { source: greedy }, { source: greedy }],
  });
  assert.deepEqual(
    result.steps.map((s) => s.seat),
    [0, 1, 2],
  );
  assert.equal(result.state.currentPlayer, 0);
  assertInvariants(result.state);
  // Legacy payloads keep working: human at seat 0 against one source.
  const legacy = await practiceTurn({
    state: createGame({ seed: 'legacy' }),
    clock: new ChessClock(2).snapshot(),
    action: legalActions(createGame({ seed: 'legacy' }))[0],
    source: greedy,
  });
  assert.equal(legacy.steps.length, 2);
  // A null action lets bots open when the human sits later.
  const opening = await practiceTurn({
    state,
    clock,
    action: null,
    humanSeat: 2,
    seats: [{ source: greedy }, { source: greedy }, null],
  });
  assert.equal(opening.state.currentPlayer, 2);
  assert.equal(opening.steps.length, 2);
});

test('Strategist plays fault-free and beats Greedy across paired seats', async () => {
  const strategist = { id: 'strategist', source: await source('strategist') };
  const greedy = { id: 'greedy', source: await source('greedy') };
  let wins = 0,
    losses = 0;
  for (let i = 0; i < 12; i++) {
    const swap = i % 2 === 1;
    const r = await simulate({
      bots: swap ? [greedy, strategist] : [strategist, greedy],
      seed: `strategist-${i}`,
    });
    assert.equal(r.result.reason, 'completed');
    assert.deepEqual(r.faults, [0, 0]);
    const seat = swap ? 1 : 0;
    if (r.result.winners.length === 1) {
      if (r.result.winners[0] === seat) wins++;
      else losses++;
    }
  }
  assert.ok(wins > losses, `expected Strategist to win more often (${wins}-${losses})`);
});

test('previewAction mirrors the engine for the human seat before bots reply', () => {
  let state = createGame({ players: 3, seed: 'preview' });
  for (let i = 0; i < 30 && state.status === 'playing'; i++) {
    const view = observe(state, state.currentPlayer);
    const action =
      view.legalActions.find((a) => a.type === 'buy') ??
      view.legalActions.find((a) => a.type === 'reserve' && a.cardId) ??
      view.legalActions[0];
    const preview = previewAction(view, action);
    const next = applyAction(state, action);
    const actual = observe(next, view.you);
    const me = preview.players[view.you];
    const real = actual.players[view.you];
    assert.deepEqual(me.tokens, real.tokens);
    assert.deepEqual(me.bonuses, real.bonuses);
    assert.equal(me.points, real.points - real.nobles.length * 3 + me.nobles.length * 3);
    assert.equal(me.reserved.length, real.reserved.length);
    assert.deepEqual(preview.bank, actual.bank);
    state = next;
  }
});
