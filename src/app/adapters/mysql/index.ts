/**
 * mysql2 adapters — implement the repository ports against the EXISTING
 * `enrollment` schema (additive-only; see db/migrations). Column names map
 * to the legacy tables; camelCase record shapes are produced by the mappers.
 *
 * `dateStrings: true` makes DATE/DATETIME come back as strings so DOB/Expiration
 * are 'YYYY-MM-DD' as the rest of the app expects.
 */
import { randomUUID } from 'node:crypto';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type { RegStatus } from '../../../domain/regStatus.js';
import type { Database } from '../../ports/database.js';

/** Either the pool or a single transaction-scoped connection. */
type Queryable = Pick<Pool, 'query'>;
import type {
  AdminRepo, AdminUserRecord, AppSettings, CapacityRepo,
  ChildRecord, ChildRepo, CurrentStudentImportRow, CurrentStudentRecord, CurrentStudentRepo,
  ExtraOptionRecord, ExtraTitleRecord, LotteryAssignmentRow, LotteryRunRepo, MaintenanceRepo,
  NoteRecord, NoteRepo, OutboxEmail, OutboxRepo, ParentRecord, ParentRepo,
  Repositories, SessionRecord, SessionRepo, SettingsRepo, SurveyInputType, SurveyRepo,
  UserRecord, UserRepo,
} from '../../ports/repositories.js';

export interface DbConfig {
  host: string; user: string; password: string; database: string; port?: number;
}

export function createPool(c: DbConfig): Pool {
  return mysql.createPool({
    host: c.host, user: c.user, password: c.password, database: c.database,
    port: c.port ?? 3306, dateStrings: true, connectionLimit: 10, namedPlaceholders: false,
  });
}

type Row = RowDataPacket & Record<string, unknown>;
const first = <T>(rows: Row[], map: (r: Row) => T): T | null => (rows[0] ? map(rows[0]) : null);

// ---- row -> record mappers ----
const toUser = (r: Row): UserRecord => ({
  id: Number(r.id), username: String(r.username), encpass: String(r.encpass), status: String(r.status),
  pwHash: (r.pw_hash as string) ?? null, pwAlgo: (r.pw_algo as string) ?? null,
});
const toParent = (r: Row): ParentRecord => ({
  parentId: Number(r.Parent_ID), lastName: String(r.Last_Name), firstName: String(r.First_Name),
  relationship: String(r.Relationship), address: String(r.Address), city: String(r.City),
  state: String(r.State), zip: Number(r.Zip), homePhone: String(r.Home_Phone),
  otherPhone: (r.Other_Phone as string) ?? null, returning: !!r.returning, email: String(r.Email),
  alternateEmail: (r.Alternate_Email as string) ?? null, guid: (r.GUID as string) ?? null,
  confirmToken: (r.confirm_token as string) ?? null,
  confirmExpires: r.confirm_expires ? new Date(r.confirm_expires as string) : null,
  resetToken: (r.reset_token as string) ?? null,
  resetExpires: r.reset_expires ? new Date(r.reset_expires as string) : null,
});
const toChild = (r: Row): ChildRecord => ({
  childId: Number(r.Child_ID), parentId: Number(r.Parent_ID), lastName: String(r.Last_Name),
  firstName: String(r.First_Name), middleName: (r.Middle_Name as string) ?? null, gender: String(r.Gender),
  dob: String(r.DOB), gradeNextYear: Number(r.Grade_nxt_yr), regStatus: String(r.Reg_Status) as RegStatus,
  languagePreference: (r.Language_Preference as string) ?? null,
  lotteryConsiderations: Number(r.Lottery_Considerations ?? 0),
  position: r.Position == null ? null : Number(r.Position),
  expiration: (r.Expiration as string) ?? null, parentNotes: (r.parent_notes as string) ?? '',
});
const toCurrent = (r: Row): CurrentStudentRecord => ({
  childId: Number(r.Child_ID), lastName: String(r.Last_Name), firstName: String(r.First_Name),
  middleName: (r.Middle_Name as string) ?? null, gender: String(r.Gender), dob: String(r.DOB),
  regStatus: String(r.Reg_Status) as RegStatus, grade: Number(r.Grade),
});
const toTitle = (r: Row): ExtraTitleRecord => ({
  titleId: Number(r.Title_ID), question: String(r.Question), grade: (r.Grade as string) ?? null,
  lotteryQuestion: Number(r.Lottery_question), brief: (r.Brief as string) ?? null,
  inputType: (String(r.input_type ?? 'text') as SurveyInputType), active: !!r.active, sortOrder: Number(r.sort_order ?? 0),
});
const toOption = (r: Row): ExtraOptionRecord => ({
  extraId: Number(r.Extra_ID), titleId: Number(r.Title_ID), value: (r.Value as string) ?? null,
});
const toAdmin = (r: Row): AdminUserRecord => ({
  id: Number(r.id), username: String(r.username), pwHash: String(r.pw_hash),
  pwAlgo: String(r.pw_algo), active: !!r.active,
});
const toNote = (r: Row): NoteRecord => ({
  id: Number(r.ID), parentId: Number(r.Parent_ID), date: String(r.Date),
  note: Buffer.isBuffer(r.Note) ? r.Note.toString('utf8') : String(r.Note ?? ''),
});

const q = async (pool: Queryable, sql: string, params: unknown[] = []): Promise<Row[]> => {
  const [rows] = await pool.query<Row[]>(sql, params);
  return rows;
};
const exec = async (pool: Queryable, sql: string, params: unknown[] = []): Promise<ResultSetHeader> => {
  const [res] = await pool.query<ResultSetHeader>(sql, params);
  return res;
};

class SqlUserRepo implements UserRepo {
  constructor(private p: Queryable) {}
  async findByUsername(u: string) { return first(await q(this.p, 'SELECT * FROM users WHERE username=?', [u]), toUser); }
  async findById(id: number) { return first(await q(this.p, 'SELECT * FROM users WHERE id=?', [id]), toUser); }
  async create(i: Omit<UserRecord, 'id'>) {
    const r = await exec(this.p, 'INSERT INTO users (username, encpass, status, pw_hash, pw_algo) VALUES (?,?,?,?,?)',
      [i.username, i.encpass, i.status, i.pwHash, i.pwAlgo]);
    return r.insertId;
  }
  async setPasswordHash(id: number, h: string, a: string) { await exec(this.p, 'UPDATE users SET pw_hash=?, pw_algo=? WHERE id=?', [h, a, id]); }
  async setEncpass(id: number, encpass: string) { await exec(this.p, 'UPDATE users SET encpass=? WHERE id=?', [encpass, id]); }
  async setStatus(id: number, s: string) { await exec(this.p, 'UPDATE users SET status=? WHERE id=?', [s, id]); }
}

class SqlParentRepo implements ParentRepo {
  constructor(private p: Queryable) {}
  async create(i: ParentRecord) {
    await exec(this.p,
      `INSERT INTO Parent (Parent_ID, Last_Name, First_Name, Relationship, Address, City, State, Zip,
        Home_Phone, Other_Phone, returning, Reg_Date, Reg_State, Email, Alternate_Email, GUID, confirm_token, confirm_expires)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,CURDATE(),'INITIAL',?,?,?,?,?)`,
      [i.parentId, i.lastName, i.firstName, i.relationship, i.address, i.city, i.state, i.zip,
        i.homePhone, i.otherPhone, i.returning ? 1 : 0, i.email, i.alternateEmail, i.guid, i.confirmToken, i.confirmExpires]);
  }
  async findById(id: number) { return first(await q(this.p, 'SELECT * FROM Parent WHERE Parent_ID=?', [id]), toParent); }
  async findByEmail(email: string) { return first(await q(this.p, 'SELECT * FROM Parent WHERE Email=?', [email]), toParent); }
  async findByEmailAndName(email: string, fn: string, ln: string) {
    return first(await q(this.p, 'SELECT * FROM Parent WHERE Email=? AND First_Name=? AND Last_Name=?', [email, fn, ln]), toParent);
  }
  async findByConfirmToken(t: string) { return first(await q(this.p, 'SELECT * FROM Parent WHERE confirm_token=?', [t]), toParent); }
  async setConfirmToken(id: number, token: string, expires: Date) { await exec(this.p, 'UPDATE Parent SET confirm_token=?, confirm_expires=? WHERE Parent_ID=?', [token, expires, id]); }
  async findByResetToken(t: string) { return first(await q(this.p, 'SELECT * FROM Parent WHERE reset_token=?', [t]), toParent); }
  async setResetToken(id: number, token: string | null, expires: Date | null) { await exec(this.p, 'UPDATE Parent SET reset_token=?, reset_expires=? WHERE Parent_ID=?', [token, expires, id]); }
}

class SqlChildRepo implements ChildRepo {
  constructor(private p: Queryable) {}
  async findByParent(pid: number) { return (await q(this.p, 'SELECT * FROM Child WHERE Parent_ID=? ORDER BY DOB', [pid])).map(toChild); }
  async findById(id: number) { return first(await q(this.p, 'SELECT * FROM Child WHERE Child_ID=?', [id]), toChild); }
  async all() { return (await q(this.p, 'SELECT * FROM Child')).map(toChild); }
  async searchByName(query: string) {
    const like = `%${query}%`;
    return (await q(this.p, 'SELECT * FROM Child WHERE First_Name LIKE ? OR Last_Name LIKE ? ORDER BY Last_Name, First_Name', [like, like])).map(toChild);
  }
  async waitlist(grade?: number) {
    const sql = "SELECT * FROM Child WHERE Reg_Status IN ('WAIT','SIB_WAIT')"
      + (grade === undefined ? '' : ' AND Grade_nxt_yr=?')
      + ' ORDER BY Grade_nxt_yr, Reg_Status, Position';
    return (await q(this.p, sql, grade === undefined ? [] : [String(grade)])).map(toChild);
  }
  async byStatuses(statuses: RegStatus[]) {
    if (statuses.length === 0) return [];
    const ph = statuses.map(() => '?').join(',');
    return (await q(this.p, `SELECT * FROM Child WHERE Reg_Status IN (${ph})`, statuses)).map(toChild);
  }
  async existsByIdentity(fn: string, mn: string, ln: string, dob: string) {
    const rows = await q(this.p,
      'SELECT 1 FROM Child WHERE DOB=? AND Last_Name=? AND (First_Name=? OR First_Name=? OR Middle_Name=?) LIMIT 1',
      [dob, ln, fn, mn, fn]);
    return rows.length > 0;
  }
  async create(i: Omit<ChildRecord, 'childId'>) {
    const r = await exec(this.p,
      `INSERT INTO Child (Parent_ID, Last_Name, First_Name, Middle_Name, Gender, DOB, Grade_nxt_yr, Reg_Date,
        Reg_Status, Language_Preference, Lottery_Considerations, Position, Expiration, parent_notes)
       VALUES (?,?,?,?,?,?,?,CURDATE(),?,?,?,?,?,?)`,
      [i.parentId, i.lastName, i.firstName, i.middleName, i.gender, i.dob, String(i.gradeNextYear),
        i.regStatus, i.languagePreference, i.lotteryConsiderations, i.position, i.expiration, i.parentNotes]);
    return r.insertId;
  }
  async updateStatus(id: number, s: RegStatus, position?: number | null) {
    if (position === undefined) await exec(this.p, 'UPDATE Child SET Reg_Status=? WHERE Child_ID=?', [s, id]);
    else await exec(this.p, 'UPDATE Child SET Reg_Status=?, Position=? WHERE Child_ID=?', [s, position, id]);
  }
  async setPosition(id: number, position: number | null) { await exec(this.p, 'UPDATE Child SET Position=? WHERE Child_ID=?', [position, id]); }
  async setExpiration(id: number, d: string | null) { await exec(this.p, 'UPDATE Child SET Expiration=? WHERE Child_ID=?', [d, id]); }
  async setLanguagePreference(id: number, pref: string | null) { await exec(this.p, 'UPDATE Child SET Language_Preference=? WHERE Child_ID=?', [pref, id]); }
  async updateFields(id: number, fields: Partial<Pick<ChildRecord, 'firstName' | 'middleName' | 'lastName' | 'gender' | 'gradeNextYear'>>) {
    const col: Record<string, string> = {
      firstName: 'First_Name', middleName: 'Middle_Name', lastName: 'Last_Name', gender: 'Gender', gradeNextYear: 'Grade_nxt_yr',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!col[k]) continue;
      sets.push(`${col[k]}=?`);
      params.push(k === 'gradeNextYear' ? String(v) : v);
    }
    if (sets.length === 0) return;
    params.push(id);
    await exec(this.p, `UPDATE Child SET ${sets.join(', ')} WHERE Child_ID=?`, params);
  }
  async delete(id: number) { await exec(this.p, 'DELETE FROM Child WHERE Child_ID=?', [id]); }
}

class SqlCurrentStudentRepo implements CurrentStudentRepo {
  constructor(private p: Queryable) {}
  async findMatch(fn: string, ln: string, dob: string) {
    return first(await q(this.p, 'SELECT * FROM Current_Student WHERE First_Name=? AND Last_Name=? AND DOB=? LIMIT 1', [fn, ln, dob]), toCurrent);
  }
  async setStatus(childId: number, s: RegStatus) { await exec(this.p, 'UPDATE Current_Student SET Reg_Status=? WHERE Child_ID=?', [s, childId]); }
}

class SqlSessionRepo implements SessionRepo {
  constructor(private p: Queryable, private table = 'app_sessions') {}
  async create(userId: number, ttlMs: number) {
    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + ttlMs);
    await exec(this.p, `INSERT INTO ${this.table} (token, user_id, issued_at, expires_at) VALUES (?,?,NOW(),?)`, [token, userId, expiresAt]);
    return { token, userId, issuedAt: new Date(), expiresAt };
  }
  async find(token: string) {
    const r = first(await q(this.p, `SELECT * FROM ${this.table} WHERE token=?`, [token]), (row): SessionRecord => ({
      token: String(row.token), userId: Number(row.user_id),
      issuedAt: new Date(row.issued_at as string), expiresAt: new Date(row.expires_at as string),
    }));
    if (!r) return null;
    if (r.expiresAt.getTime() < Date.now()) { await this.destroy(token); return null; }
    return r;
  }
  async destroy(token: string) { await exec(this.p, `DELETE FROM ${this.table} WHERE token=?`, [token]); }
}

class SqlAdminRepo implements AdminRepo {
  constructor(private p: Queryable) {}
  async findByUsername(u: string) { return first(await q(this.p, 'SELECT * FROM admin_users WHERE username=?', [u]), toAdmin); }
  async findById(id: number) { return first(await q(this.p, 'SELECT * FROM admin_users WHERE id=?', [id]), toAdmin); }
  async create(username: string, pwHash: string, pwAlgo: string) {
    const r = await exec(this.p, 'INSERT INTO admin_users (username, pw_hash, pw_algo, created_at) VALUES (?,?,?,NOW())', [username, pwHash, pwAlgo]);
    return r.insertId;
  }
  async countActive() { const r = await q(this.p, 'SELECT COUNT(*) AS n FROM admin_users WHERE active=1'); return Number(r[0]?.n ?? 0); }
  async list() { return (await q(this.p, 'SELECT * FROM admin_users ORDER BY username')).map(toAdmin); }
  async setActive(id: number, active: boolean) { await exec(this.p, 'UPDATE admin_users SET active=? WHERE id=?', [active ? 1 : 0, id]); }
}

class SqlNoteRepo implements NoteRepo {
  constructor(private p: Queryable) {}
  async add(parentId: number, note: string) { await exec(this.p, 'INSERT INTO Note (Parent_ID, Date, Note) VALUES (?,NOW(),?)', [parentId, note]); }
  async listByParent(parentId: number) { return (await q(this.p, 'SELECT * FROM Note WHERE Parent_ID=? ORDER BY Date', [parentId])).map(toNote); }
}

class SqlCapacityRepo implements CapacityRepo {
  constructor(private p: Queryable) {}
  async gradeCaps() {
    const caps = new Array(10).fill(0);
    for (const r of await q(this.p, 'SELECT Grade, Num_Students FROM MaxEnrollment')) {
      const g = Number(r.Grade);
      if (g >= 0 && g <= 9) caps[g] = Number(r.Num_Students);
    }
    return caps;
  }
}

class SqlSurveyRepo implements SurveyRepo {
  constructor(private p: Queryable) {}
  async listTitles(lq: number) {
    return (await q(this.p, 'SELECT * FROM ExtraTitles WHERE Lottery_question=? AND active=1 ORDER BY sort_order', [lq])).map(toTitle);
  }
  async options(titleId: number) { return (await q(this.p, 'SELECT * FROM Extra WHERE Title_ID=?', [titleId])).map(toOption); }
  async childAnsweredTitleIds(childId: number) {
    const rows = await q(this.p, 'SELECT DISTINCT E.Title_ID AS t FROM ChildExtra CE JOIN Extra E ON CE.Extra_ID=E.Extra_ID WHERE CE.Child_ID=?', [childId]);
    return new Set(rows.map((r) => Number(r.t)));
  }
  async addChildAnswer(childId: number, extraId: number) { await exec(this.p, 'INSERT INTO ChildExtra (Child_ID, Extra_ID) VALUES (?,?)', [childId, extraId]); }
  async clearChildAnswers(childId: number) { await exec(this.p, 'DELETE FROM ChildExtra WHERE Child_ID=?', [childId]); }
  async parentAnsweredTitleIds(parentId: number) {
    const rows = await q(this.p, 'SELECT DISTINCT Title_ID AS t FROM ParentExtra WHERE Parent_ID=?', [parentId]);
    return new Set(rows.map((r) => Number(r.t)));
  }
  async addParentAnswer(parentId: number, titleId: number, answer: string) {
    await exec(this.p, 'INSERT INTO ParentExtra (Parent_ID, Title_ID, Answer) VALUES (?,?,?)', [parentId, titleId, answer]);
  }
  async listAllTitles() {
    return (await q(this.p, 'SELECT * FROM ExtraTitles ORDER BY Lottery_question, sort_order')).map(toTitle);
  }
  async createTitle(input: Omit<ExtraTitleRecord, 'titleId'>) {
    const r = await exec(this.p,
      'INSERT INTO ExtraTitles (Question, Grade, Lottery_question, Brief, input_type, active, sort_order) VALUES (?,?,?,?,?,?,?)',
      [input.question, input.grade, input.lotteryQuestion, input.brief, input.inputType, input.active ? 1 : 0, input.sortOrder]);
    return r.insertId;
  }
  async updateTitle(titleId: number, fields: Partial<Omit<ExtraTitleRecord, 'titleId'>>) {
    const col: Record<string, string> = {
      question: 'Question', grade: 'Grade', lotteryQuestion: 'Lottery_question',
      brief: 'Brief', inputType: 'input_type', active: 'active', sortOrder: 'sort_order',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!col[k]) continue;
      sets.push(`${col[k]}=?`);
      params.push(k === 'active' ? (v ? 1 : 0) : v);
    }
    if (sets.length === 0) return;
    params.push(titleId);
    await exec(this.p, `UPDATE ExtraTitles SET ${sets.join(', ')} WHERE Title_ID=?`, params);
  }
  async addOption(titleId: number, value: string) {
    const r = await exec(this.p, 'INSERT INTO Extra (Title_ID, Value) VALUES (?,?)', [titleId, value]);
    return r.insertId;
  }
  async updateOption(extraId: number, value: string) {
    await exec(this.p, 'UPDATE Extra SET Value=? WHERE Extra_ID=?', [value, extraId]);
  }
  async deleteOption(extraId: number) {
    await exec(this.p, 'DELETE FROM Extra WHERE Extra_ID=?', [extraId]);
  }
}

class SqlLotteryRunRepo implements LotteryRunRepo {
  constructor(private p: Queryable) {}
  async createRun(input: { seed: string; year: number; caps: number[]; committed: boolean }) {
    const r = await exec(this.p, 'INSERT INTO lottery_run (seed, year, caps, ran_at, committed) VALUES (?,?,?,NOW(),?)',
      [input.seed, input.year, JSON.stringify(input.caps), input.committed ? 1 : 0]);
    return r.insertId;
  }
  async addAssignments(runId: number, rows: LotteryAssignmentRow[]) {
    if (rows.length === 0) return;
    const values = rows.map(() => '(?,?,?,?,?,?,?)').join(',');
    const params = rows.flatMap((a) => [runId, a.childId, a.fromStatus, a.toStatus, a.position, a.phase, a.viaSibling ? 1 : 0]);
    await exec(this.p, `INSERT INTO lottery_assignment (run_id, child_id, from_status, to_status, position, phase, via_sibling) VALUES ${values}`, params);
  }
}

class SqlSettingsRepo implements SettingsRepo {
  constructor(private p: Queryable) {}
  async get() {
    return first(await q(this.p, 'SELECT * FROM app_settings WHERE id=1'), (r): AppSettings => ({
      yearBegin: Number(r.year_begin), lotteryOpen: !!r.lottery_open, postLottery: !!r.post_lottery,
    }));
  }
  async set(v: AppSettings) {
    await exec(this.p,
      `INSERT INTO app_settings (id, year_begin, lottery_open, post_lottery, updated_at) VALUES (1,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE year_begin=VALUES(year_begin), lottery_open=VALUES(lottery_open), post_lottery=VALUES(post_lottery), updated_at=NOW()`,
      [v.yearBegin, v.lotteryOpen ? 1 : 0, v.postLottery ? 1 : 0]);
  }
}

class SqlMaintenanceRepo implements MaintenanceRepo {
  // Per-year tables purged on roll-over; reference + admin tables preserved.
  private static PURGE = [
    'Child', 'Parent', 'users', 'user_cookies', 'app_sessions', 'Note',
    'ParentExtra', 'ChildExtra', 'Current_Student', 'lottery_run', 'lottery_assignment',
  ];
  constructor(private p: Queryable) {}
  async purgeForNewYear() {
    await exec(this.p, 'SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const t of SqlMaintenanceRepo.PURGE) await exec(this.p, `TRUNCATE TABLE \`${t}\``);
    } finally {
      await exec(this.p, 'SET FOREIGN_KEY_CHECKS=1');
    }
  }
  async importCurrentStudents(rows: CurrentStudentImportRow[]) {
    if (rows.length === 0) return 0;
    const values = rows.map(() => '(?,?,?,?,?,?,?)').join(',');
    const params = rows.flatMap((r) => [r.lastName, r.firstName, r.middleName, r.gender, r.dob, 'PEND_REENROLL', r.grade]);
    await exec(this.p,
      `INSERT INTO Current_Student (Last_Name, First_Name, Middle_Name, Gender, DOB, Reg_Status, Grade) VALUES ${values}`,
      params);
    return rows.length;
  }
}

class SqlOutboxRepo implements OutboxRepo {
  constructor(private p: Queryable) {}
  async enqueue(recipient: string, template: string, payload: Record<string, unknown>) {
    const r = await exec(this.p, 'INSERT INTO email_outbox (recipient, template, payload, created_at) VALUES (?,?,?,NOW())',
      [recipient, template, JSON.stringify(payload)]);
    return r.insertId;
  }
  async claimPending(limit: number): Promise<OutboxEmail[]> {
    const rows = await q(this.p, "SELECT * FROM email_outbox WHERE state='pending' ORDER BY id LIMIT ?", [limit]);
    return rows.map((r) => ({
      id: Number(r.id), recipient: String(r.recipient), template: String(r.template),
      payload: JSON.parse(String(r.payload)) as Record<string, unknown>, attempts: Number(r.attempts),
    }));
  }
  async markSent(id: number) {
    await exec(this.p, "UPDATE email_outbox SET state='sent', sent_at=NOW() WHERE id=?", [id]);
  }
  async markFailed(id: number, error: string, maxAttempts: number) {
    await exec(this.p,
      "UPDATE email_outbox SET attempts=attempts+1, last_error=?, state=IF(attempts+1>=?, 'failed', 'pending') WHERE id=?",
      [error.slice(0, 250), maxAttempts, id]);
  }
  async countByState() {
    const out: Record<string, number> = {};
    for (const r of await q(this.p, 'SELECT state, COUNT(*) AS n FROM email_outbox GROUP BY state')) {
      out[String(r.state)] = Number(r.n);
    }
    return out;
  }
}

export function createMysqlRepositories(pool: Queryable): Repositories {
  return {
    users: new SqlUserRepo(pool),
    parents: new SqlParentRepo(pool),
    children: new SqlChildRepo(pool),
    currentStudents: new SqlCurrentStudentRepo(pool),
    sessions: new SqlSessionRepo(pool, 'app_sessions'),
    survey: new SqlSurveyRepo(pool),
    admins: new SqlAdminRepo(pool),
    adminSessions: new SqlSessionRepo(pool, 'admin_sessions'),
    notes: new SqlNoteRepo(pool),
    capacity: new SqlCapacityRepo(pool),
    lotteryRuns: new SqlLotteryRunRepo(pool),
    settings: new SqlSettingsRepo(pool),
    maintenance: new SqlMaintenanceRepo(pool),
    outbox: new SqlOutboxRepo(pool),
  };
}

/** Database with real BEGIN/COMMIT/ROLLBACK transactions on the pool. */
export function createMysqlDatabase(pool: Pool): Database {
  return {
    repos: createMysqlRepositories(pool),
    async transaction<T>(work: (tx: Repositories) => Promise<T>): Promise<T> {
      const conn: PoolConnection = await pool.getConnection();
      await conn.beginTransaction();
      try {
        const result = await work(createMysqlRepositories(conn));
        await conn.commit();
        return result;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
  };
}
