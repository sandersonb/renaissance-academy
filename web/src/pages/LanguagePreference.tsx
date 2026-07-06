import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

// reenrollChild.pl: grades 1 & 6 pick first/second language preference.
const FIRST = [{ v: 400, label: 'Arabic' }, { v: 200, label: 'Chinese' }, { v: 100, label: 'Spanish' }];
const SECOND = [{ v: 40, label: 'Arabic' }, { v: 20, label: 'Chinese' }, { v: 10, label: 'Spanish' }];

export function LanguagePreference() {
  const { id } = useParams();
  const childId = Number(id);
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [first, setFirst] = useState(400);
  const [second, setSecond] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.language(childId, first, second);
      await refresh();
      nav('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save preference');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h1>Language preference</h1>
      <p className="muted">We try to honor preferences but cannot guarantee placement.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit}>
        <label>First choice</label>
        <select value={first} onChange={(e) => setFirst(Number(e.target.value))}>
          {FIRST.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <label>Second choice</label>
        <select value={second} onChange={(e) => setSecond(Number(e.target.value))}>
          {SECOND.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <button type="submit" disabled={busy}>Save preference</button>
      </form>
    </div>
  );
}
