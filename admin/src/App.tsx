import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, supabase } from './api';
import { Users } from './pages/Users';
import { Scans, type ScanFilter } from './pages/Scans';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [adminState, setAdminState] = useState<'checking' | 'ok' | 'denied' | 'expired' | 'idle' | 'server'>('checking');
  const [serverDetail, setServerDetail] = useState('');
  // Opened from a password-reset email: ask for a new password before anything else.
  const [recovery, setRecovery] = useState(
    () => new URLSearchParams(location.search).has('reset') || location.hash.includes('type=recovery')
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signOutIdle = useCallback(() => {
    setAdminState('idle');
    supabase.auth.signOut();
  }, []);

  const finishRecovery = useCallback(() => {
    setRecovery(false);
    history.replaceState(null, '', '/admin/');
  }, []);

  // Every signed-in account is checked against the server's admin list.
  useEffect(() => {
    if (!session) return;
    setAdminState('checking');
    api.me().then(
      () => setAdminState('ok'),
      async (e) => {
        if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
          setAdminState(e.status === 403 ? 'denied' : 'expired');
          await supabase.auth.signOut();
        } else if (e instanceof ApiError && e.status === 503) {
          // The server cannot check sign-ins at all (its Supabase key is broken).
          setServerDetail(e.message);
          setAdminState('server');
        } else {
          setAdminState('ok'); // server unreachable: let pages show their own errors
        }
      }
    );
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return <div className="center" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
  if (recovery) return <SetNewPassword session={session} onDone={finishRecovery} />;
  if (!session) return <Login denied={adminState === 'denied'} expired={adminState === 'expired'} idle={adminState === 'idle'} />;
  if (adminState === 'server') {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Server cannot verify sign-ins</h1>
          <div className="banner banner-error" role="alert">{serverDetail}</div>
          <p>
            The analysis server reached Supabase but its service key was rejected, so neither this console nor the
            mobile app can be used until the key is updated. Set <code>SUPABASE_SERVICE_ROLE_KEY</code> in
            <code> ~/app/.env</code> on the EC2 server to the current secret key from Supabase (Project Settings → API
            Keys), then restart the container.
          </p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  if (adminState === 'checking') return <div className="center" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
  return <Dashboard email={session.user.email ?? ''} onIdle={signOutIdle} />;
}

function SetNewPassword({ session, onDone }: { session: Session | null; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Reset link not valid</h1>
          <div className="banner banner-error">This password-reset link has expired or was already used.</div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDone}>Back to sign in</button>
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    markActive();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else onDone();
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>Choose a new password</h1>
        <p>{session.user.email}</p>
        {error && <div className="banner banner-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Saving…' : 'Save password and continue'}
        </button>
      </form>
    </div>
  );
}

function Login({ denied, expired, idle }: { denied: boolean; expired: boolean; idle: boolean }) {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${location.origin}/admin/?reset=1`,
    });
    setBusy(false);
    if (err) setError(/rate limit|too many/i.test(err.message) ? 'Too many requests. Wait a minute and try again.' : err.message);
    else setSent(true);
  };

  if (mode === 'forgot') {
    return (
      <div className="login-wrap">
        <form className="card login-card" onSubmit={sendReset}>
          <h1>Reset your password</h1>
          <p>We will email you a link to choose a new password.</p>
          {sent && <div className="banner banner-info">If an account exists for that email, a reset link is on its way. Open it in this browser.</div>}
          {error && <div className="banner banner-error" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="reset-email">Email</label>
            <input id="reset-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} disabled={busy}>
            {busy ? 'Sending…' : sent ? 'Send again' : 'Send reset link'}
          </button>
          <button type="button" className="btn" style={{ width: '100%' }} onClick={() => { setMode('signin'); setSent(false); setError(null); }}>
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    markActive(); // a fresh sign-in starts a new 30-minute idle window
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (err) {
      setError(
        /invalid login/i.test(err.message)
          ? 'Incorrect email or password.'
          : /not confirmed/i.test(err.message)
          ? 'This email has not been verified yet. Use the link in the verification email first.'
          : err.message
      );
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 18px' }}>
          <div className="brand-mark">+</div>
          <div>PediaFracture AI<small>Admin console</small></div>
        </div>
        <h1>Administrator sign in</h1>
        <p>For administrators only. Users sign in with the mobile app.</p>
        {denied && <div className="banner banner-error">This account has the User role, not Admin. Users sign in with the mobile app.</div>}
        {expired && <div className="banner banner-info">Your sign-in expired. Please sign in again.</div>}
        {idle && <div className="banner banner-info">You were signed out after 30 minutes of inactivity.</div>}
        {error && <div className="banner banner-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 14 }}>
          <button type="button" className="linkish" onClick={() => { setMode('forgot'); setError(null); }}>Forgot password?</button>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

type Page = 'users' | 'scans';
const TITLES: Record<Page, [string, string]> = {
  users: ['Users', 'Every account and its role'],
  scans: ['Scans', 'Every X-ray analysed through the server'],
};

// Admins are signed out after 30 minutes without mouse, keyboard or touch activity,
// with a one-minute warning first. Activity in any open tab counts.
const IDLE_MS = 30 * 60_000;
const WARN_MS = 60_000;
const ACTIVITY_KEY = 'pediafracture-admin-last-activity';
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

function lastActivity(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || Date.now();
  } catch {
    return Date.now();
  }
}

function markActive() {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch { /* private window: this tab still tracks its own activity */ }
}

function useIdleSignOut(onTimeout: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const touch = useCallback(() => {
    markActive();
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    // A session left idle while the browser was closed is signed out on return.
    if (Date.now() - lastActivity() >= IDLE_MS) return onTimeout();
    touch();
    let last = 0;
    const onActivity = () => {
      // While the warning is showing, only the "Stay signed in" button keeps the session.
      if (Date.now() - last < 5_000 || document.querySelector('[data-idle-warning]')) return;
      last = Date.now();
      touch();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const id = setInterval(() => {
      const idle = Date.now() - lastActivity();
      if (idle >= IDLE_MS) onTimeout();
      else if (idle >= IDLE_MS - WARN_MS) setSecondsLeft(Math.ceil((IDLE_MS - idle) / 1000));
      else setSecondsLeft(null);
    }, 1000);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(id);
    };
  }, [onTimeout, touch]);

  return { secondsLeft, stay: touch };
}

function Dashboard({ email, onIdle }: { email: string; onIdle: () => void }) {
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) === 'scans' ? 'scans' : 'users'));
  const [tick, setTick] = useState(0);
  const [scanFilter, setScanFilter] = useState<ScanFilter>({});
  const { secondsLeft, stay } = useIdleSignOut(onIdle);

  useEffect(() => {
    location.hash = page;
  }, [page]);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark">+</div>
          <div>PediaFracture<small>Admin console</small></div>
        </div>
        {(['users', 'scans'] as Page[]).map((p) => (
          <button key={p} className="nav-btn" aria-current={page === p ? 'page' : undefined} onClick={() => { if (p === 'scans') setScanFilter({}); setPage(p); }}>
            {TITLES[p][0]}
          </button>
        ))}
        <div className="sidebar-foot">
          <div><span className="pill pill-good"><span aria-hidden>★</span>Admin</span></div>
          <div style={{ wordBreak: 'break-all' }}>{email}</div>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <div className="page-head">
          <div>
            <h1>{TITLES[page][0]}</h1>
            <p>{TITLES[page][1]}</p>
          </div>
          {page === 'scans' && (
            <div className="toolbar">
              <button className="btn" onClick={() => setTick((t) => t + 1)}>Refresh</button>
            </div>
          )}
        </div>
        {page === 'users' && <Users />}
        {page === 'scans' && <Scans tick={tick} filter={scanFilter} onFilter={setScanFilter} />}
      </main>
      {secondsLeft !== null && (
        <div className="drawer-backdrop center" data-idle-warning role="alertdialog" aria-labelledby="idle-title" aria-describedby="idle-body">
          <div className="card login-card">
            <h1 id="idle-title">Still there?</h1>
            <p id="idle-body">For security you will be signed out in {secondsLeft} s because of inactivity.</p>
            <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={stay} autoFocus>Stay signed in</button>
            <button className="btn" style={{ width: '100%' }} onClick={onIdle}>Sign out now</button>
          </div>
        </div>
      )}
    </div>
  );
}
