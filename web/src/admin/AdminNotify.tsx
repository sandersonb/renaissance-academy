import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

export function AdminNotify() {
  const [outbox, setOutbox] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setOutbox((await adminApi.notifyStatus()).outbox); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Status failed'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null); setMsg(null); setBusy(true);
    try { setMsg(`${label}: ${JSON.stringify(await fn())}`); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h1>Admin · Notifications</h1>
      <p className="muted"><Link to="/admin">← search</Link></p>
      <ErrorBanner message={error} />
      {msg && <div className="card"><code>{msg}</code></div>}

      <div className="card">
        <h2>Send</h2>
        <p className="muted">Replaces the legacy notify crons. Emails are queued, then delivered by the worker.</p>
        <button disabled={busy} onClick={() => void run('offers', adminApi.notifyOffers)}>Materialize offers &amp; email</button>{' '}
        <button className="secondary" disabled={busy} onClick={() => void run('reminders', adminApi.notifyReminders)}>Send reminders</button>
      </div>

      <div className="card">
        <h2>Outbox</h2>
        <p>{Object.keys(outbox).length === 0 ? 'empty' : Object.entries(outbox).map(([s, n]) => `${s}: ${n}`).join(' · ')}</p>
        <button className="secondary" disabled={busy} onClick={() => void run('drain', adminApi.notifyDrain)}>Flush now</button>{' '}
        <button className="small" onClick={() => void refresh()}>Refresh</button>
      </div>
    </div>
  );
}
