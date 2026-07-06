/**
 * End-to-end functional tests against a REAL MySQL (the mysql2 adapter + the full
 * Fastify server via inject). Reproducible version of the manual docker+curl
 * checks. Auto-skips if Docker isn't available so it never breaks `npm test`.
 *
 * Run:  npm run test:functional   (needs Docker)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { dockerAvailable, startTestMysql, resetData } from './harness.js';
import type { AppConfig } from '../../src/app/config.js';
import { createMysqlDatabase } from '../../src/app/adapters/mysql/index.js';
import { buildServer } from '../../src/app/http/server.js';
import { AdminAuthService } from '../../src/app/services/adminAuthService.js';
import type { Repositories } from '../../src/app/ports/repositories.js';

const HAS_DOCKER = dockerAvailable();

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
};

const json = (payload: unknown, cookie?: string) => ({
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  payload: JSON.stringify(payload),
});

describe.skipIf(!HAS_DOCKER)('functional (real MySQL)', () => {
  let pool: Pool;
  let stop: () => Promise<void>;
  let repos: Repositories;
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ pool, stop } = await startTestMysql());
    const database = createMysqlDatabase(pool);
    repos = database.repos;
    app = buildServer({ config, db: database });
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
    const cookie = `sid=${login.cookies.find((c) => c.name === 'sid')!.value}`;

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
    const cookie = `sid=${login.cookies.find((c) => c.name === 'sid')!.value}`;

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
    const cookie = `asid=${login.cookies.find((c) => c.name === 'asid')!.value}`;

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
    const cookie = `asid=${login.cookies.find((c) => c.name === 'asid')!.value}`;
    const caps = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    const preview = await app.inject({ method: 'POST', url: '/api/admin/lottery/preview', ...json({ caps }, cookie) });
    expect(preview.json().totals.offered).toBe(3);
    // non-destructive: still 8 INITIAL, no run recorded
    const [stillInitial] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM Child WHERE Reg_Status='INITIAL'");
    expect(Number(stillInitial[0].n)).toBe(8);
    const [runs0] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM lottery_run');
    expect(Number(runs0[0].n)).toBe(0);

    const commit = await app.inject({ method: 'POST', url: '/api/admin/lottery/commit', ...json({ caps, seed: preview.json().seed }, cookie) });
    expect(commit.json().totals).toEqual(preview.json().totals); // reproducible
    const [offered] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM Child WHERE Grade_nxt_yr='0' AND Reg_Status='PEND_OFFER'");
    expect(Number(offered[0].n)).toBe(3);
    const [assignments] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM lottery_assignment');
    expect(Number(assignments[0].n)).toBe(8);
  });

  it('admin: roll new year purges prior data and imports the roster', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    // Prior-year data that must be purged.
    const p = await insertParent('prior@example.com');
    await insertChild(p, 3, 'ACPT_REENROLL');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `asid=${login.cookies.find((c) => c.name === 'asid')!.value}`;

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
    const cookie = `asid=${login.cookies.find((c) => c.name === 'asid')!.value}`;

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

  it('email: register enqueues to the outbox; notify offers + worker drains', async () => {
    await new AdminAuthService(repos.admins, repos.adminSessions, config).createAdmin('boss', 'adminpass123');
    // A registration enqueues a confirmation email (via OutboxMailer).
    await app.inject({ method: 'POST', url: '/api/auth/register',
      ...json({ username: 'mailu', password: 'secret1', firstName: 'M', lastName: 'U', state: 'UT', zip: '84043', email: 'mailu@example.com', homePhone: '8015551234', returning: true }) });
    // A parent with a pending offer to materialize.
    const p = await insertParent('offer@example.com');
    await insertChild(p, 0, 'PEND_OFFER');

    const login = await app.inject({ method: 'POST', url: '/api/admin/login', ...json({ username: 'boss', password: 'adminpass123' }) });
    const cookie = `asid=${login.cookies.find((c) => c.name === 'asid')!.value}`;

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
