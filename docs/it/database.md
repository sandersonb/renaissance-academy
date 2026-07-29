# Database

The app runs on the **existing MySQL `enrollment` schema** from the legacy Perl
system, extended with **additive-only** migrations. Legacy tables and columns are
never renamed or dropped, so the Perl app keeps working against the same database
during cutover.

## Layout

- **`db/schema.sql`** — the base schema (no PII). Use it to create a fresh database.
- **`db/migrations/00N_*.sql`** — additive migrations, applied in filename order.

| Migration | Adds |
|---|---|
| `001_additive.sql` | `pw_hash` / confirm-token columns, data-driven survey columns, `app_sessions` |
| `002_survey_data.sql` | Survey seed data; widened `Extra.Value` |
| `003_password_reset.sql` | Password-reset token columns |
| `004_admin.sql` | `admin_users`, `admin_sessions` |
| `005_lottery_log.sql` | `lottery_run`, `lottery_assignment` (immutable draw log) |
| `006_settings.sql` | `app_settings` (cycle gates / year) |
| `007_email_outbox.sql` | `email_outbox` (transactional email queue) |
| `008_documents.sql` | `enrollment_document` (admin-uploaded registration PDFs) |

## Upgrading the database

```bash
npm run db:migrate
```

- Applies every file in `db/migrations/` in order.
- **Idempotent** — every statement is `CREATE TABLE IF NOT EXISTS` / additive, so
  re-running is safe and does nothing when there's nothing new.
- Run it on every deploy (see [deployment.md](deployment.md)). The API's startup
  guard checks for the required additive tables and exits with instructions if any
  are missing.

To apply migrations by hand instead:

```bash
for f in db/migrations/*.sql; do mysql enrollment < "$f"; done
```

## Backups

Take a backup **before** any migration and before the "Start a new lottery year"
operation (which purges the prior year's applicants).

```bash
# Full logical backup
mysqldump --single-transaction --routines enrollment > enrollment-$(date +%F).sql

# Restore
mysql enrollment < enrollment-YYYY-MM-DD.sql
```

The `enrollment_document` table stores uploaded registration PDFs as BLOBs, so a
normal `mysqldump` also backs up the paperwork. Nothing lives on the filesystem
except the optional bundled default packet (`assets/default-packet.pdf`).

## The annual cycle (operational note)

The **"Start a new lottery year"** action (admin **Settings** page) is destructive:
it purges the per-year tables (applicants, parents, notes, survey answers, draw
logs, queued email) and imports the new current-student roster. It does **not**
touch reference data (survey questions, `MaxEnrollment` caps) or uploaded
documents. **Always back up first** — the UI reminds you, but IT should verify a
recent dump exists before staff run it.

## Seeding sample data (non-production only)

```bash
# realistic pre-lottery data (applicants awaiting the draw; small grades oversubscribed)
npm run db:seed:pre

# realistic post-lottery data (offers, waitlists, paperwork, registered)
npm run db:seed:post
```

Both purge-and-reseed the per-year tables and print login details. **Never run
against production.**

## Connecting for ad-hoc inspection

phpMyAdmin is intentionally **removed**. Use the admin portal for day-to-day data
work (it covers students, families, roster, caps, admins, etc.). For genuine
break-glass DB access, connect with the MySQL client using the server's
credentials (kept out of the repo). Prefer read-only where possible.
