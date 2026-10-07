'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { authHeaders } from '@/src/client-auth';
import { ErrorNotice, errorMessage } from './ui';
interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}
async function tokens<T>(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch('/api/tokens', {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result as T;
}
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');
/** Personal access tokens and setup snippets for Claude Code, Codex and other MCP clients. */
export function McpAccess() {
  const [list, setList] = useState<ApiToken[]>([]),
    [name, setName] = useState('Claude Code'),
    [created, setCreated] = useState(''),
    [copied, setCopied] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => 'https://splendor.sudipmondal.co.in',
  );
  const refresh = useCallback(
    () =>
      tokens<ApiToken[]>('GET')
        .then(setList)
        .catch((e) => setError(errorMessage(e))),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      setCreated((await tokens<{ token: string }>('POST', { name })).token);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm('Revoke this token? Clients using it stop working immediately.')) return;
    setError('');
    try {
      await tokens('DELETE', { id });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const token = created || '<your token>';
  const url = `${origin}/api/mcp`;
  const snippets = [
    {
      label: 'Claude Code',
      text: `claude mcp add --transport http splendor ${url} --header "Authorization: Bearer ${token}"`,
    },
    {
      label: 'Codex (~/.codex/config.toml, then export SPLENDOR_TOKEN)',
      text: `[mcp_servers.splendor]\nurl = "${url}"\nbearer_token_env_var = "SPLENDOR_TOKEN"`,
    },
    {
      label: 'Other clients (Streamable HTTP)',
      text: `{"mcpServers":{"splendor":{"type":"http","url":"${url}","headers":{"Authorization":"Bearer ${token}"}}}}`,
    },
  ];
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setError('Copy failed; select the text instead.');
    }
  }
  return (
    <section className="panel mcp-access">
      <h2>AI agent access (MCP)</h2>
      <p className="muted">
        Connect Claude, Codex or any MCP client to write and submit bots, run evaluations, and play
        practice games as you. Tokens carry your account&apos;s permissions and limits: one
        unfinished game at a time and rate-limited evaluations.
      </p>
      <ErrorNotice error={error} />
      <div className="mcp-create">
        <label className="field-label">
          Token name
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="button primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? 'Creating…' : 'Create token'}
        </button>
      </div>
      {created && (
        <div role="status" className="notice success">
          <p>Copy this token now. It is shown only once.</p>
          <code className="mcp-secret">{created}</code>{' '}
          <button className="button secondary" onClick={() => copy(created, 'token')}>
            {copied === 'token' ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {snippets.map((s) => (
        <div key={s.label} className="mcp-snippet">
          <div className="mcp-snippet-head">
            <span className="step-label">{s.label.toUpperCase()}</span>
            <button className="text-button" onClick={() => copy(s.text, s.label)}>
              {copied === s.label ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre>
            <code>{s.text}</code>
          </pre>
        </div>
      ))}
      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Token</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                  </td>
                  <td className="mono">{t.prefix}…</td>
                  <td>{date(t.createdAt)}</td>
                  <td>{date(t.lastUsedAt)}</td>
                  <td>
                    <button className="text-button danger" onClick={() => revoke(t.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
