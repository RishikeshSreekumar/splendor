'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Clock3,
  Gem,
  Play,
  ShieldCheck,
  Plus,
  Check,
  LoaderCircle,
} from 'lucide-react';
import type { StoredBot, EvaluationJob } from '@/src/server/store';
import type { ClockConfig, Mode } from '@/src/types';
import { api, ClockFields, ErrorNotice, errorMessage } from './ui';
import { evaluationGameCount, tableSize } from '@/src/fixtures';
export function Arena() {
  const [bots, setBots] = useState<StoredBot[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [jobs, setJobs] = useState<EvaluationJob[]>([]),
    [clock, setClock] = useState<ClockConfig>({ initialMs: 60000, incrementMs: 1000 });
  const [pairs, setPairs] = useState(3),
    [mode, setMode] = useState<Mode>('ranked'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api<StoredBot[]>('/api/bots'), api<EvaluationJob[]>('/api/evaluations')])
      .then(([b, j]) => {
        if (!cancelled) {
          setBots(b.filter((bot) => !bot.qualification || bot.qualification === 'passed'));
          const baselineNames = new Set<string>();
          setSelected(
            b
              .filter((bot) => {
                if (!bot.baseline || baselineNames.has(bot.name)) return false;
                baselineNames.add(bot.name);
                return true;
              })
              .map((bot) => bot.id),
          );
          setJobs(j);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    const timer = setInterval(() => {
      api<EvaluationJob[]>('/api/evaluations')
        .then((j) => {
          if (!cancelled) setJobs(j);
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  async function start() {
    setBusy(true);
    setError('');
    try {
      const job = await api<EvaluationJob>('/api/evaluations', {
        botIds: selected,
        pairs,
        mode,
        clockConfig: clock,
      });
      setJobs((j) => [job, ...j]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const gameCount = evaluationGameCount(selected.length, pairs),
    shared = tableSize(selected.length) > 2;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> THE EVALUATION ARENA
          </div>
          <h1>
            A better move
            <br />
            starts with a test<span className="accent">.</span>
          </h1>
          <p>
            Put your strategy at the table. Compare bots, examine decisions,
            <br className="desktop-only" /> and discover what makes a winning player.
          </p>
        </div>
        <div className="hero-gems" aria-hidden="true">
          <Gem />
          <Gem />
          <Gem />
        </div>
      </div>
      <div className="principles">
        <span>
          <ShieldCheck size={17} /> Original Splendor rules
        </span>
        <span>
          <Clock3 size={17} /> One independent clock per bot
        </span>
        <span>
          <Gem size={17} /> Fresh deals, swapped seats
        </span>
      </div>
      <ErrorNotice error={error} />
      <div className="arena-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="step-label">01 / THE PLAYERS</span>
              <h2>Choose your contenders</h2>
            </div>
            <Link className="text-link" href="/bots">
              <Plus size={16} /> Add a bot
            </Link>
          </div>
          <p className="muted">Select 2–6 bot versions. Every contender meets every other.</p>
          <div className="bot-list">
            {!loaded && !error && <p className="muted">Loading your bot library…</p>}
            {bots.map((b, i) => (
              <button
                type="button"
                key={b.id}
                aria-pressed={selected.includes(b.id)}
                className={`bot-option ${selected.includes(b.id) ? 'selected' : ''}`}
                onClick={() =>
                  setSelected((s) =>
                    s.includes(b.id) ? s.filter((id) => id !== b.id) : [...s, b.id],
                  )
                }
              >
                <span className={`bot-avatar tone-${i % 4}`}>
                  <Gem size={23} />
                </span>
                <span className="bot-info">
                  <strong>{b.name}</strong>
                  <span>
                    {b.baseline ? 'Public baseline' : 'Your submission'} <b>·</b>{' '}
                    <span className="bot-elo">Elo {Math.round(b.elo ?? 1200)}</span> <b>·</b>{' '}
                    {b.sourceHash.slice(0, 8)}
                  </span>
                </span>
                <span className="checkbox">{selected.includes(b.id) && <Check size={14} />}</span>
              </button>
            ))}
          </div>
          <div className="inset-note">
            <span>Equal conditions. Useful comparisons.</span>
            <p>
              {shared
                ? 'Four or more bots play together at four-player tables, every bot in every seat once, each game a fresh deal with independent clocks.'
                : 'Each pairing uses two fresh deals, with starting positions reversed and independent clocks.'}
            </p>
          </div>
        </section>
        <section className="panel setup-panel">
          <span className="step-label">02 / THE CONDITIONS</span>
          <h2>Set the experiment</h2>
          <div className="segmented" aria-label="Evaluation mode">
            {(['ranked', 'practice'] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                className={mode === m ? 'current' : ''}
                onClick={() => setMode(m)}
              >
                {m === 'ranked' ? 'Strict evaluation' : 'Assisted practice'}
              </button>
            ))}
          </div>
          <ClockFields config={clock} onChange={setClock} />
          <p className="fine-print">
            Time is added once per complete turn. Discards and noble choices use the same clock.
          </p>
          <label className="field-label">
            {shared ? 'Rounds per table' : 'Paired fixtures per opponent'}
            <input
              type="number"
              min={1}
              max={10}
              value={pairs}
              onChange={(e) => setPairs(Number(e.target.value))}
            />
          </label>
          <div className="run-summary">
            <span>
              {gameCount} games <b>·</b> {selected.length} bots
            </span>
            <span>
              {clock.initialMs / 1000}s + {clock.incrementMs / 1000}s
            </span>
          </div>
          <button
            className="button primary wide"
            disabled={busy || selected.length < 2 || selected.length > 6}
            onClick={start}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <Play size={16} />} Run evaluation{' '}
            <ArrowRight size={17} />
          </button>
          <p className="fine-print">
            {mode === 'ranked'
              ? 'Invalid moves and clock expiry forfeit the game. The report rates this cohort; every ranked game also updates each bot’s global Elo.'
              : 'Invalid moves receive a logged legal fallback. Assisted games never affect Elo.'}
          </p>
        </section>
      </div>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="step-label">YOUR EXPERIMENTS</span>
            <h2>Evaluation history</h2>
          </div>
          <span className="muted">Saved evaluations</span>
        </div>
        {jobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evaluation</th>
                  <th>Mode</th>
                  <th>Time control</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <strong>
                        {new Date(j.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </strong>
                      <span className="table-sub">{j.id.slice(0, 8)}</span>
                    </td>
                    <td>{j.config.mode}</td>
                    <td className="mono">
                      {j.config.clockConfig.initialMs / 1000} +{' '}
                      {j.config.clockConfig.incrementMs / 1000}
                    </td>
                    <td>
                      {j.status === 'completed' ? (
                        <span className="table-progress">{j.completedGames} games</span>
                      ) : j.status === 'running' && j.completedGames > 0 ? (
                        <span className="table-progress">
                          <progress value={j.completedGames} max={j.totalGames} />
                          {j.completedGames} / {j.totalGames}
                        </span>
                      ) : (
                        <span className="table-progress muted">{j.totalGames} games</span>
                      )}
                    </td>
                    <td>
                      <span className={`job-status ${j.status}`}>{j.status}</span>
                    </td>
                    <td>
                      <Link href={`/evaluations/${j.id}`} className="text-link">
                        Open <ArrowRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <FlaskIcon />
            <h3>Your first experiment starts here.</h3>
            <p>
              Choose a pair of bots above. Every completed evaluation
              <br />
              will include ratings, outcomes, and a move-by-move replay.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
function FlaskIcon() {
  return (
    <span className="empty-icon">
      <Gem size={25} />
    </span>
  );
}
