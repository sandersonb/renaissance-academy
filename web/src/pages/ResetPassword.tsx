import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card center">
        <h1>Password updated</h1>
        <Link to="/login"><button>Sign in</button></Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Choose a new password</h1>
      <ErrorBanner message={error} />
      {!token && <p className="error">Missing reset token.</p>}
      <form onSubmit={submit}>
        <label>New password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <button type="submit" disabled={busy || !token}>Update password</button>
      </form>
    </div>
  );
}
