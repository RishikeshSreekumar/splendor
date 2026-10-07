import { z } from 'zod';
export class AuthenticationError extends Error {
  constructor() {
    super('Sign in to continue');
  }
}
/** An error with an HTTP status and extra JSON fields for clients to act on. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}
export class RateLimitError extends HttpError {
  constructor(
    readonly policy: string,
    readonly retryAfterSeconds: number,
    escalates = true,
  ) {
    super(
      `Rate limit reached for ${policy}. Retry in ${retryAfterSeconds}s${escalates ? '; retrying sooner extends the wait' : ''}.`,
      429,
      { policy, retryAfterSeconds },
      { 'retry-after': String(retryAfterSeconds) },
    );
  }
}
/** The caller's address. Vercel overwrites these headers, so clients cannot forge them there. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('x-real-ip')?.trim() || forwarded || 'local';
}
export const clockSchema = z.object({
  initialMs: z.number().int().min(1000).max(3600000),
  incrementMs: z.number().int().min(0).max(60000),
});
export function mutationOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  // Next.js can normalize request.url to localhost while preserving the browser-facing Host.
  const url = new URL(request.url);
  if (process.env.SPLENDOR_STORAGE === 'supabase') {
    if (origin && origin !== process.env.APP_ORIGIN)
      throw new Error('Cross-origin writes are not allowed');
    return;
  }
  const expectedHost = request.headers.get('host') ?? url.host;
  if (origin) {
    const incoming = new URL(origin);
    if (incoming.host !== expectedHost || incoming.protocol !== url.protocol)
      throw new Error('Cross-origin writes are not allowed');
  }
}
export async function jsonBody(request: Request, limit = 150000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Expected a JSON body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error('Request is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function apiError(error: unknown, status = 400): Response {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : error instanceof Error
        ? error.message
        : 'Request failed';
  if (error instanceof HttpError)
    return Response.json(
      { ...error.details, error: message },
      { status: error.status, headers: error.headers },
    );
  return Response.json(
    { error: message },
    { status: error instanceof AuthenticationError ? 401 : status },
  );
}

/** Stream large completed reports so the host need not buffer one response payload. */
export function streamJson(value: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 65536, bytes.length);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    },
  );
}
