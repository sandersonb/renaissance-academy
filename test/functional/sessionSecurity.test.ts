import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mysql, { type Pool } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestMysql, resetData } from './harness.js';
import { createMysqlDatabase, createMysqlRepositories, createPool } from '../../src/app/adapters/mysql/index.js';
import { databaseConnectionOptions } from '../../src/app/adapters/mysql/connectionOptions.js';
import { AdminAuthError, AdminAuthService } from '../../src/app/services/adminAuthService.js';
import { AdminService } from '../../src/app/services/adminService.js';
import { AuthError, AuthService } from '../../src/app/services/authService.js';
import * as password from '../../src/app/services/password.js';
import { buildServer } from '../../src/app/http/server.js';
import { applyMigrations, inspectMigrations, loadMigrations, HISTORY } from '../../src/app/adapters/mysql/migrations/engine.js';
import { rows } from '../../src/app/adapters/mysql/migrations/catalog.js';
import { MAX_SESSION_VERSION } from '../../src/app/util/sessionVersion.js';
import { deferred, sessionConfig, sessionParent } from '../sessionFixtures.js';

const migrations = loadMigrations('db/migrations');

describe('revocable sessions with scoped runtime privileges on owned MySQL 8.4.11', () => {
  let server: Awaited<ReturnType<typeof startTestMysql>>;
  let pool: Pool;
  let db: ReturnType<typeof createMysqlDatabase>;
  const appPassword = randomUUID();
  const realPw = password.realPasswordOps(sessionConfig.bcryptCost);
  beforeAll(async () => {
    server = await startTestMysql();
    await server.pool.query("CREATE USER 'session_app'@'%' IDENTIFIED BY ? REQUIRE SSL", [appPassword]);
    await server.pool.query("GRANT SELECT,INSERT,UPDATE,DELETE ON enrollment.* TO 'session_app'@'%'");
    pool = createPool(databaseConnectionOptions({ NODE_ENV: 'production', DB_HOST: 'localhost', DB_PORT: String(server.config.port),
      DB_NAME: 'enrollment', DB_USER: 'session_app', DB_PASSWORD: appPassword, DB_TLS_MODE: 'verify_identity', DB_TLS_CA_FILE: server.tlsCaFile }));
    db = createMysqlDatabase(pool);
  }, 180000);
  afterAll(async () => { await pool?.end(); await server?.stop(); });
  beforeEach(async () => { await resetData(server.pool); });
  afterEach(() => vi.restoreAllMocks());

  async function admins() {
    const auth = new AdminAuthService(db.repos.admins, db.repos.adminSessions, sessionConfig);
    const boss = await auth.createAdmin('boss', 'admin-password');
    const target = await auth.createAdmin('target', 'admin-password');
    return { auth, boss, target, service: new AdminService(db, sessionConfig) };
  }

  it('returns HTTP 401 for deactivated and retained old sessions after reactivation', async () => {
    const { auth, boss, target, service } = await admins();
    const session = await auth.login('target', 'admin-password');
    const app = buildServer({ config: sessionConfig, db });
    try {
      const request = () => app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie: `ra-dev-admin=${session.token}` } });
      expect((await request()).statusCode).toBe(200);
      await service.setAdminActive(target, false, boss);
      expect((await request()).statusCode).toBe(401);
      await service.setAdminActive(target, true, boss);
      await pool.query('INSERT INTO admin_sessions (token,user_id,issued_at,expires_at,session_version) VALUES (?,?,NOW(),?,?)', [session.token, target, session.expiresAt, session.sessionVersion]);
      expect((await request()).statusCode).toBe(401);
      const fresh = await auth.login('target', 'admin-password');
      await service.setAdminActive(target, true, boss);
      expect(await auth.adminIdForSession(fresh.token)).toBe(target);
      await expect(pool.query('ALTER TABLE admin_users ADD COLUMN not_allowed INT')).rejects.toThrow();
    } finally { await app.close(); }
  });

  it('rejects admin credential verification delayed across deactivation/reactivation', async () => {
    const { auth, boss, target, service } = await admins();
    const entered = deferred(); const release = deferred();
    const verify = password.verifyBcrypt;
    vi.spyOn(password, 'verifyBcrypt').mockImplementation(async (plain, hash) => { entered.resolve(); await release.promise; return verify(plain, hash); });
    const pending = auth.login('target', 'admin-password').then(() => null, (error: Error) => error);
    await entered.promise;
    try { await service.setAdminActive(target, false, boss); await service.setAdminActive(target, true, boss); }
    finally { release.resolve(); }
    expect(await pending).toBeInstanceOf(AdminAuthError);
    expect((await rows(pool, 'SELECT COUNT(*) AS n FROM admin_sessions'))[0]!.n).toBe(0);
  });

  it('serializes two trusted deactivations and never removes the last active admin', async () => {
    const { boss, target, service } = await admins();
    const results = await Promise.allSettled([service.setAdminActive(boss, false), service.setAdminActive(target, false)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.repos.admins.countActive()).toBe(1);
  });

  it('rejects a disabled acting admin after both HTTP requests passed authentication', async () => {
    const { auth, boss, target } = await admins();
    const a = await auth.login('boss', 'admin-password');
    const b = await auth.login('target', 'admin-password');
    const entered = deferred(); const release = deferred(); let count = 0;
    const transaction = db.transaction.bind(db);
    const coordinated = { ...db, async transaction<T>(work: Parameters<typeof db.transaction<T>>[0]) {
      if (++count === 2) entered.resolve();
      await release.promise;
      return transaction(work);
    } };
    const app = buildServer({ config: sessionConfig, db: coordinated });
    try {
      const requests = [
        app.inject({ method: 'PATCH', url: `/api/admin/admins/${target}`, headers: { cookie: `ra-dev-admin=${a.token}` }, payload: { active: false } }),
        app.inject({ method: 'PATCH', url: `/api/admin/admins/${boss}`, headers: { cookie: `ra-dev-admin=${b.token}` }, payload: { active: false } }),
      ];
      // inject is lazy/thenable; start both requests before waiting on their barrier.
      const responses = Promise.all(requests.map((request) => Promise.resolve(request)));
      await entered.promise; release.resolve();
      expect((await responses).map((r) => r.statusCode).sort()).toEqual([200, 400]);
      expect(await db.repos.admins.countActive()).toBe(1);
    } finally { release.resolve(); await app.close(); }
  });

  it('rolls admin activity/version/session deletion back if the DELETE fails', async () => {
    const { auth, boss, target, service } = await admins();
    const old = await auth.login('target', 'admin-password');
    await server.pool.query("CREATE TRIGGER admin_delete_failure BEFORE DELETE ON admin_sessions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic deletion failure'");
    try {
      await expect(service.setAdminActive(target, false, boss)).rejects.toThrow('synthetic deletion failure');
      expect((await db.repos.admins.findById(target))!).toMatchObject({ active: true, sessionVersion: 0 });
      expect(await auth.adminIdForSession(old.token)).toBe(target);
    } finally { await server.pool.query('DROP TRIGGER admin_delete_failure'); }
  });

  it('reset logs every parent session out and invalidates old HTTP cookies', async () => {
    const parent = await sessionParent(db, realPw);
    const first = await parent.auth.login(parent.username, parent.password);
    const second = await parent.auth.login(parent.username, parent.password);
    const other = await sessionParent(db, realPw, { username: 'otherparent' });
    const unrelated = await other.auth.login(other.username, other.password);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    const app = buildServer({ config: sessionConfig, db });
    try {
      const reset = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token: devToken, password: 'new-pass123' } });
      expect(reset.statusCode).toBe(200);
      for (const old of [first, second]) {
        expect(await parent.auth.userIdForSession(old.token)).toBeNull();
        expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `ra-dev-parent=${old.token}` } })).statusCode).toBe(401);
      }
      expect(await other.auth.userIdForSession(unrelated.token)).toBe(other.id);
      await expect(parent.auth.resetPassword(devToken!, 'another-pass')).rejects.toBeInstanceOf(AuthError);
      expect((await parent.auth.login(parent.username, 'new-pass123')).userId).toBe(parent.id);
      await pool.query('INSERT INTO app_sessions (token,user_id,issued_at,expires_at,session_version) VALUES (?,?,NOW(),?,?)', [first.token, parent.id, first.expiresAt, first.sessionVersion]);
      expect(await parent.auth.userIdForSession(first.token)).toBeNull();
    } finally { await app.close(); }
  });

  it('rolls reset token, credentials/version and sessions back if deletion fails', async () => {
    const parent = await sessionParent(db, realPw);
    const old = await parent.auth.login(parent.username, parent.password);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    const before = await db.repos.users.findById(parent.id);
    await server.pool.query("CREATE TRIGGER parent_delete_failure BEFORE DELETE ON app_sessions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic deletion failure'");
    try {
      await expect(parent.auth.resetPassword(devToken!, 'new-pass123')).rejects.toThrow('synthetic deletion failure');
      expect(await db.repos.users.findById(parent.id)).toEqual(before);
      expect((await db.repos.parents.findById(parent.id))!.resetToken).toBe(devToken);
      expect(await parent.auth.userIdForSession(old.token)).toBe(parent.id);
    } finally { await server.pool.query('DROP TRIGGER parent_delete_failure'); }
    await parent.auth.resetPassword(devToken!, 'new-pass123');
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
  });

  it('accepts at most one of two concurrent resets with one token', async () => {
    const parent = await sessionParent(db, realPw);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    const results = await Promise.allSettled([parent.auth.resetPassword(devToken!, 'new-pass123'), parent.auth.resetPassword(devToken!, 'other-pass123')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(1);
    expect((await db.repos.parents.findById(parent.id))!.resetToken).toBeNull();
  });

  it.each([false, true])('rejects late login/upgrade across reset (legacy=%s)', async (legacy) => {
    const parent = await sessionParent(db, realPw, { legacy });
    const entered = deferred(); const release = deferred();
    const delayed = { ...realPw,
      verifyBcrypt: async (plain: string, hash: string) => { if (!legacy) { entered.resolve(); await release.promise; } return realPw.verifyBcrypt(plain, hash); },
      hashBcrypt: async (plain: string) => { if (legacy) { entered.resolve(); await release.promise; } return realPw.hashBcrypt(plain); },
    };
    const login = new AuthService(db, sessionConfig, delayed).login(parent.username, parent.password).then(() => null, (error: Error) => error);
    await entered.promise;
    try {
      const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
      await parent.auth.resetPassword(devToken!, 'new-pass123');
    } finally { release.resolve(); }
    expect(await login).toBeInstanceOf(AuthError);
    expect((await parent.auth.login(parent.username, 'new-pass123')).userId).toBe(parent.id);
    await expect(parent.auth.login(parent.username, parent.password)).rejects.toBeInstanceOf(AuthError);
  });

  it('handles two concurrent legacy upgrades without revoking valid current logins', async () => {
    const parent = await sessionParent(db, realPw, { legacy: true });
    const sessions = await Promise.all([parent.auth.login(parent.username, parent.password), parent.auth.login(parent.username, parent.password)]);
    for (const session of sessions) expect(await parent.auth.userIdForSession(session.token)).toBe(parent.id);
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(0);
  });

  it('preserves unchanged legacy verification/upgrade when bcrypt storage is empty', async () => {
    const parent = await sessionParent(db, realPw, { legacy: true });
    await pool.query("UPDATE users SET pw_hash='' WHERE id=?", [parent.id]);
    const session = await parent.auth.login(parent.username, parent.password);
    expect(await parent.auth.userIdForSession(session.token)).toBe(parent.id);
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(0);
    expect((await db.repos.users.findById(parent.id))!.pwHash).not.toBe('');
  });

  it('rechecks current token expiry after hashing, preserving credentials/sessions on refusal', async () => {
    const parent = await sessionParent(db, realPw);
    const old = await parent.auth.login(parent.username, parent.password);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    const entered = deferred(); const release = deferred();
    const auth = new AuthService(db, sessionConfig, { ...realPw, hashBcrypt: async (plain) => { entered.resolve(); await release.promise; return realPw.hashBcrypt(plain); } });
    const reset = auth.resetPassword(devToken!, 'new-pass123').then(() => null, (error: Error) => error);
    await entered.promise;
    try { await db.repos.parents.setResetToken(parent.id, devToken!, new Date(Date.now() - 1000)); }
    finally { release.resolve(); }
    expect(await reset).toBeInstanceOf(AuthError);
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(0);
    expect(await parent.auth.userIdForSession(old.token)).toBe(parent.id);
  });

  it('validates current parent status and version, preserving no-op status updates', async () => {
    const parent = await sessionParent(db, realPw);
    const old = await parent.auth.login(parent.username, parent.password);
    await db.repos.users.setStatus(parent.id, 'confirmed');
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
    await db.repos.users.setStatus(parent.id, 'PENDING');
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
    await db.repos.users.setStatus(parent.id, 'CONFIRMED');
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
    const fresh = await parent.auth.login(parent.username, parent.password);
    await db.repos.users.setStatus(parent.id, 'CONFIRMED');
    expect(await parent.auth.userIdForSession(fresh.token)).toBe(parent.id);
  });

  it('treats session and reset tokens as exact opaque values under Unicode case-insensitive collations', async () => {
    const parent = await sessionParent(db, realPw);
    await pool.query("INSERT INTO app_sessions (token,user_id,issued_at,expires_at,session_version) VALUES ('fixturetoken',?,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY),0)", [parent.id]);
    expect(await parent.auth.userIdForSession('FIXTURETOKEN')).toBeNull();
    await db.repos.sessions.destroy('FIXTURETOKEN');
    expect(await parent.auth.userIdForSession('fixturetoken')).toBe(parent.id);
    await db.repos.parents.setResetToken(parent.id, 'fixture-reset-token', new Date(Date.now() + 60000));
    await expect(parent.auth.resetPassword('FIXTURE-RESET-TOKEN', 'new-pass123')).rejects.toBeInstanceOf(AuthError);
    expect((await db.repos.parents.findById(parent.id))!.resetToken).toBe('fixture-reset-token');
  });

  it('fails reset at the version limit without consuming its token or wrapping the version', async () => {
    const parent = await sessionParent(db, realPw);
    await pool.query('UPDATE users SET session_version=? WHERE id=?', [MAX_SESSION_VERSION, parent.id]);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    await expect(parent.auth.resetPassword(devToken!, 'new-pass123')).rejects.toThrow('operator review');
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(MAX_SESSION_VERSION);
    expect((await db.repos.parents.findById(parent.id))!.resetToken).toBe(devToken);
  });

  it('009 clears only modern sessions once, preserves data/legacy cookies, and repeat apply preserves fresh sessions', async () => {
    await server.pool.query('CREATE DATABASE session_upgrade');
    const owner = await mysql.createConnection({ ...server.config, database: 'session_upgrade' });
    try {
      await owner.query(readFileSync('db/schema.sql', 'utf8')); // No-PII legacy fixture, owned disposable schema only.
      await applyMigrations(owner, migrations.slice(0, 8), { apply: true });
      await owner.query("INSERT INTO users (id,username,encpass,status,pw_hash,pw_algo) VALUES (100,'fixtureparent','synthetic','CONFIRMED','synthetic','bcrypt')");
      await owner.query("INSERT INTO Parent (Parent_ID,First_Name,Last_Name,Email) VALUES (100,'Synthetic','Fixture','fixture@example.test')");
      await owner.query("INSERT INTO admin_users (id,username,pw_hash,created_at) VALUES (100,'fixtureadmin','synthetic',NOW())");
      await owner.query("INSERT INTO app_sessions VALUES ('oldparent',100,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))");
      await owner.query("INSERT INTO admin_sessions VALUES ('oldadmin',100,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))");
      await owner.query('INSERT INTO app_settings (id,year_begin,lottery_open,post_lottery,updated_at) VALUES (1,2027,1,0,NOW())');
      await owner.query('SET SESSION foreign_key_checks=0'); // Legacy fixture has its old cookie/user integer-width mismatch.
      await owner.query("INSERT INTO user_cookies (cookie_id,user_id) VALUES ('legacycookie',100)");
      await owner.query('SET SESSION foreign_key_checks=1');
      const before = await rows(owner, `SELECT filename,checksum FROM ${HISTORY} ORDER BY filename`);
      const cycle = await rows(owner, 'SELECT * FROM app_settings');
      await applyMigrations(owner, migrations, { apply: true });
      expect(await rows(owner, 'SELECT token FROM app_sessions')).toEqual([]);
      expect(await rows(owner, 'SELECT token FROM admin_sessions')).toEqual([]);
      expect((await rows(owner, 'SELECT cookie_id FROM user_cookies'))[0]!.cookie_id).toBe('legacycookie');
      expect((await rows(owner, 'SELECT COUNT(*) AS n FROM Parent'))[0]!.n).toBe(1);
      expect(await rows(owner, 'SELECT * FROM app_settings')).toEqual(cycle);
      expect((await rows(owner, `SELECT filename,checksum FROM ${HISTORY} ORDER BY filename`)).slice(0, 8)).toEqual(before);
      const repos = createMysqlRepositories(owner);
      const fresh = await repos.sessions.create(100, 60000, 0);
      expect(fresh).not.toBeNull();
      await applyMigrations(owner, migrations, { apply: true });
      expect(await repos.sessions.find(fresh!.token)).not.toBeNull();
    } finally { await owner.end(); await server.pool.query('DROP DATABASE session_upgrade'); }
  });

  it('refuses nontransactional authentication storage before 009 writes', async () => {
    await server.pool.query('CREATE DATABASE session_upgrade');
    const owner = await mysql.createConnection({ ...server.config, database: 'session_upgrade' });
    try {
      await owner.query(readFileSync('db/schema.sql', 'utf8'));
      await applyMigrations(owner, migrations.slice(0, 8), { apply: true });
      await owner.query('ALTER TABLE admin_sessions ENGINE=MyISAM');
      expect((await inspectMigrations(owner, migrations)).issues.some((issue) => issue.message.includes('InnoDB authentication table'))).toBe(true);
      await expect(applyMigrations(owner, migrations, { apply: true })).rejects.toThrow('InnoDB authentication table');
      expect(await rows(owner, `SELECT filename FROM ${HISTORY} WHERE filename='009_session_revocation.sql'`)).toEqual([]);
    } finally { await owner.end(); await server.pool.query('DROP DATABASE session_upgrade'); }
  });
});
