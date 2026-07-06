import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase, MemoryStore } from '../src/app/adapters/memory/index.js';
import type { ChildRecord } from '../src/app/ports/repositories.js';
import { LotteryService } from '../src/app/services/lotteryService.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
};

let nid = 1;
function seed(store: MemoryStore, parentId: number, grade: number, status: RegStatus, considerations = 0): number {
  const childId = 8000 + nid++;
  store.children.set(childId, {
    childId, parentId, lastName: 'X', firstName: `C${childId}`, middleName: null, gender: 'M',
    dob: '2019-01-01', gradeNextYear: grade, regStatus: status, languagePreference: null,
    lotteryConsiderations: considerations, position: null, expiration: null, parentNotes: '',
  });
  return childId;
}

/** Build a small oversubscribed population: grade 0 cap small, many INITIAL. */
function population() {
  const db = createMemoryDatabase();
  for (let i = 0; i < 8; i++) seed(db.store, 100 + i, 0, RegStatus.INITIAL);
  seed(db.store, 200, 1, RegStatus.INITIAL); // grade 1 undersubscribed
  return db;
}
const CAPS = [3, 5, 0, 0, 0, 0, 0, 0, 0, 0];

describe('LotteryService', () => {
  it('preview does not modify any child and returns a seed + summary', async () => {
    const db = population(); const repos = db.repos;
    const svc = new LotteryService(db, config);
    const before = (await repos.children.all()).map((c) => c.regStatus);
    const summary = await svc.preview(CAPS);
    expect(summary.seed).toBeTruthy();
    expect(summary.totals.offered).toBeGreaterThan(0);
    expect((await repos.children.all()).map((c) => c.regStatus)).toEqual(before); // unchanged
    expect(db.store.lotteryRuns).toHaveLength(0); // no log written on preview
  });

  it('commit applies placements and records an immutable draw log', async () => {
    const db = population(); const repos = db.repos;
    const svc = new LotteryService(db, config);
    const res = await svc.commit(CAPS);
    // every INITIAL child is now placed (offered or waitlisted)
    const remainingInitial = (await repos.children.all()).filter((c) => c.regStatus === RegStatus.INITIAL);
    expect(remainingInitial).toHaveLength(0);
    // grade 0: exactly 3 offered (cap), rest waitlisted
    const g0offered = (await repos.children.all()).filter((c) => c.gradeNextYear === 0 && c.regStatus === RegStatus.PEND_OFFER);
    expect(g0offered).toHaveLength(3);
    // draw log recorded
    expect(db.store.lotteryRuns).toHaveLength(1);
    expect(db.store.lotteryRuns[0]!.id).toBe(res.runId);
    expect(db.store.lotteryAssignments.length).toBe(res.totals.offered + res.totals.waitlisted);
  });

  it('is reproducible: committing a previewed seed yields the previewed allocation', async () => {
    const db = population(); const repos = db.repos;
    const svc = new LotteryService(db, config);
    const preview = await svc.preview(CAPS);
    const committed = await svc.commit(CAPS, preview.seed);
    expect(committed.byGrade).toEqual(preview.byGrade);
    expect(committed.totals).toEqual(preview.totals);
  });
});
