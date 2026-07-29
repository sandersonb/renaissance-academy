import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase, seedSurvey } from '../src/app/adapters/memory/index.js';
import { buildServer } from '../src/app/http/server.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false, emailBatchSize: 20, emailSendSpacingMs: 0, emailDailyCap: 400,
};

let app: FastifyInstance;
beforeAll(() => {
  app = buildServer({ config, db: createMemoryDatabase() });
});
afterAll(() => app.close());

const json = (payload: unknown, cookie?: string) => ({
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  payload: JSON.stringify(payload),
});

describe('parent HTTP flow', () => {
  it('register -> confirm -> login -> dashboard -> add child', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      ...json({ username: 'parentx', password: 'secret1', firstName: 'Pat', lastName: 'Lee', state: 'UT', zip: '84043', email: 'pat@example.com', homePhone: '8015551234' }),
    });
    expect(reg.statusCode).toBe(201);
    const { confirmToken } = reg.json();

    const conf = await app.inject({ method: 'POST', url: '/api/auth/confirm', ...json({ token: confirmToken }) });
    expect(conf.statusCode).toBe(200);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', ...json({ username: 'parentx', password: 'secret1' }) });
    expect(login.statusCode).toBe(200);
    const sid = login.cookies.find((c) => c.name === 'sid')!.value;
    const cookie = `sid=${sid}`;

    let me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().children).toHaveLength(0);

    const add = await app.inject({
      method: 'POST', url: '/api/children',
      ...json({ firstName: 'Sam', lastName: 'Lee', gender: 'M', dobYear: 2020, dobMonth: 5, dobDay: 1, gradeNextYear: 3 }, cookie),
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().status).toBe('INITIAL');

    me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().children).toHaveLength(1);
    expect(me.json().children[0].statusLabel).toBe('Awaiting Lottery');
  });

  it('rejects unauthenticated dashboard access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 with validation messages on bad registration', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', ...json({ username: 'ab', password: 'x' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });

  it('exposes public display settings (school year + home notice) without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.schoolYear).toBe('2026-27'); // yearBegin 2026
    expect(s.lotteryOpen).toBe(true);
    expect(s.homeNotice).toContain('2026-27');
    expect(s.homeNotice).toMatch(/Create an account/i); // signup-open wording
  });

  it('with a real email provider, register does NOT expose the confirm token', async () => {
    // Any non-console provider => emailDev false => tokens are not returned.
    const smtpLike = { async send() {} };
    const srv = buildServer({ config, db: createMemoryDatabase(), emailProvider: smtpLike });
    const reg = await srv.inject({ method: 'POST', url: '/api/auth/register',
      ...json({ username: 'prod1', password: 'secret1', firstName: 'P', lastName: 'R', state: 'UT', zip: '84043', email: 'prod1@example.com', homePhone: '8015551234' }) });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().parentId).toBeTruthy();
    expect(reg.json().confirmToken).toBeUndefined(); // gated out in prod
    const s = (await srv.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(s.emailDev).toBe(false);
    await srv.close();
  });

  it('home notice reflects the post-lottery (waitlist) state', async () => {
    const srv = buildServer({ config: { ...config, postLottery: true }, db: createMemoryDatabase() });
    const s = (await srv.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(s.homeNotice).toMatch(/already occurred/);
    expect(s.homeNotice).toMatch(/waiting list/i);
    await srv.close();
  });
});

describe('confirmation survey flow (non-returning family)', () => {
  it('walks Type B questions before confirming, then login works', async () => {
    const db = createMemoryDatabase();
    seedSurvey(db.store); // 2 lottery (Type B) questions: titleId 20, 17
    const srv = buildServer({ config, db });

    const reg = await srv.inject({
      method: 'POST', url: '/api/auth/register',
      ...json({ username: 'newfam', password: 'secret1', firstName: 'New', lastName: 'Fam', state: 'UT', zip: '84043', email: 'new@example.com', homePhone: '8015551234' }),
    });
    const { confirmToken } = reg.json();

    // First confirm: not confirmed yet, returns the first lottery question.
    let c = await srv.inject({ method: 'POST', url: '/api/auth/confirm', ...json({ token: confirmToken }) });
    expect(c.json().confirmed).toBe(false);
    let q = c.json().question;
    expect(q).toBeTruthy();

    // Answer questions until confirmed.
    let guard = 0;
    while (q && guard++ < 10) {
      const a = await srv.inject({ method: 'POST', url: '/api/auth/confirm/answer', ...json({ token: confirmToken, titleId: q.titleId, answer: 'x' }) });
      const body = a.json();
      if (body.confirmed) { q = null; break; }
      q = body.question;
    }

    const login = await srv.inject({ method: 'POST', url: '/api/auth/login', ...json({ username: 'newfam', password: 'secret1' }) });
    expect(login.statusCode).toBe(200);
    await srv.close();
  });
});
