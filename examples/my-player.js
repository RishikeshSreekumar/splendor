import { SplendorPlayer } from 'splendor';
export default class MyPlayer extends SplendorPlayer {
  chooseAction(observation) {
    // Called again in 'discard' or 'noble' phases when a turn needs another choice.
    // Instance fields persist for one game. Async returns work; external calls are disabled.
    const buys = this.getLegalActions(observation, 'buy');
    const choices = buys.length ? buys : observation.legalActions;
    return choices[Math.floor(Math.random() * choices.length)];
  }
}
