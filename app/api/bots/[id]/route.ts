import { readFile } from 'node:fs/promises';
import { getStore } from '@/src/server/store';
import { isCloud, optionalOwner } from '@/src/server/cloud';
import { CloudStore } from '@/src/server/cloud-store';
import { apiError } from '@/src/server/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id))
      return Response.json({ error: 'Invalid bot ID' }, { status: 400 });
    const bot = isCloud()
      ? await new CloudStore().getBot(id, await optionalOwner(request))
      : getStore()
          .listBots()
          .find((b) => b.id === id);
    if (!bot) return Response.json({ error: 'Bot not found' }, { status: 404 });
    if (isCloud()) return Response.json(bot);
    const project = await readFile(`storage/projects/${id}.json`, 'utf8')
      .then(JSON.parse)
      .catch(() => ({ files: [{ path: 'index.ts', content: bot.source }] }));
    return Response.json({ ...bot, ...project });
  } catch (error) {
    return apiError(error);
  }
}
