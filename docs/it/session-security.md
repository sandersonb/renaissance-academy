# Modern session revocation

This change hardens **session lifecycle only**. Cookie/origin/rate-limit/IP/proxy
controls are implemented in the separate [HTTP slice](http-security.md). Mail
isolation, queue claiming, dangerous-action safety, dependencies and actual preview
routing remain gates. Do not start the API based on these local changes alone.

## Behavior

- Modern parent/admin sessions carry the principal's `session_version`. Issuance
  atomically checks the verified credential snapshot's version and current
  confirmed/active state. Lookup checks current principal state and version.
- Admin activation changes advance the version. Deactivation also deletes all
  target sessions in the same transaction. Reactivation never restores old tokens;
  activation already in the desired state is idempotent. Last-active protection and
  self-deactivation checks run against ordered, locked admin rows.
- Password reset conditionally consumes a still-valid token, replaces credentials,
  advances the version and deletes parent sessions in one transaction. Failure
  rolls all of these back. Hashing happens before locking, and token validity is
  checked again when consumed. Reusing a token or racing another reset cannot
  change the password twice.
- A late login cannot issue a valid session from credentials verified before a
  reset/state change. Legacy crypt verification and bcrypt upgrade remain supported;
  compare-and-set prevents an old upgrade from overwriting a concurrent reset.
- Revocation affects subsequent authorization checks; it cannot cancel every
  operation already authorized/in flight. Privileged manual SQL bypassing the
  lifecycle methods is not covered. Never manually reset session versions.

## Forward migration 009

`009_session_revocation.sql` adds version columns and clears **modern**
`app_sessions` / `admin_sessions` once so users must log in again. It does not
delete accounts, families, legacy `user_cookies`, cycle settings, outbox or documents.
Previous migration/checksum bytes remain unchanged. Counter exhaustion fails
mutation instead of wrapping and requires operator review.
Authentication tables (`users`, `Parent`, `admin_users`, `app_sessions`,
`admin_sessions`) must already use InnoDB. Migration/readiness preflight refuses
other engines; any engine conversion is a separately reviewed operator action.

The API must remain stopped while the updated code/catalog is deployed and 009
is inspected/applied through the migration workflow. New code requires a clean,
current catalog; an older artifact missing recorded 009 is not a valid rollback.
DDL may partially commit on failure: existing durable failure/manual-recovery
rules apply, not blind whole-file replay. No live SQL or activation is authorized
by local implementation/test success.

## An already initialized preview upgrades normally

Use `db:migrate`, **not** `db:init-preview`, to add forward migrations to the existing
`enrollment_preview`. Its historical bootstrap checksum represents the catalog at
initialization and must not be edited/recreated when 009 is added. The initializer
is for a fresh empty database only; its current-plan inspection may report different
inputs after catalog evolution. Ordinary migration inspection still uses the
original bootstrap completion marker and the per-file migration history.

From `/opt/renaissance-academy/current`, after an approved stopped-host source deployment:

```bash
sudo env -i PATH=/usr/bin:/bin /usr/bin/node-22 --env-file=/root/enrollment-migration.env /opt/renaissance-academy/current/dist/app/adapters/mysql/migrate.js
```

Review exact preview target, 001–008 applied state, 009 pending and no blockers.
Only after separate approval, repeat with `--apply`. The existing migration account
has the scoped privileges needed; do not add runtime DDL/global privileges.
Verify the cycle remains 2027/open/pre-lottery as configured and test revocation
using synthetic preview accounts before any service/exposure approval. Production
apply and real-user re-login coordination remain separate decisions.

Local verification covers memory and actual disposable MySQL 8.4.11, two-client
races, HTTP 401 behavior, rollback failures, retained stale rows and migration repeat
safety. No tests use RDS credentials or actual family records.
