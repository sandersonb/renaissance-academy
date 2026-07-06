/**
 * OutboxMailer — implements the Mailer port by ENQUEUEING into the email outbox
 * instead of sending inline (deviation B4). The EmailWorker drains and delivers,
 * so a slow/failing provider never blocks or breaks the request that triggered
 * the email (register, password reset, …).
 */
import type { Mailer } from '../ports/mailer.js';
import type { OutboxRepo } from '../ports/repositories.js';

export class OutboxMailer implements Mailer {
  constructor(private outbox: OutboxRepo) {}
  async sendConfirmation(email: string, link: string): Promise<void> {
    await this.outbox.enqueue(email, 'confirmation', { link });
  }
  async sendPasswordReset(email: string, link: string): Promise<void> {
    await this.outbox.enqueue(email, 'password_reset', { link });
  }
}
