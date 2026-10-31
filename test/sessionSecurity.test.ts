import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDatabase } from '../src/app/adapters/memory/index.js';
import { AdminAuthService } from '../src/app/services/adminAuthService.js';
import { AdminService } from '../src/app/services/adminService.js';
import { AuthError, AuthService } from '../src/app/services/authService.js';
import { MAX_SESSION_VERSION, nextSessionVersion } from '../src/app/util/sessionVersion.js';
import { deferred, fakeSessionPasswords as pw, sessionConfig, sessionParent } from './sessionFixtures.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('modern session lifecycle (memory)', () => {
  it('revokes admin tokens, never restores retained tokens on reactivation, and preserves no-op activation', async () => {
    const db = createMemoryDatabase();
    const auth = new AdminAuthService(db.repos.admins, db.repos.adminSessions, sessionConfig);
    const admin = new AdminService(db, sessionConfig);
    const boss = await auth.createAdmin('boss', 'admin-password');
    const target = await auth.createAdmin('target', 'admin-password');
    const old = await auth.login('target', 'admin-password');
    await admin.setAdminActive(target, false, boss);
    expect(await auth.adminIdForSession(old.token)).toBeNull();
    await admin.setAdminActive(target, true, boss);
    db.store.adminSessions.set(old.token, old); // Simulate an old retained/reintroduced record.
    expect(await auth.adminIdForSession(old.token)).toBeNull();
    const fresh = await auth.login('target', 'admin-password');
    const version = (await db.repos.admins.findById(target))!.sessionVersion;
    await admin.setAdminActive(target, true, boss);
    expect((await db.repos.admins.findById(target))!.sessionVersion).toBe(version);
    expect(await auth.adminIdForSession(fresh.token)).toBe(target);
  });

  it('checks current principal existence and expiry and keeps parent/admin realms separate', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db);
    const p = await parent.auth.login(parent.username, parent.password);
    const auth = new AdminAuthService(db.repos.admins, db.repos.adminSessions, sessionConfig);
    const id = await auth.createAdmin('boss', 'admin-password');
    const a = await auth.login('boss', 'admin-password');
    expect(await auth.adminIdForSession(p.token)).toBeNull();
    expect(await parent.auth.userIdForSession(a.token)).toBeNull();
    db.store.admins.delete(id);
    expect(await auth.adminIdForSession(a.token)).toBeNull();
    db.store.sessions.get(p.token)!.expiresAt = new Date(Date.now() - 1);
    expect(await parent.auth.userIdForSession(p.token)).toBeNull();
  });

  it('serializes last-active protection and refuses self-deactivation', async () => {
    const db = createMemoryDatabase();
    const auth = new AdminAuthService(db.repos.admins, db.repos.adminSessions, sessionConfig);
    const a = await auth.createAdmin('first', 'admin-password');
    const b = await auth.createAdmin('second', 'admin-password');
    const admin = new AdminService(db, sessionConfig);
    await expect(admin.setAdminActive(a, false, a)).rejects.toThrow('own account');
    const results = await Promise.allSettled([admin.setAdminActive(a, false), admin.setAdminActive(b, false)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.repos.admins.countActive()).toBe(1);
  });

  it('rolls admin state/version/session deletion back together on failure', async () => {
    const db = createMemoryDatabase();
    const auth = new AdminAuthService(db.repos.admins, db.repos.adminSessions, sessionConfig);
    const boss = await auth.createAdmin('boss', 'admin-password');
    const target = await auth.createAdmin('target', 'admin-password');
    const old = await auth.login('target', 'admin-password');
    const destroy = db.repos.adminSessions.destroyForUser.bind(db.repos.adminSessions);
    vi.spyOn(db.repos.adminSessions, 'destroyForUser').mockImplementation(async (id) => { await destroy(id); throw new Error('synthetic deletion failure'); });
    await expect(new AdminService(db, sessionConfig).setAdminActive(target, false, boss)).rejects.toThrow('synthetic deletion failure');
    expect((await db.repos.admins.findById(target))!).toMatchObject({ active: true, sessionVersion: 0 });
    expect(await auth.adminIdForSession(old.token)).toBe(target);
  });

  it('reset invalidates every parent session, preserves unrelated sessions and consumes its token once', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db);
    const other = await sessionParent(db, pw, { username: 'otherparent' });
    const a = await parent.auth.login(parent.username, parent.password);
    const b = await parent.auth.login(parent.username, parent.password);
    const unrelated = await other.auth.login(other.username, other.password);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    await parent.auth.resetPassword(devToken!, 'new-pass123');
    expect(await parent.auth.userIdForSession(a.token)).toBeNull();
    expect(await parent.auth.userIdForSession(b.token)).toBeNull();
    expect(await other.auth.userIdForSession(unrelated.token)).toBe(other.id);
    await expect(parent.auth.resetPassword(devToken!, 'another-pass')).rejects.toBeInstanceOf(AuthError);
    expect((await parent.auth.login(parent.username, 'new-pass123')).sessionVersion).toBe(1);
    expect((await db.repos.users.findById(parent.id))!.encpass).toBe('crypt:new-pass123');
  });

  it('rolls reset token, password/version and session maps back together', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db);
    const old = await parent.auth.login(parent.username, parent.password);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    const before = await db.repos.users.findById(parent.id);
    const destroy = db.repos.sessions.destroyForUser.bind(db.repos.sessions);
    const spy = vi.spyOn(db.repos.sessions, 'destroyForUser').mockImplementation(async (id) => { await destroy(id); throw new Error('synthetic deletion failure'); });
    await expect(parent.auth.resetPassword(devToken!, 'new-pass123')).rejects.toThrow('synthetic deletion failure');
    expect(await db.repos.users.findById(parent.id)).toEqual(before);
    expect((await db.repos.parents.findById(parent.id))!.resetToken).toBe(devToken);
    expect(await parent.auth.userIdForSession(old.token)).toBe(parent.id);
    spy.mockRestore();
    await parent.auth.resetPassword(devToken!, 'new-pass123');
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
  });

  it('rejects a login verified before a completed reset', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db);
    const entered = deferred(); const release = deferred();
    const late = new AuthService(db, sessionConfig, { ...pw, verifyBcrypt: async (password, hash) => { entered.resolve(); await release.promise; return pw.verifyBcrypt(password, hash); } });
    const login = late.login(parent.username, parent.password).then(() => null, (error: Error) => error);
    await entered.promise;
    try {
      const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
      await parent.auth.resetPassword(devToken!, 'new-pass123');
    } finally { release.resolve(); }
    expect(await login).toBeInstanceOf(AuthError);
    expect(db.store.sessions.size).toBe(0);
  });

  it('a late legacy upgrade cannot overwrite reset credentials', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db, pw, { legacy: true });
    const entered = deferred(); const release = deferred();
    const late = new AuthService(db, sessionConfig, { ...pw, hashBcrypt: async (password) => { entered.resolve(); await release.promise; return pw.hashBcrypt(password); } });
    const login = late.login(parent.username, parent.password).then(() => null, (error: Error) => error);
    await entered.promise;
    try {
      const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
      await parent.auth.resetPassword(devToken!, 'new-pass123');
    } finally { release.resolve(); }
    expect(await login).toBeInstanceOf(AuthError);
    expect((await db.repos.users.findById(parent.id))!).toMatchObject({ pwHash: 'bcrypt:new-pass123', sessionVersion: 1 });
  });

  it('permits concurrent upgrades of the same unchanged legacy password', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db, pw, { legacy: true });
    const sessions = await Promise.all([parent.auth.login(parent.username, parent.password), parent.auth.login(parent.username, parent.password)]);
    expect(sessions).toHaveLength(2);
    for (const session of sessions) expect(await parent.auth.userIdForSession(session.token)).toBe(parent.id);
  });

  it('preserves legacy login compatibility when the unupgraded bcrypt field is empty', async () => {
    const db = createMemoryDatabase(); const parent = await sessionParent(db, pw, { legacy: true });
    db.store.users.get(parent.id)!.pwHash = '';
    expect((await parent.auth.login(parent.username, parent.password)).userId).toBe(parent.id);
    expect((await db.repos.users.findById(parent.id))!).toMatchObject({ pwHash: 'bcrypt:old-pass123', sessionVersion: 0 });
  });

  it('allows at most one concurrent reset per token', async () => {
    const db = createMemoryDatabase();
    const parent = await sessionParent(db);
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    const results = await Promise.allSettled([parent.auth.resetPassword(devToken!, 'new-pass123'), parent.auth.resetPassword(devToken!, 'other-pass123')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(1);
  });

  it('keeps legacy encpass unchanged when reset dual-write is disabled', async () => {
    const db = createMemoryDatabase(); const parent = await sessionParent(db);
    const auth = new AuthService(db, { ...sessionConfig, dualWriteLegacyCrypt: false }, pw);
    const { devToken } = await auth.requestPasswordReset(parent.username, parent.email);
    await auth.resetPassword(devToken!, 'new-pass123');
    expect((await db.repos.users.findById(parent.id))!.encpass).toBe('crypt:old-pass123');
    expect((await auth.login(parent.username, 'new-pass123')).userId).toBe(parent.id);
  });

  it('does not wrap versions or consume a reset token when the counter is exhausted', async () => {
    expect(() => nextSessionVersion(MAX_SESSION_VERSION)).toThrow('operator review');
    expect(() => nextSessionVersion(NaN)).toThrow('operator review');
    const db = createMemoryDatabase(); const parent = await sessionParent(db);
    db.store.users.get(parent.id)!.sessionVersion = MAX_SESSION_VERSION;
    const { devToken } = await parent.auth.requestPasswordReset(parent.username, parent.email);
    await expect(parent.auth.resetPassword(devToken!, 'new-pass123')).rejects.toThrow('operator review');
    expect((await db.repos.parents.findById(parent.id))!.resetToken).toBe(devToken);
    expect((await db.repos.users.findById(parent.id))!.sessionVersion).toBe(MAX_SESSION_VERSION);
  });

  it('rechecks expiry after a delayed reset hash without partially changing state', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    const db = createMemoryDatabase(); const parent = await sessionParent(db);
    const old = await parent.auth.login(parent.username, parent.password);
    await db.repos.parents.setResetToken(parent.id, 'synthetic-expiry-token', new Date(Date.now() + 1000));
    const entered = deferred(); const release = deferred();
    const auth = new AuthService(db, sessionConfig, { ...pw, hashBcrypt: async (plain) => { entered.resolve(); await release.promise; return pw.hashBcrypt(plain); } });
    const reset = auth.resetPassword('synthetic-expiry-token', 'new-pass123').then(() => null, (error: Error) => error);
    await entered.promise;
    vi.setSystemTime(new Date(Date.now() + 2000)); release.resolve();
    expect(await reset).toBeInstanceOf(AuthError);
    expect((await db.repos.users.findById(parent.id))!).toMatchObject({ pwHash: 'bcrypt:old-pass123', sessionVersion: 0 });
    expect(await parent.auth.userIdForSession(old.token)).toBe(parent.id);
  });

  it('parent status changes cannot revive retained sessions and malformed versions/expiry fail closed', async () => {
    const db = createMemoryDatabase(); const parent = await sessionParent(db);
    const old = await parent.auth.login(parent.username, parent.password);
    await db.repos.users.setStatus(parent.id, 'confirmed');
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
    await db.repos.users.setStatus(parent.id, 'PENDING');
    await db.repos.users.setStatus(parent.id, 'CONFIRMED');
    db.store.sessions.set(old.token, old);
    expect(await parent.auth.userIdForSession(old.token)).toBeNull();
    const fresh = await parent.auth.login(parent.username, parent.password);
    await db.repos.users.setStatus(parent.id, 'CONFIRMED');
    expect(await parent.auth.userIdForSession(fresh.token)).toBe(parent.id);
    db.store.sessions.get(fresh.token)!.expiresAt = new Date(NaN);
    expect(await parent.auth.userIdForSession(fresh.token)).toBeNull();
  });
});
