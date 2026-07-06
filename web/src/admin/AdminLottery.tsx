import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError, type LotterySummary } from '../api';
import { ErrorBanner } from '../components/Layout';

const GRADE_LABELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const DEFAULT_CAPS = [160, 120, 120, 120, 110, 100, 100, 80, 30, 50];

export function AdminLottery() {
  const [caps, setCaps] = useState<number[]>([...DEFAULT_CAPS]);
  const [preview, setPreview] = useState<LotterySummary | null>(null);
  const [committed, setCommitted] = useState<{ runId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setCap = (i: number, v: string) => setCaps((c) => c.map((x, j) => (j === i ? Number(v) || 0 : x)));

  const doPreview = async () => {
    setError(null); setCommitted(null); setBusy(true);
    try {
      setPreview(await adminApi.previewLottery(caps));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Preview failed');
    } finally { setBusy(false); }
  };

  const doCommit = async () => {
    if (!preview) return;
    if (!confirm('Commit this draw? This updates every student’s status and cannot be undone.')) return;
    setError(null); setBusy(true);
    try {
      const r = await adminApi.commitLottery(caps, preview.seed); // same seed = exact previewed draw
      setCommitted({ runId: r.runId });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Commit failed');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h1>Admin · Run Lottery</h1>
      <p className="muted"><Link to="/admin">← search</Link></p>
      <ErrorBanner message={error} />

      <div className="card">
        <h2>Per-grade openings (caps)</h2>
        <div className="row">
          {caps.map((c, i) => (
            <div key={i}>
              <label>{GRADE_LABELS[i]}</label>
              <input type="number" value={c} onChange={(e) => setCap(i, e.target.value)} />
            </div>
          ))}
        </div>
        <button onClick={() => void doPreview()} disabled={busy}>Preview (dry run)</button>
      </div>

      {preview && !committed && (
        <div className="card">
          <h2>Preview</h2>
          <p className="muted">
            {preview.totals.initialCount} entrants · {preview.totals.offered} offered ·
            {' '}{preview.totals.waitlisted} waitlisted · {preview.totals.siblingPulls} sibling pulls
            <br />seed <code>{preview.seed}</code>
          </p>
          <table>
            <thead><tr><th>Grade</th><th>Offered</th><th>Wait</th><th>Sibling wait</th></tr></thead>
            <tbody>
              {preview.byGrade.map((g) => (
                <tr key={g.grade}><td>{g.grade}</td><td>{g.offered}</td><td>{g.wait}</td><td>{g.sibWait}</td></tr>
              ))}
            </tbody>
          </table>
          <button className="danger" onClick={() => void doCommit()} disabled={busy}>Commit this draw</button>
        </div>
      )}

      {committed && (
        <div className="card center">
          <h2>Lottery committed ✓</h2>
          <p className="muted">Run #{committed.runId} recorded. Offers can now be sent.</p>
        </div>
      )}
    </div>
  );
}
