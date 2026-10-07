import { database, isCloud } from './cloud';
import { clientIp, RateLimitError } from './http';
/**
 * A token bucket per key. `capacity` requests may burst; the bucket refills completely over
 * `windowSeconds`. Policies with `backoffSeconds` punish clients that ignore Retry-After: each
 * refused request adds a strike and the block doubles (base × 2^(strikes−1), up to
 * `maxBlockSeconds`). Strikes clear after a quiet hour following the last block.
 */
export interface RateLimitPolicy {
  name: string;
  capacity: number;
  windowSeconds: number;
  /** IP buckets allow this many times the per-user capacity; shared NATs carry several users. */
  ipMultiplier: number;
  backoffSeconds: number;
  maxBlockSeconds: number;
}
export const RATE_LIMITS = {
  /** Each launch reserves a Modal sandbox with up to 2 GiB for 30 minutes. */
  evaluationCreate: {
    name: 'evaluation-create',
    capacity: 3,
    windowSeconds: 900,
    ipMultiplier: 2,
    backoffSeconds: 60,
    maxBlockSeconds: 86400,
  },
  /** Every submission starts a qualification sandbox. */
  botSubmit: {
    name: 'bot-submit',
    capacity: 3,
    windowSeconds: 900,
    ipMultiplier: 2,
    backoffSeconds: 60,
    maxBlockSeconds: 86400,
  },
  /** Status reads reconcile pending runs against Modal; the UI polls every two seconds. */
  statusRead: {
    name: 'status-read',
    capacity: 120,
    windowSeconds: 60,
    ipMultiplier: 4,
    backoffSeconds: 0,
    maxBlockSeconds: 60,
  },
  gameStart: {
    name: 'game-start',
    capacity: 6,
    windowSeconds: 600,
    ipMultiplier: 3,
    backoffSeconds: 30,
    maxBlockSeconds: 3600,
  },
  /** Each move runs one practice sandbox for all bot replies. */
  gameMove: {
    name: 'game-move',
    capacity: 30,
    windowSeconds: 60,
    ipMultiplier: 3,
    backoffSeconds: 5,
    maxBlockSeconds: 600,
  },
  gameRead: {
    name: 'game-read',
    capacity: 60,
    windowSeconds: 60,
    ipMultiplier: 4,
    backoffSeconds: 0,
    maxBlockSeconds: 60,
  },
} satisfies Record<string, RateLimitPolicy>;
export interface Bucket {
  tokens: number;
  updatedAt: number;
  strikes: number;
  blockedUntil: number;
}
export interface Decision {
  allowed: boolean;
  retryAfterSeconds: number;
  bucket: Bucket;
}
const STRIKE_DECAY_MS = 3600000;
/** Pure transition shared by the in-memory limiter and mirrored by `splendor_rate_limit`. */
export function consume(
  previous: Bucket | undefined,
  policy: Pick<
    RateLimitPolicy,
    'capacity' | 'windowSeconds' | 'backoffSeconds' | 'maxBlockSeconds'
  >,
  now: number,
): Decision {
  const rate = policy.capacity / (policy.windowSeconds * 1000);
  const b: Bucket = previous
    ? {
        ...previous,
        tokens: Math.min(policy.capacity, previous.tokens + (now - previous.updatedAt) * rate),
        updatedAt: now,
      }
    : { tokens: policy.capacity, updatedAt: now, strikes: 0, blockedUntil: 0 };
  if (b.strikes && now > b.blockedUntil + STRIKE_DECAY_MS) b.strikes = 0;
  const blocked = now < b.blockedUntil;
  if (!blocked && b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0, bucket: b };
  }
  // Refused: wait for the next token at least, longer for repeat offenders.
  if (policy.backoffSeconds > 0) b.strikes += 1;
  const refill = b.tokens >= 1 ? 0 : (1 - b.tokens) / rate;
  const penalty = policy.backoffSeconds
    ? Math.min(policy.maxBlockSeconds, policy.backoffSeconds * 2 ** (b.strikes - 1)) * 1000
    : 0;
  b.blockedUntil = Math.max(b.blockedUntil, now + Math.max(refill, penalty));
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((b.blockedUntil - now) / 1000)),
    bucket: b,
  };
}
const globals = globalThis as typeof globalThis & { splendorRateLimits?: Map<string, Bucket> };
function memoryCheck(key: string, policy: RateLimitPolicy, capacity: number): Decision {
  const buckets = (globals.splendorRateLimits ??= new Map());
  const now = Date.now();
  if (buckets.size > 10000)
    for (const [k, v] of buckets)
      if (now - v.updatedAt > policy.windowSeconds * 1000 && now > v.blockedUntil)
        buckets.delete(k);
  const decision = consume(buckets.get(key), { ...policy, capacity }, now);
  buckets.set(key, decision.bucket);
  return decision;
}
async function cloudCheck(key: string, policy: RateLimitPolicy, capacity: number) {
  const { data, error } = await database().rpc('splendor_rate_limit', {
    p_key: key,
    p_capacity: capacity,
    p_window_seconds: policy.windowSeconds,
    p_backoff_seconds: policy.backoffSeconds,
    p_max_block_seconds: policy.maxBlockSeconds,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as {
    allowed: boolean;
    retry_after_seconds: number;
  };
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}
/** Clears in-memory buckets; tests only. */
export function resetRateLimits() {
  globals.splendorRateLimits?.clear();
}
/**
 * Charges one request to the user's bucket and the caller's IP bucket. Throws a 429
 * `RateLimitError` carrying Retry-After when either is exhausted.
 */
export async function enforceRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  user?: string,
): Promise<void> {
  const keys: [string, number][] = [
    [`ip:${clientIp(request)}:${policy.name}`, policy.capacity * policy.ipMultiplier],
  ];
  if (user) keys.unshift([`user:${user}:${policy.name}`, policy.capacity]);
  for (const [key, capacity] of keys) {
    const decision = isCloud()
      ? await cloudCheck(key, policy, capacity)
      : memoryCheck(key, policy, capacity);
    if (!decision.allowed)
      throw new RateLimitError(policy.name, decision.retryAfterSeconds, policy.backoffSeconds > 0);
  }
}
