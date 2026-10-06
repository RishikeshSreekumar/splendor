/** Editor declarations for the sandbox's virtual module. The implementation lives in player.ts. */
declare module 'splendor' {
  export type Observation = import('./types').Observation;
  export type Action = import('./types').Action;
  export type Card = import('./types').Card;
  export type PlayerView = import('./types').PlayerView;
  export type Cost = import('./types').Cost;
  export type Tokens = import('./types').Tokens;
  export type Noble = import('./types').Noble;
  export abstract class SplendorPlayer {
    abstract chooseAction(view: Observation): Action | Promise<Action>;
    getSecret(name: string): string | undefined;
    getSelf(view: Observation): PlayerView;
    getLegalActions(view: Observation, type?: Action['type']): Action[];
    getBonuses(player: PlayerView): Cost;
    getPoints(player: PlayerView): number;
    getCost(card: Card, player: PlayerView): Cost;
    getPayments(card: Card, player: PlayerView): Tokens[];
    canAfford(card: Card, player: PlayerView): boolean;
    getAffordableCards(view: Observation): Card[];
    getEligibleNobles(view: Observation, player?: PlayerView): Noble[];
    chooseRandomAction(view: Observation): Action;
  }
}
