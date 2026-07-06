import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/Layout';

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

export function Register() {
  const [form, setForm] = useState({
    username: '', password: '', firstName: '', lastName: '', relationship: 'Parent',
    email: '', homePhone: '', address: '', city: '', state: 'UT', zip: '',
    returning: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ token?: string } | null>(null);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { confirmToken } = await api.register(form);
      setDone({ token: confirmToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card">
        <h1>Check your email</h1>
        <p>A verification link has been sent. Mark <b>enrollment@renacademy.org</b> as a safe sender.</p>
        {/* Dev only: the server returns the token when there is no real email delivery. */}
        {done.token && (
          <p className="muted">Dev (no email configured): <Link to={`/confirm?token=${done.token}`}>continue to confirmation →</Link></p>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Create a parent account</h1>
      <div className="info">
        This creates your <b>parent / guardian account</b>. You are <b>not</b> registering a student here —
        after you sign in and verify your email, you'll add your student(s) to the lottery from your dashboard.
      </div>
      <ErrorBanner message={error} />

      <form onSubmit={submit}>
        <fieldset>
          <legend>Parent / guardian information</legend>
          <div className="row">
            <div><label>First name</label><input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
            <div><label>Last name</label><input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
          </div>
          <label>Relationship to student(s)</label>
          <input value={form.relationship} onChange={(e) => set('relationship', e.target.value)} placeholder="Parent, Guardian, …" />
          <label className="choice">
            <input type="checkbox" checked={form.returning} onChange={(e) => set('returning', e.target.checked)} />
            We are a returning Renaissance Academy family
          </label>
        </fieldset>

        <fieldset>
          <legend>Contact</legend>
          <label>Email</label>
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <label>Home phone</label>
          <input value={form.homePhone} onChange={(e) => set('homePhone', e.target.value)} placeholder="8015551234" />
        </fieldset>

        <fieldset>
          <legend>Address</legend>
          <label>Street address</label>
          <input value={form.address} onChange={(e) => set('address', e.target.value)} />
          <div className="row">
            <div style={{ flexGrow: 3 }}><label>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div style={{ flexGrow: 1 }}>
              <label>State</label>
              <select value={form.state} onChange={(e) => set('state', e.target.value)}>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flexGrow: 1 }}><label>ZIP</label><input value={form.zip} onChange={(e) => set('zip', e.target.value)} maxLength={5} /></div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Sign-in credentials</legend>
          <div className="row">
            <div><label>Username</label><input value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="username" /></div>
            <div><label>Password</label><input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></div>
          </div>
        </fieldset>

        <button type="submit" disabled={busy}>Create account</button>
      </form>
      <p className="muted">Already registered? <Link to="/login">Sign in</Link></p>
    </div>
  );
}
