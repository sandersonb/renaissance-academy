/**
 * End-to-end functional tests against a REAL MySQL (the mysql2 adapter + the full
 * Fastify server via inject). Reproducible version of the manual docker+curl
 * checks. Docker is required; the default npm test excludes this suite.
 *
 * Run:  npm run test:functional   (needs Docker)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { startTestMysql, resetData } from './harness.js';
import type { AppConfig } from '../../src/app/config.js';
import { createMysqlDatabase } from '../../src/app/adapters/mysql/index.js';
import { buildServer } from '../../src/app/http/server.js';
import { AdminAuthService } from '../../src/app/services/adminAuthService.js';
import { ConsoleEmailProvider } from '../../src/app/adapters/email/providers.js';
import type { Repositories } from '../../src/app/ports/repositories.js';


const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false, emailBatchSize: 20, emailSendSpacingMs: 0, emailDailyCap: 400,
};

const json = (payload: unknown, cookie?: string) => ({
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  payload: JSON.stringify(payload),
});

describe('functional (real MySQL 8.4)', () => {
  let pool: Pool;
  let stop: () => Promise<void>;
  let repos: Repositories;
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ pool, stop } = await startTestMysql());
    const database = createMysqlDatabase(pool);
    repos = database.repos;
    // Preserve development-token behavior without logging token-bearing mail.
    const emailProvider = new class extends ConsoleEmailProvider { async send() {} }();
    app = buildServer({ config, db: database, emailProvider });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stop?.();
  });

  beforeEach(async () => {
    await resetData(pool);
  });

  // --- seed helpers (raw SQL against the real DB) ---
  const insertParent = async (email: string) => {
    const [r] = await pool.query<ResultSetHeader>(
      "INSERT INTO Parent (First_Name,Last_Name,Email) VALUES ('Test','Family',?)", [email],
    );
    return r.insertId;
  };
  const insertChild = async (parentId: number, grade: number, status: string, first = 'Kid') => {
    const [r] = await pool.query<ResultSetHeader>(
      "INSERT INTO Child (Parent_ID,Last_Name,First_Name,Gender,DOB,Grade_nxt_yr,Reg_Date,Reg_Status,parent_notes) " +
        "VALUES (?,?,?,?,?,?,CURDATE(),?,'')",
      [parentId, 'Family', first, 'M', '2021-01-01', String(grade), status],
    );
    return r.insertId;
  };

  it('parent: register -> confirm (walks Type-B survey) -> login -> add child', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      ...json({ username: 'fp1', password: 'secret1', firstName: 'Fp', lastName: 'One', state: 'UT', zip: '84043', email: 'fp1@example.com', homePhone: '8015551234' }) });
    expect(reg.statusCode).toBe(201);
    const { confirmToken } = reg.json();

    // Walk the lottery survey (9 real questions from schema) until confirmed.
    let r = await app.inject({ method: 'POST', url: '/api/auth/confirm', ...json({ token: confirmToken }) });
    let walked = 0;
    while (!r.json().confirmed && walked < 20) {
      const q = r.json().question;
      r = await app.inject({ method: 'POST', url: '/api/auth/confirm/answer', ...json({ token: confirmToken, titleId: q.titleId, answers: ['x'] }) });
      walked++;
    }
    expect(r.json().confirmed).toBe(true);
    expect(walked).toBeGreaterThan(0);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', ...json({ username: 'fp1', password: 'secret1' }) });
    expect(login.statusCode).toBe(200);
    const cookie = `ra-dev-parent=${login.cookies.find((c) => c.name === 'ra-dev-parent')!.value}`;

    const add = await app.inject({ method: 'POST', url: '/api/children',
      ...json({ firstName: 'Sam', lastName: 'One', gender: 'M', dobYear: 2020, dobMonth: 5, dobDay: 1, gradeNextYear: 3 }, cookie) });
    expect(add.statusCode).toBe(201);
    expect(add.json().status).toBe('INITIAL');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().children).toHaveLength(1);
  });

  it('parent: re-enrolls a matching current student (grade from roster)', async () => {
    await pool.query(
      "INSERT INTO Current_Student (Last_Name,First_Name,Gender,DOB,Reg_Status,Grade) VALUES ('Roe','Dana','F','2019-04-10','PEND_REENROLL',4)",
    );
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      ...json({ username: 'fp2', password: 'secret1', firstName: 'Fp', lastName: 'Two', state: 'UT', zip: '84043', email: 'fp2@example.com', homePhone: '8015551234', returning: true }) });
    const { confirmToken } = reg.json();
    await app.inject({ method: 'POST', url: '/api/auth/confirm', ...json({ token: confirmToken }) }); // returning -> immediate
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', ...json({ username: 'fp2', password: 'secret1' }) });
    const cookie = `ra-dev-parent=${login.cookies.find((c) => c.name === 'ra-dev-parent')!.value}`;

    const add = await app.inject({ method: 'POST', url: '/api/children',
      ...json({ firstName: 'Dana', lastName: 'Roe', gender: 'F', dobYear: 2019, dobMonth: 4, dobDay: 10, current: true }, cookie) });
    expect(add.statusCode).toBe(201);
    expect(add.json().status).toBe('ACPT_REENROLL');
    const child = await repos.children.findById(add.json().childId);
    expect(child?.gradeNextYear).toBe(4); // from the roster, not parent input
  });

  it('admin: login -> change status -> note logged', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    const parentId = await insertParent('fam@example.com');
    const childId = await insertChild(parentId, 0, 'WAIT');
    await pool.query('UPDATE Child SET Position=1 WHERE Child_ID=?', [childId]);

    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    expect(login.statusCode).toBe(200);
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    const change = await app.inject({ method: 'POST', url: `/api/admin/children/${childId}/status`, ...json({ status: 'PEND_OFFER' }, cookie) });
    expect(change.statusCode).toBe(200);
    expect((await repos.children.findById(childId))?.regStatus).toBe('PEND_OFFER');
    expect(await repos.notes.listByParent(parentId)).toHaveLength(1);

    const search = await app.inject({ method: 'GET', url: '/api/admin/search?q=Family', headers: { cookie } });
    expect(search.json().results.length).toBeGreaterThan(0);
  });

  it('admin: lottery preview is non-destructive; commit applies + records a draw log', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    // 8 distinct families in grade 0 so they waitlist as WAIT (not all siblings).
    for (let i = 0; i < 8; i++) {
      const p = await insertParent(`l${i}@example.com`);
      await insertChild(p, 0, 'INITIAL', `Kid${i}`);
    }
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;
    const caps = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    const preview = await app.inject({ method: 'POST', url: '/api/admin/lottery/preview', ...json({ caps }, cookie) });
    expect(preview.json().totals.offered).toBe(3);
    // non-destructive: still 8 INITIAL, no run recorded
    const [stillInitial] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM Child WHERE Reg_Status='INITIAL'");
    expect(Number(stillInitial[0].n)).toBe(8);
    const [runs0] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM lottery_run');
    expect(Number(runs0[0].n)).toBe(0);

    // The live run takes NO seed and draws its own — a preview is never reused.
    const commit = await app.inject({ method: 'POST', url: '/api/admin/lottery/commit', ...json({ caps }, cookie) });
    expect(commit.json().seed).toBeTruthy();
    expect(commit.json().seed).not.toBe(preview.json().seed); // independent draw
    // Counts are cap-bound regardless of seed: 3 offered, all 8 placed + logged.
    const [offered] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM Child WHERE Grade_nxt_yr='0' AND Reg_Status='PEND_OFFER'");
    expect(Number(offered[0].n)).toBe(3);
    const [assignments] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM lottery_assignment');
    expect(Number(assignments[0].n)).toBe(8);
    const [seedRow] = await pool.query<any[]>('SELECT seed FROM lottery_run LIMIT 1');
    expect(String(seedRow[0].seed)).toBe(commit.json().seed); // persisted draw seed
  });

  it('admin: roll new year purges prior data and imports the roster', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    // Prior-year data that must be purged.
    const p = await insertParent('prior@example.com');
    await insertChild(p, 3, 'ACPT_REENROLL');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    const csv = 'Last,First,Middle,Sex,Birth,Grade\nSmith,John,,M,10/8/2011,9\nBrown,Sally,Jordan,F,6/5/2012,9';
    const valid = await app.inject({ method: 'POST', url: '/api/admin/roll-year/validate', ...json({ csv }, cookie) });
    expect(valid.json()).toMatchObject({ ok: true, rowCount: 2 });

    const commit = await app.inject({ method: 'POST', url: '/api/admin/roll-year/commit', ...json({ yearBegin: 2027, csv }, cookie) });
    expect(commit.json()).toMatchObject({ imported: 2 });

    const [children] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM Child');
    const [current] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM Current_Student WHERE Reg_Status='PEND_REENROLL'");
    const [settings] = await pool.query<any[]>('SELECT year_begin, lottery_open, post_lottery FROM app_settings WHERE id=1');
    expect(Number(children[0].n)).toBe(0);           // prior year purged
    expect(Number(current[0].n)).toBe(2);            // roster imported
    expect(Number(settings[0].year_begin)).toBe(2027);
    expect(Number(settings[0].post_lottery)).toBe(0);
  });

  it('admin: survey manager creates a question that the parent flow then serves', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    const create = await app.inject({ method: 'POST', url: '/api/admin/survey/questions',
      ...json({ question: 'Functional Q?', lotteryQuestion: 1, inputType: 'single_select', sortOrder: 1 }, cookie) });
    const { titleId } = create.json();
    await app.inject({ method: 'POST', url: `/api/admin/survey/questions/${titleId}/options`, ...json({ value: 'Yes' }, cookie) });

    // It is immediately persisted + served by the data-driven survey engine.
    const list = await app.inject({ method: 'GET', url: '/api/admin/survey', headers: { cookie } });
    const q = list.json().questions.find((x: any) => x.titleId === titleId);
    expect(q.question).toBe('Functional Q?');
    expect(q.options.map((o: any) => o.value)).toContain('Yes');
    const [row] = await pool.query<any[]>('SELECT input_type FROM ExtraTitles WHERE Title_ID=?', [titleId]);
    expect(row[0].input_type).toBe('single_select');
  });

  it('admin: reports merges child + parent answers across mismatched collations', async () => {
    // Extra.Value (utf8_unicode_ci) and ParentExtra.Answer (utf8_general_ci) have
    // different collations, so combining them in a single UNION column throws
    // "Illegal mix of collations". This asserts the reports endpoint (two queries
    // merged in JS) handles both answer sources against the real schema.
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    // A registration question + option (child answer) and a lottery question (parent answer).
    const [t] = await pool.query<ResultSetHeader>(
      "INSERT INTO ExtraTitles (Question, Lottery_question, Brief, input_type, active, sort_order) VALUES ('Session?',0,'K Session','single_select',1,10)",
    );
    const regTitleId = t.insertId;
    const [e] = await pool.query<ResultSetHeader>('INSERT INTO Extra (Title_ID, Value) VALUES (?, ?)', [regTitleId, 'AM']);
    const extraId = e.insertId;
    const [lt] = await pool.query<ResultSetHeader>(
      "INSERT INTO ExtraTitles (Question, Lottery_question, Brief, input_type, active, sort_order) VALUES ('Why apply?',1,'pushmarket','text',1,20)",
    );
    const lotteryTitleId = lt.insertId;

    const parentId = await insertParent('rep@example.com');
    const childId = await insertChild(parentId, 3, 'REGISTER', 'Reba');
    await pool.query('INSERT INTO ChildExtra (Child_ID, Extra_ID) VALUES (?, ?)', [childId, extraId]);
    await pool.query('INSERT INTO ParentExtra (Parent_ID, Title_ID, Answer) VALUES (?, ?, ?)', [parentId, lotteryTitleId, 'Small class sizes']);

    const res = await app.inject({ method: 'GET', url: '/api/admin/reports', headers: { cookie } });
    expect(res.statusCode).toBe(200); // would be 500 with the old UNION query
    const body = res.json();
    // Child registration answer (has a grade) and parent lottery answer (no grade) both present.
    expect(body.responses.some((r: any) => r.parentId === parentId && r.value === 'AM' && r.grade === 3)).toBe(true);
    expect(body.responses.some((r: any) => r.value === 'Small class sizes' && r.grade === null)).toBe(true);
    // Tallied.
    expect(body.counts.some((c: any) => c.titleId === regTitleId && c.value === 'AM' && c.count === 1)).toBe(true);
  });

  it('admin: caps edit, admin management, lottery history, and email log', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    // Caps: PUT persists to MaxEnrollment (UPSERT), GET reflects it.
    const put = await app.inject({ method: 'PUT', url: '/api/admin/caps', ...json({ caps: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, cookie) });
    expect(put.json().caps[0]).toBe(5);
    const [capRow] = await pool.query<any[]>("SELECT Num_Students FROM MaxEnrollment WHERE Grade='0'");
    expect(Number(capRow[0].Num_Students)).toBe(5);

    // Admin management: create, list, deactivate.
    expect((await app.inject({ method: 'POST', url: '/api/admin/admins', ...json({ username: 'alice', password: 'longpassword' }, cookie) })).statusCode).toBe(200);
    const admins = (await app.inject({ method: 'GET', url: '/api/admin/admins', headers: { cookie } })).json().admins;
    const alice = admins.find((a: any) => a.username === 'alice');
    expect(alice).toBeTruthy();
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/admins/${alice.id}`, ...json({ active: false }, cookie) })).statusCode).toBe(200);

    // Lottery history: commit a small draw, then read it back with counts.
    for (let i = 0; i < 8; i++) { const p = await insertParent(`h${i}@example.com`); await insertChild(p, 0, 'INITIAL', `K${i}`); }
    await app.inject({ method: 'POST', url: '/api/admin/lottery/commit', ...json({ caps: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, cookie) });
    const runs = (await app.inject({ method: 'GET', url: '/api/admin/lottery/runs', headers: { cookie } })).json().runs;
    expect(runs[0]).toMatchObject({ offered: 5, waitlisted: 3, committed: true });
    expect(runs[0].seed).toBeTruthy();

    // Email log: a queued row shows up newest-first.
    await pool.query("INSERT INTO email_outbox (recipient, template, payload, created_at) VALUES ('log@example.com','offer','{}',NOW())");
    const log = (await app.inject({ method: 'GET', url: '/api/admin/notify/log', headers: { cookie } })).json().messages;
    expect(log.some((m: any) => m.recipient === 'log@example.com')).toBe(true);
  });

  it('paperwork: admin uploads a PDF; entitled parent downloads it, others are denied', async () => {
    const pdf = Buffer.from('%PDF-1.4\nrenaissance test packet\n%%EOF');
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    const adminLogin = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const adminCookie = `ra-dev-admin=${adminLogin.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    // Admin uploads two packets (raw PDF body → stored as LONGBLOB).
    for (const slug of ['family', 'grade_3']) {
      const up = await app.inject({
        method: 'POST', url: `/api/admin/documents/${slug}?filename=${slug}.pdf`,
        headers: { 'content-type': 'application/pdf', cookie: adminCookie }, payload: pdf,
      });
      expect(up.statusCode).toBe(200);
    }
    const adminList = (await app.inject({ method: 'GET', url: '/api/admin/documents', headers: { cookie: adminCookie } })).json().documents;
    expect(adminList.find((d: any) => d.slug === 'family')).toMatchObject({ available: true, size: pdf.length });
    // Reject a non-PDF.
    const bad = await app.inject({ method: 'POST', url: '/api/admin/documents/family?filename=x.pdf', headers: { 'content-type': 'application/pdf', cookie: adminCookie }, payload: Buffer.from('nope') });
    expect(bad.statusCode).toBe(400);

    // A returning parent with a newly-admitted (PEND_REGISTER, grade 3) child.
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      ...json({ username: 'docp', password: 'secret1', firstName: 'Doc', lastName: 'Parent', state: 'UT', zip: '84043', email: 'docp@example.com', homePhone: '8015551234', returning: true }) });
    await app.inject({ method: 'POST', url: '/api/auth/confirm', ...json({ token: reg.json().confirmToken }) });
    const pLogin = await app.inject({ method: 'POST', url: '/api/auth/login', ...json({ username: 'docp', password: 'secret1' }) });
    const pCookie = `ra-dev-parent=${pLogin.cookies.find((c) => c.name === 'ra-dev-parent')!.value}`;
    const parentId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: pCookie } })).json().parentId;
    await insertChild(parentId, 3, 'PEND_REGISTER');

    // Parent sees family + grade_3 (both uploaded) and can download grade_3.
    const mine = (await app.inject({ method: 'GET', url: '/api/me/documents', headers: { cookie: pCookie } })).json().documents;
    expect(mine.map((d: any) => d.slug).sort()).toEqual(['family', 'grade_3']);
    const dl = await app.inject({ method: 'GET', url: '/api/documents/grade_3', headers: { cookie: pCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    expect(dl.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    // Not entitled to a grade they have no child in.
    expect((await app.inject({ method: 'GET', url: '/api/documents/grade_4', headers: { cookie: pCookie } })).statusCode).toBe(404);
  });

  it('email: register enqueues to the outbox; notify offers + worker drains', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    // A registration enqueues a confirmation email (via OutboxMailer).
    await app.inject({ method: 'POST', url: '/api/auth/register',
      ...json({ username: 'mailu', password: 'secret1', firstName: 'M', lastName: 'U', state: 'UT', zip: '84043', email: 'mailu@example.com', homePhone: '8015551234', returning: true }) });
    // A parent with a pending offer to materialize.
    const p = await insertParent('offer@example.com');
    await insertChild(p, 0, 'PEND_OFFER');

    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `ra-dev-admin=${login.cookies.find((c) => c.name === 'ra-dev-admin')!.value}`;

    const offers = await app.inject({ method: 'POST', url: '/api/admin/notify/offers', headers: { cookie } });
    expect(offers.json()).toEqual({ offers: 1, emails: 1 });
    expect((await repos.children.findById(await childIdByParent(p)))?.regStatus).toBe('OFFER');

    const status = await app.inject({ method: 'GET', url: '/api/admin/notify/status', headers: { cookie } });
    expect(status.json().outbox.pending).toBe(2); // confirmation + offer

    const drain = await app.inject({ method: 'POST', url: '/api/admin/notify/drain', headers: { cookie } });
    expect(drain.json().sent).toBe(2);
    const [sent] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM email_outbox WHERE state='sent'");
    expect(Number(sent[0].n)).toBe(2);
  });

  async function childIdByParent(parentId: number): Promise<number> {
    const [r] = await pool.query<any[]>('SELECT Child_ID FROM Child WHERE Parent_ID=? LIMIT 1', [parentId]);
    return Number(r[0].Child_ID);
  }
});
