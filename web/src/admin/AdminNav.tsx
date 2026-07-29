import { Link } from 'react-router-dom';

/** Shared admin navigation shown at the top of every admin page. */
export function AdminNav() {
  return (
    <p className="muted">
      <Link to="/admin">Dashboard</Link> · <Link to="/admin/search">Search</Link> ·{' '}
      <Link to="/admin/reports">Reports</Link> · <Link to="/admin/roster">Roster</Link> ·{' '}
      <Link to="/admin/lottery">Run Lottery</Link> · <Link to="/admin/survey">Survey Questions</Link> ·{' '}
      <Link to="/admin/documents">Paperwork</Link> · <Link to="/admin/settings">Settings</Link>
    </p>
  );
}
