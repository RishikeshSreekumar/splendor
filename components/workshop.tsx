'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserAuth } from '@/src/client-auth';
import { ArrowRight, CheckCircle2, Code2, Upload, Save } from 'lucide-react';
import type { StoredBot } from '@/src/server/store';
import { api, ErrorNotice, errorMessage } from './ui';
const starter = `import { SplendorPlayer } from 'splendor';

export default class MyPlayer extends SplendorPlayer {
  chooseAction(view) {
    // Helpers keep the rules out of your strategy code.
    const buys = this.getLegalActions(view, 'buy');
    if (buys.length) return buys[0];

    // Also handles required discards and noble choices.
    return this.chooseRandomAction(view);
  }
}
`;
export function Workshop() {
  const [authState, setAuthState] = useState<
    'loading' | 'signed-in' | 'signed-out' | 'unavailable'
  >('loading');
  const [apiKey, setApiKey] = useState('');
  const [files, setFiles] = useState<{ path: string; content: string }[]>([]);
  const [source, setSource] = useState(starter),
    [name, setName] = useState('My first player'),
    [bots, setBots] = useState<StoredBot[]>([]),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    browserAuth()
      .then((client) => {
        if (!active) return;
        if (!client) {
          setAuthState('unavailable');
          return;
        }
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          setAuthState(session ? 'signed-in' : 'signed-out');
          if (!session) setApiKey('');
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch((e) => {
        if (!active) return;
        setAuthState('unavailable');
        setError(errorMessage(e));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    api<StoredBot[]>('/api/bots')
      .then(setBots)
      .catch((e) => setError(errorMessage(e)));
    const timer = setInterval(
      () =>
        api<StoredBot[]>('/api/bots')
          .then(setBots)
          .catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, []);
  async function save() {
    if (authState !== 'signed-in') {
      setError('Sign in to submit a bot.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const b = await api<StoredBot>('/api/bots', {
        name,
        secrets: apiKey ? { API_KEY: apiKey } : {},
        ...(files.length
          ? { files: files.map((f) => (f.path === 'index.ts' ? { ...f, content: source } : f)) }
          : { source }),
      });
      setApiKey('');
      setSaved(
        `Saved version ${b.sourceHash.slice(0, 8)}. ${b.qualification === 'pending' ? 'Qualification is running in a 512 MiB sandbox.' : b.qualification === 'failed' ? 'Qualification failed. Review the error in your library.' : 'Four-game qualification passed.'}`,
      );
      setBots(await api('/api/bots'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            <span /> THE BOT WORKSHOP
          </div>
          <h1>Your ideas. Your player.</h1>
          <p>Start simple, study the replay, then make your next move better.</p>
        </div>
        <Code2 size={48} className="heading-icon" />
      </div>
      <ErrorNotice error={error} />
      {authState === 'signed-out' && (
        <p className="notice" role="status">
          You can explore the workshop and study public bots. Sign in or create an account to submit
          your player.
        </p>
      )}
      {saved && (
        <div role="status" className="notice success">
          <CheckCircle2 size={18} />
          {saved}
        </div>
      )}
      <div className="workshop-grid">
        <section className="panel code-panel">
          <div className="panel-heading">
            <h2>Player implementation</h2>
            <label className="upload-button">
              <Upload size={15} /> Import file
              <input
                type="file"
                accept=".js,.mjs,.ts,text/javascript"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 131072) {
                    setError('Source must be at most 128 KiB');
                    return;
                  }
                  setFiles([]);
                  setSource(await f.text());
                  setSaved('');
                }}
              />
            </label>
          </div>
          <label className="upload-button">
            <Upload size={15} /> Import folder
            <input
              type="file"
              aria-label="Import bot folder"
              {...{ webkitdirectory: '', directory: '' }}
              multiple
              onChange={async (e) => {
                try {
                  const selected = Array.from(e.target.files ?? []);
                  if (!selected.length) return;
                  if (
                    selected.length > 64 ||
                    selected.reduce((n, f) => n + f.size, 0) > 1024 * 1024
                  )
                    throw new Error(
                      'Use at most 64 files and 1 MiB. Exclude node_modules and build output.',
                    );
                  const project = await Promise.all(
                    selected.map(async (f) => ({
                      path: f.webkitRelativePath.split('/').slice(1).join('/'),
                      content: await f.text(),
                    })),
                  );
                  const entry = project.find((f) => f.path === 'index.ts');
                  if (!entry) throw new Error('The folder needs index.ts at its root');
                  setFiles(project);
                  setSource(entry.content);
                  setSaved('');
                  setError('');
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            />
          </label>
          {files.length > 0 && (
            <p className="fine-print">
              {files.length} project files: {files.map((f) => f.path).join(', ')}. Edit index.ts
              below.
            </p>
          )}
          <label className="field-label">
            Bot name
            <input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field-label">
            Private API key (optional)
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <p className="fine-print">
            Read this key with <code>this.getSecret(&apos;API_KEY&apos;)</code>. It is encrypted
            separately from source. Bots with keys are private and only you can run them; provider
            usage is billed to your key. Enter it again when saving another version.
          </p>
          <div className="editor-top">
            <span className="mono">index.ts</span>
            <span>TypeScript / JavaScript · ES module</span>
          </div>
          <textarea
            className="code-editor"
            aria-label="Bot entrypoint source"
            spellCheck={false}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setSaved('');
            }}
          />
          <div className="editor-bottom">
            <span>
              {authState === 'unavailable'
                ? 'Bot submissions require configured account sign-in.'
                : 'Each save preserves an immutable version.'}
            </span>
            {authState === 'signed-out' ? (
              <Link className="button primary" href="/account">
                Sign in to submit
              </Link>
            ) : (
              <button
                className="button primary"
                disabled={busy || authState !== 'signed-in'}
                onClick={save}
              >
                <Save size={16} />
                {authState === 'loading'
                  ? 'Checking sign-in…'
                  : busy
                    ? 'Checking…'
                    : 'Check & save'}
              </button>
            )}
          </div>
        </section>
        <aside>
          <section className="panel">
            <span className="step-label">THE PLAYER CONTRACT</span>
            <h2>
              A small API.
              <br />
              Room to think.
            </h2>
            <p className="muted">
              Extend <code>SplendorPlayer</code> and return one of the legal actions from{' '}
              <code>chooseAction(view)</code>.
            </p>
            <ul className="helper-list">
              {[
                'getSelf(view)',
                'getLegalActions(view, type?)',
                'getBonuses(player)',
                'getCost(card, player)',
                'getPayments(card, player)',
                'canAfford(card, player)',
                'getAffordableCards(view)',
                'getEligibleNobles(view)',
                'chooseRandomAction(view)',
              ].map((x) => (
                <li key={x}>
                  <code>{x}</code>
                </li>
              ))}
            </ul>
            <p className="fine-print">
              Folders must contain index.ts and only .ts, .js, .mjs, or .json files. Relative
              imports and the splendor SDK are supported; npm installs are disabled. Async returns
              are supported. Outbound HTTPS is available through await fetch(). All request waiting
              counts against your clock. Read your remaining time from <code>view.clock</code>.
            </p>
          </section>
        </aside>
      </div>
      <section className="section-block">
        <div className="section-heading">
          <h2>Your bot library</h2>
          <span className="muted">{bots.length} available versions</span>
        </div>
        <div className="library-grid">
          {bots.map((b) => (
            <button
              key={b.id}
              className="panel library-card"
              onClick={async () => {
                try {
                  const detail = await api<
                    StoredBot & { files?: { path: string; content: string }[] }
                  >(`/api/bots/${b.id}`);
                  setFiles(detail.files ?? []);
                  setApiKey('');
                  setSource(
                    detail.files?.find((f) => f.path === 'index.ts')?.content ?? detail.source,
                  );
                  setName(b.baseline ? `${b.name} variation` : b.name);
                  setSaved('');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              <span className="tiny-label">
                {b.baseline
                  ? 'PUBLIC BASELINE'
                  : b.privateExecution
                    ? 'PRIVATE / API KEY'
                    : 'YOUR SUBMISSION'}
              </span>
              <h3>{b.name}</h3>
              <span>
                {b.qualification ?? 'local'}
                {b.qualificationError ? `: ${b.qualificationError}` : ''}
              </span>
              <span className="mono muted">{b.sourceHash.slice(0, 12)}</span>
              <span className="text-link">
                Study this player <ArrowRight size={15} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
