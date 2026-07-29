/**
 * EmailWorker — drains the outbox and delivers via the configured provider.
 * Replaces the legacy notify cron's interleaved SMTP send + RAND()/LIMIT throttle
 * with a proper queue worker. Because Gmail enforces strict daily + burst limits,
 * the worker paces itself:
 *   - at most `batchSize` messages per drain,
 *   - `spacingMs` between individual sends (avoid per-connection rate blocks),
 *   - never more than `dailyCap` sends in a rolling 24h.
 * A provider throttle (SMTP 4xx / rate-limit) is treated as "try again later":
 * the row is left pending (no attempt burned) and the batch backs off — so
 * throttled mail is delayed, never dropped.
 */
import type { EmailProvider } from '../ports/email.js';
import type { OutboxRepo } from '../ports/repositories.js';
import { renderEmail } from './emailTemplates.js';

const MAX_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface EmailThrottle {
  batchSize: number;
  spacingMs: number;
  dailyCap: number;
}
const DEFAULTS: EmailThrottle = { batchSize: 20, spacingMs: 1500, dailyCap: 400 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SMTP 4xx (incl. Gmail rate limits) + transient network errors are retryable. */
export function isTransient(e: unknown): boolean {
  const err = e as { responseCode?: number; code?: string | number; message?: string };
  if (typeof err?.responseCode === 'number') return err.responseCode >= 400 && err.responseCode < 500;
  const s = String(err?.code ?? err?.message ?? '');
  return /\b4\d\d\b|rate|limit|throttl|too many|try again|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ESOCKET|ECONNECTION/i.test(s);
}

export class EmailWorker {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private throttle: EmailThrottle;
  constructor(private outbox: OutboxRepo, private provider: EmailProvider, throttle: Partial<EmailThrottle> = {}) {
    this.throttle = { ...DEFAULTS, ...throttle };
  }

  /**
   * Send a bounded, paced batch (respecting the rolling-24h daily cap). Re-entrancy
   * guard prevents the background timer and a manual flush from double-sending.
   * `limitOverride` caps this run below the configured batch size (used by tests).
   */
  async drain(limitOverride?: number): Promise<{ sent: number; failed: number; deferred: number }> {
    if (this.draining) return { sent: 0, failed: 0, deferred: 0 };
    this.draining = true;
    try {
      return await this.drainOnce(limitOverride);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(limitOverride?: number): Promise<{ sent: number; failed: number; deferred: number }> {
    const sentToday = await this.outbox.countSentSince(new Date(Date.now() - DAY_MS));
    const budget = Math.max(0, this.throttle.dailyCap - sentToday);
    const limit = Math.min(limitOverride ?? this.throttle.batchSize, budget);
    if (limit <= 0) return { sent: 0, failed: 0, deferred: 0 };

    const batch = await this.outbox.claimPending(limit);
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < batch.length; i++) {
      const msg = batch[i]!;
      try {
        const { subject, body } = renderEmail(msg.template, msg.payload);
        await this.provider.send({ to: msg.recipient, subject, body });
        await this.outbox.markSent(msg.id);
        sent++;
      } catch (e) {
        if (isTransient(e)) {
          // Provider is throttling / temporarily down: leave the row pending (no
          // attempt burned) and stop — the rest go out on the next window.
          return { sent, failed, deferred: batch.length - i };
        }
        await this.outbox.markFailed(msg.id, e instanceof Error ? e.message : String(e), MAX_ATTEMPTS);
        failed++;
      }
      if (i < batch.length - 1 && this.throttle.spacingMs > 0) await sleep(this.throttle.spacingMs);
    }
    return { sent, failed, deferred: 0 };
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
