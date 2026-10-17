import { useEffect, useMemo, useState } from 'react';
import { api, relativeTime, formatDate, type AdminUser } from '../api';

export function Users({ tick, onOpenUserScans }: { tick: number; onOpenUserScans: (u: AdminUser) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    api.users().then(
      (d) => { if (live) { setUsers(d.users); setError(null); } },
      (e: Error) => live && setError(e.message)
    );
    return () => { live = false; };
  }, [tick]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!users || !q) return users ?? [];
    return users.filter((u) =>
      [u.email, u.full_name, u.hospital].some((v) => (v ?? '').toLowerCase().includes(q))
    );
  }, [users, query]);

  return (
    <section className="card">
      <div className="toolbar" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Clinicians {users && <span className="muted num">({users.length})</span>}</h2>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search name, email, hospital"
          aria-label="Search clinicians"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {!users && !error && <div className="center"><div className="spinner" /></div>}
      {users && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Clinician</th><th>Hospital</th><th>Account</th><th>Scans</th><th>Last scan</th><th>Last sign-in</th><th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr
                  key={u.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => onOpenUserScans(u)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenUserScans(u)}
                  title="Show this clinician's scans">
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.full_name || 'No name'}</div>
                    <div className="muted">{u.email}</div>
                  </td>
                  <td>{u.hospital || <span className="muted">Not set</span>}</td>
                  <td>
                    {u.is_admin ? (
                      <span className="pill pill-info"><span aria-hidden>★</span>Admin</span>
                    ) : u.email_confirmed ? (
                      <span className="pill pill-good"><span aria-hidden>✓</span>Verified</span>
                    ) : (
                      <span className="pill pill-warn"><span aria-hidden>!</span>Unverified</span>
                    )}
                  </td>
                  <td className="num">{u.scan_count}</td>
                  <td>{relativeTime(u.last_scan_at)}</td>
                  <td>{relativeTime(u.last_sign_in_at)}</td>
                  <td>{formatDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">No clinicians match.</div>}
        </div>
      )}
    </section>
  );
}
