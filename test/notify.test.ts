import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { AppConfig } from '../src/app/config.js';
import { createMemoryDatabase, MemoryStore } from '../src/app/adapters/memory/index.js';
import type { ChildRecord, ParentRecord } from '../src/app/ports/repositories.js';
import type { EmailMessage, EmailProvider } from '../src/app/ports/email.js';
import { OutboxMailer } from '../src/app/services/outboxMailer.js';
import { EmailWorker } from '../src/app/services/emailWorker.js';
import { NotifyService } from '../src/app/services/notifyService.js';

const config: AppConfig = {
  yearBegin: 2026, lotteryOpen: true, postLottery: false,
  offerExpirationDays: 3, paperworkExpirationDays: 5, bcryptCost: 4, dualWriteLegacyCrypt: true,
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false,
};

class CapturingProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) { this.sent.push(m); }
}
class FailingProvider implements EmailProvider {
  async send() { throw new Error('smtp down'); }
}

let nid = 1;
function seedParent(store: MemoryStore, parentId: number, email: string) {
  const p: ParentRecord = {
    parentId, lastName: 'Fam', firstName: 'Pat', relationship: 'PARENT', address: '', city: '', state: 'UT',
    zip: 0, homePhone: '', otherPhone: null, returning: false, email, alternateEmail: null, guid: null,
    confirmToken: null, confirmExpires: null, resetToken: null, resetExpires: null,
  };
  store.parents.set(parentId, p);
}
function seedChild(store: MemoryStore, parentId: number, status: RegStatus) {
  const childId = 9000 + nid++;
  store.children.set(childId, {
    childId, parentId, lastName: 'Fam', firstName: 'Kid', middleName: null, gender: 'M', dob: '2020-01-01',
    gradeNextYear: 0, regStatus: status, languagePreference: null, lotteryConsiderations: 0, position: null,
    expiration: null, parentNotes: '',
  } as ChildRecord);
  return childId;
}

describe('OutboxMailer + EmailWorker', () => {
  it('enqueues auth emails to the outbox (does not send inline)', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    const mailer = new OutboxMailer(repos.outbox);
    await mailer.sendConfirmation('a@example.com', 'http://x/confirm?token=t');
    await mailer.sendPasswordReset('a@example.com', 'http://x/reset?token=r');
    expect(await repos.outbox.countByState()).toEqual({ pending: 2 });
  });

  it('worker drains pending and marks them sent', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    await repos.outbox.enqueue('a@example.com', 'confirmation', { link: 'http://x' });
    const provider = new CapturingProvider();
    const r = await new EmailWorker(repos.outbox, provider).drain();
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(provider.sent[0]!.subject).toMatch(/confirm/i);
    expect(await repos.outbox.countByState()).toEqual({ sent: 1 });
  });

  it('retries a failing send up to the max, then marks it failed', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    await repos.outbox.enqueue('a@example.com', 'reminder', { link: 'http://x' });
    const worker = new EmailWorker(repos.outbox, new FailingProvider());
    for (let i = 0; i < 6; i++) await worker.drain(); // MAX_ATTEMPTS = 5
    expect(await repos.outbox.countByState()).toEqual({ failed: 1 });
  });
});

describe('NotifyService', () => {
  it('materializeOffers: PEND_OFFER -> OFFER + expiration + one email per parent', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    seedParent(db.store, 1, 'p1@example.com');
    seedParent(db.store, 2, 'p2@example.com');
    seedChild(db.store, 1, RegStatus.PEND_OFFER);
    seedChild(db.store, 1, RegStatus.PEND_OFFER); // same parent -> 1 email
    seedChild(db.store, 2, RegStatus.PEND_OFFER);

    const r = await new NotifyService(db, config).materializeOffers();
    expect(r).toEqual({ offers: 3, emails: 2 });
    const offered = (await repos.children.byStatuses([RegStatus.OFFER]));
    expect(offered).toHaveLength(3);
    expect(offered[0]!.expiration).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await repos.outbox.countByState()).toEqual({ pending: 2 });
  });

  it('sendReminders: one reminder per parent with an open item', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    seedParent(db.store, 1, 'p1@example.com');
    seedChild(db.store, 1, RegStatus.OFFER);
    seedChild(db.store, 1, RegStatus.PEND_REGISTER); // same parent
    seedParent(db.store, 2, 'p2@example.com');
    seedChild(db.store, 2, RegStatus.INITIAL); // not an open item -> no email

    const r = await new NotifyService(db, config).sendReminders();
    expect(r).toEqual({ emails: 1 });
  });
});
