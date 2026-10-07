import { z } from 'zod';
import { isCloud, sessionOwner } from '@/src/server/cloud';
import { createToken, listTokens, revokeToken } from '@/src/server/api-tokens';
import { apiError, HttpError, jsonBody, mutationOrigin } from '@/src/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function hosted() {
  if (!isCloud()) throw new HttpError('API tokens require hosted mode', 404);
}
export async function GET(request: Request) {
  try {
    hosted();
    return Response.json(await listTokens(await sessionOwner(request)));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    hosted();
    mutationOrigin(request);
    const user = await sessionOwner(request);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(60) })
      .parse(await jsonBody(request, 2000));
    return Response.json(await createToken(user, name), {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request) {
  try {
    hosted();
    mutationOrigin(request);
    const user = await sessionOwner(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await jsonBody(request, 2000));
    if (!(await revokeToken(user, id))) throw new HttpError('Token not found', 404);
    return Response.json({ revoked: true });
  } catch (error) {
    return apiError(error);
  }
}
