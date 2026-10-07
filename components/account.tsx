'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { browserAuth } from '@/src/client-auth';
import { ErrorNotice, errorMessage } from './ui';
import { McpAccess } from './mcp-access';
export function Account() {
  const router = useRouter();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [current, setCurrent] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [cloud, setCloud] = useState(true);
  useEffect(() => {
    let unsubscribe = () => {};
    browserAuth()
      .then(async (c) => {
        if (!c) {
          setCloud(false);
          return;
        }
        setCurrent((await c.auth.getUser()).data.user?.email ?? '');
        unsubscribe = c.auth.onAuthStateChange((_e, s) => setCurrent(s?.user.email ?? '')).data
          .subscription.unsubscribe;
      })
      .catch((e) => setError(errorMessage(e)));
    return () => unsubscribe();
  }, []);
  async function submit(signUp: boolean) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const c = await browserAuth();
      if (!c) return;
      const r = signUp
        ? await c.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin + '/account' },
          })
        : await c.auth.signInWithPassword({ email, password });
      if (r.error) throw r.error;
      setNotice(
        signUp
          ? 'Check your email to confirm your account.'
          : 'Signed in. You can submit bots and run evaluations.',
      );
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading compact">
        <div className="eyebrow">YOUR ACCOUNT</div>
        <h1>A place for your players.</h1>
      </div>
      <ErrorNotice error={error} />
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <section className="panel">
        {!cloud ? (
          <p>
            Local practice is available without an account. Bot submissions require configured
            account sign-in.
          </p>
        ) : current ? (
          <>
            <p>Signed in as {current}</p>
            <button
              className="button secondary"
              onClick={async () => {
                await (await browserAuth())?.auth.signOut();
                router.push('/');
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <label className="field-label">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field-label">
              Password
              <input
                type="password"
                autoComplete="current-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="fine-print">
              Keyless players become public after qualification. Players with private API keys
              remain owner-only.
            </p>
            <button
              disabled={busy || password.length < 8 || !email}
              className="button primary"
              onClick={() => submit(false)}
            >
              Sign in
            </button>{' '}
            <button
              disabled={busy || password.length < 8 || !email}
              className="button secondary"
              onClick={() => submit(true)}
            >
              Create account
            </button>
          </>
        )}
      </section>
      {cloud && current && <McpAccess />}
    </>
  );
}
