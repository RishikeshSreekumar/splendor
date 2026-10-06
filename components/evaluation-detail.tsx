'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Trophy } from 'lucide-react';
import type { EvaluationJob, StoredBot } from '@/src/server/store';
import type { GameEvent, GameRecord, Observation } from '@/src/types';
import { api, actionLabel, ErrorNotice, errorMessage } from './ui';
import { GameTable } from './table/game-table';
interface ReplayData {
  game: GameRecord;
  frames: { view: Observation; event: GameEvent | null }[];
  names: string[];
}
export function EvaluationDetail({ id }: { id: string }) {
  const [job, setJob] = useState<EvaluationJob>(),
    [bots, setBots] = useState<StoredBot[]>([]),
    [error, setError] = useState('');
  const [replay, setReplay] = useState<ReplayData>(),
    [frame, setFrame] = useState(0),
    [gameIndex, setGameIndex] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let finished = false;
    const refresh = () => {
      if (finished) return;
      return api<EvaluationJob>(`/api/evaluations/${id}`)
        .then((j) => {
          if (!cancelled) setJob(j);
          finished = j.status === 'completed' || j.status === 'failed';
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    };
    refresh();
    api<StoredBot[]>('/api/bots')
      .then((b) => {
        if (!cancelled) setBots(b);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    const timer = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id]);
  async function loadReplay(index: number) {
    setLoading(true);
    setError('');
    try {
      const r = await api<ReplayData>(`/api/evaluations/${id}/games/${index}`);
      setReplay(r);
      setFrame(0);
      setGameIndex(index);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? id.slice(0, 8);
  const current = replay?.frames[frame];
  function download() {
    if (!job?.report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(job.report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `splendor-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <Link href="/" className="text-link">
        <ArrowLeft size={15} />
        Back to the arena
      </Link>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            <span /> EVALUATION / {id.slice(0, 8)}
          </div>
          <h1>Every move tells a story.</h1>
          <p>
            {job
              ? `${job.completedGames} of ${job.totalGames} games · ${job.config.clockConfig.initialMs / 1000} + ${job.config.clockConfig.incrementMs / 1000} per bot`
              : 'Loading evaluation…'}
          </p>
        </div>
        {job?.report && (
          <button className="button secondary" onClick={download}>
            <Download size={16} />
            Export replays
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {job?.error && <ErrorNotice error={job.error} />}
      <span className={`job-status ${job?.status ?? 'queued'}`}>{job?.status ?? 'loading'}</span>
      {job && !job.report && (
        <div className="panel progress-panel">
          <h2>
            {job.status === 'failed'
              ? 'This evaluation could not finish.'
              : 'The contenders are at the table.'}
          </h2>
          <p className="muted">
            Results and replay seeds are released together after the complete evaluation.
          </p>
          <progress value={job.completedGames} max={job.totalGames} />
        </div>
      )}
      {job?.report && (
        <>
          <section className="section-block">
            <div className="section-heading">
              <h2>
                <Trophy size={20} /> Benchmark standings
              </h2>
              <span className="muted">Ratings reset to 1200 for this cohort</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Elo</th>
                    <th>W / D / L</th>
                    <th>Rated games</th>
                    <th>Faults</th>
                    <th>Assisted</th>
                  </tr>
                </thead>
                <tbody>
                  {job.report.leaderboard.map((r, i) => (
                    <tr key={r.id}>
                      <td>
                        <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                        <strong>{name(r.id)}</strong>
                        <span className="table-sub">
                          {r.provisional ? 'Provisional' : 'Established'} ·{' '}
                          {r.sourceHash.slice(0, 8)}
                        </span>
                      </td>
                      <td className="rating">{Math.round(r.elo)}</td>
                      <td>
                        {r.wins} / {r.draws} / {r.losses}
                      </td>
                      <td>{r.ratedGames}</td>
                      <td>{r.faults}</td>
                      <td>{r.assistedDecisions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="section-block">
            <div className="section-heading">
              <h2>Replay a game</h2>
              <span className="muted">State hashes verified on load</span>
            </div>
            <div className="replay-select">
              <label htmlFor="game-choice">Game</label>
              <select
                id="game-choice"
                value={gameIndex}
                onChange={(e) => setGameIndex(Number(e.target.value))}
              >
                {job.report.games.map((g, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {g.bots.map((b) => name(b.id)).join(' vs ')} · {g.scores.join(' : ')} ·{' '}
                    {g.result.reason}
                  </option>
                ))}
              </select>
              <button
                className="button primary"
                disabled={loading}
                onClick={() => loadReplay(gameIndex)}
              >
                {loading ? 'Loading…' : 'Open replay'}
              </button>
            </div>
            {replay && current && (
              <>
                <div className="replay-controls">
                  <button
                    className="icon-button"
                    aria-label="Previous decision"
                    disabled={frame === 0}
                    onClick={() => setFrame((f) => f - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <input
                    type="range"
                    aria-label="Replay decision"
                    min={0}
                    max={replay.frames.length - 1}
                    value={frame}
                    onChange={(e) => setFrame(Number(e.target.value))}
                  />
                  <button
                    className="icon-button"
                    aria-label="Next decision"
                    disabled={frame === replay.frames.length - 1}
                    onClick={() => setFrame((f) => f + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                  <span className="mono">
                    {frame} / {replay.frames.length - 1}
                  </span>
                </div>
                <div className={`replay-caption ${current.event?.kind === 'fault' ? 'error' : ''}`}>
                  {current.event
                    ? current.event.kind === 'action'
                      ? `${replay.names[current.event.seat]}: ${actionLabel(current.event.action)}${current.event.assisted ? ' · ASSISTED' : ''} · ${current.event.elapsedMs.toFixed(1)} ms`
                      : `${replay.names[current.event.seat]}: ${current.event.code}`
                    : 'The opening position. Each player starts with a fresh clock.'}
                </div>
                <GameTable
                  view={current.view}
                  seats={replay.names.map((name) => ({ name, kind: 'bot' as const }))}
                  actingSeat={current.event?.seat ?? null}
                  actingLabel={
                    current.event?.kind === 'action'
                      ? actionLabel(current.event.action)
                      : current.event?.code
                  }
                />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
