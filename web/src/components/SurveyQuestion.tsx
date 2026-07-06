import { useState } from 'react';
import type { Question } from '../api';

export interface SurveyAnswer {
  /** chosen option ids (for ChildExtra / registration questions) */
  extraIds: number[];
  /** chosen option values or typed text (for ParentExtra / lottery questions) */
  values: string[];
}

/**
 * Generic, data-driven survey renderer (deviation B8). Renders ANY question
 * purely from `inputType` + `options` — no per-question code. Emits both the
 * option ids and the values so the caller can store the form the backend needs
 * (ChildExtra uses ids; ParentExtra uses value text).
 */
export function SurveyQuestion({
  question,
  onSubmit,
  busy,
}: {
  question: Question;
  onSubmit: (answer: SurveyAnswer) => void;
  busy?: boolean;
}) {
  const [text, setText] = useState('');
  const [single, setSingle] = useState<number | null>(null);
  const [multi, setMulti] = useState<Set<number>>(new Set());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const optById = new Map(question.options.map((o) => [o.extraId, o.value ?? '']));
    if (question.inputType === 'single_select') {
      if (single == null) return;
      onSubmit({ extraIds: [single], values: [optById.get(single) ?? ''] });
    } else if (question.inputType === 'multi_select') {
      const ids = [...multi];
      onSubmit({ extraIds: ids, values: ids.map((id) => optById.get(id) ?? '') });
    } else {
      onSubmit({ extraIds: [], values: [text] });
    }
  };

  const toggle = (id: number) =>
    setMulti((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <form onSubmit={submit} className="card survey">
      <p className="question">{question.question}</p>

      {question.inputType === 'single_select' &&
        question.options.map((o) => (
          <label key={o.extraId} className="choice">
            <input type="radio" name="opt" checked={single === o.extraId} onChange={() => setSingle(o.extraId)} />
            {o.value}
          </label>
        ))}

      {question.inputType === 'multi_select' &&
        question.options.map((o) => (
          <label key={o.extraId} className="choice">
            <input type="checkbox" checked={multi.has(o.extraId)} onChange={() => toggle(o.extraId)} />
            {o.value}
          </label>
        ))}

      {question.inputType === 'text' && (
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      {question.inputType === 'textarea' && (
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      )}
      {question.inputType === 'date' && (
        <input type="date" value={text} onChange={(e) => setText(e.target.value)} />
      )}

      <button type="submit" disabled={busy}>Continue</button>
    </form>
  );
}
