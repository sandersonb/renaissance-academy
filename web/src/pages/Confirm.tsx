import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type Question } from '../api';
import { ErrorBanner } from '../components/Layout';
import { SurveyQuestion, type SurveyAnswer } from '../components/SurveyQuestion';

// Email confirmation. Non-returning families answer the lottery (Type B) survey
// here before the account is activated (RULES_SPEC §9).
export function Confirm() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [question, setQuestion] = useState<Question | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // guard React 18 StrictMode double-invoke
    started.current = true;
    if (!token) {
      setError('Missing confirmation token.');
      setBusy(false);
      return;
    }
    api
      .confirm(token)
      .then((r) => {
        setConfirmed(r.confirmed);
        setQuestion(r.question ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Confirmation failed'))
      .finally(() => setBusy(false));
  }, [token]);

  const answer = async (a: SurveyAnswer) => {
    if (!question) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.confirmAnswer(token, question.titleId, a.values);
      setConfirmed(r.confirmed);
      setQuestion(r.question ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your answer');
    } finally {
      setBusy(false);
    }
  };

  if (busy && !question) return <div className="card">Verifying…</div>;

  if (confirmed) {
    return (
      <div className="card center">
        <h1>You're all set!</h1>
        <p>Your account has been verified.</p>
        <Link to="/login"><button>Continue to sign in</button></Link>
      </div>
    );
  }

  return (
    <div>
      <h1>A few quick questions</h1>
      <p className="muted">Collected for research only — this does not affect the lottery outcome.</p>
      <ErrorBanner message={error} />
      {question && <SurveyQuestion question={question} onSubmit={answer} busy={busy} />}
    </div>
  );
}
