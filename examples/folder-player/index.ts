import { SplendorPlayer, type Observation } from 'splendor';
import { first } from './strategy';
export default class FolderPlayer extends SplendorPlayer {
  chooseAction(view: Observation) {
    return first(this.getLegalActions(view, 'buy')) ?? this.chooseRandomAction(view);
  }
}
