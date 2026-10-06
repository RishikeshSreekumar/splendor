'use client';
import { useEffect, useState } from 'react';
import { Play, ArrowRight, RotateCcw } from 'lucide-react';
import type { PracticeView } from '@/src/server/practice';
import type { Action } from '@/src/types';
import { Board } from './board';
import { api, actionLabel, ErrorNotice, errorMessage } from './ui';
export function Practice() {
  const [session, setSession] = useState<PracticeView>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const sessionId = session?.id;
  useEffect(
    () => () => {
      if (sessionId) void api('/api/play', { type: 'close', id: sessionId }).catch(() => {});
    },
    [sessionId],
  );
  const [type, setType] = useState<Action['type']>('take'),
    [choice, setChoice] = useState('');
  async function start() {
    setBusy(true);
    setError('');
    try {
      if (session) await api('/api/play', { type: 'close', id: session.id });
      setSession(
        await api('/api/play', {
          type: 'new',
          clockConfig: { initialMs: 60000, incrementMs: 1000 },
        }),
      );
      setChoice('');
      setType('take');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function move() {
    if (!session) return;
    const action = choices.find((a) => JSON.stringify(a) === choice) ?? choices[0];
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      setSession(
        await api('/api/play', {
          type: 'action',
          id: session.id,
          action,
          revision: session.revision,
        }),
      );
      setChoice('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const phase = session?.view.phase;
  const actions = session?.view.legalActions ?? [];
  const choices = actions.filter((a) => (phase === 'main' ? a.type === type : true));
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            <span /> THE PRACTICE TABLE
          </div>
          <h1>Learn by making moves.</h1>
          <p>Your seat is untimed. Greedy plays with its own 60 + 1 clock.</p>
        </div>
        {session && (
          <button className="button secondary" onClick={start} disabled={busy}>
            <RotateCcw size={16} />
            New game
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {!session ? (
        <div className="panel practice-welcome">
          <span className="large-gem">◇</span>
          <h2>A seat at the table.</h2>
          <p>
            Collect gems. Build permanent discounts. Attract nobles.
            <br />
            Reach 15 points to trigger the final round.
          </p>
          <button className="button primary" onClick={start} disabled={busy}>
            <Play size={16} />
            Play against Greedy
            <ArrowRight size={16} />
          </button>
          <p className="fine-print">
            Two-player vanilla Splendor · All actions checked by the rules engine
          </p>
        </div>
      ) : (
        <>
          <div className="game-status">
            <span>ROUND {Math.floor(session.view.turn / 2) + 1}</span>
            <strong>
              {session.view.status === 'finished'
                ? session.view.winners.length > 1
                  ? 'Shared victory'
                  : session.view.winners.includes(0)
                    ? 'You won. Well played.'
                    : 'Greedy wins this game.'
                : busy
                  ? 'Greedy is thinking…'
                  : phase === 'discard'
                    ? 'Return excess tokens to finish your turn'
                    : phase === 'noble'
                      ? 'Choose your visiting noble'
                      : 'Your turn'}
            </strong>
            <span>{session.view.finalRound ? 'FINAL ROUND' : 'PRACTICE'}</span>
          </div>
          {session.notices.map((n) => (
            <div className="notice" key={n}>
              {n}
            </div>
          ))}
          <Board view={session.view} humanSeat={0} />
          {session.view.status === 'playing' && (
            <section className="panel action-panel">
              <div>
                <span className="step-label">MAKE YOUR MOVE</span>
                <h2>
                  {phase === 'main'
                    ? 'Choose an action'
                    : phase === 'discard'
                      ? 'Return to ten tokens'
                      : 'Receive a noble'}
                </h2>
              </div>
              {phase === 'main' && (
                <div className="segmented action-tabs">
                  {(['take', 'buy', 'reserve'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setType(t);
                        setChoice('');
                      }}
                      className={type === t ? 'current' : ''}
                    >
                      {t === 'take' ? 'Take gems' : t === 'buy' ? 'Buy a card' : 'Reserve'}
                    </button>
                  ))}
                </div>
              )}
              <div className="action-controls">
                <label className="sr-only" htmlFor="legal-action">
                  Legal action
                </label>
                <select
                  id="legal-action"
                  disabled={busy || !choices.length}
                  value={choice || JSON.stringify(choices[0]) || ''}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  {choices.length ? (
                    choices.map((a) => (
                      <option key={JSON.stringify(a)} value={JSON.stringify(a)}>
                        {actionLabel(a)}
                      </option>
                    ))
                  ) : (
                    <option value="">No legal {type} actions available</option>
                  )}
                </select>
                <button
                  className="button primary"
                  disabled={busy || !choices.length}
                  onClick={move}
                >
                  Play move
                  <ArrowRight size={16} />
                </button>
              </div>
              <p className="fine-print">
                Only legal choices are shown. Gold payment alternatives appear separately when
                available.
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
