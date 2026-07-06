import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, ApiError, type ChildView } from '../api';
import { ErrorBanner } from '../components/Layout';

function actions(c: ChildView): { label: string; kind: 'accept' | 'decline' | 'delete' | 'language' }[] {
  const out: { label: string; kind: 'accept' | 'decline' | 'delete' | 'language' }[] = [];
  if (c.status === 'OFFER' || c.status === 'PEND_OFFER') out.push({ label: 'Accept', kind: 'accept' });
  if (c.status === 'IP_OFFER') out.push({ label: 'Complete acceptance', kind: 'accept' });
  if (c.status === 'IP_REENROLL') out.push({ label: 'Choose language', kind: 'language' });
  if (!/DECL/.test(c.status) && c.status !== 'INITIAL') out.push({ label: 'Decline', kind: 'decline' });
  if (c.status === 'INITIAL') out.push({ label: 'Delete', kind: 'delete' });
  return out;
}

export function Dashboard() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  if (!me) return null;

  const act = async (c: ChildView, kind: string) => {
    setError(null);
    if (kind === 'accept') return nav(`/children/${c.childId}/accept`);
    if (kind === 'language') return nav(`/children/${c.childId}/language`);
    if (kind === 'decline' && !confirm(`Decline enrollment for ${c.firstName} ${c.lastName}? This cannot be undone.`)) return;
    if (kind === 'delete' && !confirm(`Remove ${c.firstName} ${c.lastName}?`)) return;
    setBusyId(c.childId);
    try {
      if (kind === 'decline') await api.decline(c.childId);
      if (kind === 'delete') await api.remove(c.childId);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h1>Welcome{me.firstName ? `, ${me.firstName}` : ''}</h1>
      <ErrorBanner message={error} />
      <div className="card">
        <h2>Your students</h2>
        {me.children.length === 0 ? (
          <p className="muted">No students yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Grade</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {me.children.map((c) => (
                <tr key={c.childId}>
                  <td>{c.firstName} {c.lastName}</td>
                  <td>{c.grade}</td>
                  <td>
                    <span className="badge">{c.statusLabel}</span>
                    {c.waitlistRank != null && <div className="muted">position {c.waitlistRank}</div>}
                  </td>
                  <td>
                    {actions(c).map((a) => (
                      <button
                        key={a.kind}
                        className={`small ${a.kind === 'decline' || a.kind === 'delete' ? 'danger' : 'secondary'}`}
                        disabled={busyId === c.childId}
                        onClick={() => void act(c, a.kind)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link to="/add-child"><button>Add a student</button></Link>
      </div>
    </div>
  );
}
