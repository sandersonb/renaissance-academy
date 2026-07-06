import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, ApiError, type PublicSettings } from '../api';
import { ErrorBanner } from '../components/Layout';

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      nav('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const year = settings?.schoolYear;

  return (
    <div className="card">
      <h1>Renaissance Academy Lottery Registration{year ? ` — ${year}` : ''}</h1>

      {settings && (
        <p>
          {settings.homeNotice}{' '}
          <Link to="/register">Create an account</Link>.
        </p>
      )}

      <h2>{year ? `Existing ${year} users` : 'Existing users'}</h2>
      <p className="muted">Enter your username and password.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit}>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button type="submit" disabled={busy}>Log in</button>
      </form>
      <p className="muted">New family? <Link to="/register">Create an account</Link></p>
      <p className="muted"><Link to="/forgot">Forgot your password?</Link></p>
    </div>
  );
}
