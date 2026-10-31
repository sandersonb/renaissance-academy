/**
 * Dev/prod entrypoint. Uses the mysql2 adapter against the existing schema when
 * DB_HOST is set; otherwise falls back to in-memory repositories (seeded) for
 * local UI work without a database.
 */
import { loadConfig } from '../config.js';
import { createMemoryDatabase, seedSurvey } from '../adapters/memory/index.js';
import { createMysqlDatabase, createPool } from '../adapters/mysql/index.js';
import { databaseConnectionOptions } from '../adapters/mysql/connectionOptions.js';
import type { Database } from '../ports/database.js';
import { AdminAuthService } from '../services/adminAuthService.js';
import { OutboxMailer } from '../services/outboxMailer.js';
import { EmailWorker } from '../services/emailWorker.js';
import { NotifyService } from '../services/notifyService.js';
import { emailProviderFromEnv } from '../adapters/email/providers.js';
import { buildServer } from './server.js';
import { join } from 'node:path';
import { loadMigrations, MigrationSafetyError, readCycle, requireCurrentMigrations, type Cycle } from '../adapters/mysql/migrations/engine.js';

const config = loadConfig();

const REQUIRED_ADDITIVE_TABLES = [
  'app_sessions', 'admin_users', 'admin_sessions', 'lottery_run',
  'lottery_assignment', 'app_settings', 'email_outbox', 'enrollment_document',
];

let db: Database;
let productionCycle: Cycle | null = null;
if (process.env.NODE_ENV === 'production' && !process.env.DB_HOST) {
  throw new MigrationSafetyError('Production requires an explicit persistent database; in-memory fallback is disabled.');
}
if (process.env.DB_HOST) {
  const databaseOptions = databaseConnectionOptions(process.env);
  const dbName = databaseOptions.database;
  const pool = createPool(databaseOptions);
  db = createMysqlDatabase(pool);
  console.log(`using MySQL at ${databaseOptions.host}/${dbName}; transport=${databaseOptions.ssl ? 'verified TLS' : 'explicit local plaintext'}`);

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
        `    Inspect: npm run db:migrate (read-only). Writes require -- --apply.\n`,
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    await requireCurrentMigrations(pool, loadMigrations(join(process.cwd(), 'db', 'migrations')));
    productionCycle = await readCycle(pool);
    if (!productionCycle) throw new MigrationSafetyError('Production cycle is uninitialized. Inspect db:init-settings, then explicitly initialize reviewed values with --apply.');
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
const settings = productionCycle ?? await repos.settings.get();
if (settings) {
  config.yearBegin = settings.yearBegin;
  config.lotteryOpen = settings.lotteryOpen;
  config.postLottery = settings.postLottery;
  console.log(`settings: year ${config.yearBegin}, lottery_open=${config.lotteryOpen}, post_lottery=${config.postLottery}`);
}

// Email: enqueue via the outbox; a background worker drains it via the provider.
const emailProvider = emailProviderFromEnv();
const app = buildServer({ config, db, mailer: new OutboxMailer(repos.outbox), emailProvider });

// Validate provider and HTTP boundary before any optional bootstrap write/timers.
const adminAuth = new AdminAuthService(repos.admins, repos.adminSessions, config);
await adminAuth
  .bootstrapIfEmpty(process.env.ADMIN_BOOTSTRAP_USER, process.env.ADMIN_BOOTSTRAP_PASSWORD)
  .then((created) => created && console.log('Initial admin bootstrap completed.'))
  .catch(() => console.error('Admin bootstrap failed; inspect protected diagnostics.'));

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
      .catch(() => console.error('Reminder scheduler failed; inspect protected diagnostics.'));
  }, reminderMs);
  t.unref?.();
  stopReminders = () => clearInterval(t);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopReminders(); stopWorker(); process.exit(0); });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
app
  .listen({ port, host })
  .then((addr) => console.log(`enrollment API listening on ${addr}`))
  .catch(() => {
    console.error('API listener failed; inspect host configuration.');
    process.exit(1);
  });
