import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, ApiError, type Question } from '../api';
import { ErrorBanner } from '../components/Layout';
import { SurveyQuestion, type SurveyAnswer } from '../components/SurveyQuestion';

// Accepting an offer walks the grade-scoped registration (Type A) survey, then
// moves the student to "Awaiting Paperwork" (RULES_SPEC §9).
export function AcceptOffer() {
  const { id } = useParams();
  const childId = Number(id);
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [question, setQuestion] = useState<Question | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const started = useRef(false);

  const handle = (r: { needsSurvey: boolean; question?: Question }) => {
    if (r.needsSurvey && r.question) setQuestion(r.question);
    else void refresh().then(() => nav('/dashboard'));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .accept(childId)
      .then(handle)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not accept offer'))
      .finally(() => setBusy(false));
  }, [childId]);

  const answer = async (a: SurveyAnswer) => {
    setBusy(true);
    setError(null);
    try {
      handle(await api.acceptAnswer(childId, a.extraIds));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your answer');
    } finally {
      setBusy(false);
    }
  };

  if (busy && !question) return <div className="card">Working…</div>;

  return (
    <div>
      <h1>Accept offer</h1>
      <p className="muted">Please answer a couple of placement questions to complete acceptance.</p>
      <ErrorBanner message={error} />
      {question && <SurveyQuestion question={question} onSubmit={answer} busy={busy} />}
    </div>
  );
}
