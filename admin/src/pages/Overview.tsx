import { useEffect, useState } from 'react';
import { api, type Overview as OverviewData } from '../api';
import { DailyBarChart } from '../components/BarChart';

export function Overview({ tick, onOpenUsers }: { tick: number; onOpenUsers: () => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.overview().then(
      (d) => { if (live) { setData(d); setError(null); } },
      (e: Error) => live && setError(e.message)
    );
    return () => { live = false; };
  }, [tick]);

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data) return <div className="center"><div className="spinner" /></div>;

  const verifiedPct = data.users_total ? Math.round((data.users_verified / data.users_total) * 100) : null;

  return (
    <>
      {error && <div className="banner banner-error">Refresh failed: {error}</div>}
      <div className="grid-tiles">
        <Tile label="Registered users" value={data.users_total} sub="Mobile app accounts" />
        <Tile label="Verified email" value={data.users_verified} sub={verifiedPct == null ? 'No users yet' : `${verifiedPct}% of users`} />
        <Tile label="Active this week" value={data.users_active_7d} sub="Signed in during the last 7 days" />
        <Tile label="Administrators" value={data.admins_total} sub="Managed in Supabase admin_allowlist" />
      </div>
      <div className="two-col">
        <section className="card">
          <h2>New users per day</h2>
          <DailyBarChart data={data.signups_per_day} label="Sign-ups" />
        </section>
        <section className="card">
          <h2>Access rules</h2>
          <ul className="rules">
            <li><span className="pill pill-info"><span aria-hidden>●</span>User</span> Signs in to the mobile app; sees and edits only their own profile.</li>
            <li><span className="pill pill-good"><span aria-hidden>★</span>Admin</span> Signs in to this website; can see every account. Refused by the mobile app.</li>
            <li><span className="pill pill-warn"><span aria-hidden>!</span>Unverified</span> Must confirm their email before signing in. Currently {data.users_unverified}.</li>
          </ul>
          <button className="btn" style={{ marginTop: 12 }} onClick={onOpenUsers}>View all accounts</button>
        </section>
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value num">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}
