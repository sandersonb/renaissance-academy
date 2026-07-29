import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, ApiError, type AdminList as AdminListData } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const gradeLabel = (g: number) => (g === 0 ? 'K' : String(g));

// Reg_Status values with their canonical labels (kept in sync with HUMANIFY).
const STATUSES: { value: string; label: string }[] = [
  { value: 'ACPT_REENROLL', label: 'Accepted Re-Enrollment' },
  { value: 'PEND_OFFER', label: 'Offer Pending' },
  { value: 'OFFER', label: 'Offer Extended' },
  { value: 'IP_OFFER', label: 'Acceptance In Progress' },
  { value: 'PEND_REGISTER', label: 'Awaiting Paperwork' },
  { value: 'FIN_REGISTER', label: 'Paperwork Incomplete' },
  { value: 'REGISTER', label: 'Registered' },
  { value: 'INITIAL', label: 'Awaiting Lottery' },
  { value: 'WAIT', label: 'Waitlisted' },
  { value: 'SIB_WAIT', label: 'Sibling Waitlisted' },
  { value: 'IP_REENROLL', label: 'Re-Enrollment In Progress' },
  { value: 'PEND_REENROLL', label: 'Re-Enrollment Pending' },
  { value: 'DECLINE', label: 'Declined Offer' },
  { value: 'DECL_REENROLL', label: 'Declined Re-Enrollment' },
];
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function AdminList() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<AdminListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grade = params.get('grade') ?? '';
  const status = params.get('status') ?? '';
  const name = params.get('name') ?? '';

  useEffect(() => {
    setData(null);
    setError(null);
    adminApi
      .list({ grade, status, name })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load list'));
  }, [grade, status, name]);

  // Update a single filter, preserving the others (and dropping empties).
  const setFilter = (key: 'grade' | 'status' | 'name', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const anyWaitlist = !!data?.results.some((r) => r.waitlistRank != null);

  return (
    <div>
      <h1>Admin · Students</h1>
      <AdminNav />
      <ErrorBanner message={error} />

      <div className="card">
        <div className="row">
          <label>
            Grade
            <select value={grade} onChange={(e) => setFilter('grade', e.target.value)}>
              <option value="">All grades</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setFilter('name', e.target.value)} placeholder="First or last name" />
          </label>
        </div>
      </div>

      {data && (
        <div className="card">
          <p className="muted">{data.count} student{data.count === 1 ? '' : 's'}</p>
          {data.count === 0 ? (
            <p className="muted">No students match this filter.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {anyWaitlist && <th style={{ width: '3rem' }}>Rank</th>}
                  <th>Student</th>
                  <th>Grade</th>
                  <th>Status</th>
                  <th>Family</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.childId}>
                    {anyWaitlist && <td>{r.waitlistRank ?? ''}</td>}
                    <td>
                      {r.firstName} {r.lastName}
                    </td>
                    <td>{gradeLabel(r.gradeNextYear)}</td>
                    <td>
                      <span className="badge">{r.statusLabel}</span>
                    </td>
                    <td>
                      <Link to={`/admin/family/${r.parentId}`}>{r.parentName ?? `Family #${r.parentId}`}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
