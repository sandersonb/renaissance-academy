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
  appBaseUrl: 'http://test', childEditableFields: [], adminIpAllowlist: [], trustProxy: false, emailBatchSize: 20, emailSendSpacingMs: 0, emailDailyCap: 400,
};

class CapturingProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) { this.sent.push(m); }
}
class FailingProvider implements EmailProvider {
  async send() { throw new Error('smtp down'); }
}
class ThrottledProvider implements EmailProvider {
  async send(): Promise<void> {
    const e = new Error('4.7.0 Try again later') as Error & { responseCode: number };
    e.responseCode = 421; // Gmail rate-limit style transient error
    throw e;
  }
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
    expect(r).toEqual({ sent: 1, failed: 0, deferred: 0 });
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

  it('never exceeds the rolling daily cap across drains', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    for (let i = 0; i < 5; i++) await repos.outbox.enqueue(`u${i}@x.com`, 'reminder', { link: 'x' });
    const worker = new EmailWorker(repos.outbox, new CapturingProvider(), { batchSize: 10, spacingMs: 0, dailyCap: 3 });
    expect((await worker.drain()).sent).toBe(3); // capped this run
    expect((await worker.drain()).sent).toBe(0); // cap already used in trailing 24h
    expect((await repos.outbox.countByState()).pending).toBe(2); // remainder still queued
  });

  it('defers on a provider throttle without burning attempts (retryable later)', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    await repos.outbox.enqueue('a@x.com', 'reminder', { link: 'x' });
    await repos.outbox.enqueue('b@x.com', 'reminder', { link: 'x' });
    const worker = new EmailWorker(repos.outbox, new ThrottledProvider(), { batchSize: 10, spacingMs: 0, dailyCap: 100 });
    const r = await worker.drain();
    expect(r).toEqual({ sent: 0, failed: 0, deferred: 2 }); // backed off, nothing dropped
    expect(await repos.outbox.countByState()).toEqual({ pending: 2 }); // still pending, attempts untouched
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
    expect(r).toEqual({ emails: 1, skipped: 0 });
  });

  it('sendReminders skips a parent who already has a pending reminder (no duplicates)', async () => {
    const db = createMemoryDatabase(); const repos = db.repos;
    seedParent(db.store, 1, 'p1@example.com');
    seedChild(db.store, 1, RegStatus.OFFER);
    const notify = new NotifyService(db, config);
    expect(await notify.sendReminders()).toEqual({ emails: 1, skipped: 0 });
    expect(await notify.sendReminders()).toEqual({ emails: 0, skipped: 1 }); // already queued
    expect((await repos.outbox.countByState()).pending).toBe(1); // not re-enqueued
  });
});
