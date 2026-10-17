import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, supabase, type AdminUser, type Health, type ScanStatus } from './api';
import { Overview } from './pages/Overview';
import { Users } from './pages/Users';
import { Scans, type ScanFilter } from './pages/Scans';

type Page = 'overview' | 'users' | 'scans';
const REFRESH_MS = 30_000;

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [adminState, setAdminState] = useState<'checking' | 'ok' | 'denied'>('checking');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Every signed-in account is checked against the server's admin list.
  useEffect(() => {
    if (!session) return;
    setAdminState('checking');
    api.me().then(
      () => setAdminState('ok'),
      async (e) => {
        if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
          setAdminState('denied');
          await supabase.auth.signOut();
        } else {
          setAdminState('ok'); // server unreachable: let pages show their own errors
        }
      }
    );
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return <div className="center" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
  if (!session) return <Login denied={adminState === 'denied'} />;
  if (adminState === 'checking') return <div className="center" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
  return <Dashboard email={session.user.email ?? ''} />;
}

function Login({ denied }: { denied: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
        <p>Monitor clinicians, scans and analysis health.</p>
        {denied && <div className="banner banner-error">This account is not an administrator. Clinicians use the mobile app.</div>}
        {error && <div className="banner banner-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ email }: { email: string }) {
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'overview');
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [scanFilter, setScanFilter] = useState<ScanFilter>({});

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    setUpdatedAt(new Date());
    api.health().then(setHealth);
  }, []);

  useEffect(() => {
    api.health().then(setHealth);
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    location.hash = page;
  }, [page]);

  const openScans = (status?: ScanStatus) => {
    setScanFilter({ status });
    setPage('scans');
  };
  const openUserScans = (u: AdminUser) => {
    setScanFilter({ userId: u.id, userLabel: u.full_name || u.email || 'Clinician' });
    setPage('scans');
  };

  const titles: Record<Page, [string, string]> = {
    overview: ['Overview', 'Live activity from the mobile app'],
    users: ['Clinicians', 'Everyone registered through the mobile app'],
    scans: ['Scans', 'Every X-ray analysed through the server'],
  };

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark">+</div>
          <div>PediaFracture<small>Admin console</small></div>
        </div>
        {(['overview', 'users', 'scans'] as Page[]).map((p) => (
          <button key={p} className="nav-btn" aria-current={page === p ? 'page' : undefined} onClick={() => { if (p === 'scans') setScanFilter({}); setPage(p); }}>
            {titles[p][0]}
          </button>
        ))}
        <div className="sidebar-foot">
          <div>
            {health === undefined ? (
              <span className="pill pill-neutral">Checking server…</span>
            ) : health ? (
              <span className="pill pill-good" title={`device ${health.device}`}><span aria-hidden>●</span>Server online</span>
            ) : (
              <span className="pill pill-bad"><span aria-hidden>✕</span>Server offline</span>
            )}
          </div>
          {health && !health.bone_age_model && <span className="pill pill-warn"><span aria-hidden>!</span>Bone age model off</span>}
          <div style={{ wordBreak: 'break-all' }}>{email}</div>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <div className="page-head">
          <div>
            <h1>{titles[page][0]}</h1>
            <p>{titles[page][1]}</p>
          </div>
          <div className="toolbar">
            <span className="muted">Updated {updatedAt.toLocaleTimeString()} · auto-refresh 30 s</span>
            <button className="btn" onClick={refresh}>Refresh</button>
          </div>
        </div>
        {page === 'overview' && <Overview tick={tick} onOpenScans={openScans} />}
        {page === 'users' && <Users tick={tick} onOpenUserScans={openUserScans} />}
        {page === 'scans' && <Scans tick={tick} filter={scanFilter} onFilter={setScanFilter} />}
      </main>
    </div>
  );
}
