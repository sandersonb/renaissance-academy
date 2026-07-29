import { useCallback, useEffect, useState } from 'react';
import { adminApi, ApiError, type EmailLogRow } from '../api';
import { ErrorBanner } from '../components/Layout';

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** Notifications section (queue offers/reminders, drain the outbox, view the log). */
export function NotifyPanel() {
  const [outbox, setOutbox] = useState<Record<string, number>>({});
  const [sentLast24h, setSentLast24h] = useState(0);
  const [dailyCap, setDailyCap] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<EmailLogRow[]>([]);
  const [logFilter, setLogFilter] = useState<string>('all');

  const refresh = useCallback(async () => {
    try {
      const s = await adminApi.notifyStatus();
      setOutbox(s.outbox);
      setSentLast24h(s.sentLast24h);
      setDailyCap(s.dailyCap);
      setLog((await adminApi.emailLog(logFilter === 'all' ? undefined : logFilter)).messages);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Status failed'); }
  }, [logFilter]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null); setMsg(null); setBusy(true);
    try { setMsg(`${label}: ${JSON.stringify(await fn())}`); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <h2 className="section">Notifications</h2>
      <ErrorBanner message={error} />
      {msg && <div className="card"><code>{msg}</code></div>}

      <div className="card">
        <h3>Send</h3>
        <p className="muted">Replaces the legacy notify crons. Emails are queued, then delivered by the worker.</p>
        <button disabled={busy} onClick={() => void run('offers', adminApi.notifyOffers)}>Materialize offers &amp; email</button>{' '}
        <button className="secondary" disabled={busy} onClick={() => void run('reminders', adminApi.notifyReminders)}>Send reminders</button>
      </div>

      <div className="card">
        <h3>Outbox</h3>
        <p>{Object.keys(outbox).length === 0 ? 'empty' : Object.entries(outbox).map(([s, n]) => `${s}: ${n}`).join(' · ')}</p>
        <p className="muted">
          Sent in last 24h: <b>{sentLast24h}</b> / {dailyCap} daily cap.
          {sentLast24h >= dailyCap && ' Cap reached — further sends wait until the window rolls over.'}
          {' '}Delivery is paced automatically to stay under Gmail limits.
        </p>
        <button className="secondary" disabled={busy} onClick={() => void run('drain', adminApi.notifyDrain)}>Flush a batch now</button>{' '}
        <button className="small" onClick={() => void refresh()}>Refresh</button>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Email log</h3>
          <label className="inline">
            Show
            <select value={logFilter} onChange={(e) => setLogFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        </div>
        {log.length === 0 ? (
          <p className="muted">No messages.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Recipient</th><th>Template</th><th>State</th><th>Attempts</th><th>Queued</th><th>Sent</th><th>Last error</th></tr>
              </thead>
              <tbody>
                {log.map((m) => (
                  <tr key={m.id}>
                    <td>{m.recipient}</td>
                    <td>{m.template}</td>
                    <td><span className="badge">{m.state}</span></td>
                    <td>{m.attempts}</td>
                    <td>{fmtTime(m.createdAt)}</td>
                    <td>{fmtTime(m.sentAt)}</td>
                    <td className="muted">{m.lastError ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
