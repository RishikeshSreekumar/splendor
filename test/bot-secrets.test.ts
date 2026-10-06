import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptBotSecrets,
  decryptBotSecrets,
  secretFingerprint,
  botSecretsSchema,
} from '../src/server/bot-secrets';
test('bot keys are encrypted, authenticated to owner and version, and fingerprinted deterministically', () => {
  const original = process.env.BOT_SECRETS_KEY;
  process.env.BOT_SECRETS_KEY = 'a1'.repeat(32);
  try {
    const values = { API_KEY: 'test-secret', SECOND_KEY: 'other' },
      encoded = encryptBotSecrets('owner', 'bot', values)!;
    assert.ok(!encoded.includes('test-secret'));
    assert.deepEqual(decryptBotSecrets('owner', 'bot', encoded), values);
    assert.throws(() => decryptBotSecrets('other-owner', 'bot', encoded));
    assert.throws(() => decryptBotSecrets('owner', 'other-bot', encoded));
    assert.equal(
      secretFingerprint('owner', values),
      secretFingerprint('owner', { SECOND_KEY: 'other', API_KEY: 'test-secret' }),
    );
    assert.notEqual(secretFingerprint('owner', values), secretFingerprint('other', values));
    assert.equal(encryptBotSecrets('owner', 'bot', {}), null);
    assert.throws(() => botSecretsSchema.parse({ INVALID: 'x'.repeat(4097) }));
  } finally {
    if (original === undefined) delete process.env.BOT_SECRETS_KEY;
    else process.env.BOT_SECRETS_KEY = original;
  }
});
