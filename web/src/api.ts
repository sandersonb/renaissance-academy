// Typed client for the enrollment API. Cookies (the session) flow via
// credentials:'include'; in dev the Vite proxy makes /api same-origin.
import { requestHeaders } from './requestHeaders';

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

function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('error' in body) || typeof body.error !== 'string') return fallback;
  if (body.error === 'validation' && 'issues' in body && Array.isArray(body.issues)) {
    return body.issues.filter((issue): issue is string => typeof issue === 'string').join('; ') || fallback;
  }
  return body.error || fallback;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // Only send a JSON content-type when there's actually a body — otherwise the
  // server's JSON parser rejects the empty body (e.g. logout, accept, notify).
  const headers = requestHeaders(opts);
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...opts,
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(responseError(body, res.statusText), res.status);
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
  me: async () => { await post('/me/refresh-offers'); return req<Me>('/me'); },
  documents: () => req<{ documents: ParentDoc[] }>('/me/documents'),
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
export interface AdminParent {
  parentId: number; firstName: string; lastName: string; relationship: string;
  address: string; city: string; state: string; zip: number;
  homePhone: string; otherPhone: string | null; email: string; alternateEmail: string | null;
  returning: boolean;
}
export interface SurveyAnswer { titleId: number; question: string; brief: string | null; value: string | null }
export interface FamilyChild {
  childId: number; parentId: number; firstName: string; middleName: string | null; lastName: string;
  gender: string; dob: string; gradeNextYear: number; regStatus: string; statusLabel: string;
  position: number | null; expiration: string | null; waitlistRank: number | null;
  transitions: string[]; answers: SurveyAnswer[];
}
export interface AdminFamily {
  parent: AdminParent | null;
  children: FamilyChild[];
  notes: { id: number; date: string; note: string }[];
}

export interface SummaryRow {
  label: string;
  kind: 'head' | 'seat' | 'open' | 'info';
  key: string | null;
  values: number[];
  total: number;
  description: string;
}
export interface AdminSummary {
  grades: string[];
  rows: SummaryRow[];
}

export interface AdminListRow {
  childId: number;
  firstName: string;
  lastName: string;
  gradeNextYear: number;
  regStatus: string;
  statusLabel: string;
  parentId: number;
  parentName: string | null;
  expiration: string | null;
  waitlistRank: number | null;
}
export interface AdminList {
  filter: { grade: number | null; status: string | null; name: string | null };
  count: number;
  results: AdminListRow[];
}

export interface SurveyReportResponse {
  titleId: number; question: string; brief: string | null; lotteryQuestion: number;
  value: string; subject: string; grade: number | null; parentId: number;
}
export interface SurveyReport {
  questions: { titleId: number; question: string; brief: string | null; lotteryQuestion: number }[];
  counts: { titleId: number; question: string; brief: string | null; value: string; count: number }[];
  responses: SurveyReportResponse[];
}

export interface RosterStudent {
  childId: number; firstName: string; middleName: string | null; lastName: string;
  gender: string; dob: string; grade: number; regStatus: string;
}

export interface CycleSettings { yearBegin: number; lotteryOpen: boolean; postLottery: boolean }
export interface ParentDoc { slug: string; label: string; available: boolean }
export interface AdminDoc { slug: string; label: string; filename: string | null; size: number | null; uploadedAt: string | null; available: boolean; usingDefault: boolean }
export interface AdminAccount { id: number; username: string; active: boolean }
export interface LotteryRun {
  id: number; seed: string; year: number; ranAt: string | null; committed: boolean;
  offered: number; waitlisted: number; sibWait: number;
}
export interface EmailLogRow {
  id: number; recipient: string; template: string; state: string; attempts: number;
  lastError: string | null; createdAt: string | null; sentAt: string | null;
}

export const adminApi = {
  me: () => req<{ adminId: number }>('/admin/me'),
  summary: () => req<AdminSummary>('/admin/summary'),
  reports: () => req<SurveyReport>('/admin/reports'),
  getSettings: () => req<CycleSettings>('/admin/settings'),
  updateSettings: (fields: { lotteryOpen?: boolean; postLottery?: boolean }) =>
    req<CycleSettings>('/admin/settings', { method: 'PATCH', body: JSON.stringify(fields) }),
  getCaps: () => req<{ caps: number[] }>('/admin/caps'),
  updateCaps: (caps: number[]) => req<{ caps: number[] }>('/admin/caps', { method: 'PUT', body: JSON.stringify({ caps }) }),
  listAdmins: () => req<{ admins: AdminAccount[] }>('/admin/admins'),
  createAdminAccount: (username: string, password: string) => post('/admin/admins', { username, password }) as Promise<{ id: number }>,
  setAdminActive: (id: number, active: boolean) => req(`/admin/admins/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  lotteryRuns: () => req<{ runs: LotteryRun[] }>('/admin/lottery/runs'),
  emailLog: (state?: string) => req<{ messages: EmailLogRow[] }>(`/admin/notify/log${state ? `?state=${state}` : ''}`),
  docList: () => req<{ documents: AdminDoc[] }>('/admin/documents'),
  docDelete: (slug: string) => req(`/admin/documents/${slug}`, { method: 'DELETE' }),
  docUpload: async (slug: string, file: File) => {
    // Raw PDF body (not the JSON helper) — the server parses application/pdf as a Buffer.
    const options = { method: 'POST', body: file, headers: { 'content-type': 'application/pdf' } };
    const res = await fetch(`/api/admin/documents/${slug}?filename=${encodeURIComponent(file.name)}`, {
      ...options, credentials: 'include', headers: requestHeaders(options),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(responseError(body, res.statusText), res.status);
    return body as { ok: boolean };
  },
  rosterList: (params: { grade?: string | null; name?: string | null }) => {
    const qs = new URLSearchParams();
    if (params.grade) qs.set('grade', params.grade);
    if (params.name) qs.set('name', params.name);
    return req<{ roster: RosterStudent[] }>(`/admin/roster?${qs.toString()}`);
  },
  rosterCreate: (fields: Record<string, unknown>) => post('/admin/roster', fields) as Promise<{ childId: number }>,
  rosterUpdate: (childId: number, fields: Record<string, unknown>) =>
    req(`/admin/roster/${childId}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  rosterDelete: (childId: number) => req(`/admin/roster/${childId}`, { method: 'DELETE' }),
  list: (params: { grade?: string | null; status?: string | null; name?: string | null }) => {
    const qs = new URLSearchParams();
    if (params.grade) qs.set('grade', params.grade);
    if (params.status) qs.set('status', params.status);
    if (params.name) qs.set('name', params.name);
    return req<AdminList>(`/admin/list?${qs.toString()}`);
  },
  login: (username: string, password: string) => post('/admin/login', { username, password }),
  logout: () => post('/admin/logout'),
  search: (q: string) =>
    req<{ results: { parent: AdminFamily['parent']; children: AdminChild[] }[] }>(`/admin/search?q=${encodeURIComponent(q)}`),
  family: (parentId: number) => req<AdminFamily>(`/admin/family/${parentId}`),
  changeStatus: (childId: number, status: string) => post(`/admin/children/${childId}/status`, { status }),
  forceStatus: (childId: number, status: string) => post(`/admin/children/${childId}/force-status`, { status }),
  updateParent: (parentId: number, fields: Record<string, unknown>) =>
    req(`/admin/family/${parentId}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  addFamilyChild: (parentId: number, fields: Record<string, unknown>) =>
    post(`/admin/family/${parentId}/children`, fields) as Promise<{ childId: number }>,
  updateChild: (childId: number, fields: Record<string, unknown>) =>
    req(`/admin/children/${childId}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  deleteChild: (childId: number) => req(`/admin/children/${childId}`, { method: 'DELETE' }),
  addNote: (parentId: number, note: string) => post(`/admin/family/${parentId}/note`, { note }),
  previewLottery: (caps: number[]) => post('/admin/lottery/preview', { caps }) as Promise<LotterySummary>,
  commitLottery: (caps: number[]) =>
    post('/admin/lottery/commit', { caps }) as Promise<LotterySummary & { runId: number }>,
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
  notifyReminders: () => post('/admin/notify/reminders') as Promise<{ emails: number; skipped: number }>,
  notifyStatus: () => req<{ outbox: Record<string, number>; sentLast24h: number; dailyCap: number }>('/admin/notify/status'),
  notifyDrain: () => post('/admin/notify/drain') as Promise<{ sent: number; failed: number; deferred: number }>,
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
