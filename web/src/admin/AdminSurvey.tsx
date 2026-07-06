import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError, type AdminQuestion } from '../api';
import { ErrorBanner } from '../components/Layout';

const TYPES = ['text', 'textarea', 'single_select', 'multi_select', 'date'] as const;
const SELECT_TYPES = ['single_select', 'multi_select'];

export function AdminSurvey() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: '', lotteryQuestion: 1, inputType: 'single_select' as AdminQuestion['inputType'], grade: '' });

  const load = useCallback(async () => {
    setError(null);
    try { setQuestions((await adminApi.surveyList()).questions); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Load failed'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Action failed'); }
  };

  const section = (lq: number, title: string) => {
    const qs = questions.filter((q) => q.lotteryQuestion === lq);
    return (
      <div className="card">
        <h2>{title}</h2>
        {qs.length === 0 && <p className="muted">None.</p>}
        {qs.map((q) => <QuestionEditor key={q.titleId} q={q} run={run} />)}
      </div>
    );
  };

  return (
    <div>
      <h1>Admin · Survey Questions</h1>
      <p className="muted"><Link to="/admin">← search</Link></p>
      <ErrorBanner message={error} />

      <div className="card">
        <h2>Add a question</h2>
        <label>Question</label>
        <input value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
        <div className="row">
          <div>
            <label>Type</label>
            <select value={draft.inputType} onChange={(e) => setDraft({ ...draft, inputType: e.target.value as AdminQuestion['inputType'] })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>Set</label>
            <select value={draft.lotteryQuestion} onChange={(e) => setDraft({ ...draft, lotteryQuestion: Number(e.target.value) })}>
              <option value={1}>Lottery (at confirmation)</option>
              <option value={0}>Registration (at offer accept)</option>
            </select>
          </div>
          <div>
            <label>Grade scope</label>
            <input value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} placeholder="-6-7-8-9- (blank = all)" />
          </div>
        </div>
        <button disabled={!draft.question.trim()} onClick={() => void run(async () => {
          await adminApi.surveyCreate({ ...draft, grade: draft.grade || null });
          setDraft({ question: '', lotteryQuestion: 1, inputType: 'single_select', grade: '' });
        })}>Add question</button>
      </div>

      {section(1, 'Lottery questions (at confirmation)')}
      {section(0, 'Registration questions (at offer acceptance)')}
    </div>
  );
}

function QuestionEditor({ q, run }: { q: AdminQuestion; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [text, setText] = useState(q.question);
  const [grade, setGrade] = useState(q.grade ?? '');
  const [inputType, setInputType] = useState(q.inputType);
  const [sortOrder, setSortOrder] = useState(q.sortOrder);
  const [newOpt, setNewOpt] = useState('');

  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: '0.6rem', marginTop: '0.6rem', opacity: q.active ? 1 : 0.55 }}>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <div>
          <label>Type</label>
          <select value={inputType} onChange={(e) => setInputType(e.target.value as AdminQuestion['inputType'])}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><label>Grade scope</label><input value={grade} onChange={(e) => setGrade(e.target.value)} /></div>
        <div><label>Order</label><input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} /></div>
      </div>
      <button className="small secondary" onClick={() => void run(() => adminApi.surveyUpdate(q.titleId, { question: text, grade: grade || null, inputType, sortOrder }))}>Save</button>
      <button className="small" onClick={() => void run(() => adminApi.surveyUpdate(q.titleId, { active: !q.active }))}>{q.active ? 'Deactivate' : 'Reactivate'}</button>

      {SELECT_TYPES.includes(inputType) && (
        <div style={{ marginTop: '0.4rem' }}>
          <span className="muted">Options:</span>
          {q.options.map((o) => (
            <div key={o.extraId} className="row" style={{ alignItems: 'center' }}>
              <input defaultValue={o.value ?? ''} onBlur={(e) => { if (e.target.value !== o.value) void run(() => adminApi.surveyUpdateOption(o.extraId, e.target.value)); }} />
              <button className="small danger" style={{ flex: '0 0 auto' }} onClick={() => void run(() => adminApi.surveyDeleteOption(o.extraId))}>✕</button>
            </div>
          ))}
          <div className="row" style={{ alignItems: 'center' }}>
            <input value={newOpt} onChange={(e) => setNewOpt(e.target.value)} placeholder="New option" />
            <button className="small secondary" style={{ flex: '0 0 auto' }} disabled={!newOpt.trim()} onClick={() => void run(async () => { await adminApi.surveyAddOption(q.titleId, newOpt); setNewOpt(''); })}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
