import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SPLENDOR_DB_PATH = ':memory:';
delete process.env.SPLENDOR_STORAGE;
const { POST, GET } = await import('../app/api/mcp/route');
const { resetRateLimits } = await import('../src/server/rate-limit');

let nextId = 1;
async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  const response = await POST(
    new Request('http://127.0.0.1:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  );
  return { status: response.status, body: await response.json() };
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  assert.ok(body.result, JSON.stringify(body));
  const text = body.result.content[0].text as string;
  const error = Boolean(body.result.isError);
  return { error, text, data: error || !/^[[{]/.test(text) ? null : JSON.parse(text) };
}

test('the MCP endpoint speaks stateless Streamable HTTP JSON-RPC', async () => {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.ok(init.body.result.capabilities.tools);
  assert.match(init.body.result.instructions, /start_game/);
  const fallback = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(fallback.body.result.protocolVersion, '2025-06-18');
  const note = await POST(
    new Request('http://127.0.0.1:3000/api/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }),
  );
  assert.equal(note.status, 202);
  const list = await rpc('tools/list');
  const names = list.body.result.tools.map((t: { name: string }) => t.name);
  for (const n of ['submit_bot', 'start_evaluation', 'start_game', 'play_move', 'get_bot_guide'])
    assert.ok(names.includes(n), n);
  for (const t of list.body.result.tools) assert.equal(t.inputSchema.type, 'object');
  assert.equal((await rpc('tools/call', { name: 'nope' })).body.error.code, -32602);
  assert.equal((await rpc('nope/method')).body.error.code, -32601);
  assert.equal(GET().status, 405);
  const foreign = await rpc('tools/list', undefined, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const guide = await call('get_bot_guide');
  assert.match(guide.text, /SplendorPlayer/);
});

test('an agent plays one game at a time and can resume or abandon it', async () => {
  resetRateLimits();
  assert.deepEqual((await call('get_game')).data, { game: null });
  const started = await call('start_game', { opponents: ['Random'] });
  assert.ok(!started.error, started.text);
  const game = started.data;
  assert.equal(game.yourTurn, true);
  assert.ok(game.legalActions.length > 0);
  assert.equal(game.players.length, 2);

  const second = await call('start_game', { opponents: ['Greedy'] });
  assert.ok(second.error);
  assert.match(second.text, /unfinished game/i);
  assert.match(second.text, new RegExp(game.gameId));

  const resumed = (await call('get_game')).data;
  assert.equal(resumed.gameId, game.gameId);

  const moved = await call('play_move', { actionIndex: 0 });
  assert.ok(!moved.error, moved.text);
  assert.equal(moved.data.gameId, game.gameId);
  assert.deepEqual(
    moved.data.movesSinceLastCall.map((m: { player: string }) => m.player),
    ['You', 'Random'],
  );
  assert.ok(moved.data.revision > game.revision);

  // Compact action objects (zero gems omitted) are accepted too.
  const take = moved.data.legalActions.find((a: { type: string }) => a.type === 'take');
  const { index: _, ...action } = take;
  const explicit = await call('play_move', { action });
  assert.ok(!explicit.error, explicit.text);
  assert.ok((await call('play_move', { actionIndex: 100000 })).error);
  assert.ok((await call('play_move', {})).error, 'one of actionIndex or action is required');

  const replaced = await call('start_game', {
    opponents: ['Greedy', 'Random'],
    order: 'last',
    abandonExisting: true,
  });
  assert.ok(!replaced.error, replaced.text);
  assert.notEqual(replaced.data.gameId, game.gameId);
  assert.equal(replaced.data.yourSeat, 2);
  assert.equal(replaced.data.movesSinceLastCall.length, 2, 'bots opened before the human');
  assert.deepEqual((await call('abandon_game')).data, { closed: true, notices: [] });
  assert.deepEqual((await call('get_game')).data, { game: null });
});

test('finished turns make abandoning a rated loss that reaches the ladder', async () => {
  resetRateLimits();
  let game = (await call('start_game', { opponents: ['Random'] })).data;
  while (game.players[game.yourSeat].turns < 3) {
    const moved = await call('play_move', { actionIndex: 0 });
    assert.ok(!moved.error, moved.text);
    game = moved.data;
  }
  const before = (await call('get_leaderboard')).data;
  const random = before.bots.find((b: { name: string }) => b.name === 'Random');
  const abandoned = (await call('abandon_game')).data;
  assert.equal(abandoned.closed, true);
  assert.match(abandoned.notices[0], /^Ratings: You 1184 \(−16\) · Random \d+ \(\+16\)/);
  const ladder = (await call('get_leaderboard')).data;
  const me = ladder.players.find((p: { you: boolean }) => p.you);
  assert.deepEqual([me.elo, me.games, me.losses], [1184, 1, 1]);
  const after = ladder.bots.find((b: { id: string }) => b.id === random.id);
  assert.equal(after.elo, random.elo + 16);
  assert.equal(after.games, random.games + 1);
  const listed = (await call('list_bots')).data.find((b: { id: string }) => b.id === random.id);
  assert.equal(listed.elo, after.elo);
});

test('agents can benchmark bots and evaluation launches are rate limited', async () => {
  resetRateLimits();
  const bots = (await call('list_bots')).data;
  assert.ok(
    bots.some((b: { name: string; baseline: boolean }) => b.name === 'Greedy' && b.baseline),
  );
  const started = await call('start_evaluation', { bots: ['Random', 'Greedy'], pairs: 1 });
  assert.ok(!started.error, started.text);
  const report = (await call('get_evaluation', { evaluationId: started.data.id, waitSeconds: 45 }))
    .data;
  assert.equal(report.status, 'completed');
  assert.equal(report.leaderboard.length, 2);
  assert.equal(report.games.length, 2);
  // Ranked evaluation games also move the global ladder.
  const ladder = (await call('get_leaderboard')).data;
  assert.ok(
    ladder.bots.some((b: { name: string; games: number }) => b.name === 'Greedy' && b.games >= 2),
  );
  const record = (
    await call('get_evaluation_game', { evaluationId: started.data.id, gameIndex: 0 })
  ).data;
  assert.ok(record.log.length > 0);
  assert.ok(record.log[0].action);
  // Two more launches fit the burst; the fourth is refused with a wait.
  await call('start_evaluation', { bots: ['Random', 'Greedy'] });
  await call('start_evaluation', { bots: ['Random', 'Greedy'] });
  const refused = await call('start_evaluation', { bots: ['Random', 'Greedy'] });
  assert.ok(refused.error);
  assert.match(refused.text, /Rate limit reached for evaluation-create\. Retry in \d+s/);
  resetRateLimits();
});
