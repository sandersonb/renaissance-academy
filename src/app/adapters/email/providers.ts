/**
 * Email providers. Console (dev/default) logs; SMTP uses nodemailer (config from
 * env). Selected by EMAIL_PROVIDER; the worker depends only on the EmailProvider
 * port so swapping in SES/SendGrid later is a one-file change.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider } from '../../ports/email.js';

export class ConsoleEmailProvider implements EmailProvider {
  async send(m: EmailMessage): Promise<void> {
    // Log the full message (incl. any confirmation/reset link) so dev doesn't
    // need a real inbox. Never use this provider in production.
    console.log(`\n[email:console] to=${m.to}\n  subject: ${m.subject}\n  ${m.body.replace(/\n/g, '\n  ')}\n`);
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private tx: Transporter;
  constructor(private from: string, opts: { host: string; port: number; user?: string; pass?: string }) {
    this.tx = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.port === 465,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    });
  }
  async send(m: EmailMessage): Promise<void> {
    await this.tx.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.body });
  }
}

/** Build the provider from env (defaults to console). */
export function emailProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const kind = env.EMAIL_PROVIDER ?? 'console';
  if (!['smtp', 'console'].includes(kind) || (env.NODE_ENV === 'production' && kind !== 'smtp')) {
    throw new Error('EMAIL_PROVIDER must be explicitly smtp in production mode; unknown/console fallback is forbidden.');
  }
  if (kind === 'console') return new ConsoleEmailProvider();
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      (env.NODE_ENV === 'production' && (!env.SMTP_HOST || !env.EMAIL_FROM || !env.SMTP_USER || !env.SMTP_PASS))) {
    throw new Error('SMTP connection fields must be explicitly configured and valid; credentials remain on the host.');
  }
  return new SmtpEmailProvider(env.EMAIL_FROM ?? 'enrollment@example.org', {
    host: env.SMTP_HOST ?? 'localhost',
    port,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  });
}
