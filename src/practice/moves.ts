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
