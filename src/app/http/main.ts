/**
 * Dev/prod entrypoint. Uses the mysql2 adapter against the existing schema when
 * DB_HOST is set; otherwise falls back to in-memory repositories (seeded) for
 * local UI work without a database.
 */
import { loadConfig } from '../config.js';
import { createMemoryDatabase, seedSurvey } from '../adapters/memory/index.js';
import { createMysqlDatabase, createPool } from '../adapters/mysql/index.js';
import type { Database } from '../ports/database.js';
import { AdminAuthService } from '../services/adminAuthService.js';
import { OutboxMailer } from '../services/outboxMailer.js';
import { EmailWorker } from '../services/emailWorker.js';
import { NotifyService } from '../services/notifyService.js';
import { emailProviderFromEnv } from '../adapters/email/providers.js';
import { buildServer } from './server.js';

const config = loadConfig();

const REQUIRED_ADDITIVE_TABLES = [
  'app_sessions', 'admin_users', 'admin_sessions', 'lottery_run',
  'lottery_assignment', 'app_settings', 'email_outbox', 'enrollment_document',
];

let db: Database;
if (process.env.DB_HOST) {
  const dbName = process.env.DB_NAME ?? 'enrollment';
  const pool = createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: dbName,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  });
  db = createMysqlDatabase(pool);
  console.log(`using MySQL at ${process.env.DB_HOST}/${dbName}`);

  // Fail fast if the additive migrations haven't been applied — otherwise the
  // failure surfaces later at a parent's registration + a worker crash-loop.
  const [rows] = await pool.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [dbName],
  );
  const present = new Set((rows as { t: string }[]).map((r) => r.t));
  const missing = REQUIRED_ADDITIVE_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    console.error(
      `\n⚠️  Missing tables: ${missing.join(', ')}.\n` +
        `    Additive migrations are not applied. Run:  npm run db:migrate\n`,
    );
    process.exit(1);
  }
} else {
  const mem = createMemoryDatabase();
  seedSurvey(mem.store);
  db = mem;
  console.log('using in-memory repositories (set DB_HOST to use MySQL)');
}
const repos = db.repos;

// B6: app_settings (year / gates) is the source of truth, overriding env at
// startup. Roll-New-Year writes this table; changes take effect on restart.
const settings = await repos.settings.get().catch(() => null);
if (settings) {
  config.yearBegin = settings.yearBegin;
  config.lotteryOpen = settings.lotteryOpen;
  config.postLottery = settings.postLottery;
  console.log(`settings: year ${config.yearBegin}, lottery_open=${config.lotteryOpen}, post_lottery=${config.postLottery}`);
}

// First-boot convenience: create the initial admin from env if none exist.
const adminAuth = new AdminAuthService(repos.admins, repos.adminSessions, config);
await adminAuth
  .bootstrapIfEmpty(process.env.ADMIN_BOOTSTRAP_USER, process.env.ADMIN_BOOTSTRAP_PASSWORD)
  .then((created) => created && console.log(`bootstrapped initial admin '${process.env.ADMIN_BOOTSTRAP_USER}'`))
  .catch((e) => console.error('admin bootstrap failed:', e));

// Email: enqueue via the outbox; a background worker drains it via the provider.
const emailProvider = emailProviderFromEnv();
const app = buildServer({ config, db, mailer: new OutboxMailer(repos.outbox), emailProvider });

const worker = new EmailWorker(repos.outbox, emailProvider, {
  batchSize: config.emailBatchSize, spacingMs: config.emailSendSpacingMs, dailyCap: config.emailDailyCap,
});
const stopWorker = worker.start(Number(process.env.EMAIL_WORKER_INTERVAL_MS ?? 60000));

// Daily reminder re-enqueue (replaces the notify cron's "resend daily until
// resolved"). Deduped against pending reminders; the worker paces delivery.
// Set REMINDER_INTERVAL_MS=0 to disable.
const reminderMs = Number(process.env.REMINDER_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
let stopReminders = () => {};
if (reminderMs > 0) {
  const notify = new NotifyService(db, config);
  const t = setInterval(() => {
    notify.sendReminders()
      .then((r) => r.emails && console.log(`reminders: queued ${r.emails}, skipped ${r.skipped} already-pending`))
      .catch((e) => console.error('reminder scheduler:', e));
  }, reminderMs);
  t.unref?.();
  stopReminders = () => clearInterval(t);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopReminders(); stopWorker(); process.exit(0); });

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`enrollment API listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
