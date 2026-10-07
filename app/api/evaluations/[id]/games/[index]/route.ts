import { enforceRateLimit, RATE_LIMITS } from '@/src/server/rate-limit';
import { isCloud, owner } from '@/src/server/cloud';
import { CloudStore } from '@/src/server/cloud-store';
import { getStore } from '@/src/server/store';
import { replay } from '@/src/simulation';
import { createGame, applyAction, observe } from '@/src/engine';
import { apiError, streamJson } from '@/src/server/http';
import type { ClockSnapshot } from '@/src/types';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  try {
    const { id, index } = await params,
      user = await owner(_request);
    await enforceRateLimit(_request, RATE_LIMITS.statusRead, user);
    const job = isCloud() ? await new CloudStore().getJob(id, user) : getStore().getJob(id),
      n = Number(index);
    if (!job?.report || !Number.isInteger(n) || n < 0 || n >= job.report.games.length)
      return Response.json({ error: 'Completed game not found' }, { status: 404 });
    const game = job.report.games[n];
    replay(game);
    let state = createGame({ players: game.bots.length, seed: game.seed });
    const initialClock: ClockSnapshot = {
      config: game.clock.config,
      remainingMs: game.bots.map(() => game.clock.config.initialMs),
      activeSeat: null,
    };
    const frames = [
      {
        view: { ...observe(state), legalActions: [], clock: initialClock },
        event: null as (typeof game.log)[number] | null,
      },
    ];
    for (const event of game.log) {
      if (event.kind === 'action') state = applyAction(state, event.action);
      frames.push({ view: { ...observe(state, 0), legalActions: [], clock: event.clock }, event });
    }
    const allBots = isCloud() ? await new CloudStore().listBots() : getStore().listBots();
    return streamJson({
      game,
      frames,
      names: game.bots.map((b) => allBots.find((bot) => bot.id === b.id)?.name ?? b.id),
    });
  } catch (error) {
    return apiError(error, 500);
  }
}
