import { authenticatedOwner, isCloud } from '@/src/server/cloud';
import { apiError, jsonBody, mutationOrigin } from '@/src/server/http';
import { RPC, respond } from '@/src/server/mcp/protocol';
import { SERVER_INFO, TOOLS } from '@/src/server/mcp/splendor';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/**
 * Streamable HTTP MCP endpoint. Hosted mode requires `Authorization: Bearer spl_…`, a personal
 * access token created on the account page; every tool acts as that user.
 */
export async function POST(request: Request) {
  try {
    // Browsers must come from the app itself (DNS-rebinding defence); CLI clients send no Origin.
    mutationOrigin(request);
    if (isCloud()) await authenticatedOwner(request);
  } catch (error) {
    const response = apiError(error);
    if (response.status === 401)
      response.headers.set(
        'www-authenticate',
        'Bearer realm="splendor", error="invalid_token", error_description="Create an API token on the account page"',
      );
    else if (response.status === 400)
      return new Response(response.body, { status: 403, headers: response.headers });
    return response;
  }
  let body: unknown;
  try {
    body = await jsonBody(request, 1300000);
  } catch {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC.parse, message: 'Parse error' } },
      { status: 400 },
    );
  }
  return respond(body, TOOLS, SERVER_INFO, { request });
}
/** This server never opens a server-to-client stream. */
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
}
export function DELETE() {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
}
