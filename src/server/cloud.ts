import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { AuthenticationError } from './http';
export const isCloud = () => process.env.SPLENDOR_STORAGE === 'supabase';
export function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
export function database() {
  return createClient(secret('SUPABASE_URL'), secret('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function owner(request: Request): Promise<string> {
  if (!isCloud()) return '00000000-0000-4000-8000-000000000001';
  return authenticatedOwner(request);
}
/** Submissions always require a verified account, including in local storage mode. */
export async function authenticatedOwner(request: Request): Promise<string> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AuthenticationError();
  const { data, error } = await database().auth.getUser(token);
  if (error || !data.user) throw new AuthenticationError();
  return data.user.id;
}
export async function optionalOwner(request: Request) {
  return request.headers.has('authorization') ? owner(request) : undefined;
}
export function checkInternal(request: Request): boolean {
  const expected = process.env.PLATFORM_TOKEN;
  if (!expected) return false;
  const actual = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function platform(path: string, init: RequestInit = {}) {
  const response = await fetch(`${secret('PLATFORM_URL')}/__platform/${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${secret('PLATFORM_TOKEN')}` },
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Platform request failed (${response.status})`);
  return response;
}
export async function putArtifact(key: string, value: unknown) {
  await platform(`artifacts/${key}`, {
    method: 'PUT',
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
  });
}
export async function getArtifact<T>(key: string): Promise<T> {
  return (await platform(`artifacts/${key}`)).json();
}
