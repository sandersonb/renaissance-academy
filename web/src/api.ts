// Typed client for the enrollment API. Cookies (the session) flow via
// credentials:'include'; in dev the Vite proxy makes /api same-origin.

export type SurveyInputType = 'text' | 'textarea' | 'single_select' | 'multi_select' | 'date';

export interface SurveyOption {
  extraId: number;
  titleId: number;
  value: string | null;
}

export interface Question {
  titleId: number;
  question: string;
  brief: string | null;
  inputType: SurveyInputType;
  options: SurveyOption[];
}

export interface ChildView {
  childId: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  grade: string;
  dob: string;
  status: string;
  statusLabel: string;
  waitlistRank: number | null;
}

export interface Me {
  parentId: number;
  firstName: string | null;
  children: ChildView[];
}

export interface AcceptResult {
  needsSurvey: boolean;
  question?: Question;
  status: string;
}

export interface PublicSettings {
  yearBegin: number;
  schoolYear: string;
  lotteryOpen: boolean;
  postLottery: boolean;
  homeNotice: string;
  emailDev: boolean;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error === 'validation' ? (body.issues ?? []).join('; ') : body.error;
    throw new ApiError(msg || res.statusText, res.status);
  }
  return body as T;
}

const post = (path: string, data?: unknown) =>
  req(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  settings: () => req<PublicSettings>('/settings'),
  register: (data: Record<string, unknown>) =>
    post('/auth/register', data) as Promise<{ parentId: number; confirmToken?: string }>,
  confirm: (token: string) =>
    post('/auth/confirm', { token }) as Promise<{ confirmed: boolean; question?: Question }>,
  confirmAnswer: (token: string, titleId: number, answers: string[]) =>
    post('/auth/confirm/answer', { token, titleId, answers }) as Promise<{ confirmed: boolean; question?: Question }>,
  login: (username: string, password: string) => post('/auth/login', { username, password }),
  logout: () => post('/auth/logout'),
  forgot: (username: string, email: string) =>
    post('/auth/forgot', { username, email }) as Promise<{ devToken?: string }>,
  reset: (token: string, password: string) => post('/auth/reset', { token, password }),
  resend: (email: string) => post('/auth/resend', { email }) as Promise<{ devToken?: string }>,
  me: () => req<Me>('/me'),
  addChild: (data: Record<string, unknown>) =>
    post('/children', data) as Promise<{ childId: number; status: string; needsLanguagePreference: boolean }>,
  accept: (id: number) => post(`/children/${id}/accept`) as Promise<AcceptResult>,
  acceptAnswer: (id: number, extraIds: number[]) =>
    post(`/children/${id}/accept/answer`, { extraIds }) as Promise<AcceptResult>,
  decline: (id: number) => post(`/children/${id}/decline`) as Promise<{ status: string }>,
  language: (id: number, first: number, second: number) =>
    post(`/children/${id}/language`, { first, second }),
  remove: (id: number) => req(`/children/${id}`, { method: 'DELETE' }),
};

export interface AdminChild {
  childId: number; firstName: string; lastName: string; gradeNextYear: number;
  regStatus: string; position: number | null;
}
export interface AdminFamily {
  parent: { parentId: number; firstName: string; lastName: string; email: string } | null;
  children: AdminChild[];
  notes: { id: number; date: string; note: string }[];
}

export const adminApi = {
  me: () => req<{ adminId: number }>('/admin/me'),
  login: (username: string, password: string) => post('/admin/login', { username, password }),
  logout: () => post('/admin/logout'),
  search: (q: string) =>
    req<{ results: { parent: AdminFamily['parent']; children: AdminChild[] }[] }>(`/admin/search?q=${encodeURIComponent(q)}`),
  family: (parentId: number) => req<AdminFamily>(`/admin/family/${parentId}`),
  changeStatus: (childId: number, status: string) => post(`/admin/children/${childId}/status`, { status }),
  addNote: (parentId: number, note: string) => post(`/admin/family/${parentId}/note`, { note }),
  previewLottery: (caps: number[]) => post('/admin/lottery/preview', { caps }) as Promise<LotterySummary>,
  commitLottery: (caps: number[], seed: string) =>
    post('/admin/lottery/commit', { caps, seed }) as Promise<LotterySummary & { runId: number }>,
  validateRollYear: (csv: string) =>
    post('/admin/roll-year/validate', { csv }) as Promise<{ ok: boolean; rowCount: number; errors: { line: number; message: string }[]; byGrade: Record<number, number> }>,
  commitRollYear: (yearBegin: number, csv: string) =>
    post('/admin/roll-year/commit', { yearBegin, csv }) as Promise<{ imported: number }>,
  surveyList: () => req<{ questions: AdminQuestion[] }>('/admin/survey'),
  surveyCreate: (input: Partial<AdminQuestion>) => post('/admin/survey/questions', input),
  surveyUpdate: (titleId: number, fields: Partial<AdminQuestion>) =>
    req(`/admin/survey/questions/${titleId}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  surveyAddOption: (titleId: number, value: string) => post(`/admin/survey/questions/${titleId}/options`, { value }),
  surveyUpdateOption: (extraId: number, value: string) =>
    req(`/admin/survey/options/${extraId}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
  surveyDeleteOption: (extraId: number) => req(`/admin/survey/options/${extraId}`, { method: 'DELETE' }),
  notifyOffers: () => post('/admin/notify/offers') as Promise<{ offers: number; emails: number }>,
  notifyReminders: () => post('/admin/notify/reminders') as Promise<{ emails: number }>,
  notifyStatus: () => req<{ outbox: Record<string, number> }>('/admin/notify/status'),
  notifyDrain: () => post('/admin/notify/drain') as Promise<{ sent: number; failed: number }>,
};

export interface AdminQuestion {
  titleId: number;
  question: string;
  grade: string | null;
  lotteryQuestion: number;
  inputType: 'text' | 'textarea' | 'single_select' | 'multi_select' | 'date';
  active: boolean;
  sortOrder: number;
  brief: string | null;
  options: { extraId: number; value: string | null }[];
}

export interface LotterySummary {
  seed: string;
  caps: number[];
  totals: { offered: number; waitlisted: number; siblingPulls: number; initialCount: number };
  byGrade: { grade: string; offered: number; wait: number; sibWait: number }[];
}
