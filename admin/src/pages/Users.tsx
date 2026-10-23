import { useEffect, useMemo, useState } from 'react';
import { api, formatDate, type Account, type Role } from '../api';

type Filter = 'all' | Role;

export function Users() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let live = true;
    api.users().then(
      (d) => live && setAccounts(d.users),
      (e: Error) => live && setError(e.message)
    );
    return () => { live = false; };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts ?? []).filter((a) => {
      if (filter !== 'all' && a.role !== filter) return false;
      return !q || [a.email, a.full_name, a.organisation].some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [accounts, query, filter]);

  const count = (f: Filter) => (accounts ?? []).filter((a) => f === 'all' || a.role === f).length;

  return (
    <section className="card">
      <div className="toolbar" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <div className="toolbar" role="group" aria-label="Filter by role">
          {(['all', 'user', 'admin'] as Filter[]).map((f) => (
            <button
              key={f}
              className="btn"
              aria-pressed={filter === f}
              style={filter === f ? { borderColor: 'var(--primary-bright)', color: 'var(--primary-bright)' } : undefined}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'user' ? 'Users' : 'Admins'}
              {accounts && <span className="muted num">{count(f)}</span>}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search name, email, organisation"
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {!accounts && !error && <div className="center"><div className="spinner" /></div>}
      {accounts && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th>Joined</th></tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.full_name || <span className="muted">No name</span>}</td>
                  <td>{a.email}</td>
                  <td>{a.organisation || <span className="muted">Not set</span>}</td>
                  <td>
                    {a.role === 'admin' ? (
                      <span className="pill pill-good"><span aria-hidden>★</span>Admin</span>
                    ) : (
                      <span className="pill pill-info"><span aria-hidden>●</span>User</span>
                    )}
                  </td>
                  <td>{formatDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">No users match.</div>}
        </div>
      )}
    </section>
  );
}
