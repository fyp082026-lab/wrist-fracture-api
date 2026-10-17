import { useEffect, useState } from 'react';
import { api, type Overview as OverviewData, type ScanStatus } from '../api';
import { DailyBarChart } from '../components/BarChart';
import { StatusPill } from '../components/Pills';

const METER: Record<ScanStatus, string> = {
  completed: 'var(--good)',
  analyzing: 'var(--info)',
  uploaded: 'var(--text-muted)',
  failed: 'var(--bad)',
};

export function Overview({ tick, onOpenScans }: { tick: number; onOpenScans: (status?: ScanStatus) => void }) {
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

  const s = data.scans_by_status;
  const finished = s.completed + s.failed;
  const successRate = finished ? Math.round((s.completed / finished) * 100) : null;
  const statuses: ScanStatus[] = ['completed', 'analyzing', 'uploaded', 'failed'];

  return (
    <>
      {error && <div className="banner banner-error">Refresh failed: {error}</div>}
      <div className="grid-tiles">
        <Tile label="Registered clinicians" value={data.users_total} sub={`${data.users_active_7d} signed in this week`} />
        <Tile label="Scans" value={data.scans_total} sub={`${data.patients_total} patients`} />
        <Tile label="Fractures suggested" value={data.fractures_detected} sub={`of ${data.results_total} analysed scans`} />
        <Tile label="Analysis success rate" value={successRate == null ? 'No data' : `${successRate}%`} sub={`${s.failed} failed`} />
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Scans per day</h2>
          <DailyBarChart data={data.scans_per_day} label="Scans" />
        </section>
        <section className="card">
          <h2>Scan pipeline</h2>
          <div className="status-list">
            {statuses.map((k) => (
              <div className="status-row" key={k}>
                <button className="linkish" style={{ justifySelf: 'start' }} onClick={() => onOpenScans(k)} aria-label={`Show ${k} scans`}>
                  <StatusPill status={k} />
                </button>
                <strong className="num">{s[k]}</strong>
                <div className="meter" aria-hidden>
                  <div style={{ width: `${data.scans_total ? (s[k] / data.scans_total) * 100 : 0}%`, background: METER[k] }} />
                </div>
              </div>
            ))}
          </div>
          <p className="tile-sub" style={{ marginTop: 16 }}>
            Scans stuck in Uploaded or Analyzing for long usually mean the app lost connection mid-analysis.
          </p>
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
