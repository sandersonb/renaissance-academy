import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError, type SurveyReport } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const gradeLabel = (g: number | null) => (g == null ? '—' : g === 0 ? 'K' : String(g));
const qLabel = (brief: string | null, question: string) => brief || question;

// Build + download a CSV from the filtered responses.
function downloadCsv(rows: SurveyReport['responses']): void {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ['Question', 'Answer', 'Respondent', 'Grade', 'Type', 'Parent_ID'];
  const lines = rows.map((r) =>
    [qLabel(r.brief, r.question), r.value, r.subject, gradeLabel(r.grade), r.lotteryQuestion ? 'Lottery' : 'Registration', r.parentId]
      .map(esc)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'survey-responses.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminReports() {
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [questionFilter, setQuestionFilter] = useState<string>(''); // titleId as string, '' = all

  useEffect(() => {
    adminApi
      .reports()
      .then(setReport)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load reports'));
  }, []);

  const filtered = useMemo(() => {
    if (!report) return [];
    if (!questionFilter) return report.responses;
    const id = Number(questionFilter);
    return report.responses.filter((r) => r.titleId === id);
  }, [report, questionFilter]);

  if (!report) {
    return (
      <div>
        <h1>Admin · Reports</h1>
        <AdminNav />
        <ErrorBanner message={error} />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Admin · Reports</h1>
      <AdminNav />
      <ErrorBanner message={error} />

      {/* Answer tally, grouped by question */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Answer summary</h2>
        {report.questions.length === 0 && <p className="muted">No survey responses yet.</p>}
        {report.questions.map((q) => {
          const counts = report.counts.filter((c) => c.titleId === q.titleId);
          const total = counts.reduce((a, c) => a + c.count, 0);
          const max = Math.max(1, ...counts.map((c) => c.count));
          return (
            <div className="subcard" key={q.titleId}>
              <div className="card-head">
                <b>{qLabel(q.brief, q.question)}</b>
                <span className="badge">{q.lotteryQuestion ? 'Lottery' : 'Registration'} · {total}</span>
              </div>
              <table className="tally">
                <tbody>
                  {counts.map((c) => (
                    <tr key={c.value}>
                      <td className="tally-label">{c.value}</td>
                      <td className="tally-bar">
                        <span className="bar" style={{ width: `${(c.count / max) * 100}%` }} />
                      </td>
                      <td className="tally-count">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Detailed responses */}
      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>All responses</h2>
          <button className="small secondary" disabled={filtered.length === 0} onClick={() => downloadCsv(filtered)}>
            Export CSV
          </button>
        </div>
        <label className="inline" style={{ maxWidth: '28rem' }}>
          Filter by question
          <select value={questionFilter} onChange={(e) => setQuestionFilter(e.target.value)}>
            <option value="">All questions</option>
            {report.questions.map((q) => (
              <option key={q.titleId} value={q.titleId}>
                {qLabel(q.brief, q.question)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{filtered.length} response{filtered.length === 1 ? '' : 's'}</p>
        {filtered.length > 0 && (
          <table>
            <thead>
              <tr><th>Question</th><th>Answer</th><th>Respondent</th><th>Grade</th><th>Family</th></tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i}>
                  <td>{qLabel(r.brief, r.question)}</td>
                  <td>{r.value}</td>
                  <td>{r.subject}</td>
                  <td>{gradeLabel(r.grade)}</td>
                  <td><Link to={`/admin/family/${r.parentId}`}>#{r.parentId}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
