import { useCallback, useEffect, useState } from 'react';
import { api, formatMonths, relativeTime, type ScanRow, type ScanStatus } from '../api';
import { FindingPill, StatusPill } from '../components/Pills';
import { ScanDrawer } from '../components/ScanDrawer';

const PAGE = 25;

export interface ScanFilter {
  status?: ScanStatus;
  userId?: string;
  userLabel?: string;
}

export function Scans({
  tick,
  filter,
  onFilter,
}: {
  tick: number;
  filter: ScanFilter;
  onFilter: (f: ScanFilter) => void;
}) {
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeDrawer = useCallback(() => setOpenId(null), []);

  useEffect(() => setOffset(0), [filter.status, filter.userId]);

  useEffect(() => {
    let live = true;
    api.scans({ status: filter.status, userId: filter.userId, limit: PAGE, offset }).then(
      (d) => { if (live) { setRows(d.scans); setTotal(d.total); setError(null); } },
      (e: Error) => live && setError(e.message)
    );
    return () => { live = false; };
  }, [tick, filter.status, filter.userId, offset]);

  return (
    <section className="card">
      <div className="toolbar" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Scans <span className="muted num">({total})</span></h2>
        <div className="toolbar">
          {filter.userId && (
            <span className="pill pill-neutral">
              {filter.userLabel}
              <button className="linkish" aria-label="Clear user filter" onClick={() => onFilter({ status: filter.status })}>✕</button>
            </span>
          )}
          <label className="sr-only" htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            className="select"
            value={filter.status ?? ''}
            onChange={(e) => onFilter({ ...filter, status: (e.target.value || undefined) as ScanStatus | undefined })}>
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="analyzing">Analyzing</option>
            <option value="uploaded">Uploaded</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {!rows && !error && <div className="center"><div className="spinner" /></div>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>User</th><th>Patient</th><th>Status</th><th>AI-assisted finding</th><th>Bone age</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => setOpenId(r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}>
                  <td title={r.created_at}>{relativeTime(r.created_at)}</td>
                  <td>{r.user_email ?? <span className="muted">Unknown</span>}</td>
                  <td>
                    <div>{r.patient_code || <span className="muted">No code</span>}</div>
                    <div className="muted num">
                      {r.patient_age_months != null ? formatMonths(r.patient_age_months) : '?'} · {r.patient_sex ?? '?'}
                    </div>
                  </td>
                  <td><StatusPill status={r.status} /></td>
                  <td><FindingPill fracture={r.fracture_detected} confidence={r.confidence} /></td>
                  <td className="num">{r.bone_age_months != null ? formatMonths(r.bone_age_months) : <span className="muted">n/a</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No scans yet.</div>}
        </div>
      )}
      {total > PAGE && (
        <div className="pager">
          <span className="num">{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <div className="toolbar">
            <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <button className="btn" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </div>
      )}
      {openId && <ScanDrawer scanId={openId} onClose={closeDrawer} />}
    </section>
  );
}
