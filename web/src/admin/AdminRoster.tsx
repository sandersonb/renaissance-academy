import { useCallback, useEffect, useState } from 'react';
import { adminApi, ApiError, type RosterStudent } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const gradeLabel = (g: number) => (g === 0 ? 'K' : String(g));
const GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// The re-enrollment lifecycle a current student moves through.
const STATUSES = ['PEND_REENROLL', 'IP_REENROLL', 'ACPT_REENROLL', 'DECL_REENROLL'];

const blankForm = () => ({ firstName: '', middleName: '', lastName: '', gender: '', dob: '', grade: '', regStatus: 'PEND_REENROLL' });
type Form = ReturnType<typeof blankForm>;
const toForm = (s: RosterStudent): Form => ({
  firstName: s.firstName, middleName: s.middleName ?? '', lastName: s.lastName,
  gender: s.gender ?? '', dob: s.dob, grade: String(s.grade), regStatus: s.regStatus,
});

function StudentFields({ form, set }: { form: Form; set: (f: Partial<Form>) => void }) {
  return (
    <div className="field-grid">
      <label>First name<input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} /></label>
      <label>Middle<input value={form.middleName} onChange={(e) => set({ middleName: e.target.value })} /></label>
      <label>Last name<input value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} /></label>
      <label>Gender<input value={form.gender} onChange={(e) => set({ gender: e.target.value })} /></label>
      <label>Grade
        <select value={form.grade} onChange={(e) => set({ grade: e.target.value })}>
          <option value="">—</option>
          {GRADES.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
        </select>
      </label>
      <label>Date of birth<input type="date" value={form.dob} onChange={(e) => set({ dob: e.target.value })} /></label>
      <label>Status
        <select value={form.regStatus} onChange={(e) => set({ regStatus: e.target.value })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </div>
  );
}

export function AdminRoster() {
  const [roster, setRoster] = useState<RosterStudent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState('');
  const [name, setName] = useState('');

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<Form>(blankForm());
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Form>(blankForm());

  const load = useCallback(async () => {
    setError(null);
    try {
      setRoster((await adminApi.rosterList({ grade, name })).roster);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load roster');
    }
  }, [grade, name]);
  useEffect(() => { void load(); }, [load]);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  const add = async () => {
    try { await adminApi.rosterCreate(addForm); setAdding(false); setAddForm(blankForm()); await load(); }
    catch (err) { fail(err, 'Could not add student'); }
  };
  const saveEdit = async (childId: number) => {
    try { await adminApi.rosterUpdate(childId, editForm); setEditId(null); await load(); }
    catch (err) { fail(err, 'Could not save'); }
  };
  const del = async (s: RosterStudent) => {
    if (!confirm(`Remove ${s.firstName} ${s.lastName} from the current-student roster?`)) return;
    try { await adminApi.rosterDelete(s.childId); await load(); }
    catch (err) { fail(err, 'Delete failed'); }
  };

  return (
    <div>
      <h1>Admin · Current-Student Roster</h1>
      <AdminNav />
      <ErrorBanner message={error} />
      <p className="muted">
        The roster of students currently attending — matched against during re-enrollment. Edit here to correct a
        returning student’s name, DOB, or grade before re-enrollment opens.
      </p>

      <div className="card">
        <div className="row">
          <label>Grade
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">All grades</option>
              {GRADES.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
            </select>
          </label>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First or last name" />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>{roster ? `${roster.length} student${roster.length === 1 ? '' : 's'}` : 'Loading…'}</h2>
          {!adding && <button className="small secondary" onClick={() => { setAddForm(blankForm()); setAdding(true); }}>Add student</button>}
        </div>

        {adding && (
          <div className="subcard">
            <StudentFields form={addForm} set={(f) => setAddForm((s) => ({ ...s, ...f }))} />
            <div className="row-actions">
              <button onClick={() => void add()}>Add</button>
              <button className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        {roster && roster.length > 0 && (
          <table>
            <thead>
              <tr><th>Name</th><th>Grade</th><th>DOB</th><th>Gender</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {roster.map((s) =>
                editId === s.childId ? (
                  <tr key={s.childId}>
                    <td colSpan={6}>
                      <StudentFields form={editForm} set={(f) => setEditForm((v) => ({ ...v, ...f }))} />
                      <div className="row-actions">
                        <button className="small" onClick={() => void saveEdit(s.childId)}>Save</button>
                        <button className="small secondary" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.childId}>
                    <td>{s.firstName} {s.middleName ? `${s.middleName} ` : ''}{s.lastName}</td>
                    <td>{gradeLabel(s.grade)}</td>
                    <td>{s.dob}</td>
                    <td>{s.gender || '—'}</td>
                    <td><span className="badge">{s.regStatus}</span></td>
                    <td>
                      <button className="small secondary" onClick={() => { setEditForm(toForm(s)); setEditId(s.childId); }}>Edit</button>{' '}
                      <button className="small danger" onClick={() => void del(s)}>Delete</button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
        {roster && roster.length === 0 && <p className="muted">No students match this filter.</p>}
      </div>
    </div>
  );
}
