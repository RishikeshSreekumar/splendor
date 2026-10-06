import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { secret } from './cloud';
export const botSecretsSchema = z
  .record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().min(1).max(4096))
  .refine(
    (v) => Object.keys(v).length <= 16 && Buffer.byteLength(JSON.stringify(v)) <= 16384,
    'At most 16 secrets and 16 KiB are allowed',
  );
function key() {
  const value = Buffer.from(secret('BOT_SECRETS_KEY'), 'hex');
  if (value.length !== 32) throw new Error('BOT_SECRETS_KEY must contain 32 bytes');
  return value;
}
export function secretFingerprint(owner: string, values: Record<string, string>): string {
  if (!Object.keys(values).length) return '';
  return createHmac('sha256', key())
    .update(JSON.stringify([owner, Object.entries(values).sort(([a], [b]) => a.localeCompare(b))]))
    .digest('hex');
}
export function encryptBotSecrets(
  owner: string,
  id: string,
  values: Record<string, string>,
): string | null {
  if (!Object.keys(values).length) return null;
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`${owner}:${id}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(botSecretsSchema.parse(values)), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64')).join('.');
}
export function decryptBotSecrets(
  owner: string,
  id: string,
  encoded?: string | null,
): Record<string, string> {
  if (!encoded) return {};
  const [iv, tag, encrypted] = encoded.split('.').map((v) => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`${owner}:${id}`));
  cipher.setAuthTag(tag);
  return botSecretsSchema.parse(
    JSON.parse(Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8')),
  );
}
