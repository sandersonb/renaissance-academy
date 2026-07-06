import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

export function ForgotPassword() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ devToken?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setSent(await api.forgot(username, email));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="card">
        <h1>Check your email</h1>
        <p>If an account matches that username and email, a reset link has been sent.</p>
        {sent.devToken && (
          <p className="muted">Dev: <Link to={`/reset?token=${sent.devToken}`}>open reset link →</Link></p>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Reset your password</h1>
      <p className="muted">Enter your username and the email on your account.</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit}>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" disabled={busy}>Send reset link</button>
      </form>
      <p className="muted"><Link to="/login">Back to sign in</Link></p>
    </div>
  );
}
