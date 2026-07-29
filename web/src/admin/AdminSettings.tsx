import { useCallback, useEffect, useState } from 'react';
import { adminApi, ApiError, type AdminAccount, type CycleSettings } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';
import { NotifyPanel } from './NotifyPanel';
import { RollYearPanel } from './RollYearPanel';

const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function phaseLabel(s: CycleSettings): string {
  if (!s.lotteryOpen) return 'Closed — not accepting applications';
  return s.postLottery ? 'Post-lottery — offers & waitlist active' : 'Open — accepting applications (pre-lottery)';
}

function CyclePanel() {
  const [settings, setSettings] = useState<CycleSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.getSettings().then(setSettings).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load settings'));
  }, []);

  const toggle = async (field: 'lotteryOpen' | 'postLottery', value: boolean) => {
    setError(null);
    setBusy(true);
    try {
      setSettings(await adminApi.updateSettings({ [field]: value }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="section">Enrollment cycle</h2>
      <ErrorBanner message={error} />
      <div className="card">
        {!settings ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p>
              Year <b>{settings.yearBegin}</b> · Current phase: <span className="badge">{phaseLabel(settings)}</span>
            </p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.lotteryOpen}
                disabled={busy}
                onChange={(e) => void toggle('lotteryOpen', e.target.checked)}
              />
              <span>
                <b>Lottery open</b> — parents can register and add students. Turn off to close the enrollment window.
              </span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.postLottery}
                disabled={busy}
                onChange={(e) => void toggle('postLottery', e.target.checked)}
              />
              <span>
                <b>Post-lottery</b> — the draw has run; only new (INITIAL) applicants may be added and offers/waitlist are
                active. Running the lottery sets this automatically.
              </span>
            </label>
            <p className="muted">Changes take effect immediately — no restart needed.</p>
          </>
        )}
      </div>
    </section>
  );
}

function CapsPanel() {
  const [caps, setCaps] = useState<number[] | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.getCaps()
      .then((r) => { setCaps(r.caps); setDraft(r.caps.map(String)); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load caps'));
  }, []);

  const save = async () => {
    setError(null); setSaved(false); setBusy(true);
    try {
      const r = await adminApi.updateCaps(draft.map((x) => Number(x)));
      setCaps(r.caps); setDraft(r.caps.map(String)); setSaved(true);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save caps'); }
    finally { setBusy(false); }
  };
  const total = draft.reduce((a, b) => a + (Number(b) || 0), 0);

  return (
    <section>
      <h2 className="section">Grade capacity (Max Slots)</h2>
      <ErrorBanner message={error} />
      <div className="card">
        {!caps ? <p className="muted">Loading…</p> : (
          <>
            <p className="muted">Per-grade enrollment caps used by the dashboard and the lottery. Total {total} seats.</p>
            <div className="row">
              {GRADES.map((g, i) => (
                <div key={g}>
                  <label>{g}</label>
                  <input type="number" min={0} value={draft[i] ?? ''}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
              ))}
            </div>
            <div className="row-actions">
              <button onClick={() => void save()} disabled={busy}>Save caps</button>
              {saved && <span className="muted">Saved ✓</span>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function AdminsPanel() {
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try { setAdmins((await adminApi.listAdmins()).admins); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load admins'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try { await adminApi.createAdminAccount(username.trim(), password); setUsername(''); setPassword(''); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create admin'); }
  };
  const toggle = async (a: AdminAccount) => {
    setError(null);
    try { await adminApi.setAdminActive(a.id, !a.active); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not update admin'); }
  };

  return (
    <section>
      <h2 className="section">Admin accounts</h2>
      <p className="muted">Staff logins for this portal. Deactivate to revoke access without deleting the record.</p>
      <ErrorBanner message={error} />
      <div className="card">
        {admins && admins.length > 0 && (
          <table>
            <thead><tr><th>Username</th><th>Status</th><th /></tr></thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.username}</td>
                  <td>{a.active ? <span className="badge">active</span> : <span className="muted">deactivated</span>}</td>
                  <td>
                    <button className="small secondary" onClick={() => void toggle(a)}>
                      {a.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={create} className="row" style={{ marginTop: '0.8rem' }}>
          <input placeholder="new username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" style={{ flex: '0 0 auto' }}>Add admin</button>
        </form>
      </div>
    </section>
  );
}

export function AdminSettings() {
  return (
    <div>
      <h1>Admin · Settings</h1>
      <AdminNav />
      <CyclePanel />
      <CapsPanel />
      <AdminsPanel />
      <NotifyPanel />
      <RollYearPanel />
    </div>
  );
}
