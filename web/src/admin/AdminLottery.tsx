import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError, type LotterySummary, type LotteryRun } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const GRADE_LABELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const DEFAULT_CAPS = [160, 120, 120, 120, 110, 100, 100, 80, 30, 50];

export function AdminLottery() {
  const [caps, setCaps] = useState<number[]>([...DEFAULT_CAPS]);
  const [preview, setPreview] = useState<LotterySummary | null>(null);
  const [committed, setCommitted] = useState<{ runId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postLottery, setPostLottery] = useState(false);
  const [runs, setRuns] = useState<LotteryRun[]>([]);

  const loadRuns = useCallback(async () => {
    try { setRuns((await adminApi.lotteryRuns()).runs); } catch { /* history is best-effort */ }
  }, []);

  // The draw runs once per cycle; post_lottery=1 means it already ran. Caps default
  // to the live MaxEnrollment (editable in Settings), not a hardcoded table.
  useEffect(() => {
    adminApi.getSettings().then((s) => setPostLottery(s.postLottery)).catch(() => {});
    adminApi.getCaps().then((r) => setCaps(r.caps)).catch(() => {});
    void loadRuns();
  }, [loadRuns]);

  const setCap = (i: number, v: string) => setCaps((c) => c.map((x, j) => (j === i ? Number(v) || 0 : x)));

  const doPreview = async () => {
    setError(null); setCommitted(null); setBusy(true);
    try {
      setPreview(await adminApi.previewLottery(caps));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Preview failed');
    } finally { setBusy(false); }
  };

  const [committedSeed, setCommittedSeed] = useState<string | null>(null);

  const doCommit = async () => {
    if (postLottery) return;
    if (!confirm('Run the OFFICIAL lottery now? This draws a brand-new random result (different from any preview), updates every student’s status, and cannot be undone.')) return;
    setError(null); setBusy(true);
    try {
      const r = await adminApi.commitLottery(caps); // fresh server-side seed — NOT the previewed one
      setCommitted({ runId: r.runId });
      setCommittedSeed(r.seed);
      setPostLottery(true);
      await loadRuns();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lottery run failed');
    } finally { setBusy(false); }
  };

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <div>
      <h1>Admin · Run Lottery</h1>
      <AdminNav />
      <ErrorBanner message={error} />

      {postLottery && (
        <div className="error">
          The lottery has <b>already been run</b> for this year (post-lottery). Committing a new draw is disabled to
          avoid disrupting existing offers and waitlists. To re-run it, turn off the <b>Post-lottery</b> gate in{' '}
          <Link to="/admin/settings">Settings</Link> first.
        </div>
      )}

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
        <button className="secondary" onClick={() => void doPreview()} disabled={busy}>Preview a sample draw</button>
      </div>

      {preview && !committed && (
        <>
          <div className="card">
            <h2>Sample draw (illustrative)</h2>
            <div className="warn-box">
              ⚠️ This is <b>one random sample</b> of what a draw might look like — <b>not</b> the official result.
              The live lottery uses a separate random draw that no one has seen, so the actual offers and waitlist
              order <b>will differ</b> from this sample. Run it again for a different sample.
            </div>
            <p className="muted">
              In this sample: {preview.totals.initialCount} entrants · {preview.totals.offered} offered ·
              {' '}{preview.totals.waitlisted} waitlisted · {preview.totals.siblingPulls} sibling pulls
            </p>
            <table>
              <thead><tr><th>Grade</th><th>Offered</th><th>Wait</th><th>Sibling wait</th></tr></thead>
              <tbody>
                {preview.byGrade.map((g) => (
                  <tr key={g.grade}><td>{g.grade}</td><td>{g.offered}</td><td>{g.wait}</td><td>{g.sibWait}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Run the official lottery</h2>
            <p className="muted">
              This performs a <b>brand-new random draw</b> (independent of the sample above), places every student, and
              cannot be undone. Make sure the caps are correct first.
            </p>
            <button className="danger" onClick={() => void doCommit()} disabled={busy || postLottery}>
              Run official lottery
            </button>
          </div>
        </>
      )}

      {committed && (
        <div className="card center">
          <h2>Official lottery complete ✓</h2>
          <p className="muted">
            Run #{committed.runId} recorded{committedSeed ? <> · draw seed <code>{committedSeed}</code></> : null}. Offers can now be sent.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Past lottery runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No draws recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Run</th><th>When</th><th>Year</th><th>Offered</th><th>Wait</th><th>Sib wait</th><th>Draw seed</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}{r.committed ? '' : ' (preview)'}</td>
                  <td>{fmtDate(r.ranAt)}</td>
                  <td>{r.year}</td>
                  <td>{r.offered}</td>
                  <td>{r.waitlisted}</td>
                  <td>{r.sibWait}</td>
                  <td><code>{r.seed}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
