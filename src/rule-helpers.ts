import type { Card, Cost, Tokens } from './types';
import { COLORS, tokens } from './catalog';
export function discountedCost(card: Card, bonuses: Cost): Cost {
  return Object.fromEntries(COLORS.map((c) => [c, Math.max(0, card.cost[c] - bonuses[c])])) as Cost;
}
export function enumeratePayments(held: Tokens, bonuses: Cost, card: Card): Tokens[] {
  const cost = discountedCost(card, bonuses),
    result: Tokens[] = [];
  function visit(i: number, payment: Partial<Tokens>, gold: number) {
    if (gold > held.gold) return;
    if (i === COLORS.length) {
      result.push(tokens({ ...payment, gold }));
      return;
    }
    const c = COLORS[i];
    for (let paid = Math.min(cost[c], held[c]); paid >= 0; paid--)
      visit(i + 1, { ...payment, [c]: paid }, gold + cost[c] - paid);
  }
  visit(0, {}, 0);
  return result;
}
