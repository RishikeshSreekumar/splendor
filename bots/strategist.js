import { SplendorPlayer } from 'splendor';

const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const total = (bag) => Object.values(bag).reduce((a, b) => a + b, 0);

/**
 * Scores every legal action by the position it leads to: points, a bonus engine valued
 * by what the table still needs, noble progress, and how close held tokens are to the
 * best target cards. It finishes the game when it can and reserves cards that would
 * let an opponent win next turn.
 */
export default class StrategistPlayer extends SplendorPlayer {
  chooseAction(view) {
    const actions = view.legalActions;
    if (actions.length === 1) return actions[0];
    const me = view.players[view.you];
    const opponents = view.players.filter((_, i) => i !== view.you);
    const leader = Math.max(0, ...opponents.map((p) => p.points));
    const market = view.market.flat();
    const reserved = me.reserved.flatMap((r) => (r.card ? [r.card] : []));
    const byId = Object.fromEntries([...market, ...reserved].map((c) => [c.id, c]));
    const late = Math.max(me.points, leader) >= 10;

    // Cards that would hand an opponent the game on their next turn.
    const threats = new Set();
    for (const opp of opponents)
      for (const card of market)
        if (
          opp.points + card.points + this.nobleGain(view.nobles, opp.bonuses, card) * 3 >= 15 &&
          this.shortfall(card, opp.tokens, opp.bonuses) === 0
        )
          threats.add(card.id);

    const position = (s) => this.value(view, s, late);
    const base = position({
      tokens: me.tokens,
      bonuses: me.bonuses,
      points: me.points,
      reserved,
      bought: null,
    });
    const score = (a) => {
      switch (a.type) {
        case 'noble':
          return 0;
        case 'take':
        case 'discard': {
          const tokens = this.add(me.tokens, a.tokens, a.type === 'take' ? 1 : -1);
          const excess = Math.max(0, total(tokens) - 10);
          return position({ ...this.mine(me, reserved), tokens }) - base - excess * 4;
        }
        case 'buy': {
          const card = byId[a.cardId];
          const bonuses = { ...me.bonuses, [card.bonus]: me.bonuses[card.bonus] + 1 };
          const points =
            me.points + card.points + this.nobleGain(view.nobles, me.bonuses, card) * 3;
          if (points >= 15 && points > leader) return 10000 + points;
          return (
            position({
              tokens: this.add(me.tokens, a.payment, -1),
              bonuses,
              points,
              reserved: reserved.filter((c) => c.id !== card.id),
              bought: card.id,
            }) -
            base +
            (threats.has(card.id) ? 40 : 0) -
            a.payment.gold * 0.6
          );
        }
        case 'reserve': {
          const tokens = this.add(me.tokens, { gold: view.bank.gold ? 1 : 0 }, 1);
          const excess = Math.max(0, total(tokens) - 10);
          if (!a.cardId)
            return position({ ...this.mine(me, reserved), tokens }) - base - 6 - excess * 4;
          const card = byId[a.cardId];
          return (
            position({
              ...this.mine(me, reserved),
              tokens,
              reserved: [...reserved, card],
              bought: card.id,
            }) -
            base +
            (threats.has(card.id) ? 80 : 0) -
            3 -
            excess * 4
          );
        }
        default:
          return -1e6;
      }
    };
    let best = actions[0],
      bestScore = -Infinity;
    for (const a of actions) {
      const s = score(a);
      if (s > bestScore) {
        best = a;
        bestScore = s;
      }
    }
    return best;
  }

  mine(me, reserved) {
    return { tokens: me.tokens, bonuses: me.bonuses, points: me.points, reserved, bought: null };
  }

  value(view, s, late) {
    const market = view.market.flat().filter((c) => c.id !== s.bought);
    const pool = [...market, ...s.reserved];
    let v = s.points * (late ? 14 : 10);

    // Bonus engine: each bonus is worth what it saves on the cards still in play.
    for (const c of COLORS) {
      let demand = 0;
      for (const card of pool)
        if (card.cost[c] > 0) demand += Math.min(card.cost[c], 1 + card.points / 2) / pool.length;
      v += Math.min(s.bonuses[c], 4) * (late ? 1 : 2.4) * (0.6 + demand);
    }

    // Nobles reward balanced bonus colors.
    for (const noble of view.nobles) {
      const missing = COLORS.reduce((n, c) => n + Math.max(0, noble.cost[c] - s.bonuses[c]), 0);
      v += Math.max(0, 1 - missing / 7) ** 2 * 18;
    }

    // Token plan: how close held tokens put us to the best cards per turn of work.
    const ranked = pool
      .map((card) => {
        const gap = this.shortfall(card, s.tokens, s.bonuses);
        const worth = card.points * 3 + 2 + this.nobleGain(view.nobles, s.bonuses, card) * 9;
        return { gap, worth, rate: worth / (1 + gap / 2.2) };
      })
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);
    ranked.forEach((t, i) => {
      v += t.rate * [1.4, 0.6, 0.3][i];
    });
    v += total(s.tokens) * 0.35 + s.tokens.gold * 0.6 - s.reserved.length * 1.5;
    return v;
  }

  shortfall(card, tokens, bonuses) {
    return Math.max(
      0,
      COLORS.reduce((n, c) => n + Math.max(0, card.cost[c] - bonuses[c] - tokens[c]), 0) -
        (tokens.gold ?? 0),
    );
  }

  add(tokens, delta, sign) {
    const result = { ...tokens };
    for (const k of Object.keys(delta)) result[k] = (result[k] ?? 0) + sign * delta[k];
    return result;
  }

  /** 1 when buying `card` completes a noble that `bonuses` alone does not. */
  nobleGain(nobles, bonuses, card) {
    const after = { ...bonuses, [card.bonus]: bonuses[card.bonus] + 1 };
    const qualifies = (b) => (n) => COLORS.every((c) => b[c] >= n.cost[c]);
    return nobles.some(qualifies(after)) && !nobles.some(qualifies(bonuses)) ? 1 : 0;
  }
}
