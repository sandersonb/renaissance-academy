import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

const GRADES = [
  { v: 0, label: 'Kindergarten' }, { v: 1, label: 'First' }, { v: 2, label: 'Second' },
  { v: 3, label: 'Third' }, { v: 4, label: 'Fourth' }, { v: 5, label: 'Fifth' },
  { v: 6, label: 'Sixth' }, { v: 7, label: 'Seventh' }, { v: 8, label: 'Eighth' }, { v: 9, label: 'Ninth' },
];
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function AddChild() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({
    firstName: '', middleName: '', lastName: '', gender: '',
    dobMonth: '', dobDay: '', dobYear: '', gradeNextYear: '',
    current: false, sibling: false, preference: false, notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.addChild({
        ...f,
        dobMonth: Number(f.dobMonth), dobDay: Number(f.dobDay), dobYear: Number(f.dobYear),
        gradeNextYear: f.gradeNextYear === '' ? undefined : Number(f.gradeNextYear),
      });
      await refresh();
      nav(res.needsLanguagePreference ? `/children/${res.childId}/language` : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add student');
    } finally {
      setBusy(false);
    }
  };

  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - 5 - i);

  return (
    <div className="card">
      <h1>Add a student</h1>
      <ErrorBanner message={error} />
      <form onSubmit={submit}>
        <div className="row">
          <div><label>First name</label><input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
          <div><label>Middle</label><input value={f.middleName} onChange={(e) => set('middleName', e.target.value)} /></div>
          <div><label>Last name</label><input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
        </div>
        <label>Gender</label>
        <select value={f.gender} onChange={(e) => set('gender', e.target.value)}>
          <option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
        </select>
        <label>Date of birth</label>
        <div className="row">
          <select value={f.dobMonth} onChange={(e) => set('dobMonth', e.target.value)}>
            {MONTHS.map((m, i) => <option key={i} value={i || ''}>{m || 'Month'}</option>)}
          </select>
          <input placeholder="Day" value={f.dobDay} onChange={(e) => set('dobDay', e.target.value)} />
          <select value={f.dobYear} onChange={(e) => set('dobYear', e.target.value)}>
            <option value="">Year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: '0.6rem 0' }}>
          <label>Does this student…</label>
          <label className="choice"><input type="checkbox" checked={f.current} onChange={(e) => set('current', e.target.checked)} /> Currently attend Renaissance Academy? (re-enrollment)</label>
          <label className="choice"><input type="checkbox" checked={f.sibling} onChange={(e) => set('sibling', e.target.checked)} /> Have a sibling currently attending?</label>
          <label className="choice"><input type="checkbox" checked={f.preference} onChange={(e) => set('preference', e.target.checked)} /> Have a parent who is a founder or employee?</label>
        </fieldset>

        {!f.current && (
          <>
            <label>Grade next year</label>
            <select value={f.gradeNextYear} onChange={(e) => set('gradeNextYear', e.target.value)}>
              <option value="">—</option>
              {GRADES.map((g) => <option key={g.v} value={g.v}>{g.label}</option>)}
            </select>
            <p className="muted">Returning students' grade is taken from our records.</p>
          </>
        )}

        <label>Notes (optional)</label>
        <textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        <button type="submit" disabled={busy}>Add student</button>
      </form>
    </div>
  );
}
