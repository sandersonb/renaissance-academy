import { useState } from 'react';
import { adminApi, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

type Validation = { ok: boolean; rowCount: number; errors: { line: number; message: string }[]; byGrade: Record<number, number> };

/** Start-new-year section: purge the prior year and import the current-student roster. */
export function RollYearPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [valid, setValid] = useState<Validation | null>(null);
  const [done, setDone] = useState<{ imported: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
    setValid(null);
    setDone(null);
  };

  const validate = async () => {
    setError(null); setDone(null); setBusy(true);
    try { setValid(await adminApi.validateRollYear(csv)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Validation failed'); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!confirm('This PURGES all current applicants/parents and imports the new roster. Did you take a database backup first?')) return;
    setError(null); setBusy(true);
    try { setDone(await adminApi.commitRollYear(year, csv)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Roll-year failed'); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <h2 className="section">Start a new lottery year</h2>
      <div className="error">
        ⚠️ This wipes all applicants, parents, and answers for the prior year and imports
        the new current-student roster. <b>Back up the database first.</b>
      </div>
      <ErrorBanner message={error} />

      <div className="card">
        <label>Enrollment year (year_begin)</label>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <label>Current-student roster CSV</label>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        {fileName && <p className="muted">{fileName} ({csv.length} bytes)</p>}
        <button onClick={() => void validate()} disabled={!csv || busy}>Validate roster</button>
      </div>

      {valid && !done && (
        <div className="card">
          <h3>Validation</h3>
          <p className="muted">{valid.rowCount} students · by grade {JSON.stringify(valid.byGrade)}</p>
          {valid.errors.length > 0 && (
            <div className="error">
              {valid.errors.length} error(s):
              <ul>{valid.errors.slice(0, 10).map((e) => <li key={e.line}>line {e.line}: {e.message}</li>)}</ul>
            </div>
          )}
          <button className="danger" disabled={!valid.ok || busy} onClick={() => void commit()}>
            Purge &amp; import {valid.rowCount} students for {year}
          </button>
        </div>
      )}

      {done && (
        <div className="card center">
          <h3>New year started ✓</h3>
          <p className="muted">Imported {done.imported} current students. The new year and gates are now in effect.</p>
        </div>
      )}
    </section>
  );
}
