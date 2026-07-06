/**
 * NotifyService — replaces the two notify_email.pl crons (RULES_SPEC §7) with
 * admin-triggerable (or scheduler-triggerable) actions that ENQUEUE into the
 * outbox; the EmailWorker delivers. Transactional-outbox style (B4): the offer
 * state change and the email enqueue happen together; sending is decoupled.
 */
import { RegStatus } from '../../domain/regStatus.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../ports/database.js';
import type { Repositories } from '../ports/repositories.js';
import { addDays, today } from '../util/dates.js';

const REMINDER_STATUSES = [RegStatus.OFFER, RegStatus.PEND_OFFER, RegStatus.IP_OFFER, RegStatus.PEND_REGISTER];

export class NotifyService {
  private repos: Repositories;
  constructor(private db: Database, private config: AppConfig) {
    this.repos = db.repos;
  }

  private link() {
    return `${this.config.appBaseUrl}/login`;
  }

  /** notify_email.pl --make_offer: PEND_OFFER -> OFFER (+expiration) and email
   *  each affected parent that a position is available. */
  async materializeOffers(): Promise<{ offers: number; emails: number }> {
    const pending = await this.repos.children.byStatuses([RegStatus.PEND_OFFER]);
    const exp = addDays(today(), this.config.offerExpirationDays);
    // Status changes + email enqueues commit together (transactional outbox, B4).
    return this.db.transaction(async (tx) => {
      const parents = new Set<number>();
      for (const c of pending) {
        await tx.children.updateStatus(c.childId, RegStatus.OFFER);
        await tx.children.setExpiration(c.childId, exp);
        parents.add(c.parentId);
      }
      let emails = 0;
      for (const pid of parents) {
        const parent = await tx.parents.findById(pid);
        if (parent?.email) {
          await tx.outbox.enqueue(parent.email, 'offer', { firstName: parent.firstName, link: this.link() });
          emails++;
        }
      }
      return { offers: pending.length, emails };
    });
  }

  /** notify_email.pl (default mode): daily reminder to anyone with an open item. */
  async sendReminders(): Promise<{ emails: number }> {
    const kids = await this.repos.children.byStatuses(REMINDER_STATUSES);
    const parents = new Set(kids.map((k) => k.parentId));
    let emails = 0;
    for (const pid of parents) {
      const parent = await this.repos.parents.findById(pid);
      if (parent?.email) {
        await this.repos.outbox.enqueue(parent.email, 'reminder', { firstName: parent.firstName, link: this.link() });
        emails++;
      }
    }
    return { emails };
  }
}
