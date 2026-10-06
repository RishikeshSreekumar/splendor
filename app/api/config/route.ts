import { isCloud, secret } from '@/src/server/cloud';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(
    isCloud()
      ? {
          cloud: true,
          supabaseUrl: secret('SUPABASE_URL'),
          supabaseAnonKey: secret('SUPABASE_ANON_KEY'),
        }
      : { cloud: false },
  );
}
