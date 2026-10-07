import test from 'node:test';
import assert from 'node:assert/strict';
import { consume, enforceRateLimit, resetRateLimits, type Bucket } from '../src/server/rate-limit';
import { apiError, RateLimitError } from '../src/server/http';

const policy = { capacity: 3, windowSeconds: 900, backoffSeconds: 60, maxBlockSeconds: 86400 };
function run(times: number[], start?: Bucket) {
  let bucket = start;
  return times.map((now) => {
    const d = consume(bucket, policy, now);
    bucket = d.bucket;
    return d;
  });
}

test('a token bucket allows a burst, then asks callers to wait for the next refill', () => {
  const [a, b, c, d] = run([0, 0, 0, 0]);
  assert.ok(a.allowed && b.allowed && c.allowed);
  assert.equal(d.allowed, false);
  // One token refills every 300 s; the first refusal's 60 s penalty is shorter than that.
  assert.equal(d.retryAfterSeconds, 300);
});

test('callers that honour Retry-After are served without escalation', () => {
  const decisions = run([0, 0, 0, 0, 300000, 600000]);
  assert.deepEqual(
    decisions.map((d) => d.allowed),
    [true, true, true, false, true, true],
  );
  assert.equal(decisions.at(-1)!.bucket.strikes, 1);
});

test('retrying before Retry-After doubles the block each time up to the cap', () => {
  const decisions = run([0, 0, 0, 0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
  const waits = decisions.slice(3).map((d) => d.retryAfterSeconds);
  // The 300 s refill holds at first; then the 60·2^(strikes−1) penalty doubles every retry.
  assert.deepEqual(waits, [300, 299, 298, 480, 960, 1920, 3840, 7680, 15360]);
  const capped = run(
    Array.from({ length: 40 }, (_, i) => i),
    undefined,
  ).at(-1)!;
  assert.ok(capped.retryAfterSeconds <= 86400);
  assert.equal(capped.allowed, false);
});

test('strikes clear after a quiet hour following the block', () => {
  const blocked = run([0, 0, 0, 0, 1, 2, 3]).at(-1)!.bucket;
  assert.ok(blocked.strikes > 3);
  const later = consume(blocked, policy, blocked.blockedUntil + 3600001);
  assert.ok(later.allowed);
  assert.equal(later.bucket.strikes, 0);
});

test('policies without backoff only wait for the refill', () => {
  const plain = { ...policy, backoffSeconds: 0, maxBlockSeconds: 60 };
  let bucket: Bucket | undefined;
  for (let i = 0; i < 3; i++) bucket = consume(bucket, plain, 0).bucket;
  for (let i = 0; i < 5; i++) {
    const d = consume(bucket, plain, 1000 * i);
    assert.equal(d.allowed, false);
    assert.equal(d.bucket.strikes, 0);
    bucket = d.bucket;
  }
  assert.ok(consume(bucket, plain, 300000).allowed);
});

test('users and IP addresses have separate buckets and refusals become 429 responses', async () => {
  resetRateLimits();
  const p = {
    name: 'test-policy',
    capacity: 2,
    windowSeconds: 60,
    ipMultiplier: 2,
    backoffSeconds: 0,
    maxBlockSeconds: 60,
  };
  const from = (ip: string) =>
    new Request('http://local/api', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
  await enforceRateLimit(from('1.1.1.1'), p, 'alice');
  await enforceRateLimit(from('1.1.1.1'), p, 'alice');
  await assert.rejects(enforceRateLimit(from('2.2.2.2'), p, 'alice'), RateLimitError);
  // Bob shares Alice's address: the IP bucket (2 × 2) still has room for him.
  await enforceRateLimit(from('1.1.1.1'), p, 'bob');
  await enforceRateLimit(from('1.1.1.1'), p, 'bob');
  const error = await enforceRateLimit(from('1.1.1.1'), p, 'carol').catch((e) => e);
  assert.ok(error instanceof RateLimitError);
  const response = apiError(error);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal((await response.json()).policy, 'test-policy');
  resetRateLimits();
});
