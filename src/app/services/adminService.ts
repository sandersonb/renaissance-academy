/**
 * AdminService — the staff console operations (Enrollment.pm: search,
 * show_family, change_status, add_note, waitlist). The status-change rules come
 * from the M1 domain `changeStatus` (matrix + capacity + sibling promotion); this
 * service loads the working set, runs the pure logic, applies the change set, and
 * logs a Note — mirroring change_status_finalize.
 */
import { changeStatus, type RowChange } from '../../domain/changeStatus.js';
import { GRADES, HUMANIFY, RegStatus, gradeLabel, isWaitStatus } from '../../domain/regStatus.js';
import { flowable } from '../../domain/transitions.js';
import type { Child } from '../../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../ports/database.js';
import type {
  ChildRecord, CurrentStudentRecord, EditableParentFields, LotteryRunSummary, NoteRecord, OutboxLogRow,
  ParentRecord, Repositories, SurveyAnswer, SurveyResponseRow,
} from '../ports/repositories.js';
import { PW_ALGO, hashBcrypt } from './password.js';
import { addDays, today } from '../util/dates.js';

export class AdminError extends Error {}

const toDomain = (c: ChildRecord): Child => ({
  childId: c.childId, parentId: c.parentId, grade: c.gradeNextYear,
  regStatus: c.regStatus, considerations: c.lotteryConsiderations, position: c.position,
});

/** A child enriched for the family view: survey answers, valid next statuses, waitlist rank. */
export interface FamilyChild extends ChildRecord {
  statusLabel: string;
  transitions: RegStatus[];
  waitlistRank: number | null;
  answers: SurveyAnswer[];
}

export interface FamilyView {
  parent: ParentRecord | null;
  children: FamilyChild[];
  notes: NoteRecord[];
}

export interface CycleSettings {
  yearBegin: number;
  lotteryOpen: boolean;
  postLottery: boolean;
}

type EditableChildFields = Partial<Pick<ChildRecord, 'firstName' | 'middleName' | 'lastName' | 'gender' | 'gradeNextYear' | 'dob'>>;

/** Whitelist + coerce the editable parent fields from a raw request body. */
function pickParentFields(body: Record<string, unknown>): EditableParentFields {
  const f: Record<string, unknown> = {};
  for (const k of ['firstName', 'lastName', 'relationship', 'address', 'city', 'state', 'homePhone', 'otherPhone', 'email', 'alternateEmail']) {
    if (k in body && body[k] != null) f[k] = String(body[k]);
  }
  if ('zip' in body && body.zip != null && body.zip !== '') {
    const z = Number(body.zip);
    if (Number.isFinite(z)) f.zip = z;
  }
  return f as EditableParentFields;
}

/** Whitelist + coerce the editable child fields from a raw request body. */
function pickChildFields(body: Record<string, unknown>): EditableChildFields {
  const f: EditableChildFields = {};
  if (body.firstName != null) f.firstName = String(body.firstName);
  if (body.lastName != null) f.lastName = String(body.lastName);
  if (body.gender != null) f.gender = String(body.gender);
  if (body.dob != null && body.dob !== '') f.dob = String(body.dob);
  if ('middleName' in body) f.middleName = body.middleName == null || body.middleName === '' ? null : String(body.middleName);
  if (body.gradeNextYear != null && body.gradeNextYear !== '') {
    const raw = String(body.gradeNextYear);
    const g = /^k$/i.test(raw) ? 0 : Number(raw);
    if (Number.isInteger(g)) f.gradeNextYear = g;
  }
  return f;
}

export class AdminService {
  private repos: Repositories;
  constructor(private db: Database, private config: AppConfig) {
    this.repos = db.repos;
  }

  /** Current enrollment-cycle phase (effective runtime values that gate the app). */
  async getSettings(): Promise<CycleSettings> {
    return { yearBegin: this.config.yearBegin, lotteryOpen: this.config.lotteryOpen, postLottery: this.config.postLottery };
  }

  /**
   * Toggle the cycle gates. Persists to app_settings AND mutates the shared
   * `config` object in place, so the change takes effect immediately across every
   * service (no restart) and is reflected by the public /api/settings.
   */
  async updateSettings(fields: { lotteryOpen?: boolean; postLottery?: boolean }): Promise<CycleSettings> {
    const lotteryOpen = typeof fields.lotteryOpen === 'boolean' ? fields.lotteryOpen : this.config.lotteryOpen;
    const postLottery = typeof fields.postLottery === 'boolean' ? fields.postLottery : this.config.postLottery;
    await this.repos.settings.set({ yearBegin: this.config.yearBegin, lotteryOpen, postLottery });
    this.config.lotteryOpen = lotteryOpen;
    this.config.postLottery = postLottery;
    return { yearBegin: this.config.yearBegin, lotteryOpen, postLottery };
  }

  // --- Per-grade capacity (MaxEnrollment) ---
  async getCaps(): Promise<number[]> {
    return this.repos.capacity.gradeCaps();
  }
  async updateCaps(caps: unknown): Promise<number[]> {
    if (!Array.isArray(caps) || caps.length !== 10) throw new AdminError('Provide exactly 10 grade caps (K–9).');
    const clean = caps.map((c, g) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0) throw new AdminError(`Invalid cap for grade ${gradeLabel(g)}.`);
      return Math.trunc(n);
    });
    await this.repos.capacity.setCaps(clean);
    return clean;
  }

  // --- Admin account management (admin_users) ---
  async listAdmins(): Promise<{ id: number; username: string; active: boolean }[]> {
    return (await this.repos.admins.list()).map((a) => ({ id: a.id, username: a.username, active: a.active }));
  }
  async createAdminAccount(username: string, password: string): Promise<number> {
    if (!/^\w{3,}$/.test(username ?? '')) throw new AdminError('Username must be alphanumeric, 3+ characters.');
    if ((password ?? '').length < 8) throw new AdminError('Admin password must be at least 8 characters.');
    if (await this.repos.admins.findByUsername(username)) throw new AdminError(`Admin '${username}' already exists.`);
    return this.repos.admins.create(username, await hashBcrypt(password, this.config.bcryptCost), PW_ALGO);
  }
  async setAdminActive(id: number, active: boolean, actingAdminId?: number): Promise<void> {
    const target = await this.repos.admins.findById(id);
    if (!target) throw new AdminError('No such admin.');
    if (!active) {
      if (actingAdminId === id) throw new AdminError('You cannot deactivate your own account.');
      if (target.active && (await this.repos.admins.countActive()) <= 1) {
        throw new AdminError('Cannot deactivate the last active admin.');
      }
    }
    await this.repos.admins.setActive(id, active);
  }

  // --- Read-only audit views ---
  async lotteryHistory(limit = 20): Promise<LotteryRunSummary[]> {
    return this.repos.lotteryRuns.listRuns(limit);
  }
  async emailLog(limit = 50, state?: string): Promise<OutboxLogRow[]> {
    return this.repos.outbox.recent(limit, state);
  }

  /** Search students by name, grouped into families (parent + their children). */
  async search(query: string): Promise<{ parent: ParentRecord | null; children: ChildRecord[] }[]> {
    const matches = await this.repos.children.searchByName(query);
    const byParent = new Map<number, ChildRecord[]>();
    for (const c of matches) (byParent.get(c.parentId) ?? byParent.set(c.parentId, []).get(c.parentId)!).push(c);
    const out = [];
    for (const [parentId] of byParent) {
      out.push({
        parent: await this.repos.parents.findById(parentId),
        children: await this.repos.children.findByParent(parentId),
      });
    }
    return out;
  }

  async showFamily(parentId: number): Promise<FamilyView> {
    const [parent, children, notes, all] = await Promise.all([
      this.repos.parents.findById(parentId),
      this.repos.children.findByParent(parentId),
      this.repos.notes.listByParent(parentId),
      this.repos.children.all(),
    ]);
    // sib_waits(grade): sibling-wait students are offered ahead of the regular wait list.
    const sibCount = GRADES.map((g) => all.filter((c) => c.gradeNextYear === g && c.regStatus === RegStatus.SIB_WAIT).length);
    const rank = (c: ChildRecord): number | null => {
      if (!isWaitStatus(c.regStatus)) return null;
      const base = c.position ?? 0;
      return c.regStatus === RegStatus.WAIT ? base + (sibCount[c.gradeNextYear] ?? 0) : base;
    };
    const enriched: FamilyChild[] = await Promise.all(
      children.map(async (c) => ({
        ...c,
        statusLabel: HUMANIFY[c.regStatus] || c.regStatus,
        transitions: [...flowable(c.regStatus)],
        waitlistRank: rank(c),
        answers: await this.repos.survey.childAnswers(c.childId),
      })),
    );
    return { parent, children: enriched, notes };
  }

  /** Update a parent's demographic fields (show_family edit), logged as a Note. */
  async updateParent(parentId: number, body: Record<string, unknown>): Promise<void> {
    const parent = await this.repos.parents.findById(parentId);
    if (!parent) throw new AdminError('No such parent');
    const fields = pickParentFields(body);
    if (Object.keys(fields).length === 0) throw new AdminError('No editable fields provided');
    await this.db.transaction(async (tx) => {
      await tx.parents.update(parentId, fields);
      await tx.notes.add(parentId, `Edited parent details (${Object.keys(fields).join(', ')}).`);
    });
  }

  /** Edit a student's identity fields (name/gender/grade/DOB), logged as a Note. */
  async updateChild(childId: number, body: Record<string, unknown>): Promise<void> {
    const child = await this.repos.children.findById(childId);
    if (!child) throw new AdminError('No such child');
    const fields = pickChildFields(body);
    if (Object.keys(fields).length === 0) throw new AdminError('No editable fields provided');
    await this.db.transaction(async (tx) => {
      await tx.children.updateFields(childId, fields);
      await tx.notes.add(child.parentId, `Edited student ${child.firstName} ${child.lastName} (${Object.keys(fields).join(', ')}).`);
    });
  }

  /** Add a student directly to a family (admin data entry), created as INITIAL. */
  async addChildToFamily(parentId: number, body: Record<string, unknown>): Promise<number> {
    const parent = await this.repos.parents.findById(parentId);
    if (!parent) throw new AdminError('No such parent');
    const input = pickChildFields(body);
    const firstName = input.firstName?.trim();
    const lastName = input.lastName?.trim();
    const grade = input.gradeNextYear;
    const dob = input.dob;
    if (!firstName || !lastName) throw new AdminError('First and last name are required');
    if (!dob) throw new AdminError('Date of birth is required');
    if (grade == null || grade < 0 || grade > 9) throw new AdminError('Grade must be K–9');
    return this.db.transaction(async (tx) => {
      const childId = await tx.children.create({
        parentId, firstName, middleName: input.middleName ?? null, lastName, gender: input.gender ?? '', dob,
        gradeNextYear: grade, regStatus: RegStatus.INITIAL, languagePreference: null,
        lotteryConsiderations: 0, position: null, expiration: null, parentNotes: '',
      });
      await tx.notes.add(parentId, `Added student ${firstName} ${lastName} (grade ${gradeLabel(grade)}).`);
      return childId;
    });
  }

  /** Delete a student record entirely (data cleanup), logged as a Note. */
  async deleteChild(childId: number): Promise<void> {
    const child = await this.repos.children.findById(childId);
    if (!child) throw new AdminError('No such child');
    await this.db.transaction(async (tx) => {
      await tx.survey.clearChildAnswers(childId);
      await tx.children.delete(childId);
      await tx.notes.add(child.parentId, `Deleted student ${child.firstName} ${child.lastName}.`);
    });
  }

  /**
   * Force a raw Reg_Status, bypassing the transition matrix and its capacity/
   * sibling side-effects. Escape hatch for manual cleanup (phpMyAdmin parity);
   * always logged as a Note so the override is auditable.
   */
  async forceStatus(childId: number, target: RegStatus): Promise<{ message: string }> {
    if (!(Object.values(RegStatus) as string[]).includes(target)) throw new AdminError('Invalid status');
    const child = await this.repos.children.findById(childId);
    if (!child) throw new AdminError('No such child');
    const message = `Status force-set ${child.regStatus} → ${target} (manual override).`;
    await this.db.transaction(async (tx) => {
      await tx.children.updateStatus(childId, target);
      await tx.notes.add(child.parentId, message);
    });
    return { message };
  }

  /** change_status_finalize: validate + apply the transition and log a Note. */
  async changeStatus(childId: number, target: RegStatus): Promise<{ message: string }> {
    const child = await this.repos.children.findById(childId);
    if (!child) throw new AdminError('No such child');
    const all = (await this.repos.children.all()).map(toDomain);
    const caps = await this.repos.capacity.gradeCaps();
    const res = changeStatus(all, childId, target, caps);
    if (!res.ok) throw new AdminError(res.error ?? 'Change rejected');

    // Apply the whole change set + the Note atomically (B2).
    await this.db.transaction(async (tx) => {
      await this.applyChanges(tx, res.changes);
      await tx.notes.add(child.parentId, res.message ?? `Status changed to ${target}`);
    });
    return { message: res.message ?? 'Updated' };
  }

  private async applyChanges(tx: Repositories, changes: RowChange[]): Promise<void> {
    for (const ch of changes) {
      await tx.children.updateStatus(ch.childId, ch.to, ch.position);
      if (ch.setExpiration) {
        const days = ch.setExpiration === 'offer' ? this.config.offerExpirationDays : this.config.paperworkExpirationDays;
        await tx.children.setExpiration(ch.childId, addDays(today(), days));
      }
      if (ch.clearChildExtra) await tx.survey.clearChildAnswers(ch.childId);
    }
  }

  async addNote(parentId: number, note: string): Promise<void> {
    if (!note.trim()) throw new AdminError('Note cannot be empty');
    await this.repos.notes.add(parentId, note.trim());
  }

  async waitlist(grade?: number): Promise<ChildRecord[]> {
    return this.repos.children.waitlist(grade);
  }

  /**
   * Admin home summary (Enrollment.pm main_hash_swap): a grade x status capacity
   * table. "Open Slots" = Max Slots − seats consumed (SEAT_CONSUMING); the info
   * rows below (Candidates, wait lists, etc.) do not consume a seat. Each status
   * row carries `key` (the Reg_Status to drill into) + a plain-English `description`.
   */
  async summary(): Promise<{ grades: string[]; rows: SummaryRow[] }> {
    const [caps, all] = await Promise.all([this.repos.capacity.gradeCaps(), this.repos.children.all()]);
    const count = (status: RegStatus) =>
      GRADES.map((g) => all.filter((c) => c.gradeNextYear === g && c.regStatus === status).length);

    const S = RegStatus;
    const returning = count(S.ACPT_REENROLL);
    const pendOffer = count(S.PEND_OFFER);
    const offer = count(S.OFFER);
    const ipOffer = count(S.IP_OFFER);
    const pendReg = count(S.PEND_REGISTER);
    const finReg = count(S.FIN_REGISTER);
    const registered = count(S.REGISTER);
    const used = GRADES.map(
      (g) => returning[g]! + pendOffer[g]! + offer[g]! + ipOffer[g]! + pendReg[g]! + finReg[g]! + registered[g]!,
    );
    const open = GRADES.map((g) => (caps[g] ?? 0) - used[g]!);

    const row = (label: string, kind: SummaryRow['kind'], key: string | null, values: number[], description: string): SummaryRow => ({
      label, kind, key, values, total: values.reduce((a, b) => a + b, 0), description,
    });
    const D = (key: string) => STATUS_INFO[key] ?? '';
    // Status-row labels come straight from HUMANIFY so the dashboard, badges, and
    // list view all speak the same vocabulary. Only the capacity rows are custom.
    const statusRow = (kind: 'seat' | 'info', s: RegStatus, values: number[]) => row(HUMANIFY[s], kind, s, values, D(s));
    return {
      grades: GRADES.map(gradeLabel),
      rows: [
        row('Max Slots', 'head', null, GRADES.map((g) => caps[g] ?? 0), D('MAX')),
        statusRow('seat', S.ACPT_REENROLL, returning),
        statusRow('seat', S.PEND_OFFER, pendOffer),
        statusRow('seat', S.OFFER, offer),
        statusRow('seat', S.IP_OFFER, ipOffer),
        statusRow('seat', S.PEND_REGISTER, pendReg),
        statusRow('seat', S.FIN_REGISTER, finReg),
        statusRow('seat', S.REGISTER, registered),
        row('Open Slots', 'open', null, open, D('OPEN')),
        statusRow('info', S.INITIAL, count(S.INITIAL)),
        statusRow('info', S.WAIT, count(S.WAIT)),
        statusRow('info', S.SIB_WAIT, count(S.SIB_WAIT)),
        statusRow('info', S.IP_REENROLL, count(S.IP_REENROLL)),
        statusRow('info', S.DECLINE, count(S.DECLINE)),
      ],
    };
  }

  /**
   * Drill-down list for the dashboard: children matching a grade and/or status
   * (+ optional name), grouped with parent info for linking. Wait-list results
   * carry a combined `waitlistRank` reflecting true offer order — sibling-wait
   * students are ranked ahead of regular-wait (Enrollment.pm: WAIT position +
   * sib_waits(grade)); everything else sorts by grade then name.
   */
  async list(filter: ListFilter): Promise<{ filter: ListFilter; count: number; results: ListRow[] }> {
    const all = await this.repos.children.all();
    const name = filter.name?.trim().toLowerCase();
    const sibCount = GRADES.map((g) => all.filter((c) => c.gradeNextYear === g && c.regStatus === RegStatus.SIB_WAIT).length);

    const matched = all.filter((c) => {
      if (filter.grade != null && c.gradeNextYear !== filter.grade) return false;
      if (filter.status && c.regStatus !== filter.status) return false;
      if (name && !`${c.firstName} ${c.lastName}`.toLowerCase().includes(name) && !c.lastName.toLowerCase().includes(name))
        return false;
      return true;
    });

    // Resolve parents once per distinct family.
    const parentIds = [...new Set(matched.map((c) => c.parentId))];
    const parents = new Map<number, ParentRecord | null>(
      await Promise.all(parentIds.map(async (id) => [id, await this.repos.parents.findById(id)] as const)),
    );

    const isWait = (s: RegStatus) => s === RegStatus.WAIT || s === RegStatus.SIB_WAIT;
    const rank = (c: ChildRecord): number | null => {
      if (!isWait(c.regStatus)) return null;
      const base = c.position ?? 0;
      return c.regStatus === RegStatus.WAIT ? base + sibCount[c.gradeNextYear]! : base;
    };

    const results: ListRow[] = matched.map((c) => {
      const p = parents.get(c.parentId) ?? null;
      return {
        childId: c.childId, firstName: c.firstName, lastName: c.lastName, gradeNextYear: c.gradeNextYear,
        regStatus: c.regStatus, statusLabel: HUMANIFY[c.regStatus] || c.regStatus,
        parentId: c.parentId, parentName: p ? `${p.firstName} ${p.lastName}`.trim() : null,
        expiration: c.expiration ?? null, waitlistRank: rank(c),
      };
    });

    const allWait = results.length > 0 && results.every((r) => r.waitlistRank != null);
    results.sort((a, b) =>
      allWait
        ? a.gradeNextYear - b.gradeNextYear || a.waitlistRank! - b.waitlistRank!
        : a.gradeNextYear - b.gradeNextYear ||
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
    );
    return { filter, count: results.length, results };
  }

  /**
   * Survey results (Enrollment.pm reports): a tally of each question × answer with
   * counts, the flat list of individual responses (child registration + parent
   * lottery answers), and the distinct question list for filtering.
   */
  async surveyReport(): Promise<SurveyReport> {
    const responses = await this.repos.survey.surveyResponses();

    const questionMap = new Map<number, SurveyReportQuestion>();
    const countMap = new Map<string, SurveyReportCount>();
    for (const r of responses) {
      if (!questionMap.has(r.titleId)) {
        questionMap.set(r.titleId, { titleId: r.titleId, question: r.question, brief: r.brief, lotteryQuestion: r.lotteryQuestion });
      }
      const key = `${r.titleId} ${r.value}`;
      const c = countMap.get(key);
      if (c) c.count += 1;
      else countMap.set(key, { titleId: r.titleId, question: r.question, brief: r.brief, value: r.value, count: 1 });
    }

    const questions = [...questionMap.values()].sort((a, b) => a.question.localeCompare(b.question));
    const counts = [...countMap.values()].sort(
      (a, b) => a.question.localeCompare(b.question) || b.count - a.count || a.value.localeCompare(b.value),
    );
    return { questions, counts, responses };
  }

  // --- Current_Student roster CRUD (phpMyAdmin replacement for the returning-student roster) ---

  /** List the current-student roster, optionally filtered by grade and/or name. */
  async rosterList(filter: { grade?: number | null; name?: string | null }): Promise<CurrentStudentRecord[]> {
    const all = await this.repos.currentStudents.all();
    const name = filter.name?.trim().toLowerCase();
    return all
      .filter((c) => (filter.grade == null || c.grade === filter.grade)
        && (!name || `${c.firstName} ${c.lastName}`.toLowerCase().includes(name) || c.lastName.toLowerCase().includes(name)))
      .sort((a, b) => a.grade - b.grade || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }

  async rosterCreate(body: Record<string, unknown>): Promise<number> {
    const f = pickRosterFields(body);
    if (!f.firstName?.trim() || !f.lastName?.trim()) throw new AdminError('First and last name are required');
    if (!f.dob) throw new AdminError('Date of birth is required');
    if (f.grade == null) throw new AdminError('Grade is required (K–12)');
    return this.repos.currentStudents.create({
      firstName: f.firstName.trim(), lastName: f.lastName.trim(), middleName: f.middleName ?? null,
      gender: f.gender ?? '', dob: f.dob, grade: f.grade, regStatus: f.regStatus ?? RegStatus.PEND_REENROLL,
    });
  }

  async rosterUpdate(childId: number, body: Record<string, unknown>): Promise<void> {
    const existing = await this.repos.currentStudents.findById(childId);
    if (!existing) throw new AdminError('No such current student');
    const f = pickRosterFields(body);
    if (Object.keys(f).length === 0) throw new AdminError('No editable fields provided');
    await this.repos.currentStudents.update(childId, f);
  }

  async rosterDelete(childId: number): Promise<void> {
    const existing = await this.repos.currentStudents.findById(childId);
    if (!existing) throw new AdminError('No such current student');
    await this.repos.currentStudents.delete(childId);
  }
}

type RosterFields = Partial<Omit<CurrentStudentRecord, 'childId'>>;

/** Whitelist + coerce editable current-student fields from a raw request body. */
function pickRosterFields(body: Record<string, unknown>): RosterFields {
  const f: Record<string, unknown> = {};
  if (body.firstName != null) f.firstName = String(body.firstName);
  if (body.lastName != null) f.lastName = String(body.lastName);
  if ('middleName' in body) f.middleName = body.middleName == null || body.middleName === '' ? null : String(body.middleName);
  if (body.gender != null) f.gender = String(body.gender);
  if (body.dob != null && body.dob !== '') f.dob = String(body.dob);
  if (body.regStatus != null && (Object.values(RegStatus) as string[]).includes(String(body.regStatus))) {
    f.regStatus = String(body.regStatus);
  }
  if (body.grade != null && body.grade !== '') {
    const raw = String(body.grade);
    const g = /^k$/i.test(raw) ? 0 : Number(raw);
    if (Number.isInteger(g) && g >= 0 && g <= 12) f.grade = g;
  }
  return f as RosterFields;
}

export interface SurveyReportQuestion {
  titleId: number;
  question: string;
  brief: string | null;
  lotteryQuestion: number;
}
export interface SurveyReportCount {
  titleId: number;
  question: string;
  brief: string | null;
  value: string;
  count: number;
}
export interface SurveyReport {
  questions: SurveyReportQuestion[];
  counts: SurveyReportCount[];
  responses: SurveyResponseRow[];
}

export interface SummaryRow {
  label: string;
  /** 'head' = Max Slots, 'open' = Open Slots (neither drills down); 'seat'/'info' = a status. */
  kind: 'head' | 'seat' | 'open' | 'info';
  /** Reg_Status to filter by when a cell is clicked, or null for head/open rows. */
  key: string | null;
  values: number[];
  total: number;
  description: string;
}

export interface ListFilter {
  grade: number | null;
  status: RegStatus | null;
  name: string | null;
}

export interface ListRow {
  childId: number;
  firstName: string;
  lastName: string;
  gradeNextYear: number;
  regStatus: RegStatus;
  statusLabel: string;
  parentId: number;
  parentName: string | null;
  expiration: string | null;
  waitlistRank: number | null;
}

/** Plain-English descriptions for the (i) tooltips (derived from RULES_SPEC §4). */
const STATUS_INFO: Record<string, string> = {
  MAX: 'Total seats available in this grade for the year (the enrollment cap).',
  OPEN: 'Seats still available: Max Slots minus every student currently holding a seat (Returning through Registered).',
  [RegStatus.ACPT_REENROLL]: 'Current students who accepted their spot for next year. They hold a confirmed seat.',
  [RegStatus.PEND_OFFER]: 'Selected by the lottery; an offer email is queued but has not been sent yet.',
  [RegStatus.OFFER]: 'An enrollment offer has been sent and is awaiting the family’s response before it expires.',
  [RegStatus.IP_OFFER]: 'The family clicked Accept and is completing the acceptance survey; the seat is held for them.',
  [RegStatus.PEND_REGISTER]: 'Offer accepted; the family must now submit registration paperwork before the deadline.',
  [RegStatus.FIN_REGISTER]: 'Registration paperwork was started but not finished; the seat is held pending completion.',
  [RegStatus.REGISTER]: 'Fully enrolled — offer accepted and all paperwork complete.',
  [RegStatus.INITIAL]: 'New applicants in the pool awaiting the lottery draw. They do not yet hold a seat.',
  [RegStatus.WAIT]: 'Not selected in the lottery; queued to receive an offer in order as seats open up.',
  [RegStatus.SIB_WAIT]: 'Waitlisted applicants with a sibling attending; they are offered ahead of the regular waiting list.',
  [RegStatus.IP_REENROLL]: 'A returning student who began re-enrollment but has not yet confirmed their spot for next year.',
  [RegStatus.DECLINE]: 'The family declined the offer or withdrew; the seat has been released.',
};
