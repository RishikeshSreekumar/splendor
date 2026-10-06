import type { ClockConfig, ClockSnapshot } from './types';
export const DEFAULT_CLOCK: Readonly<ClockConfig> = Object.freeze({
  initialMs: 60_000,
  incrementMs: 1_000,
});
export function validateClock(config: ClockConfig): ClockConfig {
  if (!Number.isInteger(config.initialMs) || config.initialMs < 1 || config.initialMs > 3_600_000)
    throw new RangeError('Initial time must be 1–3,600,000 ms');
  if (
    !Number.isInteger(config.incrementMs) ||
    config.incrementMs < 0 ||
    config.incrementMs > 60_000
  )
    throw new RangeError('Increment must be 0–60,000 ms');
  return { ...config };
}
/** Independent Fischer clocks. A clock runs only during its player's decision calls. */
export class ChessClock {
  readonly config: ClockConfig;
  private readonly remaining: number[];
  private active: { seat: number; startedAt: number } | null = null;
  private completedTurns = new Set<number>();
  constructor(
    players: number,
    config: ClockConfig = DEFAULT_CLOCK,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!Number.isInteger(players) || players < 2 || players > 4)
      throw new RangeError('Expected 2–4 clocks');
    this.config = Object.freeze(validateClock(config));
    this.remaining = Array(players).fill(config.initialMs);
  }
  static restore(snapshot: ClockSnapshot): ChessClock {
    const clock = new ChessClock(snapshot.remainingMs.length, snapshot.config);
    if (
      snapshot.activeSeat !== null ||
      snapshot.remainingMs.some((ms) => !Number.isFinite(ms) || ms < 0)
    )
      throw new Error('Invalid saved clock');
    snapshot.remainingMs.forEach((ms, i) => {
      clock.remaining[i] = ms;
    });
    return clock;
  }
  private checkSeat(seat: number) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.remaining.length)
      throw new RangeError('Invalid clock seat');
  }
  getRemaining(seat: number): number {
    this.checkSeat(seat);
    return Math.max(
      0,
      this.remaining[seat] - (this.active?.seat === seat ? this.now() - this.active.startedAt : 0),
    );
  }
  beginDecision(seat: number): number {
    this.checkSeat(seat);
    if (this.active) throw new Error('Another clock is already running');
    if (this.remaining[seat] <= 0) throw new Error('Clock has expired');
    this.active = { seat, startedAt: this.now() };
    return this.remaining[seat];
  }
  endDecision(seat: number): { elapsedMs: number; expired: boolean } {
    if (!this.active || this.active.seat !== seat)
      throw new Error('Clock is not running for this seat');
    const elapsedMs = Math.max(0, this.now() - this.active.startedAt);
    this.remaining[seat] = Math.max(0, this.remaining[seat] - elapsedMs);
    this.active = null;
    return { elapsedMs, expired: this.remaining[seat] <= 0 };
  }
  completeTurn(seat: number, turnId: number, assisted = false): void {
    this.checkSeat(seat);
    if (this.active) throw new Error('Stop decision clock before completing a turn');
    if (this.completedTurns.has(turnId)) throw new Error('Turn increment already processed');
    this.completedTurns.add(turnId);
    if (!assisted && this.remaining[seat] > 0) this.remaining[seat] += this.config.incrementMs;
  }
  snapshot(): ClockSnapshot {
    return {
      config: { ...this.config },
      remainingMs: this.remaining.map((_, i) => this.getRemaining(i)),
      activeSeat: this.active?.seat ?? null,
    };
  }
}
