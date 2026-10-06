import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { database } from '../src/server/cloud';
import { createClient } from '@supabase/supabase-js';
const db = database(),
  email = `splendor-qa-${Date.now()}@example.com`,
  password = randomBytes(24).toString('hex');
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});
const login = await client.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
await writeFile(
  '.env.qa',
  `QA_USER_ID=${data.user.id}\nQA_EMAIL=${email}\nQA_PASSWORD=${password}\nQA_TOKEN=${login.data.session.access_token}\n`,
  { mode: 0o600 },
);
console.log('Created temporary application QA account:', data.user.id);
