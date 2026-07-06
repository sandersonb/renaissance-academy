import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryRepositories } from '../src/app/adapters/memory/index.js';
import { EnrollmentService, EnrollmentError } from '../src/app/services/enrollmentService.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
};

function svc() {
  const repos = createMemoryRepositories();
  return { repos, enrollment: new EnrollmentService(repos.children, repos.currentStudents, config) };
}

const newKid = {
  firstName: 'Sam', lastName: 'Rivera', gender: 'M',
  dobYear: 2020, dobMonth: 5, dobDay: 1, gradeNextYear: 3,
};

function seedCurrent(repos: ReturnType<typeof createMemoryRepositories>, over: Partial<{ grade: number; status: RegStatus; first: string; last: string; dob: string }>) {
  const id = 900 + repos.store.currentStudents.size;
  repos.store.currentStudents.set(id, {
    childId: id, firstName: over.first ?? 'Dana', lastName: over.last ?? 'Kim', middleName: null,
    gender: 'F', dob: over.dob ?? '2019-04-10', regStatus: over.status ?? RegStatus.PEND_REENROLL, grade: over.grade ?? 3,
  });
  return id;
}

describe('EnrollmentService.addChild', () => {
  it('adds a new student as INITIAL', async () => {
    const { enrollment } = svc();
    const r = await enrollment.addChild(1, newKid);
    expect(r.status).toBe(RegStatus.INITIAL);
  });

  it('rejects a child too young for Kindergarten', async () => {
    const { enrollment } = svc();
    await expect(enrollment.addChild(1, { ...newKid, dobYear: 2021, dobMonth: 10 }))
      .rejects.toThrow(/turn 5/);
  });

  it('rejects an invalid grade for a new student', async () => {
    const { enrollment } = svc();
    await expect(enrollment.addChild(1, { ...newKid, gradeNextYear: 10 })).rejects.toThrow(/Grade/);
  });

  it('blocks a duplicate child', async () => {
    const { enrollment } = svc();
    await enrollment.addChild(1, newKid);
    await expect(enrollment.addChild(1, newKid)).rejects.toThrow(/already in the lottery/);
  });

  it('re-enrolls a matching current student (ACPT_REENROLL, grade from roster)', async () => {
    const { repos, enrollment } = svc();
    const csId = seedCurrent(repos, { first: 'Dana', last: 'Kim', dob: '2019-04-10', grade: 4 });
    const r = await enrollment.addChild(7, {
      firstName: 'Dana', lastName: 'Kim', gender: 'F', dobYear: 2019, dobMonth: 4, dobDay: 10,
      gradeNextYear: 99, current: true, // input grade ignored; taken from roster
    });
    expect(r.status).toBe(RegStatus.ACPT_REENROLL);
    const child = await repos.children.findById(r.childId);
    expect(child?.gradeNextYear).toBe(4);
    expect(repos.store.currentStudents.get(csId)?.regStatus).toBe(RegStatus.ACPT_REENROLL);
  });

  it('routes returning grades 1 & 6 to IP_REENROLL (language preference)', async () => {
    const { repos, enrollment } = svc();
    seedCurrent(repos, { first: 'Lee', last: 'Park', dob: '2018-03-03', grade: 6 });
    const r = await enrollment.addChild(7, {
      firstName: 'Lee', lastName: 'Park', gender: 'M', dobYear: 2018, dobMonth: 3, dobDay: 3, current: true,
    });
    expect(r.status).toBe(RegStatus.IP_REENROLL);
    expect(r.needsLanguagePreference).toBe(true);
  });

  it('errors when no current-student match is found', async () => {
    const { enrollment } = svc();
    await expect(enrollment.addChild(7, { ...newKid, current: true })).rejects.toThrow(/Could not find/);
  });

  it('errors when the student was already re-enrolled', async () => {
    const { repos, enrollment } = svc();
    seedCurrent(repos, { first: 'Al', last: 'Roe', dob: '2017-02-02', grade: 5, status: RegStatus.ACPT_REENROLL });
    await expect(enrollment.addChild(7, {
      firstName: 'Al', lastName: 'Roe', gender: 'F', dobYear: 2017, dobMonth: 2, dobDay: 2, current: true,
    })).rejects.toThrow(/already been re-enrolled/);
  });

  it('B9: rejects a returning grade outside 1..9 (e.g. roster grade 0)', async () => {
    const { repos, enrollment } = svc();
    seedCurrent(repos, { first: 'Kit', last: 'Vo', dob: '2020-07-24', grade: 0, status: RegStatus.PEND_REENROLL });
    await expect(enrollment.addChild(7, {
      firstName: 'Kit', lastName: 'Vo', gender: 'F', dobYear: 2020, dobMonth: 7, dobDay: 24, current: true,
    })).rejects.toThrow(/out of range/);
  });
});

describe('EnrollmentService.editChild (field policy)', () => {
  it('changes nothing when no fields are editable (legacy parity)', async () => {
    const repos = createMemoryRepositories();
    const svc = new EnrollmentService(repos.children, repos.currentStudents, config); // childEditableFields []
    const id = await svc.addChild(1, newKid).then((r) => r.childId);
    const r = await svc.editChild(1, id, { firstName: 'Renamed' });
    expect(r.changed).toEqual([]);
    expect((await repos.children.findById(id))?.firstName).toBe('Sam');
  });

  it('edits only permitted fields on an INITIAL child', async () => {
    const repos = createMemoryRepositories();
    const cfg = { ...config, childEditableFields: ['firstName', 'gradeNextYear'] };
    const svc = new EnrollmentService(repos.children, repos.currentStudents, cfg);
    const id = await svc.addChild(1, newKid).then((r) => r.childId);
    const r = await svc.editChild(1, id, { firstName: 'Samuel', lastName: 'Nope', gradeNextYear: 4 });
    expect(r.changed.sort()).toEqual(['firstName', 'gradeNextYear']);
    const c = await repos.children.findById(id);
    expect(c?.firstName).toBe('Samuel');
    expect(c?.lastName).toBe('Rivera'); // lastName not in policy -> unchanged
    expect(c?.gradeNextYear).toBe(4);
  });
});
