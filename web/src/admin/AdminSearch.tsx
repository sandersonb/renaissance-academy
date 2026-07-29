import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError, type AdminChild } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const gradeLabel = (g: number) => (g === 0 ? 'K' : String(g));

export function AdminSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ parent: { parentId: number; firstName: string; lastName: string } | null; children: AdminChild[] }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setResults((await adminApi.search(q)).results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed');
    }
  };

  return (
    <div>
      <h1>Admin · Search</h1>
      <AdminNav />
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="card">
        <label>Find a student by name</label>
        <div className="row">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Last or first name" />
          <button type="submit" style={{ flex: '0 0 auto' }}>Search</button>
        </div>
      </form>
      {searched && results.length === 0 && <p className="muted">No matches.</p>}
      {results.map((fam) => (
        <div className="card" key={fam.parent?.parentId ?? Math.random()}>
          <b>
            {fam.parent ? (
              <Link to={`/admin/family/${fam.parent.parentId}`}>{fam.parent.firstName} {fam.parent.lastName}</Link>
            ) : 'Unknown family'}
          </b>
          <table>
            <tbody>
              {fam.children.map((c) => (
                <tr key={c.childId}>
                  <td>{c.firstName} {c.lastName}</td>
                  <td>grade {gradeLabel(c.gradeNextYear)}</td>
                  <td><span className="badge">{c.regStatus}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
