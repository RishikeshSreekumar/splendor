import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database } from './cloud';
import { HttpError } from './http';
/** Personal access tokens let MCP clients act as their owner without a browser session. */
export const TOKEN_PREFIX = 'spl_';
export const MAX_ACTIVE_TOKENS = 10;
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}
interface TokenRow {
  id: string;
  owner_id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}
export const isApiToken = (token: string) => token.startsWith(TOKEN_PREFIX);
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const view = (r: TokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});
/** Returns the owner of an active token, or undefined. */
export async function tokenOwner(token: string): Promise<string | undefined> {
  if (!/^spl_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const db = database();
  const { data, error } = await db
    .from('splendor_api_tokens')
    .select('id,owner_id,last_used_at')
    .eq('token_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;
  // Usage is informational; record it at most once a minute.
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 60000)
    await db
      .from('splendor_api_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id);
  return data.owner_id as string;
}
export async function listTokens(owner: string): Promise<ApiToken[]> {
  const { data, error } = await database()
    .from('splendor_api_tokens')
    .select('id,owner_id,name,prefix,created_at,last_used_at')
    .eq('owner_id', owner)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as TokenRow[]).map(view);
}
/** Creates a token. The plaintext is returned once and never stored. */
export async function createToken(
  owner: string,
  name: string,
): Promise<ApiToken & { token: string }> {
  if ((await listTokens(owner)).length >= MAX_ACTIVE_TOKENS)
    throw new HttpError(`Revoke a token first; at most ${MAX_ACTIVE_TOKENS} may be active`, 409);
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const { data, error } = await database()
    .from('splendor_api_tokens')
    .insert({
      id: randomUUID(),
      owner_id: owner,
      name,
      token_hash: hashToken(token),
      prefix: token.slice(0, 10),
    })
    .select('id,owner_id,name,prefix,created_at,last_used_at')
    .single();
  if (error) throw new Error(error.message);
  return { ...view(data as TokenRow), token };
}
export async function revokeToken(owner: string, id: string): Promise<boolean> {
  const { data, error } = await database()
    .from('splendor_api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', owner)
    .is('revoked_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}
