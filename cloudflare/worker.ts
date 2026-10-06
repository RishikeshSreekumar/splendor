// Private R2 gateway. Only the Next.js server receives PLATFORM_TOKEN.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const encoder = new TextEncoder(),
      a = encoder.encode(token),
      b = encoder.encode(env.PLATFORM_TOKEN);
    if (!b.length || a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b))
      return new Response('Unauthorized', { status: 401 });
    const url = new URL(request.url),
      prefix = '/__platform/artifacts/';
    if (!url.pathname.startsWith(prefix)) return new Response('Not found', { status: 404 });
    const key = url.pathname.slice(prefix.length);
    if (!/^(bots|reports)\/[a-zA-Z0-9/_-]+\.json$/.test(key))
      return new Response('Invalid key', { status: 400 });
    if (request.method === 'GET') {
      const object = await env.ARTIFACTS.get(key);
      return object
        ? new Response(object.body, {
            headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
          })
        : new Response('Not found', { status: 404 });
    }
    if (request.method === 'PUT') {
      const bytes = Number(request.headers.get('content-length'));
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 32 * 1024 * 1024)
        return new Response('Invalid content length', { status: 413 });
      if (!request.body) return new Response('Missing body', { status: 400 });
      await env.ARTIFACTS.put(key, request.body, {
        httpMetadata: { contentType: 'application/json' },
      });
      return new Response(null, { status: 204 });
    }
    return new Response('Method not allowed', { status: 405 });
  },
} satisfies ExportedHandler<Env>;
