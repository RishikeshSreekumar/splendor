import { GEMS } from '../catalog';
import type { Action, Card, Gem, Observation, Tokens } from '../types';
/**
 * Client-side helpers that turn clicks into actions. They only ever select from
 * `legalActions`, so the server's engine remains the single source of rules.
 */
type Bag = Partial<Record<Gem, number>>;
const count = (bag: Bag, gem: Gem) => bag[gem] ?? 0;
export const bagSize = (bag: Bag) => GEMS.reduce((n, g) => n + count(bag, g), 0);
const within = (bag: Bag, limit: Tokens) => GEMS.every((g) => count(bag, g) <= limit[g]);
const equal = (bag: Bag, tokens: Tokens) => GEMS.every((g) => count(bag, g) === tokens[g]);
const withGem = (bag: Bag, gem: Gem): Bag => ({ ...bag, [gem]: count(bag, gem) + 1 });
type BagAction = Extract<Action, { type: 'take' | 'discard' }>;
function bagActions(view: Observation, type: BagAction['type']): BagAction[] {
  return view.legalActions.filter((a): a is BagAction => a.type === type);
}
/** Whether adding one `gem` to the selection still leads to a legal take/discard. */
export function canAddGem(
  view: Observation,
  type: BagAction['type'],
  selection: Bag,
  gem: Gem,
): boolean {
  const next = withGem(selection, gem);
  return bagActions(view, type).some((a) => within(next, a.tokens));
}
/** The legal take/discard exactly matching the selection, if any. */
export function bagAction(
  view: Observation,
  type: BagAction['type'],
  selection: Bag,
): BagAction | undefined {
  return bagActions(view, type).find((a) => equal(selection, a.tokens));
}
/** Legal purchases of a card, cheapest in gold first. */
export function buyOptions(view: Observation, cardId: string) {
  return view.legalActions
    .filter((a): a is Extract<Action, { type: 'buy' }> => a.type === 'buy' && a.cardId === cardId)
    .sort((a, b) => a.payment.gold - b.payment.gold || bagSize(a.payment) - bagSize(b.payment));
}
export function reserveAction(view: Observation, target: { cardId: string } | { tier: number }) {
  return view.legalActions.find(
    (a) =>
      a.type === 'reserve' &&
      ('cardId' in target ? a.cardId === target.cardId : a.tier === target.tier),
  );
}
export function nobleAction(view: Observation, nobleId: string) {
  return view.legalActions.find((a) => a.type === 'noble' && a.nobleId === nobleId);
}
/** Every card currently visible to the human: market rows plus their own reservations. */
export function visibleCards(view: Observation): Card[] {
  return [
    ...view.market.flat(),
    ...view.players.flatMap((p) => p.reserved.flatMap((r) => (r.card ? [r.card] : []))),
  ];
}
export function findCard(view: Observation, cardId: string): Card | undefined {
  return visibleCards(view).find((c) => c.id === cardId);
}
const plus = (a: Tokens, b: Tokens, sign = 1): Tokens =>
  Object.fromEntries(GEMS.map((g) => [g, a[g] + sign * b[g]])) as Tokens;
/**
 * The human's own move applied locally, so the table updates the moment they click
 * instead of after every bot reply. Hidden information (deck refills, auto-visiting
 * nobles) is left for the server's next view to fill in.
 */
export function previewAction(view: Observation, action: Action): Observation {
  const you = view.you;
  const players = view.players.map((p) => ({ ...p }));
  const me = players[you];
  let { bank, market, nobles, deckCounts } = view;
  const dropFromMarket = (id: string) =>
    (market = market.map((row) => row.filter((c) => c.id !== id)));
  switch (action.type) {
    case 'take':
      me.tokens = plus(me.tokens, action.tokens);
      bank = plus(bank, action.tokens, -1);
      break;
    case 'discard':
      me.tokens = plus(me.tokens, action.tokens, -1);
      bank = plus(bank, action.tokens);
      break;
    case 'buy': {
      const card = findCard(view, action.cardId);
      if (!card) break;
      dropFromMarket(card.id);
      me.reserved = me.reserved.filter((r) => r.card?.id !== card.id);
      me.cards = [...me.cards, card];
      me.bonuses = { ...me.bonuses, [card.bonus]: me.bonuses[card.bonus] + 1 };
      me.points += card.points;
      me.tokens = plus(me.tokens, action.payment, -1);
      bank = plus(bank, action.payment);
      break;
    }
    case 'reserve': {
      const card = action.cardId ? findCard(view, action.cardId) : undefined;
      if (card) {
        dropFromMarket(card.id);
        me.reserved = [...me.reserved, { card, public: true }];
      } else if (action.tier) {
        me.reserved = [...me.reserved, { hidden: true, tier: action.tier }];
        deckCounts = deckCounts.map((n, i) => (i === action.tier! - 1 ? Math.max(0, n - 1) : n));
      }
      if (bank.gold > 0) {
        me.tokens = { ...me.tokens, gold: me.tokens.gold + 1 };
        bank = { ...bank, gold: bank.gold - 1 };
      }
      break;
    }
    case 'noble': {
      const noble = nobles.find((n) => n.id === action.nobleId);
      if (!noble) break;
      nobles = nobles.filter((n) => n !== noble);
      me.nobles = [...me.nobles, noble];
      me.points += noble.points;
      break;
    }
  }
  const overLimit = bagSize(me.tokens) > 10;
  return {
    ...view,
    bank,
    market,
    nobles,
    deckCounts,
    players,
    legalActions: [],
    phase: overLimit ? 'discard' : 'main',
    currentPlayer: overLimit ? you : (you + 1) % players.length,
  };
}
