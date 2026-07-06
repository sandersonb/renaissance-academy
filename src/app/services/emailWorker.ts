/**
 * EmailWorker — drains the outbox and delivers via the configured provider.
 * Replaces the legacy notify cron's interleaved SMTP send + RAND()/LIMIT
 * throttle with a proper queue worker (retries, batch limit, observable state).
 */
import type { EmailProvider } from '../ports/email.js';
import type { OutboxRepo } from '../ports/repositories.js';
import { renderEmail } from './emailTemplates.js';

const MAX_ATTEMPTS = 5;

export class EmailWorker {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  constructor(private outbox: OutboxRepo, private provider: EmailProvider) {}

  /** Send up to `limit` pending messages. Returns counts. Re-entrancy guard
   *  prevents the background timer and a manual flush from double-sending. */
  async drain(limit = 50): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    try {
      return await this.drainOnce(limit);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(limit: number): Promise<{ sent: number; failed: number }> {
    const batch = await this.outbox.claimPending(limit);
    let sent = 0;
    let failed = 0;
    for (const msg of batch) {
      try {
        const { subject, body } = renderEmail(msg.template, msg.payload);
        await this.provider.send({ to: msg.recipient, subject, body });
        await this.outbox.markSent(msg.id);
        sent++;
      } catch (e) {
        await this.outbox.markFailed(msg.id, e instanceof Error ? e.message : String(e), MAX_ATTEMPTS);
        failed++;
      }
    }
    return { sent, failed };
  }

  /** Background loop. Returns a stop function. */
  start(intervalMs: number): () => void {
    if (intervalMs <= 0) return () => {};
    const tick = () => void this.drain().catch((e) => console.error('email worker:', e));
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }
}
