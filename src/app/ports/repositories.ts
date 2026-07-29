/**
 * Repository ports (hexagonal). Record shapes mirror the EXISTING MySQL schema
 * (additive-only policy) in camelCase. Adapters: an in-memory one for
 * tests/dev, and a mysql2 one for production (both implement these interfaces).
 */
import type { RegStatus } from '../../domain/regStatus.js';

export interface UserRecord {
  id: number;
  username: string;
  encpass: string; // legacy crypt() hash (kept; system of record during window)
  status: string; // PENDING | CONFIRMED
  // additive (new columns):
  pwHash: string | null; // bcrypt
  pwAlgo: string | null;
}

export interface ParentRecord {
  parentId: number; // == users.id
  lastName: string;
  firstName: string;
  relationship: string;
  address: string;
  city: string;
  state: string;
  zip: number;
  homePhone: string;
  otherPhone: string | null;
  returning: boolean;
  email: string;
  alternateEmail: string | null;
  guid: string | null; // legacy deterministic UUID (kept for Perl during window)
  // additive:
  confirmToken: string | null;
  confirmExpires: Date | null;
  resetToken: string | null;
  resetExpires: Date | null;
}

export interface ChildRecord {
  childId: number;
  parentId: number;
  lastName: string;
  firstName: string;
  middleName: string | null;
  gender: string;
  dob: string; // YYYY-MM-DD
  gradeNextYear: number;
  regStatus: RegStatus;
  languagePreference: string | null;
  lotteryConsiderations: number;
  position: number | null;
  expiration: string | null; // YYYY-MM-DD offer/paperwork deadline
  parentNotes: string;
}

/** Generic widget types so the UI renders surveys entirely from data (B8). */
export type SurveyInputType = 'text' | 'textarea' | 'single_select' | 'multi_select' | 'date';

export interface ExtraTitleRecord {
  titleId: number;
  question: string;
  grade: string | null; // scope like "-6-7-8-9-" (null = all grades)
  lotteryQuestion: number; // 0 = registration question, 1 = lottery question
  brief: string | null;
  // additive (B8 — fully data-driven surveys):
  inputType: SurveyInputType;
  active: boolean;
  sortOrder: number;
}

export interface ExtraOptionRecord {
  extraId: number;
  titleId: number;
  value: string | null;
}

export interface CurrentStudentRecord {
  childId: number;
  lastName: string;
  firstName: string;
  middleName: string | null;
  gender: string;
  dob: string;
  regStatus: RegStatus;
  grade: number; // NEXT-YEAR grade (despite the legacy column name)
}

export interface SessionRecord {
  token: string;
  userId: number;
  issuedAt: Date;
  expiresAt: Date;
}

export interface AdminUserRecord {
  id: number;
  username: string;
  pwHash: string;
  pwAlgo: string;
  active: boolean;
}

export interface NoteRecord {
  id: number;
  parentId: number;
  date: string;
  note: string;
}

export interface UserRepo {
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: number): Promise<UserRecord | null>;
  create(input: Omit<UserRecord, 'id'>): Promise<number>;
  setPasswordHash(id: number, pwHash: string, algo: string): Promise<void>;
  setEncpass(id: number, encpass: string): Promise<void>; // legacy dual-write on reset
  setStatus(id: number, status: string): Promise<void>;
}

/** Demographic parent fields an admin may edit (identity/tokens excluded). */
export type EditableParentFields = Partial<
  Pick<ParentRecord, 'firstName' | 'lastName' | 'relationship' | 'address' | 'city' | 'state' | 'zip'
    | 'homePhone' | 'otherPhone' | 'email' | 'alternateEmail'>
>;

export interface ParentRepo {
  create(input: ParentRecord): Promise<void>;
  update(parentId: number, fields: EditableParentFields): Promise<void>;
  findById(parentId: number): Promise<ParentRecord | null>;
  findByEmail(email: string): Promise<ParentRecord | null>;
  findByEmailAndName(email: string, firstName: string, lastName: string): Promise<ParentRecord | null>;
  findByConfirmToken(token: string): Promise<ParentRecord | null>;
  setConfirmToken(parentId: number, token: string, expires: Date): Promise<void>;
  findByResetToken(token: string): Promise<ParentRecord | null>;
  setResetToken(parentId: number, token: string | null, expires: Date | null): Promise<void>;
}

export interface ChildRepo {
  findByParent(parentId: number): Promise<ChildRecord[]>;
  findById(childId: number): Promise<ChildRecord | null>;
  /** All children (for capacity math / sibling lookups in a grade). */
  all(): Promise<ChildRecord[]>;
  /** Admin search: children whose first/last name matches (case-insensitive). */
  searchByName(query: string): Promise<ChildRecord[]>;
  /** Children on a wait list (WAIT/SIB_WAIT), optionally a single grade, ordered. */
  waitlist(grade?: number): Promise<ChildRecord[]>;
  /** Children currently in any of the given statuses (for notify/reminders). */
  byStatuses(statuses: RegStatus[]): Promise<ChildRecord[]>;
  /** Duplicate guard: matches DOB + last + (first|middle overlap) — child_exists. */
  existsByIdentity(firstName: string, middleName: string, lastName: string, dob: string): Promise<boolean>;
  create(input: Omit<ChildRecord, 'childId'>): Promise<number>;
  updateStatus(childId: number, status: RegStatus, position?: number | null): Promise<void>;
  setPosition(childId: number, position: number | null): Promise<void>;
  setExpiration(childId: number, date: string | null): Promise<void>;
  setLanguagePreference(childId: number, pref: string | null): Promise<void>;
  updateFields(
    childId: number,
    fields: Partial<Pick<ChildRecord, 'firstName' | 'middleName' | 'lastName' | 'gender' | 'gradeNextYear' | 'dob'>>,
  ): Promise<void>;
  delete(childId: number): Promise<void>;
}

export interface SurveyAnswer {
  titleId: number;
  question: string;
  brief: string | null;
  value: string | null;
}

/** One individual survey response, for the admin reports page (child + parent answers). */
export interface SurveyResponseRow {
  titleId: number;
  question: string;
  brief: string | null;
  lotteryQuestion: number; // 0 = registration (child), 1 = lottery (parent)
  value: string;
  subject: string; // student name (registration) or parent name (lottery)
  grade: number | null; // student's next-year grade for registration Qs; null for parent Qs
  parentId: number;
}

export interface SurveyRepo {
  /** Question definitions; lotteryQuestion 0 = registration, 1 = lottery. */
  listTitles(lotteryQuestion: number): Promise<ExtraTitleRecord[]>;
  options(titleId: number): Promise<ExtraOptionRecord[]>;
  // Child answers (ChildExtra -> Extra): which titles a child has answered.
  childAnsweredTitleIds(childId: number): Promise<Set<number>>;
  /** A child's survey answers joined to their question label (show_family "Extras"). */
  childAnswers(childId: number): Promise<SurveyAnswer[]>;
  /** Every survey response (child + parent) for the admin reports page. */
  surveyResponses(): Promise<SurveyResponseRow[]>;
  addChildAnswer(childId: number, extraId: number): Promise<void>;
  clearChildAnswers(childId: number): Promise<void>;
  // Parent answers (ParentExtra): keyed by Title_ID directly.
  parentAnsweredTitleIds(parentId: number): Promise<Set<number>>;
  addParentAnswer(parentId: number, titleId: number, answer: string): Promise<void>;
  // --- admin question-manager CRUD (B8) ---
  listAllTitles(): Promise<ExtraTitleRecord[]>; // incl. inactive, both types, ordered
  createTitle(input: Omit<ExtraTitleRecord, 'titleId'>): Promise<number>;
  updateTitle(titleId: number, fields: Partial<Omit<ExtraTitleRecord, 'titleId'>>): Promise<void>;
  addOption(titleId: number, value: string): Promise<number>;
  updateOption(extraId: number, value: string): Promise<void>;
  deleteOption(extraId: number): Promise<void>;
}

export interface CurrentStudentRepo {
  /** Re-enrollment match: First + Last + DOB (gender intentionally ignored). */
  findMatch(firstName: string, lastName: string, dob: string): Promise<CurrentStudentRecord | null>;
  setStatus(childId: number, status: RegStatus): Promise<void>;
  // Roster CRUD (admin data management — replaces phpMyAdmin on Current_Student):
  all(): Promise<CurrentStudentRecord[]>;
  findById(childId: number): Promise<CurrentStudentRecord | null>;
  create(input: Omit<CurrentStudentRecord, 'childId'>): Promise<number>;
  update(childId: number, fields: Partial<Omit<CurrentStudentRecord, 'childId'>>): Promise<void>;
  delete(childId: number): Promise<void>;
}

export interface SessionRepo {
  create(userId: number, ttlMs: number): Promise<SessionRecord>;
  find(token: string): Promise<SessionRecord | null>;
  destroy(token: string): Promise<void>;
}

export interface AdminRepo {
  findByUsername(username: string): Promise<AdminUserRecord | null>;
  findById(id: number): Promise<AdminUserRecord | null>;
  create(username: string, pwHash: string, pwAlgo: string): Promise<number>;
  countActive(): Promise<number>;
  list(): Promise<AdminUserRecord[]>;
  setActive(id: number, active: boolean): Promise<void>;
}

export interface NoteRepo {
  add(parentId: number, note: string): Promise<void>;
  listByParent(parentId: number): Promise<NoteRecord[]>;
}

export interface CapacityRepo {
  /** Per-grade caps (index 0..9) from MaxEnrollment. */
  gradeCaps(): Promise<number[]>;
  /** Replace the per-grade caps (index 0..9) in MaxEnrollment. */
  setCaps(caps: number[]): Promise<void>;
}

export interface LotteryAssignmentRow {
  childId: number;
  fromStatus: string;
  toStatus: string;
  position: number | null;
  phase: string;
  viaSibling: boolean;
}

export interface LotteryRunSummary {
  id: number;
  seed: string;
  year: number;
  ranAt: string | null;
  committed: boolean;
  offered: number;
  waitlisted: number;
  sibWait: number;
}

export interface LotteryRunRepo {
  createRun(input: { seed: string; year: number; caps: number[]; committed: boolean }): Promise<number>;
  addAssignments(runId: number, rows: LotteryAssignmentRow[]): Promise<void>;
  /** Most-recent runs (newest first) with per-run placement counts, for the audit history. */
  listRuns(limit: number): Promise<LotteryRunSummary[]>;
}

export interface AppSettings {
  yearBegin: number;
  lotteryOpen: boolean;
  postLottery: boolean;
}

export interface SettingsRepo {
  get(): Promise<AppSettings | null>;
  set(s: AppSettings): Promise<void>;
}

export interface CurrentStudentImportRow {
  lastName: string;
  firstName: string;
  middleName: string | null;
  gender: string;
  dob: string;
  grade: number;
}

export interface OutboxEmail {
  id: number;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface OutboxRepo {
  enqueue(recipient: string, template: string, payload: Record<string, unknown>): Promise<number>;
  /** Claim up to `limit` pending messages to send. */
  claimPending(limit: number): Promise<OutboxEmail[]>;
  markSent(id: number): Promise<void>;
  /** Increment attempts; re-queue (pending) until maxAttempts, then mark failed. */
  markFailed(id: number, error: string, maxAttempts: number): Promise<void>;
  countByState(): Promise<Record<string, number>>;
  /** How many messages were sent since `since` — drives the daily send cap. */
  countSentSince(since: Date): Promise<number>;
  /** Recipients that already have a pending message of this template (dedup). */
  pendingRecipients(template: string): Promise<Set<string>>;
  /** Most-recent messages (newest first), optionally filtered by state — for the admin log. */
  recent(limit: number, state?: string): Promise<OutboxLogRow[]>;
}

export interface DocumentMeta {
  slug: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string | null;
  uploadedBy: number | null;
}
export interface DocumentFile extends DocumentMeta {
  bytes: Buffer;
}
export interface DocumentRepo {
  /** Metadata for all stored documents (no bytes). */
  list(): Promise<DocumentMeta[]>;
  getMeta(slug: string): Promise<DocumentMeta | null>;
  getFile(slug: string): Promise<DocumentFile | null>;
  upsert(input: { slug: string; filename: string; contentType: string; bytes: Buffer; size: number; uploadedBy: number | null }): Promise<void>;
  delete(slug: string): Promise<void>;
}

export interface OutboxLogRow {
  id: number;
  recipient: string;
  template: string;
  state: string;
  attempts: number;
  lastError: string | null;
  createdAt: string | null;
  sentAt: string | null;
}

/** Annual reset operations (RULES_SPEC §2.1). */
export interface MaintenanceRepo {
  /** TRUNCATE the per-year tables; PRESERVE reference + admin tables. */
  purgeForNewYear(): Promise<void>;
  /** Bulk-insert the current-student roster (status defaults to PEND_REENROLL). */
  importCurrentStudents(rows: CurrentStudentImportRow[]): Promise<number>;
}

export interface Repositories {
  users: UserRepo;
  parents: ParentRepo;
  children: ChildRepo;
  currentStudents: CurrentStudentRepo;
  sessions: SessionRepo;
  survey: SurveyRepo;
  admins: AdminRepo;
  adminSessions: SessionRepo;
  notes: NoteRepo;
  capacity: CapacityRepo;
  lotteryRuns: LotteryRunRepo;
  settings: SettingsRepo;
  maintenance: MaintenanceRepo;
  outbox: OutboxRepo;
  documents: DocumentRepo;
}
