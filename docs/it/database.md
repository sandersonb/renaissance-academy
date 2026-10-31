# Database

The app runs on the **existing MySQL `enrollment` schema** from the legacy Perl
system, extended with **additive-only** migrations. Legacy tables and columns are
never renamed or dropped, so the Perl app keeps working against the same database
during cutover.

All new clients require verified TLS by default. See [database TLS](database-tls.md)
for the public RDS CA, shared API/CLI settings, read-only session diagnostic and
rotation procedure. Server transport can remain optional for AL1 without weakening
new-client certificate/hostname verification; changing users/global enforcement
is a separate approval.

## Layout

- **`db/schema.sql`** — the base schema (no PII). Use it to create a fresh database.
- **`db/migrations/00N_*.sql`** — additive migrations, applied in filename order.

The base tables, including `Child`, use **InnoDB**. Production `Child` has
already been converted; the committed base schema reflects that engine for new
installations and tests. Verify the actual table engines before cutover rather
than running a conversion against an already-updated production database.

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

The empty isolated preview needs a base before additive migrations. See the
[preview bootstrap guide](../../db/PREVIEW_BOOTSTRAP.md); `db:init-preview` inspects
by default and requires separate explicit apply. It creates no families or cycle,
keeps 001–008 byte-identical and finalizes fresh preview text to utf8mb4_unicode_ci.
It is not a production charset-conversion or schema-reset tool.

```bash
npm run db:migrate
npm run db:migrate -- --apply   # Only after target/backup review
```

- Bare command is **read-only**. Explicit `--apply` executes only pending files
  under a per-schema lock, recording checksums and durable running/applied/failed
  states. Repeat applies skip completed migrations, not SQL errors.
- Changed/missing files, unknown untracked schema and partial failures block.
  No whole-file DDL rollback is promised. See [recovery and full CLI guide](../../db/README.md).
- Initial year/open/post settings are a separate insert-only initialization;
  production refuses to start without them. Migration 006 does not open enrollment.

Do not loop over SQL files by hand: that bypasses history, companion catalog
validation/backfill, serialization and recovery controls.

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
For RDS, use the actual RDS hostname and approved public CA. The host-installed
MariaDB CLI needs `--ssl --ssl-verify-server-cert --ssl-ca=...`; Oracle MySQL uses
`--ssl-mode=VERIFY_IDENTITY --ssl-ca=...` instead. Neither consumes the Node
application's `DB_TLS_*` variables. See the
[administrator CLI example](../../infrastructure/HOST_SETUP.md#administrator-database-cli)
for password prompting and disabled local history. Do not put passwords in arguments.
