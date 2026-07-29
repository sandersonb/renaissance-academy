import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi, ApiError, type AdminFamily as Family, type FamilyChild } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const gradeLabel = (g: number) => (g === 0 ? 'K' : String(g));
const GRADE_OPTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ALL_STATUSES = [
  'INITIAL', 'PEND_OFFER', 'OFFER', 'IP_OFFER', 'WAIT', 'SIB_WAIT',
  'PEND_REGISTER', 'FIN_REGISTER', 'REGISTER', 'DECLINE',
  'PEND_REENROLL', 'IP_REENROLL', 'ACPT_REENROLL', 'DECL_REENROLL',
];

// Editable parent fields, rendered in order.
const PARENT_FIELDS: { key: string; label: string }[] = [
  { key: 'firstName', label: 'First name' }, { key: 'lastName', label: 'Last name' },
  { key: 'relationship', label: 'Relationship' }, { key: 'email', label: 'Email' },
  { key: 'alternateEmail', label: 'Alternate email' }, { key: 'homePhone', label: 'Home phone' },
  { key: 'otherPhone', label: 'Other phone' }, { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'zip', label: 'ZIP' },
];

export function AdminFamily() {
  const parentId = Number(useParams().parentId);
  const [fam, setFam] = useState<Family | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [editingParent, setEditingParent] = useState(false);
  const [pForm, setPForm] = useState<Record<string, string>>({});

  const [editChildId, setEditChildId] = useState<number | null>(null);
  const [cForm, setCForm] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Record<number, string>>({});
  const [forceId, setForceId] = useState<number | null>(null);
  const [forceTarget, setForceTarget] = useState('');

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      setFam(await adminApi.family(parentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }, [parentId]);
  useEffect(() => { void load(); }, [load]);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  // --- Parent edit ---
  const startEditParent = () => {
    const p = fam?.parent;
    if (!p) return;
    setPForm({
      firstName: p.firstName, lastName: p.lastName, relationship: p.relationship, email: p.email,
      alternateEmail: p.alternateEmail ?? '', homePhone: p.homePhone, otherPhone: p.otherPhone ?? '',
      address: p.address, city: p.city, state: p.state, zip: String(p.zip ?? ''),
    });
    setEditingParent(true);
  };
  const saveParent = async () => {
    try {
      await adminApi.updateParent(parentId, pForm);
      setEditingParent(false);
      await load();
    } catch (err) { fail(err, 'Could not save parent'); }
  };

  // --- Child status (guarded) + force override ---
  const change = async (childId: number) => {
    const status = target[childId];
    if (!status) return;
    try { await adminApi.changeStatus(childId, status); await load(); }
    catch (err) { fail(err, 'Change failed'); }
  };
  const applyForce = async (childId: number) => {
    if (!forceTarget) return;
    if (!confirm(`Force this student's status to ${forceTarget}? This bypasses the normal rules and side-effects.`)) return;
    try { await adminApi.forceStatus(childId, forceTarget); setForceId(null); setForceTarget(''); await load(); }
    catch (err) { fail(err, 'Force failed'); }
  };

  // --- Child edit / delete / add ---
  const startEditChild = (c: FamilyChild) => {
    setCForm({
      firstName: c.firstName, middleName: c.middleName ?? '', lastName: c.lastName,
      gender: c.gender ?? '', gradeNextYear: String(c.gradeNextYear), dob: c.dob,
    });
    setEditChildId(c.childId);
  };
  const saveChild = async (childId: number) => {
    try { await adminApi.updateChild(childId, cForm); setEditChildId(null); await load(); }
    catch (err) { fail(err, 'Could not save student'); }
  };
  const delChild = async (c: FamilyChild) => {
    if (!confirm(`Delete ${c.firstName} ${c.lastName}? This permanently removes the student record.`)) return;
    try { await adminApi.deleteChild(c.childId); await load(); }
    catch (err) { fail(err, 'Delete failed'); }
  };
  const addChild = async () => {
    try {
      await adminApi.addFamilyChild(parentId, addForm);
      setAdding(false); setAddForm({});
      await load();
    } catch (err) { fail(err, 'Could not add student'); }
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    try { await adminApi.addNote(parentId, note); setNote(''); await load(); }
    catch (err) { fail(err, 'Could not add note'); }
  };

  if (!fam) return <p className="container">Loading…</p>;
  const p = fam.parent;

  return (
    <div>
      <h1>{p ? `${p.firstName} ${p.lastName}` : 'Family'}</h1>
      <AdminNav />
      <ErrorBanner message={error} />

      {/* Parent details */}
      <div className="card">
        <div className="card-head">
          <h2>Parent / Guardian</h2>
          {p && !editingParent && <button className="small secondary" onClick={startEditParent}>Edit</button>}
        </div>
        {!p ? (
          <p className="muted">No parent record.</p>
        ) : editingParent ? (
          <>
            <div className="field-grid">
              {PARENT_FIELDS.map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input value={pForm[f.key] ?? ''} onChange={(e) => setPForm((s) => ({ ...s, [f.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <div className="row-actions">
              <button onClick={() => void saveParent()}>Save</button>
              <button className="secondary" onClick={() => setEditingParent(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <dl className="detail">
            <div><dt>Relationship</dt><dd>{p.relationship || '—'}</dd></div>
            <div><dt>Email</dt><dd>{p.email}</dd></div>
            <div><dt>Alternate email</dt><dd>{p.alternateEmail || '—'}</dd></div>
            <div><dt>Home phone</dt><dd>{p.homePhone || '—'}</dd></div>
            <div><dt>Other phone</dt><dd>{p.otherPhone || '—'}</dd></div>
            <div><dt>Address</dt><dd>{[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ') || '—'}</dd></div>
            <div><dt>Returning family</dt><dd>{p.returning ? 'Yes' : 'No'}</dd></div>
          </dl>
        )}
      </div>

      {/* Students */}
      <div className="card">
        <div className="card-head">
          <h2>Students</h2>
          {!adding && <button className="small secondary" onClick={() => setAdding(true)}>Add student</button>}
        </div>

        {adding && (
          <div className="subcard">
            <div className="field-grid">
              <label>First name<input value={addForm.firstName ?? ''} onChange={(e) => setAddForm((s) => ({ ...s, firstName: e.target.value }))} /></label>
              <label>Middle name<input value={addForm.middleName ?? ''} onChange={(e) => setAddForm((s) => ({ ...s, middleName: e.target.value }))} /></label>
              <label>Last name<input value={addForm.lastName ?? ''} onChange={(e) => setAddForm((s) => ({ ...s, lastName: e.target.value }))} /></label>
              <label>Gender<input value={addForm.gender ?? ''} onChange={(e) => setAddForm((s) => ({ ...s, gender: e.target.value }))} /></label>
              <label>Grade (next year)
                <select value={addForm.gradeNextYear ?? ''} onChange={(e) => setAddForm((s) => ({ ...s, gradeNextYear: e.target.value }))}>
                  <option value="">—</option>
                  {GRADE_OPTS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
                </select>
              </label>
              <label>Date of birth<input type="date" value={addForm.dob ?? ''} onChange={(e) => setAddForm((s) => ({ ...s, dob: e.target.value }))} /></label>
            </div>
            <div className="row-actions">
              <button onClick={() => void addChild()}>Add</button>
              <button className="secondary" onClick={() => { setAdding(false); setAddForm({}); }}>Cancel</button>
            </div>
          </div>
        )}

        {fam.children.length === 0 && <p className="muted">No students.</p>}
        {fam.children.map((c) => (
          <div className="subcard" key={c.childId}>
            {editChildId === c.childId ? (
              <>
                <div className="field-grid">
                  <label>First name<input value={cForm.firstName ?? ''} onChange={(e) => setCForm((s) => ({ ...s, firstName: e.target.value }))} /></label>
                  <label>Middle name<input value={cForm.middleName ?? ''} onChange={(e) => setCForm((s) => ({ ...s, middleName: e.target.value }))} /></label>
                  <label>Last name<input value={cForm.lastName ?? ''} onChange={(e) => setCForm((s) => ({ ...s, lastName: e.target.value }))} /></label>
                  <label>Gender<input value={cForm.gender ?? ''} onChange={(e) => setCForm((s) => ({ ...s, gender: e.target.value }))} /></label>
                  <label>Grade (next year)
                    <select value={cForm.gradeNextYear ?? ''} onChange={(e) => setCForm((s) => ({ ...s, gradeNextYear: e.target.value }))}>
                      {GRADE_OPTS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
                    </select>
                  </label>
                  <label>Date of birth<input type="date" value={cForm.dob ?? ''} onChange={(e) => setCForm((s) => ({ ...s, dob: e.target.value }))} /></label>
                </div>
                <div className="row-actions">
                  <button onClick={() => void saveChild(c.childId)}>Save</button>
                  <button className="secondary" onClick={() => setEditChildId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="card-head">
                  <b>{c.firstName} {c.middleName ? `${c.middleName} ` : ''}{c.lastName}</b>
                  <span>
                    <button className="small secondary" onClick={() => startEditChild(c)}>Edit</button>{' '}
                    <button className="small danger" onClick={() => void delChild(c)}>Delete</button>
                  </span>
                </div>
                <p className="muted">
                  Grade {gradeLabel(c.gradeNextYear)} · DOB {c.dob} · <span className="badge">{c.statusLabel}</span>
                  {c.waitlistRank != null && <> · wait rank #{c.waitlistRank}</>}
                  {c.expiration && <> · expires {c.expiration}</>}
                </p>

                {c.answers.length > 0 && (
                  <ul className="answers">
                    {c.answers.map((a, i) => (
                      <li key={i}><span className="muted">{a.brief || a.question}:</span> {a.value}</li>
                    ))}
                  </ul>
                )}

                <div className="row-actions">
                  <label className="inline">
                    Change status
                    <select value={target[c.childId] ?? ''} onChange={(e) => setTarget((t) => ({ ...t, [c.childId]: e.target.value }))}>
                      <option value="">—</option>
                      {c.transitions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <button className="small secondary" disabled={c.transitions.length === 0} onClick={() => void change(c.childId)}>Apply</button>
                  <button className="small link" onClick={() => { setForceId(forceId === c.childId ? null : c.childId); setForceTarget(''); }}>
                    {forceId === c.childId ? 'Cancel override' : 'Force status…'}
                  </button>
                </div>
                {c.transitions.length === 0 && <p className="muted">No standard transitions from this status — use “Force status” if needed.</p>}

                {forceId === c.childId && (
                  <div className="warn-box">
                    <strong>Force raw status</strong> — bypasses capacity/sibling rules. Logged as a note.
                    <div className="row-actions">
                      <select value={forceTarget} onChange={(e) => setForceTarget(e.target.value)}>
                        <option value="">Select status…</option>
                        {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button className="small danger" disabled={!forceTarget} onClick={() => void applyForce(c.childId)}>Force</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="card">
        <h2>Notes</h2>
        {fam.notes.length === 0 && <p className="muted">No notes yet.</p>}
        <ul>
          {fam.notes.map((n) => (
            <li key={n.id}><span className="muted">{n.date.slice(0, 10)}:</span> {n.note}</li>
          ))}
        </ul>
        <form onSubmit={submitNote}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. called parent re: paperwork)" />
          <button type="submit">Add note</button>
        </form>
      </div>
    </div>
  );
}
