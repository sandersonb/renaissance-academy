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
import type { DatabaseOptions } from './connectionOptions.js';
import { MAX_SESSION_VERSION, validSessionVersion } from '../../util/sessionVersion.js';

/** Either the pool or a single transaction-scoped connection. */
type Queryable = Pick<Pool, 'query'>;
import type {
  AdminRepo, AdminUserRecord, AppSettings, CapacityRepo,
  ChildRecord, ChildRepo, CurrentStudentImportRow, CurrentStudentRecord, CurrentStudentRepo,
  DocumentMeta, DocumentRepo,
  EditableParentFields, ExtraOptionRecord, ExtraTitleRecord, LotteryAssignmentRow, LotteryRunRepo, MaintenanceRepo,
  NoteRecord, NoteRepo, OutboxEmail, OutboxRepo, ParentRecord, ParentRepo,
  Repositories, SessionRecord, SessionRepo, SettingsRepo, SurveyInputType, SurveyRepo,
  UserRecord, UserRepo,
} from '../../ports/repositories.js';

export type DbConfig = DatabaseOptions;

export function createPool(c: DbConfig): Pool {
  return mysql.createPool({
    ...c, dateStrings: true, connectionLimit: 10, namedPlaceholders: false,
    multipleStatements: false, // Never inherit the migration connection's capability.
  });
}

type Row = RowDataPacket & Record<string, unknown>;
const first = <T>(rows: Row[], map: (r: Row) => T): T | null => (rows[0] ? map(rows[0]) : null);

// ---- row -> record mappers ----
const toUser = (r: Row): UserRecord => ({
  id: Number(r.id), username: String(r.username), encpass: String(r.encpass), status: String(r.status),
  pwHash: (r.pw_hash as string) ?? null, pwAlgo: (r.pw_algo as string) ?? null,
  sessionVersion: Number(r.session_version),
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
  sessionVersion: Number(r.session_version),
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
  async create(i: Omit<UserRecord, 'id' | 'sessionVersion'>) {
    const r = await exec(this.p, 'INSERT INTO users (username, encpass, status, pw_hash, pw_algo) VALUES (?,?,?,?,?)',
      [i.username, i.encpass, i.status, i.pwHash, i.pwAlgo]);
    return r.insertId;
  }
  async lockById(id: number) { return first(await q(this.p, 'SELECT * FROM users WHERE id=? FOR UPDATE', [id]), toUser); }
  async upgradeLegacyPassword(id: number, encpass: string, version: number, hash: string, algo: string) {
    if (!validSessionVersion(version)) return false;
    const result = await exec(this.p, "UPDATE users SET pw_hash=?,pw_algo=? WHERE id=? AND BINARY encpass=BINARY ? AND (pw_hash IS NULL OR pw_hash='') AND session_version=?", [hash, algo, id, encpass, version]);
    return result.affectedRows === 1;
  }
  async replacePassword(id: number, hash: string, algo: string, encpass: string | null) {
    const result = await exec(this.p, 'UPDATE users SET pw_hash=?,pw_algo=?,encpass=COALESCE(?,encpass),session_version=session_version+1 WHERE id=? AND session_version<?', [hash, algo, encpass, id, MAX_SESSION_VERSION]);
    if (result.affectedRows !== 1) throw new Error('Session version exhausted or account missing; operator review required.');
  }
  async setPasswordHash(id: number, h: string, a: string) { await this.replacePassword(id, h, a, null); }
  async setEncpass(id: number, encpass: string) { await exec(this.p, 'UPDATE users SET encpass=? WHERE id=?', [encpass, id]); }
  async setStatus(id: number, status: string) {
    const result = await exec(this.p, 'UPDATE users SET session_version=session_version+(BINARY status<>BINARY ?),status=? WHERE id=? AND (BINARY status=BINARY ? OR session_version<?)', [status, status, id, status, MAX_SESSION_VERSION]);
    if (result.affectedRows !== 1) throw new Error('Session version exhausted or account missing; operator review required.');
  }
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
  async update(id: number, fields: EditableParentFields) {
    const col: Record<string, string> = {
      firstName: 'First_Name', lastName: 'Last_Name', relationship: 'Relationship', address: 'Address',
      city: 'City', state: 'State', zip: 'Zip', homePhone: 'Home_Phone', otherPhone: 'Other_Phone',
      email: 'Email', alternateEmail: 'Alternate_Email',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!col[k]) continue;
      sets.push(`${col[k]}=?`);
      params.push(v);
    }
    if (sets.length === 0) return;
    params.push(id);
    await exec(this.p, `UPDATE Parent SET ${sets.join(', ')} WHERE Parent_ID=?`, params);
  }
  async findById(id: number) { return first(await q(this.p, 'SELECT * FROM Parent WHERE Parent_ID=?', [id]), toParent); }
  async findByEmail(email: string) { return first(await q(this.p, 'SELECT * FROM Parent WHERE Email=?', [email]), toParent); }
  async findByEmailAndName(email: string, fn: string, ln: string) {
    return first(await q(this.p, 'SELECT * FROM Parent WHERE Email=? AND First_Name=? AND Last_Name=?', [email, fn, ln]), toParent);
  }
  async findByConfirmToken(t: string) { return first(await q(this.p, 'SELECT * FROM Parent WHERE confirm_token=?', [t]), toParent); }
  async setConfirmToken(id: number, token: string, expires: Date) { await exec(this.p, 'UPDATE Parent SET confirm_token=?, confirm_expires=? WHERE Parent_ID=?', [token, expires, id]); }
  async findByResetToken(t: string) { return first(await q(this.p, 'SELECT * FROM Parent WHERE reset_token=? AND BINARY reset_token=BINARY ?', [t, t]), toParent); }
  async setResetToken(id: number, token: string | null, expires: Date | null) { await exec(this.p, 'UPDATE Parent SET reset_token=?, reset_expires=? WHERE Parent_ID=?', [token, expires, id]); }
  async consumeResetToken(id: number, token: string, now: Date) {
    const result = await exec(this.p, 'UPDATE Parent SET reset_token=NULL,reset_expires=NULL WHERE Parent_ID=? AND BINARY reset_token=BINARY ? AND reset_expires>?', [id, token, now]);
    return result.affectedRows === 1;
  }
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
  async updateFields(id: number, fields: Partial<Pick<ChildRecord, 'firstName' | 'middleName' | 'lastName' | 'gender' | 'gradeNextYear' | 'dob'>>) {
    const col: Record<string, string> = {
      firstName: 'First_Name', middleName: 'Middle_Name', lastName: 'Last_Name', gender: 'Gender', gradeNextYear: 'Grade_nxt_yr', dob: 'DOB',
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
  async all() { return (await q(this.p, 'SELECT * FROM Current_Student ORDER BY Grade, Last_Name, First_Name')).map(toCurrent); }
  async findById(childId: number) { return first(await q(this.p, 'SELECT * FROM Current_Student WHERE Child_ID=?', [childId]), toCurrent); }
  async create(i: Omit<CurrentStudentRecord, 'childId'>) {
    const r = await exec(this.p,
      'INSERT INTO Current_Student (Last_Name, First_Name, Middle_Name, Gender, DOB, Reg_Status, Grade) VALUES (?,?,?,?,?,?,?)',
      [i.lastName, i.firstName, i.middleName, i.gender, i.dob, i.regStatus, i.grade]);
    return r.insertId;
  }
  async update(childId: number, fields: Partial<Omit<CurrentStudentRecord, 'childId'>>) {
    const col: Record<string, string> = {
      lastName: 'Last_Name', firstName: 'First_Name', middleName: 'Middle_Name',
      gender: 'Gender', dob: 'DOB', regStatus: 'Reg_Status', grade: 'Grade',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!col[k]) continue;
      sets.push(`${col[k]}=?`);
      params.push(v);
    }
    if (sets.length === 0) return;
    params.push(childId);
    await exec(this.p, `UPDATE Current_Student SET ${sets.join(', ')} WHERE Child_ID=?`, params);
  }
  async delete(childId: number) { await exec(this.p, 'DELETE FROM Current_Student WHERE Child_ID=?', [childId]); }
}

class SqlSessionRepo implements SessionRepo {
  constructor(private p: Queryable, private table = 'app_sessions') {}
  private get principal() { return this.table === 'admin_sessions' ? 'admin_users' : 'users'; }
  private get enabled() { return this.table === 'admin_sessions' ? 'p.active=1' : "BINARY p.status=BINARY 'CONFIRMED'"; }
  async create(userId: number, ttlMs: number, expectedVersion: number) {
    if (!validSessionVersion(expectedVersion)) return null;
    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + ttlMs);
    const result = await exec(this.p, `INSERT INTO ${this.table} (token,user_id,issued_at,expires_at,session_version)
      SELECT ?,p.id,NOW(),?,p.session_version FROM ${this.principal} p
      WHERE p.id=? AND p.session_version=? AND ${this.enabled}`, [token, expiresAt, userId, expectedVersion]);
    if (result.affectedRows !== 1) return null;
    return { token, userId, issuedAt: new Date(), expiresAt, sessionVersion: expectedVersion };
  }
  async find(token: string) {
    const r = first(await q(this.p, `SELECT s.* FROM ${this.table} s JOIN ${this.principal} p ON p.id=s.user_id
      WHERE s.token=? AND BINARY s.token=BINARY ? AND s.session_version=p.session_version AND ${this.enabled}`, [token, token]), (row): SessionRecord => ({
      token: String(row.token), userId: Number(row.user_id),
      issuedAt: new Date(row.issued_at as string), expiresAt: new Date(row.expires_at as string),
      sessionVersion: Number(row.session_version),
    }));
    if (!r) return null;
    if (!validSessionVersion(r.sessionVersion) || !Number.isFinite(r.expiresAt.getTime()) || r.expiresAt.getTime() <= Date.now()) { await this.destroy(token); return null; }
    return r;
  }
  async destroy(token: string) { await exec(this.p, `DELETE FROM ${this.table} WHERE token=? AND BINARY token=BINARY ?`, [token, token]); }
  async destroyForUser(userId: number) { await exec(this.p, `DELETE FROM ${this.table} WHERE user_id=?`, [userId]); }
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
  async lockAll() { return (await q(this.p, 'SELECT * FROM admin_users ORDER BY id FOR UPDATE')).map(toAdmin); }
  async setActive(id: number, active: boolean) {
    const value = active ? 1 : 0;
    const result = await exec(this.p, 'UPDATE admin_users SET session_version=session_version+(active<>?),active=? WHERE id=? AND (active=? OR session_version<?)', [value, value, id, value, MAX_SESSION_VERSION]);
    if (result.affectedRows !== 1) throw new Error('Session version exhausted or admin missing; operator review required.');
  }
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
  async setCaps(caps: number[]) {
    for (let g = 0; g < 10; g++) {
      await exec(this.p,
        'INSERT INTO MaxEnrollment (Grade, Num_Students) VALUES (?,?) ON DUPLICATE KEY UPDATE Num_Students=VALUES(Num_Students)',
        [String(g), Math.max(0, Math.trunc(caps[g] ?? 0))]);
    }
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
  async childAnswers(childId: number) {
    const rows = await q(this.p,
      `SELECT ET.Title_ID AS titleId, ET.Question AS question, ET.Brief AS brief, E.Value AS value
         FROM ChildExtra CE JOIN Extra E ON CE.Extra_ID=E.Extra_ID JOIN ExtraTitles ET ON E.Title_ID=ET.Title_ID
        WHERE CE.Child_ID=? ORDER BY ET.sort_order`, [childId]);
    return rows.map((r) => ({
      titleId: Number(r.titleId), question: String(r.question ?? ''),
      brief: r.brief == null ? null : String(r.brief), value: r.value == null ? null : String(r.value),
    }));
  }
  async surveyResponses() {
    // Two separate queries (not a UNION) — Extra.Value and ParentExtra.Answer can carry
    // different collations, which makes a UNION column throw "Illegal mix of collations".
    const childRows = await q(this.p,
      `SELECT ET.Title_ID AS titleId, ET.Question AS question, ET.Brief AS brief, ET.Lottery_question AS lq,
              E.Value AS val, CONCAT(C.First_Name,' ',C.Last_Name) AS subject, C.Grade_nxt_yr AS grade, C.Parent_ID AS parentId
         FROM ChildExtra CE JOIN Extra E ON CE.Extra_ID=E.Extra_ID JOIN ExtraTitles ET ON E.Title_ID=ET.Title_ID
         JOIN Child C ON C.Child_ID=CE.Child_ID
        WHERE E.Value IS NOT NULL AND C.First_Name IS NOT NULL`);
    const parentRows = await q(this.p,
      `SELECT ET.Title_ID AS titleId, ET.Question AS question, ET.Brief AS brief, ET.Lottery_question AS lq,
              PE.Answer AS val, CONCAT(P.First_Name,' ',P.Last_Name) AS subject, PE.Parent_ID AS parentId
         FROM ParentExtra PE JOIN ExtraTitles ET ON PE.Title_ID=ET.Title_ID JOIN Parent P ON P.Parent_ID=PE.Parent_ID
        WHERE PE.Answer IS NOT NULL AND PE.Answer <> ''`);
    const map = (r: Row, grade: number | null) => ({
      titleId: Number(r.titleId), question: String(r.question ?? ''), brief: r.brief == null ? null : String(r.brief),
      lotteryQuestion: Number(r.lq), value: String(r.val ?? ''), subject: String(r.subject ?? ''),
      grade, parentId: Number(r.parentId),
    });
    return [
      ...childRows.map((r) => map(r, r.grade == null ? null : Number(r.grade))),
      ...parentRows.map((r) => map(r, null)),
    ];
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
  async listRuns(limit: number) {
    const runs = await q(this.p, 'SELECT id, seed, year, ran_at AS ranAt, committed FROM lottery_run ORDER BY id DESC LIMIT ?', [limit]);
    if (runs.length === 0) return [];
    const ids = runs.map((r) => Number(r.id));
    const ph = ids.map(() => '?').join(',');
    const counts = await q(this.p,
      `SELECT run_id, to_status, COUNT(*) AS n FROM lottery_assignment WHERE run_id IN (${ph}) GROUP BY run_id, to_status`, ids);
    const byRun = new Map<number, Record<string, number>>();
    for (const c of counts) {
      const m = byRun.get(Number(c.run_id)) ?? {};
      m[String(c.to_status)] = Number(c.n);
      byRun.set(Number(c.run_id), m);
    }
    return runs.map((r) => {
      const m = byRun.get(Number(r.id)) ?? {};
      return {
        id: Number(r.id), seed: String(r.seed), year: Number(r.year),
        ranAt: r.ranAt == null ? null : String(r.ranAt), committed: Number(r.committed) === 1,
        offered: m['PEND_OFFER'] ?? 0, waitlisted: m['WAIT'] ?? 0, sibWait: m['SIB_WAIT'] ?? 0,
      };
    });
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
  async countSentSince(since: Date) {
    const rows = await q(this.p, "SELECT COUNT(*) AS n FROM email_outbox WHERE state='sent' AND sent_at >= ?", [since]);
    return Number(rows[0]?.n ?? 0);
  }
  async pendingRecipients(template: string) {
    const rows = await q(this.p, "SELECT DISTINCT recipient FROM email_outbox WHERE state='pending' AND template=?", [template]);
    return new Set(rows.map((r) => String(r.recipient)));
  }
  async recent(limit: number, state?: string) {
    const rows = await q(this.p,
      `SELECT id, recipient, template, state, attempts, last_error AS lastError, created_at AS createdAt, sent_at AS sentAt
         FROM email_outbox ${state ? 'WHERE state=?' : ''} ORDER BY id DESC LIMIT ?`,
      state ? [state, limit] : [limit]);
    return rows.map((r) => ({
      id: Number(r.id), recipient: String(r.recipient), template: String(r.template), state: String(r.state),
      attempts: Number(r.attempts), lastError: r.lastError == null ? null : String(r.lastError),
      createdAt: r.createdAt == null ? null : String(r.createdAt), sentAt: r.sentAt == null ? null : String(r.sentAt),
    }));
  }
}

const toDocMeta = (r: Row): DocumentMeta => ({
  slug: String(r.slug), filename: String(r.filename), contentType: String(r.content_type),
  size: Number(r.size), uploadedAt: r.uploaded_at == null ? null : String(r.uploaded_at),
  uploadedBy: r.uploaded_by == null ? null : Number(r.uploaded_by),
});

class SqlDocumentRepo implements DocumentRepo {
  constructor(private p: Queryable) {}
  async list() {
    return (await q(this.p, 'SELECT slug, filename, content_type, size, uploaded_at, uploaded_by FROM enrollment_document ORDER BY slug')).map(toDocMeta);
  }
  async getMeta(slug: string) {
    return first(await q(this.p, 'SELECT slug, filename, content_type, size, uploaded_at, uploaded_by FROM enrollment_document WHERE slug=?', [slug]), toDocMeta);
  }
  async getFile(slug: string) {
    const r = first(await q(this.p, 'SELECT * FROM enrollment_document WHERE slug=?', [slug]), (row) => row);
    if (!r) return null;
    return { ...toDocMeta(r), bytes: r.bytes as Buffer };
  }
  async upsert(input: { slug: string; filename: string; contentType: string; bytes: Buffer; size: number; uploadedBy: number | null }) {
    await exec(this.p,
      `INSERT INTO enrollment_document (slug, filename, content_type, bytes, size, uploaded_at, uploaded_by)
       VALUES (?,?,?,?,?,NOW(),?)
       ON DUPLICATE KEY UPDATE filename=VALUES(filename), content_type=VALUES(content_type), bytes=VALUES(bytes),
         size=VALUES(size), uploaded_at=NOW(), uploaded_by=VALUES(uploaded_by)`,
      [input.slug, input.filename, input.contentType, input.bytes, input.size, input.uploadedBy]);
  }
  async delete(slug: string) {
    await exec(this.p, 'DELETE FROM enrollment_document WHERE slug=?', [slug]);
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
    documents: new SqlDocumentRepo(pool),
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
