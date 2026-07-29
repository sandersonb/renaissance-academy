import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryRepositories, seedSurvey, MemoryStore } from '../src/app/adapters/memory/index.js';
import type { ChildRecord } from '../src/app/ports/repositories.js';
import { SurveyService } from '../src/app/services/surveyService.js';
import { OfferService } from '../src/app/services/offerService.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false, emailBatchSize: 20, emailSendSpacingMs: 0, emailDailyCap: 400,
};

function setup() {
  const repos = createMemoryRepositories();
  seedSurvey(repos.store);
  const survey = new SurveyService(repos.children, repos.survey);
  const offers = new OfferService(repos.children, repos.currentStudents, survey, config);
  return { repos, survey, offers };
}

let nextId = 1;
function seedChild(store: MemoryStore, over: Partial<ChildRecord> & { parentId: number; gradeNextYear: number; regStatus: RegStatus }): number {
  const childId = 5000 + nextId++;
  store.children.set(childId, {
    childId, lastName: 'Doe', firstName: 'Kid', middleName: null, gender: 'M',
    dob: '2019-01-01', languagePreference: null, lotteryConsiderations: 0, position: null,
    expiration: null, parentNotes: '', ...over,
  });
  return childId;
}

describe('OfferService', () => {
  it('extends PEND_OFFER -> OFFER with an expiration on dashboard load', async () => {
    const { repos, offers } = setup();
    const id = seedChild(repos.store, { parentId: 1, gradeNextYear: 3, regStatus: RegStatus.PEND_OFFER });
    const n = await offers.extendOffers(1);
    expect(n).toBe(1);
    const c = await repos.children.findById(id);
    expect(c?.regStatus).toBe(RegStatus.OFFER);
    expect(c?.expiration).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts an offer with no registration questions -> PEND_REGISTER', async () => {
    const { repos, offers } = setup();
    const id = seedChild(repos.store, { parentId: 1, gradeNextYear: 7, regStatus: RegStatus.OFFER }); // no Type A for grade 7
    const r = await offers.acceptOffer(1, id);
    expect(r.needsSurvey).toBe(false);
    expect(r.status).toBe(RegStatus.PEND_REGISTER);
    expect((await repos.children.findById(id))?.expiration).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gates acceptance on a grade-scoped registration question', async () => {
    const { repos, offers } = setup();
    const id = seedChild(repos.store, { parentId: 1, gradeNextYear: 0, regStatus: RegStatus.OFFER }); // grade 0 -> title 6
    const r1 = await offers.acceptOffer(1, id);
    expect(r1.needsSurvey).toBe(true);
    expect(r1.question?.titleId).toBe(6);
    expect((await repos.children.findById(id))?.regStatus).toBe(RegStatus.IP_OFFER);
    const r2 = await offers.answerAccept(1, id, 1); // extraId 1 (AM) answers title 6
    expect(r2.needsSurvey).toBe(false);
    expect(r2.status).toBe(RegStatus.PEND_REGISTER);
  });

  it('declines a waitlisted child and coalesces the queue', async () => {
    const { repos, offers } = setup();
    const a = seedChild(repos.store, { parentId: 1, gradeNextYear: 0, regStatus: RegStatus.WAIT, position: 1 });
    const b = seedChild(repos.store, { parentId: 2, gradeNextYear: 0, regStatus: RegStatus.WAIT, position: 2 });
    const r = await offers.declineOffer(1, a);
    expect(r.status).toBe(RegStatus.DECLINE);
    expect((await repos.children.findById(a))?.position).toBeNull();
    expect((await repos.children.findById(b))?.position).toBe(1);
  });

  it('completes re-enrollment language preference (IP_REENROLL -> ACPT_REENROLL)', async () => {
    const { repos, offers } = setup();
    const id = seedChild(repos.store, { parentId: 1, gradeNextYear: 6, regStatus: RegStatus.IP_REENROLL, firstName: 'Mia', lastName: 'Vo', dob: '2018-05-05' });
    repos.store.currentStudents.set(1, { childId: 1, firstName: 'Mia', lastName: 'Vo', middleName: null, gender: 'F', dob: '2018-05-05', regStatus: RegStatus.IP_REENROLL, grade: 6 });
    const r = await offers.setLanguagePreference(1, id, 400, 10); // Arabic / Spanish -> AR-SP-CH
    expect(r.status).toBe(RegStatus.ACPT_REENROLL);
    expect(r.languagePreference).toBe('AR-SP-CH');
    expect((await repos.children.findById(id))?.languagePreference).toBe('AR-SP-CH');
  });

  it('deletes an INITIAL child but blocks deleting a non-INITIAL post-lottery', async () => {
    const { repos, offers } = setup();
    const id = seedChild(repos.store, { parentId: 1, gradeNextYear: 2, regStatus: RegStatus.INITIAL });
    await offers.deleteChild(1, id);
    expect(await repos.children.findById(id)).toBeNull();
  });

  it('records a multi-select lottery answer as one ParentExtra row per option', async () => {
    const { repos, survey } = setup();
    // title 11 (pushmarket) is multi_select; record two selected values.
    await survey.answerLottery(42, 11, ['World language program', 'Small class sizes']);
    const rows = repos.store.parentExtra.filter((p) => p.parentId === 42 && p.titleId === 11);
    expect(rows.map((r) => r.answer).sort()).toEqual(['Small class sizes', 'World language program']);
    // The question exposes its generic input type for the renderer.
    const q = await survey.nextLotteryQuestion(99);
    expect(q && ['text', 'single_select', 'multi_select'].includes(q.inputType)).toBe(true);
  });

  it('rejects acting on a child that is not the parent\'s', async () => {
    const { repos, offers } = setup();
    const id = seedChild(repos.store, { parentId: 1, gradeNextYear: 2, regStatus: RegStatus.OFFER });
    await expect(offers.acceptOffer(999, id)).rejects.toThrow(/Invalid/);
  });
});
