import { describe, it, expect } from 'vitest';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase } from '../src/app/adapters/memory/index.js';
import { AuthService, AuthError } from '../src/app/services/authService.js';
import type { PasswordOps } from '../src/app/services/password.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
};

// Deterministic fake so unit tests don't depend on the bcrypt/crypt libs.
const fakePw: PasswordOps = {
  hashBcrypt: async (p) => `bcrypt:${p}`,
  verifyBcrypt: async (p, h) => h === `bcrypt:${p}`,
  verifyLegacyCrypt: (p, enc) => enc === `crypt:${p}`,
  makeLegacyCrypt: (p) => `crypt:${p}`,
};

const baseReg = {
  username: 'parent1', password: 'secret1', firstName: 'Pat', lastName: 'Lee',
  state: 'UT', zip: '84043', email: 'pat.lee@example.com', homePhone: '8015551234',
};

function svc() {
  const db = createMemoryDatabase();
  const auth = new AuthService(db, config, fakePw);
  return { repos: db.repos, auth };
}

describe('AuthService', () => {
  it('registers a user (PENDING) + parent, with bcrypt + legacy dual-write', async () => {
    const { repos, auth } = svc();
    const { parentId } = await auth.register(baseReg);
    const user = await repos.users.findById(parentId);
    expect(user?.status).toBe('PENDING');
    expect(user?.pwHash).toBe('bcrypt:secret1');
    expect(user?.encpass).toBe('crypt:secret1'); // dual-write for Perl during window
    expect((await repos.parents.findById(parentId))?.email).toBe('pat.lee@example.com');
    expect(await repos.outbox.countByState()).toEqual({ pending: 1 }); // confirmation enqueued in the tx
  });

  it('rolls back the whole account if the confirmation enqueue fails (no orphan)', async () => {
    const db = createMemoryDatabase();
    db.repos.outbox.enqueue = async () => { throw new Error('outbox down'); };
    const auth = new AuthService(db, config, fakePw);
    await expect(auth.register(baseReg)).rejects.toThrow('outbox down');
    // The user + parent were rolled back — a clean retry is possible.
    expect(await db.repos.users.findByUsername('parent1')).toBeNull();
    expect(await db.repos.parents.findByEmail('pat.lee@example.com')).toBeNull();
  });

  it('rejects duplicate username and invalid input', async () => {
    const { auth } = svc();
    await auth.register(baseReg);
    await expect(auth.register({ ...baseReg, email: 'x@example.com', firstName: 'Other' }))
      .rejects.toBeInstanceOf(AuthError); // dup username
    await expect(auth.register({ ...baseReg, username: 'ab' })).rejects.toThrow(); // too short
    await expect(auth.register({ ...baseReg, username: 'newu', email: 'bad' })).rejects.toThrow();
    await expect(auth.register({ ...baseReg, username: 'newu2', state: 'ZZ' })).rejects.toThrow();
  });

  it('requires confirmation before login', async () => {
    const { auth } = svc();
    const { confirmToken } = await auth.register(baseReg);
    await expect(auth.login('parent1', 'secret1')).rejects.toThrow(/not been validated/);
    await auth.confirm(confirmToken);
    const session = await auth.login('parent1', 'secret1');
    expect(session.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const { auth } = svc();
    const { confirmToken } = await auth.register(baseReg);
    await auth.confirm(confirmToken);
    await expect(auth.login('parent1', 'nope')).rejects.toThrow(/wrong password/);
  });

  it('verifies a legacy crypt() user and upgrades them to bcrypt on login', async () => {
    const { repos, auth } = svc();
    // Seed a legacy user (no bcrypt hash yet), already confirmed.
    const id = await repos.users.create({ username: 'legacy', encpass: 'crypt:hunter2', status: 'CONFIRMED', pwHash: null, pwAlgo: null });
    const session = await auth.login('legacy', 'hunter2');
    expect(session.userId).toBe(id);
    const upgraded = await repos.users.findById(id);
    expect(upgraded?.pwHash).toBe('bcrypt:hunter2'); // upgraded on successful login
  });

  it('logs out (session no longer resolves)', async () => {
    const { auth } = svc();
    const { confirmToken } = await auth.register(baseReg);
    await auth.confirm(confirmToken);
    const s = await auth.login('parent1', 'secret1');
    expect(await auth.userIdForSession(s.token)).toBeTruthy();
    await auth.logout(s.token);
    expect(await auth.userIdForSession(s.token)).toBeNull();
  });

  it('resets a password via a reset token (and lets the new password log in)', async () => {
    const { auth } = svc();
    const { confirmToken } = await auth.register(baseReg);
    await auth.confirm(confirmToken);
    const { devToken } = await auth.requestPasswordReset('parent1', 'pat.lee@example.com');
    expect(devToken).toBeTruthy();
    await auth.resetPassword(devToken!, 'brandnew1');
    await expect(auth.login('parent1', 'secret1')).rejects.toThrow(); // old password gone
    expect((await auth.login('parent1', 'brandnew1')).token).toBeTruthy();
  });

  it('does not reveal whether an account exists on forgot-password', async () => {
    const { auth } = svc();
    await auth.register(baseReg);
    expect(await auth.requestPasswordReset('parent1', 'wrong@example.com')).toEqual({}); // email mismatch
    expect(await auth.requestPasswordReset('nobody', 'x@example.com')).toEqual({}); // no user
  });

  it('rejects an expired/invalid reset token', async () => {
    const { auth } = svc();
    await expect(auth.resetPassword('bogus', 'whatever1')).rejects.toThrow(/invalid or has expired/);
  });

  it('resends confirmation only for a PENDING account', async () => {
    const { auth } = svc();
    await auth.register(baseReg); // status PENDING
    const r = await auth.resendConfirmation('pat.lee@example.com');
    expect(r.devToken).toBeTruthy();
    expect(await auth.resendConfirmation('unknown@example.com')).toEqual({});
  });
});
