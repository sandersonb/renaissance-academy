import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError, type AdminSummary, type SummaryRow } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

// Rows that emphasise capacity headroom get their own styling.
const ROW_CLASS: Record<SummaryRow['kind'], string> = { head: 'row-head', open: 'row-open', seat: '', info: '' };

function listHref(status: string | null, grade?: string): string {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (grade) qs.set('grade', grade);
  return `/admin/list?${qs.toString()}`;
}

// A count cell: a drill-down link when there's something to see, else plain text.
function CountCell({ value, href, className }: { value: number; href: string | null; className?: string }) {
  if (href && value > 0) {
    return (
      <td className={className}>
        <Link to={href}>{value}</Link>
      </td>
    );
  }
  return <td className={className}>{value}</td>;
}

export function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .summary()
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load summary'));
  }, []);

  const colCount = summary ? summary.grades.length + 2 : 0; // label + grades + total

  return (
    <div>
      <h1>Admin · Dashboard</h1>
      <AdminNav />
      <ErrorBanner message={error} />
      {!summary ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Enrollment by grade</h2>
          <p className="muted">Click any count to see the students behind it. Use the ⓘ for what a row means.</p>
          <div className="table-scroll">
            <table className="summary">
              <thead>
                <tr>
                  <th className="rowlabel">Description</th>
                  {summary.grades.map((g) => (
                    <th key={g}>
                      <Link to={listHref(null, g)}>{g}</Link>
                    </th>
                  ))}
                  <th className="total">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r, ri) => {
                  const firstInfo = r.kind === 'info' && summary.rows[ri - 1]?.kind !== 'info';
                  const open = openInfo === r.label;
                  return (
                    <Fragment key={r.label}>
                      <tr className={`${ROW_CLASS[r.kind]} ${firstInfo ? 'row-group-start' : ''}`.trim()}>
                        <th className="rowlabel">
                          <button
                            type="button"
                            className="info-btn"
                            aria-label={`What does “${r.label}” mean?`}
                            aria-expanded={open}
                            onClick={() => setOpenInfo(open ? null : r.label)}
                          >
                            ⓘ
                          </button>
                          {r.label}
                        </th>
                        {r.values.map((v, i) => (
                          <CountCell key={i} value={v} href={r.key ? listHref(r.key, summary.grades[i]) : null} />
                        ))}
                        <CountCell value={r.total} href={r.key ? listHref(r.key) : null} className="total" />
                      </tr>
                      {open && (
                        <tr className="info-row">
                          <td colSpan={colCount}>
                            <strong>{r.label}.</strong> {r.description}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
