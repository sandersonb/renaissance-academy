/**
 * In-memory repository adapters — for tests and local dev (no MySQL needed).
 * The production mysql2 adapters implement the same ports against the existing
 * schema; services depend only on the interfaces.
 */
import { randomUUID } from 'node:crypto';
import { RegStatus } from '../../../domain/regStatus.js';
import type { Database } from '../../ports/database.js';
import { nextSessionVersion, validSessionVersion } from '../../util/sessionVersion.js';
import type {
  AdminRepo,
  AdminUserRecord,
  AppSettings,
  CapacityRepo,
  ChildRecord,
  ChildRepo,
  CurrentStudentImportRow,
  LotteryAssignmentRow,
  LotteryRunRepo,
  MaintenanceRepo,
  OutboxEmail,
  OutboxRepo,
  SettingsRepo,
  CurrentStudentRecord,
  CurrentStudentRepo,
  DocumentFile,
  DocumentRepo,
  EditableParentFields,
  ExtraOptionRecord,
  ExtraTitleRecord,
  NoteRecord,
  NoteRepo,
  ParentRecord,
  ParentRepo,
  Repositories,
  SessionRecord,
  SessionRepo,
  SurveyAnswer,
  SurveyResponseRow,
  SurveyRepo,
  UserRecord,
  UserRepo,
} from '../../ports/repositories.js';

const DEFAULT_CAPS = [160, 120, 120, 120, 110, 100, 100, 80, 30, 50];

export class MemoryStore {
  users = new Map<number, UserRecord>();
  parents = new Map<number, ParentRecord>();
  children = new Map<number, ChildRecord>();
  currentStudents = new Map<number, CurrentStudentRecord>();
  sessions = new Map<string, SessionRecord>();
  extraTitles = new Map<number, ExtraTitleRecord>();
  extras = new Map<number, ExtraOptionRecord>();
  childExtra: { childId: number; extraId: number }[] = [];
  parentExtra: { parentId: number; titleId: number; answer: string }[] = [];
  admins = new Map<number, AdminUserRecord>();
  adminSessions = new Map<string, SessionRecord>();
  notes: NoteRecord[] = [];
  caps: number[] = [...DEFAULT_CAPS];
  nextTitleId = 1000;
  nextExtraId = 1000;
  lotteryRuns: { id: number; seed: string; year: number; caps: number[]; committed: boolean; ranAt: Date }[] = [];
  lotteryAssignments: (LotteryAssignmentRow & { runId: number })[] = [];
  settings: AppSettings | null = null;
  outbox: { id: number; recipient: string; template: string; payload: Record<string, unknown>; state: string; attempts: number; lastError: string | null; createdAt: Date; sentAt: Date | null }[] = [];
  documents = new Map<string, DocumentFile>();
  nextOutboxId = 1;
  nextUserId = 1;
  nextChildId = 1;
  nextAdminId = 1;
  nextNoteId = 1;
  nextRunId = 1;
}

const norm = (s: string) => s.trim().toLowerCase();

class MemUserRepo implements UserRepo {
  constructor(private s: MemoryStore) {}
  async findByUsername(username: string) {
    const user = [...this.s.users.values()].find((u) => u.username === username);
    return user ? { ...user } : null;
  }
  async findById(id: number) {
    const user = this.s.users.get(id);
    return user ? { ...user } : null;
  }
  async create(input: Omit<UserRecord, 'id' | 'sessionVersion'>) {
    const id = this.s.nextUserId++;
    this.s.users.set(id, { ...input, id, sessionVersion: 0 });
    return id;
  }
  async lockById(id: number) { return this.findById(id); }
  async upgradeLegacyPassword(id: number, encpass: string, version: number, hash: string, algo: string) {
    if (!validSessionVersion(version)) return false;
    const user = this.s.users.get(id);
    if (!user || user.encpass !== encpass || !!user.pwHash || user.sessionVersion !== version) return false;
    user.pwHash = hash; user.pwAlgo = algo;
    return true;
  }
  async replacePassword(id: number, pwHash: string, algo: string, encpass: string | null) {
    const user = this.s.users.get(id);
    if (!user) throw new Error('Account missing.');
    const version = nextSessionVersion(user.sessionVersion);
    user.pwHash = pwHash; user.pwAlgo = algo; user.sessionVersion = version;
    if (encpass !== null) user.encpass = encpass;
  }
  async setPasswordHash(id: number, pwHash: string, algo: string) {
    await this.replacePassword(id, pwHash, algo, null);
  }
  async setEncpass(id: number, encpass: string) {
    const u = this.s.users.get(id);
    if (u) u.encpass = encpass;
  }
  async setStatus(id: number, status: string) {
    const u = this.s.users.get(id);
    if (!u) throw new Error('Account missing.');
    if (u && u.status !== status) { u.sessionVersion = nextSessionVersion(u.sessionVersion); u.status = status; }
  }
}

class MemParentRepo implements ParentRepo {
  constructor(private s: MemoryStore) {}
  async create(input: ParentRecord) {
    this.s.parents.set(input.parentId, { ...input });
  }
  async update(parentId: number, fields: EditableParentFields) {
    const p = this.s.parents.get(parentId);
    if (p) Object.assign(p, fields);
  }
  async findById(parentId: number) {
    return this.s.parents.get(parentId) ?? null;
  }
  async findByEmail(email: string) {
    return [...this.s.parents.values()].find((p) => norm(p.email) === norm(email)) ?? null;
  }
  async findByEmailAndName(email: string, firstName: string, lastName: string) {
    return (
      [...this.s.parents.values()].find(
        (p) => norm(p.email) === norm(email) && norm(p.firstName) === norm(firstName) && norm(p.lastName) === norm(lastName),
      ) ?? null
    );
  }
  async findByConfirmToken(token: string) {
    return [...this.s.parents.values()].find((p) => p.confirmToken === token) ?? null;
  }
  async setConfirmToken(parentId: number, token: string, expires: Date) {
    const p = this.s.parents.get(parentId);
    if (p) { p.confirmToken = token; p.confirmExpires = expires; }
  }
  async findByResetToken(token: string) {
    return [...this.s.parents.values()].find((p) => p.resetToken === token) ?? null;
  }
  async setResetToken(parentId: number, token: string | null, expires: Date | null) {
    const p = this.s.parents.get(parentId);
    if (p) { p.resetToken = token; p.resetExpires = expires; }
  }
  async consumeResetToken(parentId: number, token: string, now: Date) {
    const parent = this.s.parents.get(parentId);
    if (!parent || parent.resetToken !== token || !parent.resetExpires || parent.resetExpires.getTime() <= now.getTime()) return false;
    parent.resetToken = null; parent.resetExpires = null;
    return true;
  }
}

class MemChildRepo implements ChildRepo {
  constructor(private s: MemoryStore) {}
  async findByParent(parentId: number) {
    return [...this.s.children.values()].filter((c) => c.parentId === parentId);
  }
  async findById(childId: number) {
    return this.s.children.get(childId) ?? null;
  }
  async all() {
    return [...this.s.children.values()];
  }
  async searchByName(query: string) {
    const q = norm(query);
    return [...this.s.children.values()].filter(
      (c) => norm(c.firstName).includes(q) || norm(c.lastName).includes(q),
    );
  }
  async waitlist(grade?: number) {
    return [...this.s.children.values()]
      .filter((c) => (c.regStatus === RegStatus.WAIT || c.regStatus === RegStatus.SIB_WAIT) && (grade === undefined || c.gradeNextYear === grade))
      .sort((a, b) => a.gradeNextYear - b.gradeNextYear || a.regStatus.localeCompare(b.regStatus) || (a.position ?? 0) - (b.position ?? 0));
  }
  async byStatuses(statuses: RegStatus[]) {
    const set = new Set(statuses);
    return [...this.s.children.values()].filter((c) => set.has(c.regStatus));
  }
  async existsByIdentity(firstName: string, middleName: string, lastName: string, dob: string) {
    return [...this.s.children.values()].some((c) => {
      if (c.dob !== dob || norm(c.lastName) !== norm(lastName)) return false;
      const f = norm(firstName), m = norm(middleName);
      return norm(c.firstName) === f || norm(c.firstName) === m || norm(c.middleName ?? '') === f;
    });
  }
  async create(input: Omit<ChildRecord, 'childId'>) {
    const childId = this.s.nextChildId++;
    this.s.children.set(childId, { ...input, childId });
    return childId;
  }
  async updateStatus(childId: number, status: RegStatus, position?: number | null) {
    const c = this.s.children.get(childId);
    if (c) {
      c.regStatus = status;
      if (position !== undefined) c.position = position;
    }
  }
  async setPosition(childId: number, position: number | null) {
    const c = this.s.children.get(childId);
    if (c) c.position = position;
  }
  async setExpiration(childId: number, date: string | null) {
    const c = this.s.children.get(childId);
    if (c) c.expiration = date;
  }
  async setLanguagePreference(childId: number, pref: string | null) {
    const c = this.s.children.get(childId);
    if (c) c.languagePreference = pref;
  }
  async updateFields(childId: number, fields: Partial<Pick<ChildRecord, 'firstName' | 'middleName' | 'lastName' | 'gender' | 'gradeNextYear' | 'dob'>>) {
    const c = this.s.children.get(childId);
    if (c) Object.assign(c, fields);
  }
  async delete(childId: number) {
    this.s.children.delete(childId);
  }
}

class MemSurveyRepo implements SurveyRepo {
  constructor(private s: MemoryStore) {}
  async listTitles(lotteryQuestion: number) {
    return [...this.s.extraTitles.values()]
      .filter((t) => t.lotteryQuestion === lotteryQuestion && t.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async options(titleId: number) {
    return [...this.s.extras.values()].filter((e) => e.titleId === titleId);
  }
  async childAnsweredTitleIds(childId: number) {
    const ids = new Set<number>();
    for (const ce of this.s.childExtra) {
      if (ce.childId === childId) {
        const ex = this.s.extras.get(ce.extraId);
        if (ex) ids.add(ex.titleId);
      }
    }
    return ids;
  }
  async childAnswers(childId: number) {
    const out: SurveyAnswer[] = [];
    for (const ce of this.s.childExtra) {
      if (ce.childId !== childId) continue;
      const ex = this.s.extras.get(ce.extraId);
      if (!ex) continue;
      const t = this.s.extraTitles.get(ex.titleId);
      out.push({ titleId: ex.titleId, question: t?.question ?? '', brief: t?.brief ?? null, value: ex.value });
    }
    return out;
  }
  async surveyResponses() {
    const rows: SurveyResponseRow[] = [];
    // Child registration answers (ChildExtra -> Extra option value).
    for (const ce of this.s.childExtra) {
      const ex = this.s.extras.get(ce.extraId);
      const child = this.s.children.get(ce.childId);
      const t = ex && this.s.extraTitles.get(ex.titleId);
      if (!ex || !ex.value || !child || !t) continue;
      rows.push({
        titleId: t.titleId, question: t.question, brief: t.brief, lotteryQuestion: t.lotteryQuestion,
        value: ex.value, subject: `${child.firstName} ${child.lastName}`.trim(),
        grade: child.gradeNextYear, parentId: child.parentId,
      });
    }
    // Parent lottery answers (ParentExtra free-text/value).
    for (const pe of this.s.parentExtra) {
      const t = this.s.extraTitles.get(pe.titleId);
      const parent = this.s.parents.get(pe.parentId);
      if (!t || pe.answer == null || pe.answer === '') continue;
      rows.push({
        titleId: t.titleId, question: t.question, brief: t.brief, lotteryQuestion: t.lotteryQuestion,
        value: pe.answer, subject: parent ? `${parent.firstName} ${parent.lastName}`.trim() : `Parent #${pe.parentId}`,
        grade: null, parentId: pe.parentId,
      });
    }
    return rows;
  }
  async addChildAnswer(childId: number, extraId: number) {
    this.s.childExtra.push({ childId, extraId });
  }
  async clearChildAnswers(childId: number) {
    this.s.childExtra = this.s.childExtra.filter((ce) => ce.childId !== childId);
  }
  async parentAnsweredTitleIds(parentId: number) {
    return new Set(this.s.parentExtra.filter((p) => p.parentId === parentId).map((p) => p.titleId));
  }
  async addParentAnswer(parentId: number, titleId: number, answer: string) {
    this.s.parentExtra.push({ parentId, titleId, answer });
  }
  async listAllTitles() {
    return [...this.s.extraTitles.values()].sort(
      (a, b) => a.lotteryQuestion - b.lotteryQuestion || a.sortOrder - b.sortOrder,
    );
  }
  async createTitle(input: Omit<ExtraTitleRecord, 'titleId'>) {
    const titleId = this.s.nextTitleId++;
    this.s.extraTitles.set(titleId, { titleId, ...input });
    return titleId;
  }
  async updateTitle(titleId: number, fields: Partial<Omit<ExtraTitleRecord, 'titleId'>>) {
    const t = this.s.extraTitles.get(titleId);
    if (t) Object.assign(t, fields);
  }
  async addOption(titleId: number, value: string) {
    const extraId = this.s.nextExtraId++;
    this.s.extras.set(extraId, { extraId, titleId, value });
    return extraId;
  }
  async updateOption(extraId: number, value: string) {
    const e = this.s.extras.get(extraId);
    if (e) e.value = value;
  }
  async deleteOption(extraId: number) {
    this.s.extras.delete(extraId);
  }
}

class MemCurrentStudentRepo implements CurrentStudentRepo {
  constructor(private s: MemoryStore) {}
  async findMatch(firstName: string, lastName: string, dob: string) {
    return (
      [...this.s.currentStudents.values()].find(
        (c) => norm(c.firstName) === norm(firstName) && norm(c.lastName) === norm(lastName) && c.dob === dob,
      ) ?? null
    );
  }
  async setStatus(childId: number, status: RegStatus) {
    const c = this.s.currentStudents.get(childId);
    if (c) c.regStatus = status;
  }
  async all() {
    return [...this.s.currentStudents.values()];
  }
  async findById(childId: number) {
    return this.s.currentStudents.get(childId) ?? null;
  }
  async create(input: Omit<CurrentStudentRecord, 'childId'>) {
    const childId = Math.max(1000, ...this.s.currentStudents.keys()) + 1;
    this.s.currentStudents.set(childId, { childId, ...input });
    return childId;
  }
  async update(childId: number, fields: Partial<Omit<CurrentStudentRecord, 'childId'>>) {
    const c = this.s.currentStudents.get(childId);
    if (c) Object.assign(c, fields);
  }
  async delete(childId: number) {
    this.s.currentStudents.delete(childId);
  }
}

class MemSessionRepo implements SessionRepo {
  constructor(private store: MemoryStore, private admin = false) {}
  private get map() { return this.admin ? this.store.adminSessions : this.store.sessions; }
  private currentVersion(userId: number): number | null {
    if (this.admin) {
      const admin = this.store.admins.get(userId);
      return admin?.active ? admin.sessionVersion : null;
    }
    const user = this.store.users.get(userId);
    return user?.status === 'CONFIRMED' ? user.sessionVersion : null;
  }
  async create(userId: number, ttlMs: number, expectedVersion: number) {
    if (!validSessionVersion(expectedVersion) || this.currentVersion(userId) !== expectedVersion) return null;
    const rec: SessionRecord = {
      token: randomUUID().replace(/-/g, ''),
      userId,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      sessionVersion: expectedVersion,
    };
    this.map.set(rec.token, rec);
    return rec;
  }
  async find(token: string) {
    const r = this.map.get(token);
    if (!r) return null;
    if (!validSessionVersion(r.sessionVersion) || !Number.isFinite(r.expiresAt.getTime()) || r.expiresAt.getTime() <= Date.now() || this.currentVersion(r.userId) !== r.sessionVersion) {
      this.map.delete(token);
      return null;
    }
    return { ...r };
  }
  async destroy(token: string) {
    this.map.delete(token);
  }
  async destroyForUser(userId: number) {
    for (const [token, record] of this.map) if (record.userId === userId) this.map.delete(token);
  }
}

class MemAdminRepo implements AdminRepo {
  constructor(private s: MemoryStore) {}
  async findByUsername(u: string) {
    const admin = [...this.s.admins.values()].find((a) => a.username === u);
    return admin ? { ...admin } : null;
  }
  async findById(id: number) {
    const admin = this.s.admins.get(id);
    return admin ? { ...admin } : null;
  }
  async create(username: string, pwHash: string, pwAlgo: string) {
    const id = this.s.nextAdminId++;
    this.s.admins.set(id, { id, username, pwHash, pwAlgo, active: true, sessionVersion: 0 });
    return id;
  }
  async countActive() {
    return [...this.s.admins.values()].filter((a) => a.active).length;
  }
  async list() {
    return [...this.s.admins.values()].map((admin) => ({ ...admin }));
  }
  async lockAll() { return (await this.list()).sort((a, b) => a.id - b.id); }
  async setActive(id: number, active: boolean) {
    const a = this.s.admins.get(id);
    if (!a) throw new Error('Admin missing.');
    if (a && a.active !== active) { a.sessionVersion = nextSessionVersion(a.sessionVersion); a.active = active; }
  }
}

class MemNoteRepo implements NoteRepo {
  constructor(private s: MemoryStore) {}
  async add(parentId: number, note: string) {
    this.s.notes.push({ id: this.s.nextNoteId++, parentId, date: new Date().toISOString(), note });
  }
  async listByParent(parentId: number) {
    return this.s.notes.filter((n) => n.parentId === parentId);
  }
}

class MemCapacityRepo implements CapacityRepo {
  constructor(private s: MemoryStore) {}
  async gradeCaps() {
    return [...this.s.caps];
  }
  async setCaps(caps: number[]) {
    this.s.caps = Array.from({ length: 10 }, (_, g) => Math.max(0, Math.trunc(caps[g] ?? this.s.caps[g] ?? 0)));
  }
}

class MemLotteryRunRepo implements LotteryRunRepo {
  constructor(private s: MemoryStore) {}
  async createRun(input: { seed: string; year: number; caps: number[]; committed: boolean }) {
    const id = this.s.nextRunId++;
    this.s.lotteryRuns.push({ id, ...input, ranAt: new Date() });
    return id;
  }
  async addAssignments(runId: number, rows: LotteryAssignmentRow[]) {
    for (const r of rows) this.s.lotteryAssignments.push({ runId, ...r });
  }
  async listRuns(limit: number) {
    return [...this.s.lotteryRuns]
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map((r) => {
        const asn = this.s.lotteryAssignments.filter((a) => a.runId === r.id);
        const count = (s: RegStatus) => asn.filter((a) => a.toStatus === s).length;
        return {
          id: r.id, seed: r.seed, year: r.year, ranAt: r.ranAt.toISOString(), committed: r.committed,
          offered: count(RegStatus.PEND_OFFER), waitlisted: count(RegStatus.WAIT), sibWait: count(RegStatus.SIB_WAIT),
        };
      });
  }
}

class MemSettingsRepo implements SettingsRepo {
  constructor(private s: MemoryStore) {}
  async get() {
    return this.s.settings;
  }
  async set(v: AppSettings) {
    this.s.settings = { ...v };
  }
}

class MemOutboxRepo implements OutboxRepo {
  constructor(private s: MemoryStore) {}
  async enqueue(recipient: string, template: string, payload: Record<string, unknown>) {
    const id = this.s.nextOutboxId++;
    this.s.outbox.push({ id, recipient, template, payload, state: 'pending', attempts: 0, lastError: null, createdAt: new Date(), sentAt: null });
    return id;
  }
  async claimPending(limit: number): Promise<OutboxEmail[]> {
    return this.s.outbox.filter((m) => m.state === 'pending').slice(0, limit)
      .map((m) => ({ id: m.id, recipient: m.recipient, template: m.template, payload: m.payload, attempts: m.attempts }));
  }
  async markSent(id: number) {
    const m = this.s.outbox.find((x) => x.id === id);
    if (m) { m.state = 'sent'; m.sentAt = new Date(); }
  }
  async markFailed(id: number, error: string, maxAttempts: number) {
    const m = this.s.outbox.find((x) => x.id === id);
    if (m) { m.attempts++; m.lastError = error; m.state = m.attempts >= maxAttempts ? 'failed' : 'pending'; }
  }
  async countByState() {
    const out: Record<string, number> = {};
    for (const m of this.s.outbox) out[m.state] = (out[m.state] ?? 0) + 1;
    return out;
  }
  async countSentSince(since: Date) {
    return this.s.outbox.filter((m) => m.state === 'sent' && m.sentAt != null && m.sentAt >= since).length;
  }
  async pendingRecipients(template: string) {
    return new Set(this.s.outbox.filter((m) => m.state === 'pending' && m.template === template).map((m) => m.recipient));
  }
  async recent(limit: number, state?: string) {
    return [...this.s.outbox]
      .filter((m) => !state || m.state === state)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map((m) => ({
        id: m.id, recipient: m.recipient, template: m.template, state: m.state, attempts: m.attempts,
        lastError: m.lastError, createdAt: m.createdAt?.toISOString() ?? null, sentAt: m.sentAt?.toISOString() ?? null,
      }));
  }
}

class MemMaintenanceRepo implements MaintenanceRepo {
  constructor(private s: MemoryStore) {}
  async purgeForNewYear() {
    this.s.children.clear();
    this.s.parents.clear();
    this.s.users.clear();
    this.s.currentStudents.clear();
    this.s.sessions.clear();
    this.s.notes = [];
    this.s.parentExtra = [];
    this.s.childExtra = [];
    this.s.lotteryRuns = [];
    this.s.lotteryAssignments = [];
    // Preserved: admins, adminSessions, extraTitles, extras, caps (reference).
  }
  async importCurrentStudents(rows: CurrentStudentImportRow[]) {
    let id = 1;
    for (const r of rows) {
      this.s.currentStudents.set(id, {
        childId: id, lastName: r.lastName, firstName: r.firstName, middleName: r.middleName,
        gender: r.gender, dob: r.dob, regStatus: RegStatus.PEND_REENROLL, grade: r.grade,
      });
      id++;
    }
    return rows.length;
  }
}

export function createMemoryRepositories(store = new MemoryStore()): Repositories & { store: MemoryStore } {
  return {
    store,
    users: new MemUserRepo(store),
    parents: new MemParentRepo(store),
    children: new MemChildRepo(store),
    currentStudents: new MemCurrentStudentRepo(store),
    sessions: new MemSessionRepo(store),
    survey: new MemSurveyRepo(store),
    admins: new MemAdminRepo(store),
    adminSessions: new MemSessionRepo(store, true),
    notes: new MemNoteRepo(store),
    capacity: new MemCapacityRepo(store),
    lotteryRuns: new MemLotteryRunRepo(store),
    settings: new MemSettingsRepo(store),
    maintenance: new MemMaintenanceRepo(store),
    outbox: new MemOutboxRepo(store),
    documents: new MemDocumentRepo(store),
  };
}

class MemDocumentRepo implements DocumentRepo {
  constructor(private s: MemoryStore) {}
  async list() {
    return [...this.s.documents.values()].map(({ bytes: _bytes, ...meta }) => meta);
  }
  async getMeta(slug: string) {
    const d = this.s.documents.get(slug);
    if (!d) return null;
    const { bytes: _bytes, ...meta } = d;
    return meta;
  }
  async getFile(slug: string) {
    return this.s.documents.get(slug) ?? null;
  }
  async upsert(input: { slug: string; filename: string; contentType: string; bytes: Buffer; size: number; uploadedBy: number | null }) {
    this.s.documents.set(input.slug, { ...input, uploadedAt: new Date().toISOString() });
  }
  async delete(slug: string) {
    this.s.documents.delete(slug);
  }
}

/**
 * In-memory Database with snapshot/restore "transactions" so tests exercise the
 * same atomic semantics: on error, all writes within the work fn are rolled back.
 */
const transactionQueues = new WeakMap<MemoryStore, Promise<void>>();

export function createMemoryDatabase(store = new MemoryStore()): Database & { store: MemoryStore; repos: Repositories } {
  const repos = createMemoryRepositories(store);
  return {
    store,
    repos,
    async transaction<T>(work: (tx: Repositories) => Promise<T>): Promise<T> {
      const previous = transactionQueues.get(store) ?? Promise.resolve();
      let release!: () => void;
      transactionQueues.set(store, new Promise<void>((resolve) => { release = resolve; }));
      await previous;
      try {
        const snap = structuredClone({
          users: store.users, parents: store.parents, children: store.children,
          currentStudents: store.currentStudents, sessions: store.sessions,
          extraTitles: store.extraTitles, extras: store.extras, childExtra: store.childExtra,
          parentExtra: store.parentExtra, admins: store.admins, adminSessions: store.adminSessions,
          notes: store.notes, caps: store.caps, lotteryRuns: store.lotteryRuns,
          lotteryAssignments: store.lotteryAssignments, settings: store.settings, outbox: store.outbox,
          nextUserId: store.nextUserId, nextChildId: store.nextChildId, nextAdminId: store.nextAdminId,
          nextNoteId: store.nextNoteId, nextRunId: store.nextRunId, nextTitleId: store.nextTitleId,
          nextExtraId: store.nextExtraId, nextOutboxId: store.nextOutboxId,
        });
        try {
          return await work(repos);
        } catch (e) {
          Object.assign(store, snap); // restore on failure (rollback)
          throw e;
        }
      } finally { release(); }
    },
  };
}

/** Seed a representative, fully data-driven question set (subset of the real
 *  ExtraTitles/Extra, now with input_type/active/sort_order). */
export function seedSurvey(store: MemoryStore): void {
  const titles: ExtraTitleRecord[] = [
    { titleId: 6, question: 'Which Kindergarten session would you prefer?', grade: '-0-', lotteryQuestion: 0, brief: 'K Session', inputType: 'single_select', active: true, sortOrder: 10 },
    { titleId: 10, question: 'Which language would be your first preference?', grade: '-2-3-4-5-', lotteryQuestion: 0, brief: 'Language', inputType: 'single_select', active: true, sortOrder: 20 },
    { titleId: 20, question: 'How did you find out about us?', grade: null, lotteryQuestion: 1, brief: 'referredby', inputType: 'text', active: true, sortOrder: 10 },
    { titleId: 17, question: 'How many times have you visited?', grade: null, lotteryQuestion: 1, brief: 'visit_count', inputType: 'single_select', active: true, sortOrder: 20 },
    { titleId: 11, question: 'What influenced your decision to apply?', grade: null, lotteryQuestion: 1, brief: 'pushmarket', inputType: 'multi_select', active: true, sortOrder: 30 },
  ];
  const options: ExtraOptionRecord[] = [
    { extraId: 1, titleId: 6, value: 'AM' },
    { extraId: 2, titleId: 6, value: 'PM' },
    { extraId: 13, titleId: 10, value: 'Spanish' },
    { extraId: 12, titleId: 10, value: 'Arabic' },
    { extraId: 50, titleId: 17, value: '0' },
    { extraId: 51, titleId: 17, value: '2 - 3' },
    // pushmarket options that legacy hardcoded in Perl — now data:
    { extraId: 60, titleId: 11, value: 'World language program' },
    { extraId: 61, titleId: 11, value: 'After-school programs' },
    { extraId: 62, titleId: 11, value: 'Small class sizes' },
  ];
  for (const t of titles) store.extraTitles.set(t.titleId, t);
  for (const o of options) store.extras.set(o.extraId, o);
}
