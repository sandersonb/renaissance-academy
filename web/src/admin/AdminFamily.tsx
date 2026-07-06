import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi, ApiError, type AdminFamily as Family } from '../api';
import { ErrorBanner } from '../components/Layout';

const STATUSES = [
  'INITIAL', 'PEND_OFFER', 'OFFER', 'IP_OFFER', 'WAIT', 'SIB_WAIT',
  'PEND_REGISTER', 'FIN_REGISTER', 'REGISTER', 'DECLINE',
  'PEND_REENROLL', 'ACPT_REENROLL', 'DECL_REENROLL',
];
const gradeLabel = (g: number) => (g === 0 ? 'K' : String(g));

export function AdminFamily() {
  const parentId = Number(useParams().parentId);
  const [fam, setFam] = useState<Family | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      setFam(await adminApi.family(parentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }, [parentId]);
  useEffect(() => { void load(); }, [load]);

  const change = async (childId: number) => {
    const status = target[childId];
    if (!status) return;
    setError(null);
    try {
      await adminApi.changeStatus(childId, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Change failed');
    }
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await adminApi.addNote(parentId, note);
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add note');
    }
  };

  if (!fam) return <p className="container">Loading…</p>;

  return (
    <div>
      <h1>{fam.parent ? `${fam.parent.firstName} ${fam.parent.lastName}` : 'Family'}</h1>
      {fam.parent && <p className="muted">{fam.parent.email}</p>}
      <ErrorBanner message={error} />

      <div className="card">
        <h2>Students</h2>
        <table>
          <thead><tr><th>Name</th><th>Grade</th><th>Status</th><th>Change to</th></tr></thead>
          <tbody>
            {fam.children.map((c) => (
              <tr key={c.childId}>
                <td>{c.firstName} {c.lastName}</td>
                <td>{gradeLabel(c.gradeNextYear)}</td>
                <td><span className="badge">{c.regStatus}</span>{c.position != null && <span className="muted"> #{c.position}</span>}</td>
                <td>
                  <select value={target[c.childId] ?? ''} onChange={(e) => setTarget((t) => ({ ...t, [c.childId]: e.target.value }))}>
                    <option value="">—</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button className="small secondary" onClick={() => void change(c.childId)}>Apply</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Notes</h2>
        {fam.notes.length === 0 && <p className="muted">No notes yet.</p>}
        <ul>
          {fam.notes.map((n) => (
            <li key={n.id}><span className="muted">{n.date.slice(0, 10)}:</span> {n.note}</li>
          ))}
        </ul>
        <form onSubmit={submitNote}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. called parent re: paperwork)" />
          <button type="submit">Add note</button>
        </form>
      </div>
    </div>
  );
}
