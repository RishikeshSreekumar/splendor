import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/bots/route';
import { authenticatedOwner } from '../src/server/cloud';

test('submission rejects anonymous requests before parsing source in every storage mode', async () => {
  const original = process.env.SPLENDOR_STORAGE;
  try {
    for (const mode of ['supabase', 'local']) {
      process.env.SPLENDOR_STORAGE = mode;
      for (const authorization of ['', 'Basic forged-credentials']) {
        const response = await POST(
          new Request('https://splendor.example/api/bots', {
            method: 'POST',
            headers: authorization ? { authorization } : {},
            body: 'not even valid JSON',
          }),
        );
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'Sign in to continue' });
      }
    }
  } finally {
    if (original === undefined) delete process.env.SPLENDOR_STORAGE;
    else process.env.SPLENDOR_STORAGE = original;
  }
});

test('submission verifies the bearer token with Supabase and uses the verified identity', async (t) => {
  const keys = ['SPLENDOR_STORAGE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  const originals = keys.map((key) => process.env[key]);
  process.env.SPLENDOR_STORAGE = 'supabase';
  process.env.SUPABASE_URL = 'https://auth.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
  let valid = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://auth.example/auth/v1/user');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
    calls++;
    return valid
      ? Response.json({ id: 'verified-owner', email: 'owner@example.com' })
      : Response.json({ msg: 'Expired or invalid token' }, { status: 401 });
  });
  const request = () =>
    new Request('https://splendor.example/api/bots', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: '{}',
    });
  try {
    assert.equal((await POST(request())).status, 401);
    valid = true;
    assert.equal(await authenticatedOwner(request()), 'verified-owner');
    // Authenticated requests reach payload validation rather than being rejected as anonymous.
    const response = await POST(request());
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /name/);
    assert.equal(calls, 3);
  } finally {
    keys.forEach((key, index) => {
      if (originals[index] === undefined) delete process.env[key];
      else process.env[key] = originals[index];
    });
  }
});
