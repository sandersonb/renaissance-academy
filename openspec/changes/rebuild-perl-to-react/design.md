# Design & technical decisions

## Architecture

Hexagonal: pure `domain/` (no I/O), application `services/`, repository `ports/`, and
`adapters/`. Two adapter implementations back every port — an **in-memory** store for
fast unit tests and dev, and **mysql2** over the real legacy schema. A `Database`
abstraction exposes `{ repos, transaction }`; mysql does real BEGIN/COMMIT/ROLLBACK,
memory does structuredClone snapshot/restore, so both honor the same atomicity.

HTTP is thin Fastify routes injected with the services (`buildServer(deps)`), enabling
route tests over the in-memory adapter.

## Key decisions

### Additive-only on the legacy schema
No legacy column is renamed or dropped. New capabilities use new tables/columns
(migrations `001`–`008`). This keeps the Perl app runnable against the same database
so it's a warm rollback during cutover.

### Non-reproducible official lottery (fairness/legal)
The preview is explicitly a *sample* and its seed is **never** threaded into the
official run — `commit()` always generates a fresh server-side seed. The official
draw's seed is recorded for after-the-fact auditability, but cannot be known or
chosen in advance. Committing sets `post_lottery=1` and blocks re-runs.

### Data-driven surveys (B8)
Question definitions (type/choices/active/order) live in the DB, so staff edit
surveys without code changes. Registration answers attach to a child at acceptance;
lottery answers attach to a parent at confirmation.

### Transactional outbox + paced worker (B4)
State changes enqueue emails in the same transaction; a worker delivers
asynchronously. Because consumer Gmail has tight limits, the worker enforces a batch
size, inter-message spacing, and a rolling 24h cap, and treats provider 4xx/transient
errors as *retry later* (no attempt burned) rather than dropping mail. Daily reminders
re-enqueue with de-duplication.

### Documents in the database
Registration PDFs are stored as BLOBs (`enrollment_document`) and streamed only to
entitled parents — never a public URL. Entitlement mirrors `enroll.pl`. A bundled
default (`assets/default-packet.pdf`, overridable via `DEFAULT_PACKET_PATH`) serves
when a slot has no real upload, so links never break and admins see which slots still
need the year's file.

### Security
- Passwords: bcrypt; legacy DES `crypt()` verified and upgraded on first successful
  login; optional dual-write during the cutover window (`S3`).
- Sessions: httpOnly, non-IP-pinned cookies (`S4`).
- Auth: non-enumerating login and password reset.
- Admin: DB-backed accounts (no hard-coded creds), IP-restricted at nginx **and** in
  the app (`ADMIN_IP_ALLOWLIST`, `TRUST_PROXY`). phpMyAdmin removed.

## Deviation catalog

Behavior (`B`) and security (`S`) deviations are enumerated in
`new/IMPLEMENTATION_PLAN.md`. Notable: seeded/replayable RNG, underfill double-offer
bug guarded, transactional change-sets (`B2`), transactional outbox (`B4`),
data-driven surveys (`B8`), returning-grade guard (`B9`); `crypt()`→bcrypt (`S3`),
non-IP-pinned sessions (`S4`).

## Testing

Three levels: fast in-memory unit tests for all logic; `test/functional/` against a
disposable MySQL in Docker to catch adapter/SQL/collation issues (e.g. the reports
UNION collation bug, the paperwork BLOB round-trip); and `docker compose` for the full
stack. Every behavior change ships with a test.

## Risks & mitigations

- **Gmail limits** → paced worker + daily cap + back-off; visible in the admin log.
- **Unmigrated DB** → startup guard exits with a clear "run db:migrate" message.
- **Accidental re-draw / new-year purge** → confirmations, post-lottery guard,
  CSV validation before purge, and IT-verified backups.
