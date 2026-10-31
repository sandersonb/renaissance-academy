import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import { flowable } from '../src/domain/transitions.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase, MemoryStore, seedSurvey } from '../src/app/adapters/memory/index.js';
import type { ChildRecord } from '../src/app/ports/repositories.js';
import { AdminAuthService, AdminAuthError } from '../src/app/services/adminAuthService.js';
import { AdminService } from '../src/app/services/adminService.js';
import { buildServer } from '../src/app/http/server.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false, emailBatchSize: 20, emailSendSpacingMs: 0, emailDailyCap: 400,
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

  it('builds the grade x status summary with open slots and totals', async () => {
    const db = createMemoryDatabase();
    // Grade 0 (cap 160): 2 registered, 1 offer, 3 initial candidates.
    seedChild(db.store, { parentId: 1, gradeNextYear: 0, regStatus: RegStatus.REGISTER });
    seedChild(db.store, { parentId: 1, gradeNextYear: 0, regStatus: RegStatus.REGISTER });
    seedChild(db.store, { parentId: 2, gradeNextYear: 0, regStatus: RegStatus.OFFER });
    seedChild(db.store, { parentId: 3, gradeNextYear: 0, regStatus: RegStatus.INITIAL });
    seedChild(db.store, { parentId: 3, gradeNextYear: 0, regStatus: RegStatus.INITIAL });
    seedChild(db.store, { parentId: 4, gradeNextYear: 0, regStatus: RegStatus.INITIAL });
    const admin = new AdminService(db, config);
    const { grades, rows } = await admin.summary();

    expect(grades[0]).toBe('K');
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Max Slots']!.values[0]).toBe(160);
    expect(byLabel['Registered']!.values[0]).toBe(2);
    expect(byLabel['Offer Extended']!.values[0]).toBe(1);
    expect(byLabel['Awaiting Lottery']!.values[0]).toBe(3); // INITIAL, not seat-consuming
    // Open = 160 − (2 registered + 1 offer) = 157; candidates don't consume seats.
    expect(byLabel['Open Slots']!.values[0]).toBe(157);
    // Totals across all grades.
    expect(byLabel['Registered']!.total).toBe(2);
    expect(byLabel['Max Slots']!.total).toBe(160 + 120 + 120 + 120 + 110 + 100 + 100 + 80 + 30 + 50);
    // Wait-list rows are now shown (info kind) and drillable.
    expect(byLabel['Waitlisted']!.key).toBe(RegStatus.WAIT);
    expect(byLabel['Max Slots']!.key).toBeNull(); // capacity rows don't drill down
  });

  it('filters the drill-down list by grade and status with parent names', async () => {
    const db = createMemoryDatabase();
    await db.repos.parents.create({
      parentId: 1, firstName: 'John', lastName: 'Snow', relationship: 'Parent', address: '1 Wall',
      city: 'North', state: 'UT', zip: 84043, homePhone: '8015550000', otherPhone: null, returning: false,
      email: 'j@example.test', alternateEmail: null, guid: null,
      confirmToken: null, confirmExpires: null, resetToken: null, resetExpires: null,
    });
    seedChild(db.store, { parentId: 1, gradeNextYear: 3, regStatus: RegStatus.REGISTER, firstName: 'Arya', lastName: 'Snow' });
    seedChild(db.store, { parentId: 1, gradeNextYear: 3, regStatus: RegStatus.INITIAL, firstName: 'Bran', lastName: 'Snow' });
    seedChild(db.store, { parentId: 2, gradeNextYear: 4, regStatus: RegStatus.REGISTER, firstName: 'Jon', lastName: 'Targaryen' });
    const admin = new AdminService(db, config);

    const byStatus = await admin.list({ grade: null, status: RegStatus.REGISTER, name: null });
    expect(byStatus.count).toBe(2); // both registered, any grade
    const byGradeStatus = await admin.list({ grade: 3, status: RegStatus.REGISTER, name: null });
    expect(byGradeStatus.count).toBe(1);
    expect(byGradeStatus.results[0]!.parentName).toBe('John Snow');
    expect(byGradeStatus.results[0]!.firstName).toBe('Arya');
  });

  it('ranks the wait list in true offer order (siblings ahead of regular waits)', async () => {
    const db = createMemoryDatabase();
    // Grade 2: two sibling-waits (positions 1,2) and two regular waits (positions 1,2).
    seedChild(db.store, { parentId: 10, gradeNextYear: 2, regStatus: RegStatus.SIB_WAIT, position: 1, firstName: 'Sib1' });
    seedChild(db.store, { parentId: 11, gradeNextYear: 2, regStatus: RegStatus.SIB_WAIT, position: 2, firstName: 'Sib2' });
    seedChild(db.store, { parentId: 12, gradeNextYear: 2, regStatus: RegStatus.WAIT, position: 1, firstName: 'Reg1' });
    seedChild(db.store, { parentId: 13, gradeNextYear: 2, regStatus: RegStatus.WAIT, position: 2, firstName: 'Reg2' });
    const admin = new AdminService(db, config);

    // Regular-wait rank = position + number of sibling-waits ahead of them (2).
    const wait = await admin.list({ grade: 2, status: RegStatus.WAIT, name: null });
    expect(wait.results.map((r) => [r.firstName, r.waitlistRank])).toEqual([['Reg1', 3], ['Reg2', 4]]);

    // Sibling-wait keeps its raw position.
    const sib = await admin.list({ grade: 2, status: RegStatus.SIB_WAIT, name: null });
    expect(sib.results.map((r) => [r.firstName, r.waitlistRank])).toEqual([['Sib1', 1], ['Sib2', 2]]);

    // Whole-grade view orders everyone by combined rank (siblings first).
    const all = await admin.list({ grade: 2, status: null, name: null });
    expect(all.results.map((r) => r.firstName)).toEqual(['Sib1', 'Sib2', 'Reg1', 'Reg2']);
  });
});

describe('AdminService family CRUD', () => {
  const seedParent = async (db: ReturnType<typeof createMemoryDatabase>, parentId: number, over: Partial<Record<string, unknown>> = {}) => {
    await db.repos.parents.create({
      parentId, firstName: 'John', lastName: 'Snow', relationship: 'Parent', address: '1 Wall',
      city: 'North', state: 'UT', zip: 84043, homePhone: '8015550000', otherPhone: null, returning: false,
      email: 'j@example.test', alternateEmail: null, guid: null,
      confirmToken: null, confirmExpires: null, resetToken: null, resetExpires: null, ...over,
    } as never);
  };

  it('enriches the family view with answers, transitions, and waitlist rank', async () => {
    const db = createMemoryDatabase();
    await seedParent(db, 1);
    // A WAIT child in a grade that also has 2 sibling-waits → rank = position + 2.
    seedChild(db.store, { parentId: 1, gradeNextYear: 2, regStatus: RegStatus.WAIT, position: 1, firstName: 'Arya' });
    seedChild(db.store, { parentId: 99, gradeNextYear: 2, regStatus: RegStatus.SIB_WAIT, position: 1 });
    seedChild(db.store, { parentId: 98, gradeNextYear: 2, regStatus: RegStatus.SIB_WAIT, position: 2 });
    const admin = new AdminService(db, config);
    const fam = await admin.showFamily(1);
    expect(fam.children[0]!.waitlistRank).toBe(3);
    expect(fam.children[0]!.transitions).toEqual([...flowable(RegStatus.WAIT)]); // valid next statuses from WAIT
    expect(fam.children[0]!.statusLabel).toBe('Waitlisted');
  });

  it('updates parent fields and logs a note', async () => {
    const db = createMemoryDatabase();
    await seedParent(db, 5);
    const admin = new AdminService(db, config);
    await admin.updateParent(5, { email: 'new@example.test', zip: '90210', ignored: 'nope' });
    const p = await db.repos.parents.findById(5);
    expect(p?.email).toBe('new@example.test');
    expect(p?.zip).toBe(90210);
    expect((await db.repos.notes.listByParent(5)).length).toBe(1);
  });

  it('adds, edits, and deletes a child within a family', async () => {
    const db = createMemoryDatabase();
    await seedParent(db, 7);
    const admin = new AdminService(db, config);
    const childId = await admin.addChildToFamily(7, { firstName: 'Bran', lastName: 'Snow', gender: 'M', dob: '2018-05-01', gradeNextYear: '1' });
    let kids = await db.repos.children.findByParent(7);
    expect(kids).toHaveLength(1);
    expect(kids[0]!.regStatus).toBe(RegStatus.INITIAL);
    expect(kids[0]!.gradeNextYear).toBe(1);

    await admin.updateChild(childId, { firstName: 'Brandon', dob: '2018-06-02' });
    kids = await db.repos.children.findByParent(7);
    expect(kids[0]!.firstName).toBe('Brandon');
    expect(kids[0]!.dob).toBe('2018-06-02');

    await admin.deleteChild(childId);
    expect(await db.repos.children.findByParent(7)).toHaveLength(0);
  });

  it('addChildToFamily rejects a missing DOB / bad grade', async () => {
    const db = createMemoryDatabase();
    await seedParent(db, 8);
    const admin = new AdminService(db, config);
    await expect(admin.addChildToFamily(8, { firstName: 'A', lastName: 'B', gradeNextYear: '3' })).rejects.toThrow(/birth/i);
    await expect(admin.addChildToFamily(8, { firstName: 'A', lastName: 'B', dob: '2019-01-01', gradeNextYear: '12' })).rejects.toThrow(/Grade/);
  });

  it('force-sets a raw status bypassing the transition matrix, logged as a note', async () => {
    const db = createMemoryDatabase();
    await seedParent(db, 9);
    const id = seedChild(db.store, { parentId: 9, gradeNextYear: 0, regStatus: RegStatus.INITIAL });
    const admin = new AdminService(db, config);
    // INITIAL → REGISTER is NOT a valid transition; force allows it.
    await expect(admin.changeStatus(id, RegStatus.REGISTER)).rejects.toThrow();
    const r = await admin.forceStatus(id, RegStatus.REGISTER);
    expect(r.message).toMatch(/override/);
    expect((await db.repos.children.findById(id))?.regStatus).toBe(RegStatus.REGISTER);
    expect((await db.repos.notes.listByParent(9)).some((n) => /override/.test(n.note))).toBe(true);
  });
});

describe('AdminService survey report', () => {
  it('tallies answers and lists individual responses (child + parent)', async () => {
    const db = createMemoryDatabase();
    seedSurvey(db.store); // titles 6 (K Session: AM=1/PM=2), 11 (pushmarket, lottery)
    const c1 = seedChild(db.store, { parentId: 1, gradeNextYear: 0, regStatus: RegStatus.REGISTER, firstName: 'A' });
    const c2 = seedChild(db.store, { parentId: 2, gradeNextYear: 0, regStatus: RegStatus.REGISTER, firstName: 'B' });
    await db.repos.survey.addChildAnswer(c1, 1); // AM
    await db.repos.survey.addChildAnswer(c2, 1); // AM
    await db.repos.survey.addParentAnswer(1, 11, 'Small class sizes'); // parent lottery answer

    const admin = new AdminService(db, config);
    const rep = await admin.surveyReport();

    expect(rep.responses).toHaveLength(3);
    const am = rep.counts.find((c) => c.titleId === 6 && c.value === 'AM');
    expect(am?.count).toBe(2);
    // The parent lottery answer shows up as its own question + response with no grade.
    expect(rep.questions.some((q) => q.titleId === 11 && q.lotteryQuestion === 1)).toBe(true);
    expect(rep.responses.some((r) => r.value === 'Small class sizes' && r.grade === null)).toBe(true);
  });
});

describe('AdminService roster CRUD (Current_Student)', () => {
  it('creates, filters, edits, and deletes roster students', async () => {
    const db = createMemoryDatabase();
    const admin = new AdminService(db, config);

    const id = await admin.rosterCreate({ firstName: 'Ned', lastName: 'Stark', gender: 'M', dob: '2015-03-01', grade: '3' });
    await admin.rosterCreate({ firstName: 'Cat', lastName: 'Tully', gender: 'F', dob: '2016-04-02', grade: 'K' });

    const all = await admin.rosterList({ grade: null, name: null });
    expect(all).toHaveLength(2);
    expect(all[0]!.grade).toBe(0); // sorted by grade → K (Cat) first
    expect(all[0]!.regStatus).toBe(RegStatus.PEND_REENROLL); // default status

    const g3 = await admin.rosterList({ grade: 3, name: null });
    expect(g3.map((s) => s.firstName)).toEqual(['Ned']);
    const byName = await admin.rosterList({ grade: null, name: 'tully' });
    expect(byName.map((s) => s.firstName)).toEqual(['Cat']);

    await admin.rosterUpdate(id, { grade: '4', regStatus: RegStatus.ACPT_REENROLL });
    const ned = await db.repos.currentStudents.findById(id);
    expect(ned?.grade).toBe(4);
    expect(ned?.regStatus).toBe(RegStatus.ACPT_REENROLL);

    await admin.rosterDelete(id);
    expect(await admin.rosterList({ grade: null, name: null })).toHaveLength(1);
  });

  it('validates required fields and ignores unknown ones on create', async () => {
    const db = createMemoryDatabase();
    const admin = new AdminService(db, config);
    await expect(admin.rosterCreate({ firstName: 'A', lastName: 'B', grade: '2' })).rejects.toThrow(/birth/i);
    await expect(admin.rosterCreate({ firstName: 'A', lastName: 'B', dob: '2015-01-01' })).rejects.toThrow(/Grade/);
    const id = await admin.rosterCreate({ firstName: 'A', lastName: 'B', dob: '2015-01-01', grade: '2', hacker: 'x' });
    expect((await db.repos.currentStudents.findById(id))).toBeTruthy();
  });
});

describe('AdminService cycle settings', () => {
  it('reads and toggles gates, persisting to DB and the live config', async () => {
    const db = createMemoryDatabase();
    const cfg = { ...config }; // own copy so we can observe live mutation
    const admin = new AdminService(db, cfg);

    expect(await admin.getSettings()).toEqual({ yearBegin: 2026, lotteryOpen: true, postLottery: false });

    const updated = await admin.updateSettings({ postLottery: true });
    expect(updated).toEqual({ yearBegin: 2026, lotteryOpen: true, postLottery: true });
    expect(cfg.postLottery).toBe(true); // live config mutated in place
    expect((await db.repos.settings.get())?.postLottery).toBe(true); // persisted

    // Partial update leaves the other gate untouched.
    await admin.updateSettings({ lotteryOpen: false });
    expect(cfg.lotteryOpen).toBe(false);
    expect(cfg.postLottery).toBe(true);
  });
});

describe('AdminService caps / admins / audit views', () => {
  it('reads and updates the per-grade caps (with validation)', async () => {
    const db = createMemoryDatabase();
    const admin = new AdminService(db, config);
    const before = await admin.getCaps();
    expect(before).toHaveLength(10);

    const next = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(await admin.updateCaps(next)).toEqual(next);
    expect(await db.repos.capacity.gradeCaps()).toEqual(next);

    await expect(admin.updateCaps([1, 2, 3])).rejects.toThrow(/exactly 10/);
    await expect(admin.updateCaps([...Array(9).fill(1), -5])).rejects.toThrow(/Invalid cap/);
  });

  it('manages admin accounts with guards (no self / last-active deactivation)', async () => {
    const db = createMemoryDatabase();
    const admin = new AdminService(db, config);
    const aliceId = await admin.createAdminAccount('alice', 'longpassword');

    await expect(admin.createAdminAccount('alice', 'longpassword')).rejects.toThrow(/already exists/);
    await expect(admin.createAdminAccount('x', 'longpassword')).rejects.toThrow(/3\+/);
    await expect(admin.createAdminAccount('bob', 'short')).rejects.toThrow(/at least 8/);

    // Can't deactivate the only active admin, or yourself.
    await expect(admin.setAdminActive(aliceId, false)).rejects.toThrow(/last active/);
    const bobId = await admin.createAdminAccount('bob', 'longpassword');
    await expect(admin.setAdminActive(aliceId, false, aliceId)).rejects.toThrow(/your own/);

    await admin.setAdminActive(bobId, false); // now allowed (alice still active)
    const list = await admin.listAdmins();
    expect(list.find((a) => a.username === 'bob')?.active).toBe(false);
    expect((list[0] as Record<string, unknown>).pwHash).toBeUndefined(); // never leak hashes
  });

  it('returns lottery run history with per-run placement counts', async () => {
    const db = createMemoryDatabase();
    const runId = await db.repos.lotteryRuns.createRun({ seed: 'abc', year: 2026, caps: [160], committed: true });
    await db.repos.lotteryRuns.addAssignments(runId, [
      { childId: 1, fromStatus: 'INITIAL', toStatus: 'PEND_OFFER', position: null, phase: 'main', viaSibling: false },
      { childId: 2, fromStatus: 'INITIAL', toStatus: 'PEND_OFFER', position: null, phase: 'main', viaSibling: false },
      { childId: 3, fromStatus: 'INITIAL', toStatus: 'WAIT', position: 1, phase: 'main', viaSibling: false },
      { childId: 4, fromStatus: 'INITIAL', toStatus: 'SIB_WAIT', position: 1, phase: 'main', viaSibling: true },
    ]);
    const admin = new AdminService(db, config);
    const [run] = await admin.lotteryHistory();
    expect(run).toMatchObject({ id: runId, seed: 'abc', committed: true, offered: 2, waitlisted: 1, sibWait: 1 });
    expect(run!.ranAt).toBeTruthy();
  });

  it('returns the email log newest-first, filterable by state', async () => {
    const db = createMemoryDatabase();
    const id1 = await db.repos.outbox.enqueue('a@example.test', 'offer', {});
    await db.repos.outbox.enqueue('b@example.test', 'reminder', {});
    await db.repos.outbox.markSent(id1);
    const admin = new AdminService(db, config);

    const all = await admin.emailLog();
    expect(all).toHaveLength(2);
    expect(all[0]!.recipient).toBe('b@example.test'); // newest (higher id) first
    const sent = await admin.emailLog(50, 'sent');
    expect(sent.map((m) => m.recipient)).toEqual(['a@example.test']);
    expect(sent[0]!.sentAt).toBeTruthy();
  });
});

describe('admin IP allowlist (route gate)', () => {
  it('blocks disallowed IPs and lets allowed IPs reach the login', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const app = buildServer({ config: { ...config, adminIpAllowlist: ['203.0.113.0/24'] }, db });
    const blocked = await app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: '10.0.0.1', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(blocked.statusCode).toBe(403);
    const allowed = await app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: '203.0.113.9', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'x', password: 'y' }) });
    expect(allowed.statusCode).toBe(401); // reached auth (no such admin), not IP-blocked
    await app.close();
  });
});
