import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine';
import { placements, rateGames, recordRanks, type Rating } from '../src/ratings';
import { LabStore } from '../src/server/store';
import type { GameRecord } from '../src/types';

const bot = (id: string) => ({ kind: 'bot' as const, id });
const total = (m: Map<string, Rating>) => [...m.values()].reduce((n, r) => n + r.elo, 0);

test('placements rank by points, then fewer cards, with forfeits last', () => {
  const s = structuredClone(createGame({ players: 4, seed: 'rank' }));
  // c08 is worth 1 point; c01 and c02 are worth none.
  s.players[0].cards = ['c08'];
  s.players[1].cards = ['c08'];
  s.players[2].cards = ['c08', 'c01'];
  s.players[3].cards = ['c02'];
  // Seats 0 and 1 tie exactly; seat 2 has as many points but one more card.
  assert.deepEqual(placements(s), [0, 0, 2, 3]);
  // Seat 1 forfeited first, then seat 0: both rank below every live seat.
  assert.deepEqual(placements(s, [1, 0]), [2, 3, 0, 1]);
  const legacy = {
    result: { winners: [1], reason: 'completed' },
    bots: [{}, {}],
  } as unknown as GameRecord;
  assert.deepEqual(recordRanks(legacy), [1, 0]);
});

test('multiplayer games are zero-sum and weigh as much as one 1v1 game', () => {
  const ratings = new Map<string, Rating>();
  rateGames(ratings, [{ participants: ['a', 'b', 'c', 'd'].map(bot), ranks: [0, 1, 2, 3] }]);
  assert.ok(Math.abs(total(ratings) - 4800) < 1e-9);
  const a = ratings.get('bot:a')!,
    d = ratings.get('bot:d')!;
  // 3 wins against equal opponents at K = 32/3 each: +16, like one 1v1 win.
  assert.ok(Math.abs(a.elo - 1216) < 1e-9);
  assert.ok(Math.abs(d.elo - 1184) < 1e-9);
  assert.deepEqual([a.wins, a.losses, d.wins, d.losses], [1, 0, 0, 1]);
  const tie = new Map<string, Rating>();
  rateGames(tie, [{ participants: ['a', 'b'].map(bot), ranks: [0, 0] }]);
  assert.equal(tie.get('bot:a')!.draws, 1);
  assert.equal(tie.get('bot:a')!.elo, 1200);
});

test('an abandoned game is the human loss against each bot and never moves bots among themselves', () => {
  const ratings = new Map<string, Rating>();
  rateGames(ratings, [
    {
      participants: [{ kind: 'user', id: 'u' }, bot('x'), bot('y')],
      ranks: [1, 0, 0],
      focus: 0,
    },
  ]);
  const u = ratings.get('user:u')!,
    x = ratings.get('bot:x')!,
    y = ratings.get('bot:y')!;
  assert.ok(u.elo < 1200);
  assert.equal(x.elo, y.elo);
  assert.ok(Math.abs(u.elo + x.elo + y.elo - 3600) < 1e-9);
  assert.deepEqual([u.losses, x.wins, y.wins, x.draws], [1, 1, 1, 0]);
});

test('a game cannot widen a gap beyond 500 points', () => {
  const ratings = new Map<string, Rating>();
  rateGames(ratings, [{ participants: [bot('weak')], ranks: [0] }]);
  ratings.set('bot:strong', {
    ...ratings.get('bot:weak')!,
    key: 'bot:strong',
    subjectId: 'strong',
    elo: 1800,
  });
  rateGames(ratings, [{ participants: [bot('strong'), bot('weak')], ranks: [0, 1] }]);
  assert.equal(ratings.get('bot:strong')!.elo, 1800);
  assert.equal(ratings.get('bot:weak')!.elo, 1200);
  rateGames(ratings, [{ participants: [bot('strong'), bot('weak')], ranks: [1, 0] }]);
  assert.ok(ratings.get('bot:weak')!.elo > 1200, 'upsets still count');
});

test('a bot seated twice is only compared with the other players', () => {
  const ratings = new Map<string, Rating>();
  rateGames(ratings, [
    { participants: [{ kind: 'user', id: 'u' }, bot('g'), bot('g')], ranks: [0, 1, 2] },
  ]);
  assert.equal(ratings.get('bot:g')!.games, 1);
  assert.ok(Math.abs(ratings.get('user:u')!.elo + ratings.get('bot:g')!.elo - 2400) < 1e-9);
});

test('the local store applies each rating source exactly once', () => {
  const store = new LabStore(':memory:');
  try {
    const games = [{ participants: [bot('a'), bot('b')], ranks: [0, 1] }];
    const changes = store.applyRatings('evaluation:1', games)!;
    assert.equal(changes.length, 2);
    assert.equal(store.applyRatings('evaluation:1', games), null);
    store.applyRatings('evaluation:2', games);
    const [a] = store.ratings(['bot:a']);
    assert.equal(a.games, 2);
    assert.ok(a.elo > 1216);
  } finally {
    store.close();
  }
});
