/** Protected HTTP requests against owned MySQL 8.4.11; no operator DB_* reads or mail delivery. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ResultSetHeader, RowDataPacket, Pool } from 'mysql2/promise';
import type { FastifyInstance } from 'fastify';
import { startTestMysql, resetData } from './harness.js';
import { loadConfig } from '../../src/app/config.js';
import { databaseConnectionOptions } from '../../src/app/adapters/mysql/connectionOptions.js';
import { createMysqlDatabase, createPool } from '../../src/app/adapters/mysql/index.js';
import { buildServer } from '../../src/app/http/server.js';
import { AdminAuthService } from '../../src/app/services/adminAuthService.js';
import { realPasswordOps } from '../../src/app/services/password.js';
import { sessionParent } from '../sessionFixtures.js';

const origin = 'https://enrollment.example.org';
const parentName = '__Host-ra-preview-parent';
const adminName = '__Host-ra-preview-admin';
const mutation = { origin, 'x-enrollment-request': '1' };
const staff = { 'x-forwarded-for': '203.0.113.10' };
const config = loadConfig({ NODE_ENV: 'production', DB_NAME: 'enrollment_preview', YEAR_BEGIN: '2027',
  APP_BASE_URL: origin, ADMIN_IP_ALLOWLIST: '203.0.113.10', TRUST_PROXY: 'true', BCRYPT_COST: '4' });
const provider = { async send() { throw new Error('Functional HTTP tests must never deliver mail.'); } };

describe('protected HTTP boundaries with scoped privileges on MySQL 8.4.11', () => {
  let server: Awaited<ReturnType<typeof startTestMysql>>;
  let pool: Pool;
  let db: ReturnType<typeof createMysqlDatabase>;
  let app: FastifyInstance;
  const password = randomUUID();
  beforeAll(async () => {
    server = await startTestMysql();
    await server.pool.query("CREATE USER 'http_app'@'%' IDENTIFIED BY ? REQUIRE SSL", [password]);
    await server.pool.query("GRANT SELECT,INSERT,UPDATE,DELETE ON enrollment.* TO 'http_app'@'%'");
    pool = createPool(databaseConnectionOptions({ NODE_ENV: 'production', DB_HOST: 'localhost', DB_PORT: String(server.config.port),
      DB_NAME: 'enrollment', DB_USER: 'http_app', DB_PASSWORD: password, DB_TLS_MODE: 'verify_identity', DB_TLS_CA_FILE: server.tlsCaFile }));
    db = createMysqlDatabase(pool);
    app = buildServer({ config, db, emailProvider: provider });
  }, 180000);
  afterAll(async () => { await app?.close(); await pool?.end(); await server?.stop(); });
  beforeEach(() => resetData(server.pool));

  async function parent(username = 'syntheticparent') {
    const fixture = await sessionParent(db, realPasswordOps(4), { username });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: mutation,
      payload: { username: fixture.username, password: fixture.password } });
    expect(login.statusCode).toBe(200);
    return { ...fixture, cookie: `${parentName}=${login.cookies.find((c) => c.name === parentName)!.value}` };
  }
  async function admin() {
    const id = await new AdminAuthService(db.repos.admins, db.repos.adminSessions, config).createAdmin('syntheticstaff', 'admin-pass123');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', headers: { ...mutation, ...staff },
      payload: { username: 'syntheticstaff', password: 'admin-pass123' } });
    expect(login.statusCode).toBe(200);
    expect(String(login.headers['set-cookie'])).toContain('HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; Secure');
    expect(String(login.headers['set-cookie'])).not.toContain('Domain=');
    return { id, cookie: `${adminName}=${login.cookies.find((c) => c.name === adminName)!.value}` };
  }
  async function child(parentId: number, status = 'PEND_OFFER') {
    const [row] = await pool.query<ResultSetHeader>(
      "INSERT INTO Child (Parent_ID,Last_Name,First_Name,Gender,DOB,Grade_nxt_yr,Reg_Date,Reg_Status,parent_notes) VALUES (?,'Fixture','Synthetic','M','2021-01-01','0',CURDATE(),?,'')",
      [parentId, status]);
    return row.insertId;
  }
  async function businessSnapshot() {
    const tables = ['Child', 'Parent', 'users', 'ParentExtra', 'ChildExtra', 'Note', 'Current_Student', 'email_outbox', 'app_settings'];
    return Promise.all(tables.map(async (table) => (await pool.query(`SELECT * FROM \`${table}\``))[0]));
  }

  it('dashboard GET/HEAD perform no business writes; authenticated refresh changes only owned pending offers', async () => {
    const mine = await parent(); const theirs = await parent('anotherparent');
    const owned = await child(mine.id); const unrelated = await child(theirs.id); const waiting = await child(mine.id, 'WAIT');
    const before = await businessSnapshot();
    const read = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: mine.cookie } });
    expect(read.statusCode).toBe(200);
    expect(read.json().children.map((c: { childId: number }) => c.childId)).not.toContain(unrelated);
    expect((await app.inject({ method: 'HEAD', url: '/api/me', headers: { cookie: mine.cookie } })).statusCode).toBe(200);
    expect(await businessSnapshot()).toEqual(before);
    expect((await app.inject({ method: 'POST', url: '/api/me/refresh-offers', headers: mutation })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/me/refresh-offers', headers: { cookie: mine.cookie } })).statusCode).toBe(403);
    expect(await businessSnapshot()).toEqual(before);
    expect((await app.inject({ method: 'POST', url: '/api/me/refresh-offers', headers: { ...mutation, cookie: mine.cookie } })).statusCode).toBe(200);
    expect((await db.repos.children.findById(owned))?.regStatus).toBe('OFFER');
    expect((await db.repos.children.findById(owned))?.expiration).not.toBeNull();
    expect((await db.repos.children.findById(unrelated))?.regStatus).toBe('PEND_OFFER');
    expect((await db.repos.children.findById(unrelated))?.expiration).toBeNull();
    expect((await db.repos.children.findById(waiting))?.regStatus).toBe('WAIT');
    const after = await businessSnapshot();
    expect(after.slice(1)).toEqual(before.slice(1));
    await app.inject({ method: 'POST', url: '/api/me/refresh-offers', headers: { ...mutation, cookie: mine.cookie } });
    expect(await businessSnapshot()).toEqual(after);
  });

  it('isolates parent/admin, legacy and production cookie namespaces and expires only the current realm', async () => {
    const p = await parent(); const a = await admin();
    const parentToken = p.cookie.split('=')[1]!; const adminToken = a.cookie.split('=')[1]!;
    for (const cookie of [a.cookie, `sid=${parentToken}`, `__Host-ra-parent=${parentToken}`, `${parentName}=${parentToken}; ${parentName}=${parentToken}`]) {
      expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
    }
    for (const cookie of [p.cookie, `asid=${adminToken}`, `__Host-ra-admin=${adminToken}`, `${adminName}=${parentToken}`]) {
      expect((await app.inject({ method: 'GET', url: '/api/admin/me', headers: { ...staff, cookie } })).statusCode).toBe(401);
    }
    const both = `${p.cookie}; ${a.cookie}; selector=preview; sid=ignored`;
    const out = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { ...mutation, ...staff, cookie: both } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toBe(`${adminName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`);
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', headers: { ...staff, cookie: a.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: p.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { ...mutation, ...staff, cookie: both } })).statusCode).toBe(200);
  });

  it('refuses forbidden Origin on bodyless/JSON/PATCH/PUT/DELETE and raw upload before writes', async () => {
    const p = await parent(); const a = await admin(); const id = await child(p.id);
    const before = await businessSnapshot();
    for (const supplied of [{}, { origin }, { ...mutation, origin: 'null' }, { ...mutation, origin: 'https://evil.example.test' }, { ...mutation, 'sec-fetch-site': 'same-site' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/me/refresh-offers', headers: { ...supplied, cookie: p.cookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/admin/documents/family?filename=fixture.pdf', headers: { ...supplied, ...staff, cookie: a.cookie, 'content-type': 'application/pdf' }, payload: '%PDF-fixture' })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { ...supplied, ...staff, cookie: a.cookie }, payload: { lotteryOpen: false } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: '/api/admin/caps', headers: { ...supplied, ...staff, cookie: a.cookie }, payload: { caps: [1] } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/api/children/${id}`, headers: { ...supplied, cookie: p.cookie } })).statusCode).toBe(403);
    }
    expect(await businessSnapshot()).toEqual(before);
    expect((await db.repos.documents.list())).toHaveLength(0);
  });

  it('does not trust spoofed forwarding, rejects malformed trusted chains and preserves admin IP gating', async () => {
    const a = await admin();
    for (const remoteAddress of ['198.51.100.10', '203.0.113.100']) {
      expect((await app.inject({ method: 'GET', url: '/api/admin/me', remoteAddress, headers: { ...staff, 'x-real-ip': '203.0.113.10', cookie: a.cookie } })).statusCode).toBe(403);
    }
    for (const value of ['203.0.113.10, 198.51.100.1', 'not-an-address', '203.0.113.010']) {
      expect((await app.inject({ method: 'GET', url: '/api/admin/me', headers: { 'x-forwarded-for': value, cookie: a.cookie } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', remoteAddress: '203.0.113.10', headers: { 'x-forwarded-for': '198.51.100.10', cookie: a.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', headers: { 'x-forwarded-for': '::ffff:cb00:710a', cookie: a.cookie } })).statusCode).toBe(200);
  });

  it('supports same-origin PDF upload larger than the auth limit and JSON/bodyless/delete actions', async () => {
    const a = await admin();
    const bytes = Buffer.concat([Buffer.from('%PDF-fixture\n'), Buffer.alloc(20 * 1024, 32)]);
    const upload = await app.inject({ method: 'POST', url: '/api/admin/documents/family?filename=fixture.pdf',
      headers: { ...mutation, ...staff, cookie: a.cookie, 'content-type': 'application/pdf' }, payload: bytes });
    expect(upload.statusCode).toBe(200);
    const document = await db.repos.documents.getFile('family');
    expect(document?.bytes).toEqual(bytes); expect(document?.uploadedBy).toBe(a.id);
    const create = await app.inject({ method: 'POST', url: '/api/admin/admins', headers: { ...mutation, ...staff, cookie: a.cookie },
      payload: { username: 'newsyntheticstaff', password: 'admin-pass123' } });
    expect(create.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/admins/${create.json().id}`, headers: { ...mutation, ...staff, cookie: a.cookie }, payload: { active: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/documents/family', headers: { ...mutation, ...staff, cookie: a.cookie } })).statusCode).toBe(200);
    expect(await db.repos.documents.getFile('family')).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { ...mutation, ...staff, cookie: a.cookie } })).statusCode).toBe(200);
  });

  it('suppresses production-mode tokens regardless of injected provider and never invokes delivery', async () => {
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', headers: mutation,
      payload: { username: 'newparent', password: 'secret123', firstName: 'Synthetic', lastName: 'Fixture', state: 'UT', zip: 0,
        email: 'newparent@example.test', homePhone: '8015551234' } });
    expect(registration.statusCode).toBe(201); expect(Object.keys(registration.json())).toEqual(['parentId']);
    const resend = await app.inject({ method: 'POST', url: '/api/auth/resend', headers: mutation, payload: { email: 'newparent@example.test' } });
    expect(resend.statusCode).toBe(200); expect(resend.json()).toEqual({});
    const p = await parent();
    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot', headers: mutation, payload: { username: p.username, email: p.email } });
    expect(forgot.statusCode).toBe(200); expect(forgot.json()).toEqual({});
    const [outbox] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM email_outbox');
    expect(outbox[0]!.n).toBe(3);
    for (const response of [registration, resend, forgot]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });
});
