import { enumeratePayments } from './rule-helpers';
import type { Action, Card, Cost, GameState, Observation, PlayerState, Tokens } from './types';
import { CARD, CARDS, NOBLE, NOBLES, COLORS, GEMS, tokens, sum, freeze } from './catalog';
import { shuffle } from './random';
import { dealRandom } from './deal-random';
export const RULES_VERSION = 'splendor-base-1';
export class InvalidAction extends Error {
  readonly code = 'INVALID_ACTION';
  constructor(
    message = 'Action is not legal in the current phase; choose from observation.legalActions.',
  ) {
    super(message);
    this.name = 'InvalidAction';
    this.code = 'INVALID_ACTION';
  }
}
export function createGame({
  players = 2,
  seed = 'splendor',
}: { players?: number; seed?: string | number } = {}): GameState {
  if (!Number.isInteger(players) || players < 2 || players > 4)
    throw new RangeError('Expected 2–4 players');
  const rng = dealRandom(seed);
  const decks = [1, 2, 3].map((t) =>
    shuffle(
      CARDS.filter((c) => c.tier === t).map((c) => c.id),
      rng,
    ),
  );
  const market = decks.map((d) => d.splice(0, 4));
  return freeze({
    rulesVersion: RULES_VERSION,
    decks,
    market,
    nobles: shuffle(
      NOBLES.map((n) => n.id),
      rng,
    ).slice(0, players + 1),
    bank: tokens({
      ...Object.fromEntries(COLORS.map((c) => [c, [0, 0, 4, 5, 7][players]])),
      gold: 5,
    }),
    players: Array.from({ length: players }, () => ({
      tokens: tokens(),
      cards: [],
      reserved: [],
      nobles: [],
      turns: 0,
    })),
    currentPlayer: 0,
    phase: 'main',
    turn: 0,
    decision: 0,
    finalRound: false,
    status: 'playing',
    winners: [],
  });
}
export function bonuses(player: PlayerState): Cost {
  const result = Object.fromEntries(COLORS.map((c) => [c, 0])) as Cost;
  for (const id of player.cards) result[CARD[id].bonus]++;
  return result;
}
export const points = (player: PlayerState) =>
  player.cards.reduce((n, id) => n + CARD[id].points, 0) + player.nobles.length * 3;
export function eligibleNobles(state: GameState) {
  const b = bonuses(state.players[state.currentPlayer]);
  return state.nobles.filter((id) => COLORS.every((c) => b[c] >= NOBLE[id].cost[c]));
}
// All valid exact payments, including optional substitution of gold for held colors.
export function payments(player: PlayerState, card: Card): Tokens[] {
  return enumeratePayments(player.tokens, bonuses(player), card);
}
function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  return items.flatMap((v, i) =>
    combinations(items.slice(i + 1), count - 1).map((tail) => [v, ...tail]),
  );
}
function discards(held: Tokens, excess: number): Action[] {
  const result: Action[] = [];
  function visit(i: number, bag: Partial<Tokens>, left: number) {
    if (i === GEMS.length) {
      if (left === 0) result.push({ type: 'discard', tokens: tokens(bag) });
      return;
    }
    const c = GEMS[i];
    for (let n = 0; n <= Math.min(left, held[c]); n++) visit(i + 1, { ...bag, [c]: n }, left - n);
  }
  visit(0, {}, excess);
  return result;
}
export function legalActions(state: GameState): Action[] {
  if (state.status !== 'playing') return [];
  const p = state.players[state.currentPlayer];
  if (state.phase === 'discard') return discards(p.tokens, sum(p.tokens) - 10);
  if (state.phase === 'noble')
    return eligibleNobles(state).map((nobleId) => ({ type: 'noble', nobleId }));
  const result: Action[] = [];
  const available = COLORS.filter((c) => state.bank[c] > 0);
  if (available.length) {
    for (const group of combinations(available, Math.min(3, available.length))) {
      result.push({ type: 'take', tokens: tokens(Object.fromEntries(group.map((c) => [c, 1]))) });
    }
  }
  for (const c of COLORS)
    if (state.bank[c] >= 4) result.push({ type: 'take', tokens: tokens({ [c]: 2 }) });
  for (const id of [...state.market.flat(), ...p.reserved.map((r) => r.cardId)]) {
    for (const payment of payments(p, CARD[id])) result.push({ type: 'buy', cardId: id, payment });
  }
  if (p.reserved.length < 3) {
    for (const cardId of state.market.flat()) result.push({ type: 'reserve', cardId });
    state.decks.forEach((d, i) => {
      if (d.length) result.push({ type: 'reserve', tier: i + 1 });
    });
  }
  return result;
}
function key(value: unknown): string | undefined {
  if (Array.isArray(value)) return '[' + value.map(key).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + key((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function validateAction(state: GameState, action: unknown): Action {
  try {
    const candidate = key(action);
    const legal = legalActions(state).find((a) => key(a) === candidate);
    if (legal) return legal;
  } catch {
    /* malformed data is an invalid move, never a partial mutation */
  }
  throw new InvalidAction();
}
function removeMarket(state: GameState, id: string) {
  const tier = CARD[id].tier - 1,
    row = state.market[tier],
    index = row.indexOf(id);
  if (state.decks[tier].length) row[index] = state.decks[tier].shift()!;
  else row.splice(index, 1);
}
function awardNoble(state: GameState, id: string) {
  state.nobles.splice(state.nobles.indexOf(id), 1);
  state.players[state.currentPlayer].nobles.push(id);
}
function endTurn(state: GameState) {
  const player = state.players[state.currentPlayer];
  player.turns++;
  state.turn++;
  if (points(player) >= 15) state.finalRound = true;
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.phase = 'main';
  if (state.finalRound && state.currentPlayer === 0) {
    state.status = 'finished';
    state.phase = 'finished';
    const bestPoints = Math.max(...state.players.map(points));
    const candidates = state.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => points(p) === bestPoints);
    const fewest = Math.min(...candidates.map(({ p }) => p.cards.length));
    state.winners = candidates.filter(({ p }) => p.cards.length === fewest).map(({ i }) => i);
  }
}
function resolveEnd(state: GameState) {
  if (sum(state.players[state.currentPlayer].tokens) > 10) {
    state.phase = 'discard';
    return;
  }
  const eligible = eligibleNobles(state);
  if (eligible.length > 1) {
    state.phase = 'noble';
    return;
  }
  if (eligible.length === 1) awardNoble(state, eligible[0]);
  endTurn(state);
}
export function applyAction(state: GameState, candidate: unknown): GameState {
  const action = validateAction(state, candidate);
  const next = structuredClone(state),
    p = next.players[next.currentPlayer];
  next.decision++;
  if (action.type === 'take' || action.type === 'discard') {
    const sign = action.type === 'take' ? 1 : -1;
    for (const c of GEMS) {
      p.tokens[c] += sign * action.tokens[c];
      next.bank[c] -= sign * action.tokens[c];
    }
  } else if (action.type === 'reserve') {
    let cardId;
    if (action.cardId) {
      cardId = action.cardId;
      removeMarket(next, cardId);
    } else cardId = next.decks[action.tier! - 1].shift()!;
    p.reserved.push({ cardId, public: Boolean(action.cardId) });
    if (next.bank.gold) {
      next.bank.gold--;
      p.tokens.gold++;
    }
  } else if (action.type === 'buy') {
    for (const c of GEMS) {
      p.tokens[c] -= action.payment[c];
      next.bank[c] += action.payment[c];
    }
    const reservedIndex = p.reserved.findIndex((r) => r.cardId === action.cardId);
    if (reservedIndex >= 0) p.reserved.splice(reservedIndex, 1);
    else removeMarket(next, action.cardId);
    p.cards.push(action.cardId);
  } else if (action.type === 'noble') {
    awardNoble(next, action.nobleId);
    endTurn(next);
    return freeze(next);
  }
  resolveEnd(next);
  return freeze(next);
}
export function observe(state: GameState, seat = state.currentPlayer): Observation {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length)
    throw new RangeError('Invalid seat');
  return freeze(
    structuredClone({
      rulesVersion: state.rulesVersion,
      you: seat,
      currentPlayer: state.currentPlayer,
      turn: state.turn,
      decision: state.decision,
      phase: state.phase,
      status: state.status,
      finalRound: state.finalRound,
      winners: state.winners,
      bank: state.bank,
      deckCounts: state.decks.map((d) => d.length),
      market: state.market.map((row) => row.map((id) => CARD[id])),
      nobles: state.nobles.map((id) => NOBLE[id]),
      players: state.players.map((p, i) => ({
        tokens: p.tokens,
        cards: p.cards.map((id) => CARD[id]),
        bonuses: bonuses(p),
        points: points(p),
        nobles: p.nobles.map((id) => NOBLE[id]),
        turns: p.turns,
        reserved: p.reserved.map((r) =>
          i === seat || r.public
            ? { card: CARD[r.cardId], public: r.public }
            : { hidden: true, tier: CARD[r.cardId].tier },
        ),
      })),
      legalActions: seat === state.currentPlayer ? legalActions(state) : [],
    }),
  );
}
export function assertInvariants(state: GameState) {
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`Invariant: ${message}`);
  };
  for (const c of GEMS) {
    const piles = [state.bank[c], ...state.players.map((p) => p.tokens[c])];
    check(
      piles.every((n) => Number.isInteger(n) && n >= 0),
      `nonnegative ${c}`,
    );
    check(
      piles.reduce((a, b) => a + b, 0) ===
        (c === 'gold' ? 5 : [0, 0, 4, 5, 7][state.players.length]),
      `conservation ${c}`,
    );
  }
  const ids = [
    ...state.decks.flat(),
    ...state.market.flat(),
    ...state.players.flatMap((p) => [...p.cards, ...p.reserved.map((r) => r.cardId)]),
  ];
  check(
    ids.length === 90 && new Set(ids).size === 90 && ids.every((id) => Object.hasOwn(CARD, id)),
    'card conservation',
  );
  const nobles = [...state.nobles, ...state.players.flatMap((p) => p.nobles)];
  check(
    nobles.length === state.players.length + 1 &&
      new Set(nobles).size === nobles.length &&
      nobles.every((id) => Object.hasOwn(NOBLE, id)),
    'noble conservation',
  );
  state.players.forEach((p, i) => {
    check(p.reserved.length <= 3, 'reserve limit');
    check(
      sum(p.tokens) <= (state.phase === 'discard' && i === state.currentPlayer ? 13 : 10),
      'token limit',
    );
  });
  state.market.forEach((row, i) => {
    check(row.length <= 4 && (state.decks[i].length === 0 || row.length === 4), 'market refill');
    check(
      [...row, ...state.decks[i]].every((id) => CARD[id].tier === i + 1),
      'card tiers',
    );
  });
  return true;
}
