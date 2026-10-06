import type { GameState, Tokens, Cost } from '../src/types';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD, NOBLES, COLORS, tokens, sum } from '../src/catalog';
import {
  createGame,
  applyAction,
  legalActions,
  observe,
  points,
  payments,
  assertInvariants,
  InvalidAction,
} from '../src/engine';
import { random } from '../src/random';
const mutable = (players = 2) => structuredClone(createGame({ players, seed: 'tests' }));
function giveTokens(s: GameState, seat: number, bag: Partial<Tokens>) {
  for (const [c, n] of Object.entries(bag) as [keyof Tokens, number][]) {
    s.players[seat].tokens[c] += n;
    s.bank[c] -= n;
  }
}
function giveCard(s: GameState, seat: number, id: string) {
  for (let t = 0; t < 3; t++) {
    const i = s.decks[t].indexOf(id);
    if (i >= 0) s.decks[t].splice(i, 1);
    const j = s.market[t].indexOf(id);
    if (j >= 0) {
      s.market[t].splice(j, 1);
      if (s.decks[t].length) s.market[t].push(s.decks[t].shift()!);
    }
  }
  s.players[seat].cards.push(id);
}
function grantBonuses(s: GameState, seat: number, requirements: Partial<Cost>) {
  for (const [c, n] of Object.entries(requirements)) {
    for (const card of CARDS.filter((ca) => ca.bonus === c && ca.points === 0).slice(0, n))
      giveCard(s, seat, card.id);
  }
}
const take = (s: GameState) => legalActions(s).find((a) => a.type === 'take')!;

test('catalog contains 90 unique cards with 40/30/20 tiers and ten distinct nobles', () => {
  assert.equal(CARDS.length, 90);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 90);
  assert.deepEqual(
    [1, 2, 3].map((t) => CARDS.filter((c) => c.tier === t).length),
    [40, 30, 20],
  );
  assert.equal(NOBLES.length, 10);
  assert.equal(new Set(NOBLES.map((n) => JSON.stringify(n.cost))).size, 10);
  for (const c of CARDS)
    assert.ok(
      COLORS.includes(c.bonus) &&
        COLORS.every((k) => Number.isInteger(c.cost[k]) && c.cost[k] >= 0),
    );
  // Independent anchor facts, including a color pair easy to mistranscribe.
  assert.deepEqual(CARD.c01.cost, { white: 1, blue: 1, green: 1, red: 1, black: 0 });
  assert.ok(NOBLES.some((n) => n.cost.white === 3 && n.cost.black === 3 && n.cost.red === 3));
  assert.ok(!NOBLES.some((n) => n.cost.white === 3 && n.cost.green === 3 && n.cost.red === 3));
});
test('setup uses correct banks, markets, noble counts and deterministic shuffles', () => {
  for (const n of [2, 3, 4]) {
    const s = createGame({ players: n, seed: 'a' });
    assert.equal(s.bank.white, { 2: 4, 3: 5, 4: 7 }[n]);
    assert.equal(s.bank.gold, 5);
    assert.equal(s.nobles.length, n + 1);
    assert.deepEqual(
      s.decks.map((d) => d.length),
      [36, 26, 16],
    );
    assert.deepEqual(s, createGame({ players: n, seed: 'a' }));
    assertInvariants(s);
  }
  assert.notDeepEqual(createGame({ seed: 'a' }).market, createGame({ seed: 'b' }).market);
  for (const n of [0, 1, 5, 2.2, NaN]) assert.throws(() => createGame({ players: n }));
});
test('take is exactly three distinct colors unless bank piles are depleted; doubles require four', () => {
  let s = mutable();
  assert.equal(legalActions(s).filter((a) => a.type === 'take').length, 15);
  for (const bag of [{ white: 1 }, { white: 2, blue: 1 }, { gold: 1 }, { white: -1 }]) {
    assert.throws(() => applyAction(s, { type: 'take', tokens: tokens(bag) }), InvalidAction);
  }
  giveTokens(s, 1, { white: 1 });
  assert.throws(
    () => applyAction(s, { type: 'take', tokens: tokens({ white: 2 }) }),
    InvalidAction,
  );
  s = mutable(4);
  s.bank = tokens({ white: 2, blue: 3, gold: 5 });
  assert.deepEqual(
    legalActions(s).filter((a) => a.type === 'take'),
    [{ type: 'take', tokens: tokens({ white: 1, blue: 1 }) }],
  );
  s.bank.blue = 0;
  assert.deepEqual(
    legalActions(s).filter((a) => a.type === 'take'),
    [{ type: 'take', tokens: tokens({ white: 1 }) }],
  );
});
test('invalid moves are atomic and reject malformed/extra fields', () => {
  const s = createGame(),
    before = JSON.stringify(s);
  for (const a of [
    null,
    undefined,
    [],
    {},
    { type: 'pass' },
    { ...take(s), extra: true },
    { type: 'buy', cardId: '__proto__', payment: tokens() },
  ]) {
    assert.throws(() => applyAction(s, a), InvalidAction);
    assert.equal(JSON.stringify(s), before);
  }
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => applyAction(s, circular), InvalidAction);
});
test('excess tokens are returned as a separate mandatory decision, including newly taken tokens', () => {
  let s = mutable();
  giveTokens(s, 0, { white: 2, blue: 2, green: 2, red: 2, black: 2 });
  const action = { type: 'take', tokens: tokens({ white: 1, blue: 1, green: 1 }) };
  s = applyAction(s, action);
  assert.equal(s.phase, 'discard');
  assert.equal(s.currentPlayer, 0);
  assert.equal(s.turn, 0);
  assert.equal(sum(s.players[0].tokens), 13);
  assertInvariants(s);
  assert.throws(
    () => applyAction(s, { type: 'discard', tokens: tokens({ white: 1 }) }),
    InvalidAction,
  );
  s = applyAction(s, { type: 'discard', tokens: action.tokens });
  assert.equal(s.phase, 'main');
  assert.equal(s.currentPlayer, 1);
  assert.equal(s.turn, 1);
  assert.equal(sum(s.players[0].tokens), 10);
  assertInvariants(s);
});
test('reserve refills, takes gold, works without gold and respects cap', () => {
  let s = mutable();
  const id = s.market[0][0],
    refill = s.decks[0][0];
  s = applyAction(s, { type: 'reserve', cardId: id });
  assert.equal(s.market[0][0], refill);
  assert.equal(s.players[0].tokens.gold, 1);
  assert.deepEqual(s.players[0].reserved, [{ cardId: id, public: true }]);
  assertInvariants(s);
  s = structuredClone(s);
  s.currentPlayer = 0;
  giveTokens(s, 1, { gold: 4 });
  s = applyAction(s, { type: 'reserve', tier: 2 });
  assert.equal(s.players[0].tokens.gold, 1);
  assertInvariants(s);
  s = structuredClone(s);
  s.currentPlayer = 0;
  s = applyAction(s, { type: 'reserve', tier: 2 });
  s = structuredClone(s);
  s.currentPlayer = 0;
  assert.equal(legalActions(s).filter((a) => a.type === 'reserve').length, 0);
});
test('reserve with ten tokens requires returning one, and gold can be returned', () => {
  const s = mutable();
  giveTokens(s, 0, { white: 2, blue: 2, green: 2, red: 2, black: 2 });
  const n = applyAction(s, { type: 'reserve', tier: 1 });
  assert.equal(n.phase, 'discard');
  const done = applyAction(n, { type: 'discard', tokens: tokens({ gold: 1 }) });
  assert.equal(done.bank.gold, 5);
  assert.equal(done.players[0].reserved.length, 1);
  assertInvariants(done);
});
test('blind reservations and deck order stay private, visible reservations remain known', () => {
  let s = createGame();
  const blind = s.decks[2][0];
  s = applyAction(s, { type: 'reserve', tier: 3 });
  const opponent = observe(s, 1),
    own = observe(s, 0);
  assert.equal(own.players[0].reserved[0].card!.id, blind);
  assert.deepEqual(opponent.players[0].reserved, [{ hidden: true, tier: 3 }]);
  assert.ok(!JSON.stringify(opponent).includes(blind));
  assert.ok(!('decks' in opponent));
  assert.ok(!('seed' in opponent));
  assert.equal(own.legalActions.length, 0);
  const id = s.market[0][0];
  s = applyAction(s, { type: 'reserve', cardId: id });
  assert.equal(observe(s, 0).players[1].reserved[0].card!.id, id);
  assert.throws(() => {
    opponent.bank.gold = 900;
  }, TypeError);
});
test('different private deck orders produce identical observations and legal actions', () => {
  const s = mutable(),
    t = structuredClone(s);
  t.decks.forEach((d) => d.reverse());
  assert.deepEqual(observe(s), observe(t));
});
test('payments include optional gold substitution, exact amounts, discounts and free cards', () => {
  const s = mutable(),
    card = CARD.c01;
  giveTokens(s, 0, { white: 1, blue: 1, green: 1, red: 1, gold: 1 });
  const options = payments(s.players[0], card);
  assert.equal(options.length, 5);
  assert.ok(options.some((p) => p.gold === 1 && p.white === 0));
  giveCard(s, 0, CARDS.find((c) => c.bonus === 'white' && c.id !== card.id)!.id);
  assert.ok(payments(s.players[0], card).every((p) => p.white === 0 && sum(p) === 3));
  for (const c of ['blue', 'green', 'red'])
    giveCard(s, 0, CARDS.find((ca) => ca.bonus === c && ca.id !== card.id)!.id);
  assert.deepEqual(payments(s.players[0], card), [tokens()]);
});
test('buy returns payment to bank and can buy own reserved card but not an opponent reservation', () => {
  let s = mutable();
  const id = s.market[0].find((id) => sum(CARD[id].cost) <= 5) ?? s.market[0][0];
  giveTokens(s, 0, CARD[id].cost);
  const action = legalActions(s).find((a) => a.type === 'buy' && a.cardId === id);
  s = applyAction(s, action);
  assert.ok(s.players[0].cards.includes(id));
  assert.equal(sum(s.players[0].tokens), 0);
  assertInvariants(s);
  s = mutable();
  const reservedId = s.market[0][0];
  s = applyAction(s, { type: 'reserve', cardId: reservedId });
  assert.ok(!legalActions(s).some((a) => a.type === 'buy' && a.cardId === reservedId));
  s = structuredClone(s);
  s.currentPlayer = 0;
  giveTokens(s, 0, CARD[reservedId].cost);
  const buy = legalActions(s).find((a) => a.type === 'buy' && a.cardId === reservedId);
  const n = applyAction(s, buy);
  assert.equal(n.players[0].reserved.length, 0);
  assert.ok(n.players[0].cards.includes(reservedId));
  assertInvariants(n);
});
test('overpayment and insufficient payment are invalid', () => {
  const s = mutable(),
    id = s.market[0][0];
  giveTokens(s, 0, CARD[id].cost);
  const a = legalActions(s).find((a) => a.type === 'buy' && a.cardId === id);
  assert.ok(a && a.type === 'buy');
  const extra = structuredClone(a);
  extra.payment.gold++;
  assert.throws(() => applyAction(s, extra), InvalidAction);
  assert.throws(() => applyAction(s, { ...a, payment: tokens() }), InvalidAction);
});
test('nobles are mandatory, only bonuses count, and multiple eligible nobles require a choice', () => {
  let s = mutable();
  s.nobles = ['n2-0', 'n2-1', 'n2-2'];
  grantBonuses(s, 0, { red: 4, green: 4, blue: 4 });
  s = applyAction(s, take(s));
  assert.equal(s.phase, 'noble');
  assert.equal(s.turn, 0);
  assert.deepEqual(
    legalActions(s)
      .filter((a) => a.type === 'noble')
      .map((a) => a.nobleId),
    ['n2-0', 'n2-1'],
  );
  assert.throws(() => applyAction(s, { type: 'noble', nobleId: 'n2-2' }), InvalidAction);
  s = applyAction(s, { type: 'noble', nobleId: 'n2-1' });
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].nobles.length, 1);
  assert.ok(s.nobles.includes('n2-0'));
  assert.equal(points(s.players[0]), 3);
  assertInvariants(s);
  let only = mutable();
  only.nobles = ['n2-0', 'n2-1', 'n2-2'];
  grantBonuses(only, 0, { red: 4, green: 4 });
  only = applyAction(only, take(only));
  assert.equal(only.phase, 'main');
  assert.deepEqual(only.players[0].nobles, ['n2-0']);
  let justTokens = mutable();
  justTokens.nobles = ['n2-0', 'n2-1', 'n2-2'];
  giveTokens(justTokens, 0, { red: 4, green: 4 });
  justTokens = applyAction(justTokens, { type: 'reserve', tier: 1 });
  assert.equal(justTokens.players[0].nobles.length, 0);
});
test('a noble is checked after discarding and only one is received per turn', () => {
  let s = mutable();
  s.nobles = ['n2-0', 'n2-1', 'n2-2'];
  grantBonuses(s, 0, { red: 4, green: 4 });
  giveTokens(s, 0, { white: 2, blue: 2, green: 2, red: 2, black: 2 });
  s = applyAction(s, { type: 'reserve', tier: 1 });
  assert.equal(s.phase, 'discard');
  assert.equal(s.players[0].nobles.length, 0);
  s = applyAction(s, { type: 'discard', tokens: tokens({ gold: 1 }) });
  assert.equal(s.players[0].nobles.length, 1);
  assert.equal(s.turn, 1);
});
test('deck exhaustion shrinks market instead of inventing cards', () => {
  const s = mutable();
  s.players[1].cards.push(...s.decks[0]);
  s.decks[0] = [];
  const n = applyAction(s, { type: 'reserve', cardId: s.market[0][0] });
  assert.equal(n.market[0].length, 3);
  assertInvariants(n);
  assert.ok(!legalActions(n).some((a) => a.type === 'reserve' && a.tier === 1));
});
test('15 points completes the round with equal turns; first trigger need not win', () => {
  let s = mutable(3);
  const five = CARDS.filter((c) => c.points === 5),
    four = CARDS.filter((c) => c.points === 4);
  for (const card of five.slice(0, 3)) giveCard(s, 0, card.id);
  for (const card of four.slice(0, 4)) giveCard(s, 2, card.id);
  s = applyAction(s, take(s));
  assert.equal(s.finalRound, true);
  assert.equal(s.status, 'playing');
  s = applyAction(s, take(s));
  assert.equal(s.status, 'playing');
  s = applyAction(s, take(s));
  assert.equal(s.status, 'finished');
  assert.deepEqual(
    s.players.map((p) => p.turns),
    [1, 1, 1],
  );
  assert.deepEqual(s.winners, [2]);
  assert.deepEqual(legalActions(s), []);
  assert.throws(() => applyAction(s, { type: 'pass' }), InvalidAction);
  assertInvariants(s);
});
test('ties use fewest purchased cards, then shared victory', () => {
  for (const extra of [false, true]) {
    let s = mutable();
    const five = CARDS.filter((c) => c.points === 5);
    for (const card of five.slice(0, 3)) giveCard(s, 0, card.id);
    for (const card of five.slice(3, 5)) giveCard(s, 1, card.id);
    // 15 points for player 1 via 5+5+4+1, versus 5+5+5 for player 0.
    giveCard(s, 1, CARDS.find((c) => c.points === 4)!.id);
    giveCard(s, 1, CARDS.find((c) => c.points === 1)!.id);
    if (extra) giveCard(s, 0, CARDS.find((c) => c.points === 0)!.id);
    s = applyAction(s, take(s));
    s = applyAction(s, take(s));
    assert.deepEqual(s.winners, extra ? [0, 1] : [0]);
    assertInvariants(s);
  }
});
test('final-round trigger from last seat finishes immediately', () => {
  let s = mutable();
  s = applyAction(s, take(s));
  s = structuredClone(s);
  for (const card of CARDS.filter((c) => c.points === 5).slice(0, 3)) giveCard(s, 1, card.id);
  s = applyAction(s, take(s));
  assert.equal(s.status, 'finished');
  assert.deepEqual(s.winners, [1]);
});
test('seeded fuzz: 90 games conserve all cards/tokens/nobles across 2–4 players', () => {
  let transitions = 0,
    completed = 0,
    stalled = 0;
  for (const n of [2, 3, 4])
    for (let seed = 0; seed < 30; seed++) {
      const rng = random(`actions:${n}:${seed}`);
      let s = createGame({ players: n, seed });
      for (let decision = 0; decision < 600 && s.status === 'playing'; decision++) {
        const actions = legalActions(s);
        if (!actions.length) {
          assert.equal(s.phase, 'main');
          assert.ok(COLORS.every((c) => s.bank[c] === 0));
          assert.equal(s.players[s.currentPlayer].reserved.length, 3);
          stalled++;
          break;
        }
        // Buy-heavy but varied games also explore full hand limits and reserved cards.
        const buy = actions.filter((a) => a.type === 'buy');
        const pool = buy.length && rng() < 0.85 ? buy : actions;
        const a = pool[Math.floor(rng() * pool.length)],
          before = JSON.stringify(s);
        const next = applyAction(s, a);
        assert.equal(JSON.stringify(s), before);
        assertInvariants(next);
        assert.ok(next.decision === s.decision + 1 && next.turn <= next.decision);
        s = next;
        transitions++;
      }
      if (s.status === 'finished') {
        completed++;
        assert.equal(new Set(s.players.map((p) => p.turns)).size, 1);
      }
    }
  assert.ok(transitions > 5000);
  assert.ok(completed >= 70, `Only ${completed} games completed`);
  console.log(
    `Fuzz: ${transitions} transitions, ${completed} completed games, ${stalled} no-move positions`,
  );
});

test('recorded no-move position is valid but offers no invented pass or gold action', async () => {
  const { readFile } = await import('node:fs/promises');
  const s = JSON.parse(await readFile(new URL('./fixtures/no-move.json', import.meta.url), 'utf8'));
  assertInvariants(s);
  assert.equal(s.turn, 26);
  assert.equal(s.bank.gold, 5);
  assert.deepEqual(legalActions(s), []);
  assert.throws(() => applyAction(s, { type: 'pass' }), InvalidAction);
});
