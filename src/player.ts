import type { Action, Card, Cost, Noble, Observation, PlayerView, Tokens } from './types';
import { COLORS } from './catalog';
import { discountedCost, enumeratePayments } from './rule-helpers';
export type {
  Action,
  Card,
  Cost,
  Noble,
  Observation,
  PlayerView,
  Tokens,
  ClockConfig,
  ClockSnapshot,
} from './types';
/** The same implementation is bundled into the sandbox's virtual `splendor` module. */
export abstract class SplendorPlayer {
  constructor() {
    if (new.target === SplendorPlayer)
      throw new TypeError('Extend SplendorPlayer and implement chooseAction');
  }
  abstract chooseAction(observation: Observation): Action | Promise<Action>;
  /** Keys configured privately for this bot version; never platform credentials. */
  getSecret(name: string): string | undefined {
    const values = (globalThis as unknown as { __botSecrets?: Record<string, string> })
      .__botSecrets;
    return values && Object.hasOwn(values, name) ? values[name] : undefined;
  }
  getSelf(view: Observation): PlayerView {
    return view.players[view.you];
  }
  getLegalActions(view: Observation, type?: Action['type']): Action[] {
    return view.legalActions.filter((a) => !type || a.type === type);
  }
  getBonuses(player: PlayerView): Cost {
    const result = Object.fromEntries(COLORS.map((c) => [c, 0])) as Cost;
    for (const card of player.cards) result[card.bonus]++;
    return result;
  }
  getPoints(player: PlayerView): number {
    return (
      player.cards.reduce((n, card) => n + card.points, 0) +
      player.nobles.reduce((n, noble) => n + noble.points, 0)
    );
  }
  getCost(card: Card, player: PlayerView): Cost {
    return discountedCost(card, this.getBonuses(player));
  }
  getPayments(card: Card, player: PlayerView): Tokens[] {
    return enumeratePayments(player.tokens, this.getBonuses(player), card);
  }
  canAfford(card: Card, player: PlayerView): boolean {
    return this.getPayments(card, player).length > 0;
  }
  getAffordableCards(view: Observation): Card[] {
    const me = this.getSelf(view);
    return [...view.market.flat(), ...me.reserved.flatMap((r) => (r.card ? [r.card] : []))].filter(
      (card) => this.canAfford(card, me),
    );
  }
  getEligibleNobles(view: Observation, player = this.getSelf(view)): Noble[] {
    const bonuses = this.getBonuses(player);
    return view.nobles.filter((n) => COLORS.every((c) => bonuses[c] >= n.cost[c]));
  }
  chooseRandomAction(view: Observation): Action {
    if (!view.legalActions.length) throw new Error('No legal actions');
    return view.legalActions[Math.floor(Math.random() * view.legalActions.length)];
  }
}
