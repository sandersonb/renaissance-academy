import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase } from '../src/app/adapters/memory/index.js';
import { DocumentService, DocumentError } from '../src/app/services/documentService.js';

const baseConfig: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: true,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
  emailBatchSize: 20, emailSendSpacingMs: 0, emailDailyCap: 400,
};

let cid = 1;
function addChild(db: ReturnType<typeof createMemoryDatabase>, parentId: number, grade: number, status: RegStatus) {
  const childId = 5000 + cid++;
  db.store.children.set(childId, {
    childId, parentId, lastName: 'Fam', firstName: 'Kid', middleName: null, gender: 'M', dob: '2019-01-01',
    gradeNextYear: grade, regStatus: status, languagePreference: null, lotteryConsiderations: 0,
    position: null, expiration: null, parentNotes: '',
  });
}
const PDF = Buffer.from('%PDF-1.4\n...pretend pdf...');

describe('DocumentService entitlement (mirrors enroll.pl)', () => {
  it('new admitted family gets the family packet + its grade packets', async () => {
    const db = createMemoryDatabase();
    addChild(db, 1, 3, RegStatus.PEND_REGISTER);
    addChild(db, 1, 0, RegStatus.PEND_REGISTER); // Kindergarten
    const svc = new DocumentService(db.repos, baseConfig);
    expect([...(await svc.entitledSlugs(1))].sort()).toEqual(['family', 'grade_0', 'grade_3']);
  });

  it('returning family gets the returning packet (not the regular family packet)', async () => {
    const db = createMemoryDatabase();
    addChild(db, 2, 4, RegStatus.ACPT_REENROLL);
    addChild(db, 2, 4, RegStatus.PEND_REGISTER); // a second, newly-admitted child
    const svc = new DocumentService(db.repos, baseConfig);
    expect([...(await svc.entitledSlugs(2))].sort()).toEqual(['grade_4', 'returning_family']);
  });

  it('returning packet requires post-lottery', async () => {
    const db = createMemoryDatabase();
    addChild(db, 3, 2, RegStatus.ACPT_REENROLL);
    const pre = new DocumentService(db.repos, { ...baseConfig, postLottery: false });
    expect([...(await pre.entitledSlugs(3))]).toEqual([]);
    const post = new DocumentService(db.repos, baseConfig);
    expect([...(await post.entitledSlugs(3))]).toEqual(['returning_family']);
  });

  it('a family with no admitted/returning students gets nothing', async () => {
    const db = createMemoryDatabase();
    addChild(db, 4, 1, RegStatus.INITIAL);
    addChild(db, 4, 5, RegStatus.WAIT);
    const svc = new DocumentService(db.repos, baseConfig);
    expect([...(await svc.entitledSlugs(4))]).toEqual([]);
  });
});

describe('DocumentService upload + access control', () => {
  it('validates the slug and that the file is a PDF', async () => {
    const db = createMemoryDatabase();
    const svc = new DocumentService(db.repos, baseConfig);
    await expect(svc.upload('nope', 'x.pdf', PDF, 1)).rejects.toBeInstanceOf(DocumentError);
    await expect(svc.upload('family', 'x.pdf', Buffer.from('not a pdf'), 1)).rejects.toThrow(/PDF/);
    await svc.upload('family', 'Family Packet 2026.pdf', PDF, 7);
    const list = await svc.adminList();
    const fam = list.find((d) => d.slug === 'family')!;
    expect(fam.available).toBe(true);
    expect(fam.filename).toBe('Family Packet 2026.pdf');
    expect(fam.size).toBe(PDF.length);
  });

  it('serves a file to an entitled parent but denies a non-entitled one', async () => {
    const db = createMemoryDatabase();
    const svc = new DocumentService(db.repos, baseConfig);
    await svc.upload('grade_3', 'g3.pdf', PDF, 1);
    addChild(db, 10, 3, RegStatus.PEND_REGISTER); // parent 10 admitted in grade 3
    addChild(db, 11, 3, RegStatus.WAIT);          // parent 11 only waitlisted

    const ok = await svc.parentFile(10, 'grade_3');
    expect(ok?.bytes.equals(PDF)).toBe(true);
    expect(await svc.parentFile(10, 'grade_4')).toBeNull(); // entitled parent, wrong packet
    expect(await svc.parentFile(11, 'grade_3')).toBeNull(); // not entitled at all

    // Entitled to the family packet too (not yet uploaded → available:false) and grade 3 (uploaded).
    const listed = await svc.parentDocuments(10);
    expect(listed).toEqual([
      { slug: 'family', label: 'Family Packet (new families)', available: false },
      { slug: 'grade_3', label: '3rd Grade Packet', available: true },
    ]);
  });
});

describe('DocumentService bundled default fallback', () => {
  const DEFAULT = Buffer.from('%PDF-1.4 bundled sample packet');

  it('serves the default when a slot has no upload, but only to entitled parents', async () => {
    const db = createMemoryDatabase();
    addChild(db, 20, 5, RegStatus.PEND_REGISTER); // entitled to family + grade_5
    const svc = new DocumentService(db.repos, baseConfig, DEFAULT);

    // Entitled + not uploaded → the default sample.
    expect((await svc.parentFile(20, 'grade_5'))?.bytes.equals(DEFAULT)).toBe(true);
    // A real upload always wins over the default.
    const REAL = Buffer.from('%PDF-1.4 real grade 5 packet');
    await svc.upload('grade_5', 'g5.pdf', REAL, 1);
    expect((await svc.parentFile(20, 'grade_5'))?.bytes.equals(REAL)).toBe(true);
    // Non-entitled is still denied even though a default exists.
    expect(await svc.parentFile(20, 'grade_6')).toBeNull();

    // Admin list distinguishes a real upload from the default-in-use.
    const list = await svc.adminList();
    expect(list.find((d) => d.slug === 'grade_5')).toMatchObject({ available: true, usingDefault: false });
    expect(list.find((d) => d.slug === 'family')).toMatchObject({ available: false, usingDefault: true });
    // Parent list shows entitled docs as downloadable thanks to the default.
    expect((await svc.parentDocuments(20)).find((d) => d.slug === 'family')?.available).toBe(true);
  });
});
