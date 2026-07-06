# Database — setup & migrations

The app runs against the **existing `enrollment` MySQL schema** (additive-only;
the legacy Perl app keeps working as a rollback target). Migrations only ADD
columns/tables — they never alter or drop anything Perl reads.

## Local setup against a sanitized copy

```bash
# 1. Create a local DB and load the schema (+ reference data).
#    Use the empty post-purge schema dump (no PII), or a sanitized data dump:
mysql -u root -p -e "CREATE DATABASE enrollment"
mysql -u root -p enrollment < ../old/lottery/backups/20250228184731_enrollment.sql
# (or a sanitized data fixture produced by new/sanitize_dump.py)

# 2. Point the app at it and apply additive migrations.
export DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=secret DB_NAME=enrollment
npm run db:migrate            # applies db/migrations/*.sql (idempotent-tolerant)

# 3. Run the API against MySQL (falls back to in-memory if DB_HOST is unset).
npm start
```

## Migrations

| File | Purpose |
|---|---|
| `migrations/001_additive.sql` | `users.pw_hash`/`pw_algo` (S3), `Parent.confirm_token`/`confirm_expires` (S6), `ExtraTitles.input_type`/`active`/`sort_order` (B8), `app_sessions` table (S4) |
| `migrations/002_survey_data.sql` | Backfill `input_type`/`sort_order` on existing questions and move the Type B option lists hardcoded in `confirm.pl` into `Extra` (B8) |

Notes:
- MySQL 5.7 has no `ADD COLUMN IF NOT EXISTS`; the runner tolerates re-runs by
  ignoring duplicate-column/table/key/entry errors.
- Credentials come from env only — never commit them (the legacy plaintext creds
  must be rotated; see the security backlog).
- The mysql2 adapter (`src/app/adapters/mysql`) is typechecked against the ports;
  full integration/parity testing against a restored DB is the M5 step.
