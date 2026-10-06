import { spawn } from 'node:child_process';
const vars: Record<string, string> = {
  SPLENDOR_STORAGE: 'supabase',
  APP_ORIGIN: 'https://splendor.sudipmondal.co.in',
};
for (const key of [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PLATFORM_URL',
  'PLATFORM_TOKEN',
  'MODAL_TOKEN_ID',
  'MODAL_TOKEN_SECRET',
  'CRON_SECRET',
  'BOT_SECRETS_KEY',
]) {
  if (!process.env[key]) throw new Error('Missing ' + key);
  vars[key] = process.env[key]!;
}
for (const [key, value] of Object.entries(vars)) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      'npx',
      [
        '--yes',
        'vercel@latest',
        'env',
        'add',
        key,
        'production',
        '--force',
        '--yes',
        '--sensitive',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    p.stdout.on('data', (c) => (output += c));
    p.stderr.on('data', (c) => (output += c));
    p.stdin.end(value);
    p.on('exit', (code) => {
      if (code)
        reject(new Error(`Vercel env ${key} failed: ${output.replaceAll(value, '[redacted]')}`));
      else {
        console.log('Configured ' + key);
        resolve();
      }
    });
  });
}
