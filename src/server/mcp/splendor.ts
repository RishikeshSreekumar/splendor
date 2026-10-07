import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { GET as listBotsRoute, POST as submitBotRoute } from '@/app/api/bots/route';
import { GET as getBotRoute } from '@/app/api/bots/[id]/route';
import {
  GET as listEvaluationsRoute,
  POST as startEvaluationRoute,
} from '@/app/api/evaluations/route';
import { GET as getEvaluationRoute } from '@/app/api/evaluations/[id]/route';
import { GET as currentGameRoute, POST as playRoute } from '@/app/api/play/route';
import { GET as ladderRoute } from '@/app/api/ratings/route';
import { authenticatedOwner, isCloud, owner } from '../cloud';
import { projectSchema } from '../../submissions/bundle';
import { MAX_OPPONENTS, type PracticeView } from '../../practice/types';
import type { StoredBot, EvaluationJob } from '../store';
import type { Action, Card, GameRecord } from '../../types';
import { defineTool, type ServerInfo, type Tool, type ToolContext } from './protocol';
const GEMS = ['white', 'blue', 'green', 'red', 'black', 'gold'] as const;
type Bot = StoredBot & { ownerId?: string };
/** Any route handler; `never` params accept every dynamic segment shape. */
type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;
/** Calls an API route in-process as the MCP caller, so every route's checks apply unchanged. */
async function api<T>(
  context: ToolContext,
  handler: Handler,
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<T> {
  const headers = new Headers();
  for (const name of ['authorization', 'x-forwarded-for', 'x-real-ip']) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await handler(
    new Request(new URL(path, context.request.url), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) as Promise<never> },
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    let message = String(data.error ?? `Request failed (${response.status})`);
    if (data.activeGameId)
      message += `. Unfinished game ${data.activeGameId}: call get_game to resume it, or start_game with abandonExisting: true.`;
    throw new Error(message);
  }
  return data as T;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Omits zero entries from token and cost maps. */
function bag(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).filter(([, n]) => n));
}
/** Token maps sent to the engine must name all six gems. */
function fullBag(value: unknown) {
  const source = (value ?? {}) as Record<string, number>;
  return Object.fromEntries(GEMS.map((g) => [g, source[g] ?? 0]));
}
const card = (c: Card) => ({
  id: c.id,
  tier: c.tier,
  bonus: c.bonus,
  points: c.points,
  cost: bag(c.cost),
});
function compactAction(a: Action) {
  if (a.type === 'take' || a.type === 'discard') return { type: a.type, tokens: bag(a.tokens) };
  if (a.type === 'buy') return { type: a.type, cardId: a.cardId, payment: bag(a.payment) };
  return a;
}
function normalizeAction(raw: Record<string, unknown>) {
  const a = { ...raw };
  if (a.type === 'take' || a.type === 'discard') a.tokens = fullBag(a.tokens);
  if (a.type === 'buy') a.payment = fullBag(a.payment);
  return a;
}
const publicBot = (b: Bot, user: string) => ({
  id: b.id,
  name: b.name,
  baseline: b.baseline,
  mine: Boolean(b.ownerId && b.ownerId === user),
  qualification: b.qualification ?? 'passed',
  qualificationError: b.qualificationError,
  privateExecution: b.privateExecution || undefined,
  elo: Math.round(b.elo ?? 1200),
  ratedGames: b.ratedGames ?? 0,
  createdAt: b.createdAt,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Accepts bot IDs or names: baselines first, then the caller's newest qualified version. */
async function resolveBots(context: ToolContext, refs: string[]) {
  const bots = await api<Bot[]>(context, listBotsRoute, '/api/bots');
  const user = await owner(context.request);
  return refs.map((ref) => {
    if (UUID.test(ref)) return ref;
    const named = bots.filter(
      (b) =>
        b.name.toLowerCase() === ref.trim().toLowerCase() &&
        (b.qualification ?? 'passed') === 'passed',
    );
    const pick =
      named.find((b) => b.baseline) ??
      named.find((b) => b.ownerId === user) ??
      named.find(() => true);
    if (!pick) throw new Error(`No qualified bot named "${ref}". Call list_bots for options.`);
    return pick.id;
  });
}
async function botNames(context: ToolContext) {
  const bots = await api<Bot[]>(context, listBotsRoute, '/api/bots');
  return (id: string) => bots.find((b) => b.id === id)?.name ?? id;
}
function agentGame(g: PracticeView) {
  const v = g.view,
    names = g.seats.map((s) => s.name);
  const yourTurn = v.status === 'playing' && v.currentPlayer === g.humanSeat && !g.busy;
  return {
    gameId: g.id,
    revision: g.revision,
    status: v.status,
    yourSeat: g.humanSeat,
    yourTurn,
    ...(g.busy ? { busy: 'A move is still being computed; call get_game again shortly.' } : {}),
    currentPlayer: names[v.currentPlayer],
    phase: v.phase,
    turn: v.turn,
    finalRound: v.finalRound,
    ...(v.status === 'finished' ? { winners: v.winners.map((i) => names[i]) } : {}),
    movesSinceLastCall: g.steps.map((s) => ({
      player: names[s.seat],
      action: compactAction(s.action),
      ...(s.assisted ? { assisted: true } : {}),
    })),
    notices: g.notices,
    bank: bag(v.bank),
    deckCounts: { tier1: v.deckCounts[0], tier2: v.deckCounts[1], tier3: v.deckCounts[2] },
    market: v.market.map((row, i) => ({ tier: i + 1, cards: row.map(card) })),
    nobles: v.nobles.map((n) => ({ id: n.id, points: n.points, requiresBonuses: bag(n.cost) })),
    players: v.players.map((p, i) => ({
      seat: i,
      name: names[i],
      ...(i === g.humanSeat ? { you: true } : {}),
      points: p.points,
      turns: p.turns,
      tokens: bag(p.tokens),
      bonuses: bag(p.bonuses),
      cards: p.cards.length,
      nobles: p.nobles.map((n) => n.id),
      reserved: p.reserved.map((r) => (r.card ? card(r.card) : { hidden: true, tier: r.tier })),
      clockSeconds: v.clock ? Math.round(v.clock.remainingMs[i] / 1000) : undefined,
    })),
    legalActions: yourTurn
      ? v.legalActions.map((a, index) => ({ index, ...compactAction(a) }))
      : [],
  };
}
function agentEvaluation(job: EvaluationJob, name: (id: string) => string) {
  const { report, ...rest } = job;
  return {
    ...rest,
    bots: job.config.botIds.map((id) => ({ id, name: name(id) })),
    ...(report
      ? {
          leaderboard: report.leaderboard.map((r) => ({
            bot: name(r.id),
            id: r.id,
            elo: Math.round(r.elo),
            provisional: r.provisional,
            games: r.games,
            ratedGames: r.ratedGames,
            wins: r.wins,
            draws: r.draws,
            losses: r.losses,
            forfeits: r.forfeits,
            faults: r.faults,
            winRate: r.winRate,
          })),
          games: report.games.map((g, index) => ({
            index,
            seats: g.bots.map((b) => name(b.id)),
            result: g.result.reason,
            winners: g.result.winners.map((i) => name(g.bots[i].id)),
            scores: g.scores,
            turns: g.turns,
            faults: g.faults,
          })),
        }
      : {}),
  };
}
function agentRecord(g: GameRecord, index: number, name: (id: string) => string) {
  const seats = g.bots.map((b) => name(b.id));
  return {
    index,
    seats,
    result: g.result,
    winners: g.result.winners.map((i) => seats[i]),
    scores: g.scores,
    turns: g.turns,
    faults: g.faults,
    clock: g.clock.config,
    log: g.log.map((e) =>
      e.kind === 'action'
        ? {
            decision: e.decision,
            seat: e.seat,
            action: compactAction(e.action),
            elapsedMs: Math.round(e.elapsedMs),
            ...(e.assisted ? { assisted: true } : {}),
          }
        : { decision: e.decision, seat: e.seat, fault: e.code, stage: e.stage },
    ),
  };
}
async function currentGame(context: ToolContext) {
  return (await api<{ game: PracticeView | null }>(context, currentGameRoute, '/api/play')).game;
}
const RULES = `Vanilla Splendor (base game) for 2–4 players. On a turn choose one main action:
take 3 different colored gems, take 2 of one color (bank must hold ≥4 of it), reserve a market card
or the top of a deck (max 3 reserved; gain 1 gold if available), or buy a market/reserved card paying
its cost minus your permanent bonuses (gold is wild). Holding more than 10 tokens forces a discard
decision. After the action, a noble whose bonus requirement you meet visits (choose if several).
Reaching 15 points triggers the final round; most points wins, ties go to fewer purchased cards.
Every action you send must be one of legalActions; play_move accepts its index.`;
const GUIDE_SECTIONS = [
  'Write a player',
  'Folder submissions',
  'Independent clocks',
  'Networked and LLM bots',
  'Faults and evaluation',
];
async function botGuide() {
  // Not traced: outputFileTracingIncludes ships exactly these files with the MCP function.
  const root = /* turbopackIgnore: true */ process.cwd();
  const [readme, sdk, example] = await Promise.all([
    readFile(join(root, 'README.md'), 'utf8'),
    readFile(join(root, 'src/sdk.d.ts'), 'utf8'),
    readFile(join(root, 'bots/greedy.js'), 'utf8'),
  ]);
  const sections = readme
    .split(/\n(?=## )/)
    .filter((s) => GUIDE_SECTIONS.some((h) => s.startsWith(`## ${h}`)));
  return [
    '# Splendor bot guide',
    RULES,
    ...sections,
    '## SDK declarations (virtual module `splendor`)',
    '```ts\n' + sdk + '\n```',
    '## Example: the public Greedy baseline',
    '```js\n' + example + '\n```',
  ].join('\n\n');
}
const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(45)
  .default(0)
  .describe('Wait up to this long for the run to finish, polling server-side every 5 s.');
export const TOOLS: Tool[] = [
  defineTool({
    name: 'get_account',
    title: 'Account',
    description: 'Who the token belongs to, the storage mode, and the limits that apply.',
    input: z.object({}),
    readOnly: true,
    async run(_args, context) {
      const user = isCloud()
        ? await authenticatedOwner(context.request)
        : await owner(context.request);
      return {
        userId: user,
        hosted: isCloud(),
        limits: {
          games:
            'One unfinished practice game at a time; start_game can abandon it (a rated loss after your third turn).',
          evaluations:
            'Bursts of 3 launches per 15 minutes (bot submissions likewise), at most 2 running and 20 per day. Calls made before Retry-After double the block.',
          moves: '30 moves per minute.',
        },
      };
    },
  }),
  defineTool({
    name: 'get_bot_guide',
    title: 'Bot-writing guide',
    description:
      'Rules summary, the player SDK declarations, submission limits, clock and fault policy, and an example bot. Read before writing a bot.',
    input: z.object({}),
    readOnly: true,
    run: () => botGuide(),
  }),
  defineTool({
    name: 'list_bots',
    title: 'List bots',
    description:
      'Public qualified bots (including the Random, Greedy and Strategist baselines) and all of your own versions with their qualification status.',
    input: z.object({ mineOnly: z.boolean().default(false) }),
    readOnly: true,
    async run({ mineOnly }, context) {
      const user = await owner(context.request);
      const bots = (await api<Bot[]>(context, listBotsRoute, '/api/bots')).map((b) =>
        publicBot(b, user),
      );
      return mineOnly ? bots.filter((b) => b.mine) : bots;
    },
  }),
  defineTool({
    name: 'get_leaderboard',
    title: 'Leaderboard',
    description:
      'The global Elo ladder: every qualified bot you can see and the top human players. Ranked evaluation games and practice games update it.',
    input: z.object({}),
    readOnly: true,
    run: (_args, context) => api(context, ladderRoute, '/api/ratings'),
  }),
  defineTool({
    name: 'get_bot',
    title: 'Get bot',
    description:
      'A bot version with its source files and qualification result. Set waitSeconds to wait for a pending qualification.',
    input: z.object({ botId: z.string().uuid(), waitSeconds }),
    readOnly: true,
    async run({ botId, waitSeconds }, context) {
      const deadline = Date.now() + waitSeconds * 1000;
      while (true) {
        const bot = await api<Bot & { files?: unknown }>(
          context,
          getBotRoute,
          `/api/bots/${botId}`,
          { params: { id: botId } },
        );
        if (bot.qualification !== 'pending' || Date.now() + 5000 > deadline)
          return { ...bot, source: undefined };
        await sleep(5000);
        // The list endpoint advances pending qualifications in hosted mode.
        await api(context, listBotsRoute, '/api/bots');
      }
    },
  }),
  defineTool({
    name: 'submit_bot',
    title: 'Submit bot',
    description:
      'Submit a new immutable bot version. Provide `source` (one JavaScript/TypeScript module) or `files` (a folder with root index.ts). It must default-export a subclass of SplendorPlayer from "splendor". The version then plays four qualification games against Random and Greedy; poll get_bot with waitSeconds. Rate limited with escalating backoff.',
    input: z
      .object({
        name: z.string().trim().min(1).max(50),
        source: z.string().min(1).max(131072).optional(),
        files: projectSchema.optional(),
        secrets: z
          .record(z.string(), z.string())
          .optional()
          .describe('Private values read with this.getSecret(name); makes the bot owner-only.'),
      })
      .refine(
        (v) => Boolean(v.source) !== Boolean(v.files),
        'Provide exactly one of source or files',
      ),
    destructive: false,
    async run(args, context) {
      return api(context, submitBotRoute, '/api/bots', { method: 'POST', body: args });
    },
  }),
  defineTool({
    name: 'list_evaluations',
    title: 'List evaluations',
    description: 'Your evaluations, newest first, with status and progress.',
    input: z.object({}),
    readOnly: true,
    async run(_args, context) {
      const [jobs, name] = await Promise.all([
        api<EvaluationJob[]>(context, listEvaluationsRoute, '/api/evaluations'),
        botNames(context),
      ]);
      return jobs.map((j) => agentEvaluation({ ...j, report: undefined }, name));
    },
  }),
  defineTool({
    name: 'start_evaluation',
    title: 'Start evaluation',
    description:
      'Run a round-robin evaluation between 2–6 qualified bots (IDs or names such as "Greedy"). Every pair plays `pairs` seat-swapped fixtures. Ranked mode forfeits faults; practice mode substitutes fallback moves. Strictly rate limited: wait for Retry-After before retrying or the block doubles.',
    input: z.object({
      bots: z.array(z.string().min(1).max(64)).min(2).max(6),
      pairs: z.number().int().min(1).max(10).default(1),
      mode: z.enum(['ranked', 'practice']).default('ranked'),
      initialSeconds: z.number().min(1).max(3600).default(60),
      incrementSeconds: z.number().min(0).max(60).default(1),
    }),
    async run(args, context) {
      const botIds = await resolveBots(context, args.bots);
      return api(context, startEvaluationRoute, '/api/evaluations', {
        method: 'POST',
        body: {
          botIds,
          pairs: args.pairs,
          mode: args.mode,
          clockConfig: {
            initialMs: Math.round(args.initialSeconds * 1000),
            incrementMs: Math.round(args.incrementSeconds * 1000),
          },
        },
      });
    },
  }),
  defineTool({
    name: 'get_evaluation',
    title: 'Get evaluation',
    description:
      'Status of an evaluation; once completed, the Elo leaderboard and a summary of every game. Set waitSeconds to wait for completion instead of polling quickly.',
    input: z.object({ evaluationId: z.string().uuid(), waitSeconds }),
    readOnly: true,
    async run({ evaluationId, waitSeconds }, context) {
      const deadline = Date.now() + waitSeconds * 1000;
      const name = await botNames(context);
      while (true) {
        const job = await api<EvaluationJob>(
          context,
          getEvaluationRoute,
          `/api/evaluations/${evaluationId}`,
          { params: { id: evaluationId } },
        );
        const done = job.status === 'completed' || job.status === 'failed';
        if (done || Date.now() + 5000 > deadline) return agentEvaluation(job, name);
        await sleep(5000);
      }
    },
  }),
  defineTool({
    name: 'get_evaluation_game',
    title: 'Get evaluation game',
    description:
      'The move-by-move log of one game in a completed evaluation: actions, decision times and faults.',
    input: z.object({ evaluationId: z.string().uuid(), gameIndex: z.number().int().min(0) }),
    readOnly: true,
    async run({ evaluationId, gameIndex }, context) {
      const [job, name] = await Promise.all([
        api<EvaluationJob>(context, getEvaluationRoute, `/api/evaluations/${evaluationId}`, {
          params: { id: evaluationId },
        }),
        botNames(context),
      ]);
      const game = job.report?.games[gameIndex];
      if (!game) throw new Error('Completed game not found');
      return agentRecord(game, gameIndex, name);
    },
  }),
  defineTool({
    name: 'get_game',
    title: 'Get current game',
    description:
      'Your unfinished practice game (one per account), with the board, every player, and the indexed legalActions when it is your turn. Returns null when you have no game.',
    input: z.object({}),
    readOnly: true,
    async run(_args, context) {
      const game = await currentGame(context);
      return game ? agentGame(game) : { game: null };
    },
  }),
  defineTool({
    name: 'start_game',
    title: 'Start practice game',
    description:
      'Sit at a practice table against 1–3 bots (IDs or names, e.g. ["Greedy", "Strategist"]). The game is rated: when it finishes, your Elo and every bot\'s move by placement. You may only have one unfinished game; abandonExisting discards it, which counts as a loss once you have played three turns. Bots move automatically; the response shows the board on your turn.',
    input: z.object({
      opponents: z.array(z.string().min(1).max(64)).min(1).max(MAX_OPPONENTS),
      order: z.enum(['first', 'random', 'last']).default('first').describe('Your seat'),
      abandonExisting: z.boolean().default(false),
    }),
    async run({ opponents, order, abandonExisting }, context) {
      const game = await api<PracticeView>(context, playRoute, '/api/play', {
        method: 'POST',
        body: {
          type: 'new',
          opponents: await resolveBots(context, opponents),
          order,
          replace: abandonExisting,
          clockConfig: { initialMs: 60000, incrementMs: 1000 },
        },
      });
      return agentGame(game);
    },
  }),
  defineTool({
    name: 'play_move',
    title: 'Play move',
    description:
      'Play your decision in the current game: pass actionIndex from legalActions (preferred) or an explicit action object. All bot replies run before this returns; movesSinceLastCall lists them.',
    input: z
      .object({
        actionIndex: z.number().int().min(0).optional(),
        action: z
          .looseObject({ type: z.enum(['take', 'discard', 'buy', 'reserve', 'noble']) })
          .optional()
          .describe('e.g. {"type":"take","tokens":{"red":1,"blue":1,"green":1}}'),
        gameId: z.string().uuid().optional().describe('Guards against playing in a newer game'),
      })
      .refine(
        (v) => (v.actionIndex === undefined) !== (v.action === undefined),
        'Provide exactly one of actionIndex or action',
      ),
    async run({ actionIndex, action, gameId }, context) {
      let game = await currentGame(context);
      if (!game) throw new Error('You have no unfinished game. Call start_game.');
      if (gameId && gameId !== game.id) throw new Error(`Your current game is ${game.id}`);
      if (game.busy) throw new Error('A move is still being computed; call get_game shortly.');
      // A browser move can leave the bots' replies pending; run them first.
      if (game.pending)
        game = await api<PracticeView>(context, playRoute, '/api/play', {
          method: 'POST',
          body: { type: 'advance', id: game.id, revision: game.revision },
        });
      if (game.view.currentPlayer !== game.humanSeat) throw new Error('It is not your turn');
      const chosen =
        actionIndex === undefined
          ? normalizeAction(action as Record<string, unknown>)
          : game.view.legalActions[actionIndex];
      if (!chosen) throw new Error(`actionIndex must be below ${game.view.legalActions.length}`);
      const next = await api<PracticeView>(context, playRoute, '/api/play', {
        method: 'POST',
        body: { type: 'action', id: game.id, action: chosen, revision: game.revision },
      });
      return agentGame(next);
    },
  }),
  defineTool({
    name: 'abandon_game',
    title: 'Abandon game',
    description:
      'Discard your unfinished practice game. After your third turn this is a rated loss against every bot at the table.',
    input: z.object({ gameId: z.string().uuid().optional() }),
    destructive: true,
    async run({ gameId }, context) {
      const id = gameId ?? (await currentGame(context))?.id;
      if (!id) return { closed: false, reason: 'No unfinished game' };
      return api(context, playRoute, '/api/play', { method: 'POST', body: { type: 'close', id } });
    },
  }),
];
export const SERVER_INFO: ServerInfo = {
  name: 'splendor-lab',
  title: 'Splendor Strategy Lab',
  version: '1.0.0',
  instructions: `Splendor Strategy Lab: write JavaScript/TypeScript Splendor bots, qualify them, benchmark them, and play practice games.
- Writing a bot: read get_bot_guide, then submit_bot and wait on get_bot (waitSeconds) for qualification (four fault-free games vs Random and Greedy).
- Benchmarking: start_evaluation with qualified bot IDs or names, then get_evaluation with waitSeconds; get_evaluation_game shows move logs.
- Playing yourself: start_game, then repeat play_move with an actionIndex from legalActions until status is "finished". One unfinished game per account: get_game resumes it. Games are rated (see get_leaderboard); abandoning after three turns is a loss.
- Limits are enforced per account and per IP. On a rate-limit error wait the stated seconds before retrying; early retries double the block.`,
};
