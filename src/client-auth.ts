import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let pending: Promise<SupabaseClient | null> | undefined;
export function browserAuth() {
  return (pending ??= (async () => {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Unable to load sign-in configuration');
    const c = await response.json();
    return c.cloud ? createClient(c.supabaseUrl, c.supabaseAnonKey) : null;
  })());
}
export async function authHeaders(): Promise<Record<string, string>> {
  const client = await browserAuth();
  if (!client) return {};
  const { data } = await client.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}
