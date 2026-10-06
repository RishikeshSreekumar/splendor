import test from 'node:test';
import assert from 'node:assert/strict';
import { LabStore } from '../src/server/store';
import { jsonBody, mutationOrigin } from '../src/server/http';

test('saved bot versions are immutable and identical saves are idempotent', () => {
  const s = new LabStore(':memory:');
  try {
    const a = s.saveBot('Bot', 'code-a'),
      same = s.saveBot('Bot', 'code-a'),
      b = s.saveBot('Bot', 'code-b');
    assert.equal(a.id, same.id);
    assert.notEqual(a.id, b.id);
    assert.equal(s.listBots().length, 2);
    assert.equal(s.listBots().find((bot) => bot.id === a.id)?.source, 'code-a');
  } finally {
    s.close();
  }
});
test('job progress persists, restarting marks unfinished jobs failed, and configuration is retained', () => {
  const s = new LabStore(':memory:');
  try {
    const config = {
      botIds: ['a', 'b', 'c'],
      pairs: 3,
      mode: 'ranked' as const,
      clockConfig: { initialMs: 45000, incrementMs: 2000 },
    };
    const j = s.createJob(config);
    assert.equal(j.totalGames, 18);
    s.start(j.id);
    s.progress(j.id, 2);
    assert.equal(s.getJob(j.id)?.completedGames, 2);
    s.recover();
    assert.equal(s.getJob(j.id)?.status, 'failed');
    assert.deepEqual(s.getJob(j.id)?.config, config);
    s.progress(j.id, 10);
    assert.equal(s.getJob(j.id)?.completedGames, 2);
  } finally {
    s.close();
  }
});
test('HTTP parsing enforces byte limits and rejects cross-origin mutations', async () => {
  assert.throws(
    () =>
      mutationOrigin(
        new Request('http://localhost:3000/api/bots', {
          headers: { origin: 'https://unrelated.example' },
        }),
      ),
    /Cross-origin/,
  );
  mutationOrigin(
    new Request('http://localhost:3000/api/bots', { headers: { origin: 'http://localhost:3000' } }),
  );
  const req = new Request('http://localhost:3000/api/bots', {
    method: 'POST',
    body: JSON.stringify({ message: 'too large' }),
  });
  await assert.rejects(jsonBody(req, 5), /too large/);
});

test('same-origin local writes survive Next.js internal hostname normalization', () => {
  mutationOrigin(
    new Request('http://localhost:3000/api/bots', {
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    }),
  );
  assert.throws(
    () =>
      mutationOrigin(
        new Request('http://localhost:3000/api/bots', {
          headers: { host: '127.0.0.1:3000', origin: 'https://unrelated.example' },
        }),
      ),
    /Cross-origin/,
  );
});
