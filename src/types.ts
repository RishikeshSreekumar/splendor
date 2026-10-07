export type Color = 'white' | 'blue' | 'green' | 'red' | 'black';
export type Gem = Color | 'gold';
export type Tokens = Record<Gem, number>;
export type Cost = Record<Color, number>;
export interface Card {
  id: string;
  tier: number;
  bonus: Color;
  points: number;
  cost: Cost;
}
export interface Noble {
  id: string;
  points: number;
  cost: Cost;
}
export interface PlayerState {
  tokens: Tokens;
  cards: string[];
  reserved: { cardId: string; public: boolean }[];
  nobles: string[];
  turns: number;
}
export type Action =
  | { type: 'take'; tokens: Tokens }
  | { type: 'discard'; tokens: Tokens }
  | { type: 'buy'; cardId: string; payment: Tokens }
  | { type: 'reserve'; cardId: string; tier?: never }
  | { type: 'reserve'; tier: number; cardId?: never }
  | { type: 'noble'; nobleId: string };
export type Phase = 'main' | 'discard' | 'noble' | 'finished';
export interface GameState {
  rulesVersion: string;
  decks: string[][];
  market: string[][];
  nobles: string[];
  bank: Tokens;
  players: PlayerState[];
  currentPlayer: number;
  phase: Phase;
  turn: number;
  decision: number;
  finalRound: boolean;
  status: 'playing' | 'finished';
  winners: number[];
}
export type ReservationView =
  | { card: Card; public: boolean; hidden?: never; tier?: never }
  | { hidden: true; tier: number; card?: never; public?: never };
export interface PlayerView {
  tokens: Tokens;
  cards: Card[];
  bonuses: Cost;
  points: number;
  nobles: Noble[];
  turns: number;
  reserved: ReservationView[];
}
export interface ClockConfig {
  initialMs: number;
  incrementMs: number;
}
export interface ClockSnapshot {
  config: ClockConfig;
  remainingMs: number[];
  activeSeat: number | null;
}
export interface Observation {
  rulesVersion: string;
  you: number;
  currentPlayer: number;
  turn: number;
  decision: number;
  phase: Phase;
  status: 'playing' | 'finished';
  finalRound: boolean;
  winners: number[];
  bank: Tokens;
  deckCounts: number[];
  market: Card[][];
  nobles: Noble[];
  players: PlayerView[];
  legalActions: Action[];
  clock?: ClockSnapshot;
}
export interface BotDefinition {
  id: string;
  source: string;
  /** Private execution input: never included in game records. */
  secrets?: Record<string, string>;
}
export type Mode = 'ranked' | 'practice';
export interface RunnerOptions {
  seed?: string;
  initializationMs?: number;
  memoryMb?: number;
  startupMs?: number;
}
export interface FaultEvent {
  kind: 'fault';
  seat: number;
  code: string;
  stage: 'startup' | 'decision';
  decision: number;
  attempted?: unknown;
  clock: ClockSnapshot;
}
export interface ActionEvent {
  kind: 'action';
  seat: number;
  decision: number;
  action: Action;
  assisted: boolean;
  stateHash: string;
  elapsedMs: number;
  clock: ClockSnapshot;
}
export type GameEvent = FaultEvent | ActionEvent;
export interface MatchResult {
  reason: 'completed' | 'forfeit' | 'both_failed' | 'turn_limit' | 'no_legal_action';
  winners: number[];
  /** Finishing order per seat (0 = first, ties share). Absent on older records. */
  ranks?: number[];
  ratingEligible: boolean;
}
export interface GameRecord {
  formatVersion: number;
  rulesVersion: string;
  seed: string;
  mode: Mode;
  maxTurns: number;
  bots: { id: string; sourceHash: string }[];
  runnerOptions: RunnerOptions;
  clock: ClockSnapshot;
  result: MatchResult;
  scores: number[];
  turns: number;
  decisions: number[];
  faults: number[];
  assistedDecisions: number;
  log: GameEvent[];
  finalStateHash: string;
}
export interface LeaderboardRow {
  id: string;
  sourceHash: string;
  elo: number;
  games: number;
  ratedGames: number;
  wins: number;
  draws: number;
  losses: number;
  forfeits: number;
  faults: number;
  decisions: number;
  assistedDecisions: number;
  unratedGames: number;
  provisional: boolean;
  winRate: number | null;
  winRate95: number[];
}
export interface EvaluationReport {
  /** Absent on legacy reports, which reused deals across seat swaps. */
  dealPolicy?: 'independent';
  formatVersion: number;
  seed: string;
  mode: Mode;
  pairs: number;
  clockConfig: ClockConfig;
  leaderboard: LeaderboardRow[];
  games: GameRecord[];
}
