import type { Card, Noble, Tokens, Color, Gem } from './types';
import cards from '../data/cards.json' with { type: 'json' };
export const COLORS = Object.freeze<Color[]>(['white', 'blue', 'green', 'red', 'black']);
export const GEMS = Object.freeze<Gem[]>([...COLORS, 'gold']);
export const tokens = (partial: Partial<Tokens> = {}): Tokens =>
  Object.fromEntries(GEMS.map((c) => [c, partial[c] ?? 0])) as Tokens;
export const sum = (bag: Record<string, number>) => Object.values(bag).reduce((a, b) => a + b, 0);
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const CARDS = freeze(cards as Card[]);
// Clockwise adjacent pairs and triples in the base game's color cycle.
const cycle = ['red', 'green', 'blue', 'white', 'black'];
export const NOBLES: Noble[] = freeze(
  [2, 3].flatMap((size) =>
    cycle.map((_, i) => ({
      id: `n${size}-${i}`,
      points: 3,
      cost: Object.fromEntries(
        COLORS.map((c) => [
          c,
          Array.from({ length: size }, (_, j) => cycle[(i + j) % 5]).includes(c)
            ? size === 2
              ? 4
              : 3
            : 0,
        ]),
      ) as Noble['cost'],
    })),
  ),
);
export const CARD = freeze(Object.fromEntries(CARDS.map((c) => [c.id, c])));
export const NOBLE = freeze(Object.fromEntries(NOBLES.map((n) => [n.id, n])));
