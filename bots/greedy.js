import { SplendorPlayer } from 'splendor';
export default class GreedyPlayer extends SplendorPlayer {
  chooseAction(view) {
    const me = view.players[view.you];
    const cards = [...view.market.flat(), ...me.reserved.map((r) => r.card)];
    const colors = ['white', 'blue', 'green', 'red', 'black'];
    const total = (bag) => Object.values(bag).reduce((a, b) => a + b, 0);
    const distance = (card, held) =>
      Math.max(
        0,
        colors.reduce((n, c) => n + Math.max(0, card.cost[c] - me.bonuses[c] - held[c]), 0) -
          held.gold,
      );
    const closest = (held) => Math.min(...cards.map((c) => distance(c, held) - c.points * 0.3));
    const score = (a) => {
      if (a.type === 'buy') {
        const card = cards.find((c) => c.id === a.cardId);
        const nobleProgress = view.nobles.filter(
          (n) => me.bonuses[card.bonus] < n.cost[card.bonus],
        ).length;
        return 30 + card.points * 12 + nobleProgress * 2 - total(a.payment) * 0.3 - a.payment.gold;
      }
      if (a.type === 'noble') return 100;
      if (a.type === 'discard') {
        const held = Object.fromEntries(
          Object.keys(me.tokens).map((c) => [c, me.tokens[c] - a.tokens[c]]),
        );
        return -closest(held) * 4 - a.tokens.gold * 2;
      }
      if (a.type === 'take') {
        const held = Object.fromEntries(
          Object.keys(me.tokens).map((c) => [c, me.tokens[c] + a.tokens[c]]),
        );
        return 10 + (closest(me.tokens) - closest(held)) * 4 + total(a.tokens) * 0.2;
      }
      if (a.type === 'reserve' && a.cardId) {
        const card = cards.find((c) => c.id === a.cardId);
        return 2 + card.points - distance(card, me.tokens);
      }
      return -10;
    };
    return view.legalActions.reduce((best, a) => (score(a) > score(best) ? a : best));
  }
}
