import { SplendorPlayer } from 'splendor';
export default class RandomPlayer extends SplendorPlayer {
  chooseAction({ legalActions }) {
    return legalActions[Math.floor(Math.random() * legalActions.length)];
  }
}
