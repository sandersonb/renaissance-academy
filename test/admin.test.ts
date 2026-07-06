import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase, MemoryStore } from '../src/app/adapters/memory/index.js';
import type { ChildRecord } from '../src/app/ports/repositories.js';
import { AdminAuthService, AdminAuthError } from '../src/app/services/adminAuthService.js';
import { AdminService } from '../src/app/services/adminService.js';
import { buildServer } from '../src/app/http/server.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
};

let nid = 1;
function seedChild(store: MemoryStore, over: Partial<ChildRecord> & { parentId: number; gradeNextYear: number; regStatus: RegStatus }) {
  const childId = 7000 + nid++;
  store.children.set(childId, {
    childId, lastName: 'Stark', firstName: 'Ned', middleName: null, gender: 'M', dob: '2019-01-01',
    languagePreference: null, lotteryConsiderations: 0, position: null, expiration: null, parentNotes: '', ...over,
  });
  return childId;
}

describe('AdminAuthService', () => {
  it('creates an admin and logs in; rejects bad credentials', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const auth = new AdminAuthService(repos.admins, repos.adminSessions, config);
    await auth.createAdmin('alice', 'longpassword');
    const s = await auth.login('alice', 'longpassword');
    expect(await auth.adminIdForSession(s.token)).toBeTruthy();
    await expect(auth.login('alice', 'wrong')).rejects.toBeInstanceOf(AdminAuthError);
  });

  it('enforces password length and uniqueness', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const auth = new AdminAuthService(repos.admins, repos.adminSessions, config);
    await expect(auth.createAdmin('bob', 'short')).rejects.toThrow(/at least 8/);
    await auth.createAdmin('bob', 'longpassword');
    await expect(auth.createAdmin('bob', 'longpassword')).rejects.toThrow(/already exists/);
  });

  it('bootstraps the first admin only when none exist', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const auth = new AdminAuthService(repos.admins, repos.adminSessions, config);
    expect(await auth.bootstrapIfEmpty('root', 'longpassword')).toBe(true);
    expect(await auth.bootstrapIfEmpty('root2', 'longpassword')).toBe(false); // already one admin
  });
});

describe('AdminService', () => {
  it('searches students grouped into families', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    seedChild(db.store, { parentId: 1, gradeNextYear: 3, regStatus: RegStatus.INITIAL, firstName: 'Arya', lastName: 'Stark' });
    seedChild(db.store, { parentId: 1, gradeNextYear: 5, regStatus: RegStatus.INITIAL, firstName: 'Bran', lastName: 'Stark' });
    seedChild(db.store, { parentId: 2, gradeNextYear: 1, regStatus: RegStatus.INITIAL, firstName: 'Jon', lastName: 'Snow' });
    const admin = new AdminService(db, config);
    const res = await admin.search('stark');
    expect(res).toHaveLength(1); // one family (parent 1)
    expect(res[0]!.children).toHaveLength(2);
  });

  it('changes status via the domain rules and logs a note', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const id = seedChild(db.store, { parentId: 9, gradeNextYear: 0, regStatus: RegStatus.WAIT, position: 1 });
    const admin = new AdminService(db, config);
    const r = await admin.changeStatus(id, RegStatus.PEND_OFFER); // grade 0 cap 160, room available
    expect(r.message).toMatch(/Offer Pending/);
    expect((await repos.children.findById(id))?.regStatus).toBe(RegStatus.PEND_OFFER);
    expect(await repos.notes.listByParent(9)).toHaveLength(1);
  });

  it('rejects an illegal status change', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const id = seedChild(db.store, { parentId: 9, gradeNextYear: 0, regStatus: RegStatus.INITIAL });
    const admin = new AdminService(db, config);
    await expect(admin.changeStatus(id, RegStatus.REGISTER)).rejects.toThrow();
  });
});

describe('admin IP allowlist (route gate)', () => {
  it('blocks disallowed IPs and lets allowed IPs reach the login', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const app = buildServer({ config: { ...config, adminIpAllowlist: ['203.0.113'] }, db });
    const blocked = await app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: '10.0.0.1', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(blocked.statusCode).toBe(403);
    const allowed = await app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: '203.0.113.9', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'x', password: 'y' }) });
    expect(allowed.statusCode).toBe(401); // reached auth (no such admin), not IP-blocked
    await app.close();
  });
});
