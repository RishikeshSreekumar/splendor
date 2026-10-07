'use client';
import { useEffect, useState } from 'react';
import { api, ErrorNotice, errorMessage } from './ui';
interface Ladder {
  bots: {
    id: string;
    name: string;
    baseline: boolean;
    mine: boolean;
    elo: number;
    games: number;
    createdAt: string;
  }[];
  players: {
    name: string;
    you: boolean;
    elo: number;
    games: number;
    wins: number;
    draws: number;
    losses: number;
  }[];
  me: { elo: number; games: number } | null;
}
/** The global Elo ladder for bots and human players. */
export function LadderView() {
  const [ladder, setLadder] = useState<Ladder>(),
    [error, setError] = useState('');
  useEffect(() => {
    api<Ladder>('/api/ratings')
      .then(setLadder)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <>
      <div className="page-heading compact">
        <div className="eyebrow">GLOBAL LADDER</div>
        <h1>Every rating, one ladder.</h1>
      </div>
      <p className="muted ladder-intro">
        Everyone starts at 1200. Ranked evaluation games and practice games move bots and players on
        this one ladder. Larger tables split each game&apos;s K factor of 32 across opponents. Past
        a 500-point gap, the favourite gains nothing and the underdog loses nothing. Abandoning a
        practice game after your third turn counts as a loss.
      </p>
      <ErrorNotice error={error} />
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="step-label">BOTS</span>
            <h2>Bot ratings</h2>
          </div>
          <span className="muted">
            {ladder ? `${ladder.bots.length} qualified bots` : 'Loading…'}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Bot</th>
                <th>Elo</th>
                <th>Rated games</th>
              </tr>
            </thead>
            <tbody>
              {ladder?.bots.map((b, i) => (
                <tr key={b.id}>
                  <td className="mono">{i + 1}</td>
                  <td>
                    <strong>{b.name}</strong>
                    <span className="table-sub">
                      {b.baseline ? 'Public baseline' : b.mine ? 'Your bot' : 'Public bot'} ·{' '}
                      {b.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="rating">{b.elo}</td>
                  <td>{b.games || 'Unrated'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="step-label">PLAYERS</span>
            <h2>Player ratings</h2>
          </div>
          <span className="muted">
            {ladder?.me ? `Your rating ${ladder.me.elo} · ${ladder.me.games} games · ` : ''}
            Top 100 · names are pseudonymous
          </span>
        </div>
        {ladder?.players.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Elo</th>
                  <th>Games</th>
                  <th>W · D · L</th>
                </tr>
              </thead>
              <tbody>
                {ladder.players.map((p, i) => (
                  <tr key={`${p.name}-${i}`} className={p.you ? 'ladder-you' : undefined}>
                    <td className="mono">{i + 1}</td>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="rating">{p.elo}</td>
                    <td>{p.games}</td>
                    <td className="mono">
                      {p.wins} · {p.draws} · {p.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No rated players yet. Finish a practice game to join the ladder.</p>
        )}
      </section>
    </>
  );
}
