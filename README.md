# Renaissance Academy Enrollment — React/TypeScript rebuild

A modern rebuild of the live Perl enrollment-lottery app (grades K–9). The build
is driven by analysis, not a static port. See:

- **`new/RULES_SPEC.md`** — validated behavior of the legacy system (the contract).
- **`new/IMPLEMENTATION_PLAN.md`** — architecture, intentional deviations, phases.
- **`new/LOG_ANALYSIS.md`** — production traffic/usage study.
- **`old/`** — the live Perl app (gitignored; contains secrets/PII).
- **`cursor/`** — an earlier static-port attempt (reference only).

## Documentation

- **[`docs/`](docs/)** — guidebooks for three audiences:
  [IT](docs/it/) (deploy, DB upgrades, nginx + TLS, CLI/env reference),
  [admin staff](docs/admin/) (using the portal), and
  [parents](docs/parents/) (applying, offers, paperwork).
- **[`CLAUDE.md`](CLAUDE.md)** — repo orientation for developers / AI assistants
  (architecture, commands, conventions).
- **[`openspec/`](openspec/)** — spec-driven records: current capability specs
  (`openspec/specs/`) and the rebuild change to be archived at cutover.

The app is **feature-complete** across parent portal, admin console, lottery,
notifications, surveys, documents, and the annual cycle; remaining work is
production cutover. The milestone history below is kept for context.

## Status

**M1 — Domain core (complete, tested).** Framework-free TypeScript (`src/domain/`):
`regStatus`, `transitions` ($flow matrix), `capacity`, seeded lottery
`engine`+`rng`, `changeStatus` (§11.1), `enrollmentRules`. The lottery is
validated against a real 2019 draw via the golden-master harness. Deviations
baked in: seeded/replayable RNG (vs unseeded `rand()`), underfill double-offer
bug guarded, transactional change-sets. Parity preserved otherwise.

**M2 — Parent portal backend (complete; React UI + DB adapter pending).**
Hexagonal: repository **ports** (`src/app/ports`) with an in-memory adapter
(`src/app/adapters/memory`) for tests/dev; a mysql2 adapter over the existing
schema lands with M3/M5.

| Area | Module | Notes |
|---|---|---|
| Auth | `services/authService.ts` | register / confirm / login / logout; **legacy `crypt()` verify → bcrypt upgrade-on-login** (S3), random expiring confirm token (S6), non-IP-pinned sessions (S4) |
| Passwords | `services/password.ts` | bcrypt + real DES `crypt()` compat (verified vs canonical `crypt('password','ab')`) |
| Enrollment | `services/enrollmentService.ts` | add child (new + re-enroll exact match) with K-age + **returning-grade 1..9 guard (B9)** + duplicate guard |
| Offers | `services/offerService.ts` | accept (survey-gated → PEND_REGISTER + expiration), decline (`cleanup_and_coalesce`), offer materialization on load, language-preference step, delete |
| Survey | `services/surveyService.ts` | data-driven (B8): Type A registration (grade-scoped, at accept), Type B lottery (at confirm) |
| HTTP | `http/server.ts` | Fastify routes for all of the above (auth, dashboard, children, accept/answer/decline/language/delete, survey-walked confirm) |

**React frontend** (`web/`): Vite + React + TS parent portal over the API —
login, register, **survey-driven email confirmation**, dashboard (status +
waitlist rank + actions), add/re-enroll student, accept (with the **generic
data-driven survey renderer**), decline, language preference. Dev-proxies `/api`
to the Node API. `cd web && npm install && npm run dev` (run `npm start` at the
repo root for the API).

**MySQL adapter** (`src/app/adapters/mysql`): implements the repository ports
against the **existing schema** (additive-only). `main.ts` uses it when `DB_HOST`
is set, else falls back to in-memory. Additive migrations in `db/migrations`
(`pw_hash`/`pw_algo`, `confirm_token`, `ExtraTitles.input_type`/`active`/
`sort_order`, `app_sessions`) applied via `npm run db:migrate`. See `db/README.md`.
**Integration-verified against real MySQL 8** (Docker): loaded the no-PII schema,
ran `db:migrate`, and exercised the full flow on the actual schema —
register → confirm (9-question Type-B survey → `ParentExtra`) → login
(`app_sessions`) → add `INITIAL` → re-enroll exact-match (`ACPT_REENROLL` +
`Current_Student` update) → accept (2-question Type-A survey → `ChildExtra`) →
`PEND_REGISTER` + paperwork expiration, with `pw_hash` populated. (Migration
`002` also widens `Extra.Value` 31→255 so the long Type-B options fit.)

**M2 complete:** also forgot-password (modernized to a token-based **reset link**
vs the legacy plaintext-password email), **resend** confirmation, and parent
`editChild` (field-policy via `CHILD_EDITABLE_FIELDS`, default locked = legacy
parity). Email goes through a `Mailer` port (ConsoleMailer dev stub; provider M4).

`npm test` → 61 tests passing; `web` builds clean. Verified end-to-end on **real
MySQL** and via the full **Docker Compose** stack.

**M3 — Admin console (complete).** Staff console with **isolated admin auth**
(dedicated `admin_users`/`admin_sessions` tables — *not* in `users`, so the annual
reset never wipes admins), bcrypt, and a **separate admin session cookie**.
Operations: search → family view → **change status** (the M1 transactional
state-machine rules) → add note; waitlist. Admin UI under `/admin` in `web/`.
- **First admin:** `DB_HOST=… ADMIN_PASSWORD=… npm run admin:create -- --username alice`
  (or set `ADMIN_BOOTSTRAP_USER`/`ADMIN_BOOTSTRAP_PASSWORD` for first-boot create).
- **Access control:** IP-restricted — `nginx` is the primary gate
  (`deploy/nginx.conf.example`); app-level `ADMIN_IP_ALLOWLIST` + `TRUST_PROXY`
  are defense-in-depth.
- **Run Lottery** (admin): **preview** (dry run, no writes, one random *sample*) →
  review the summary → **run the official lottery**, which draws a **fresh
  server-side seed that is never the previewed one** (fairness/legal requirement —
  a preview can't be reused as the outcome). The official run records an
  **immutable draw log** (`lottery_run`/`lottery_assignment` with the recorded
  seed, so the result is auditable after the fact), places every student, sets
  `post_lottery=1`, and blocks a re-run. Past runs are listed on the page. UI at
  `/admin/lottery`.
- **Start New Year** (admin, the December reset as a guarded action): upload the
  current-student roster CSV → **validate** (parses with the bug fixes: header
  skipped, dates read as M/D/YYYY) → **commit** = purge the per-year tables +
  import `Current_Student` (PEND_REENROLL) + set the new `year_begin` /
  `lottery_open=1` / `post_lottery=0` in `app_settings` (B6 — replaces the
  hand-edited `page.pm` globals; loaded at startup). Validation runs *before* any
  purge so a bad CSV can't wipe data. UI at `/admin/roll-year`. Verified on real
  MySQL.
- **Survey question-manager** (admin, the B8 payoff): full CRUD over questions +
  options (`ExtraTitles`/`Extra`) — text, grade scope, input type, ordering,
  activate/deactivate — so staff edit surveys **without a deploy**. Edits are
  served immediately by the data-driven survey engine. UI at `/admin/survey`.

**M4 — Email (complete).** Transactional **outbox** (deviation B4): auth +
notify emails are enqueued (`email_outbox`) in the same operation as the state
change; a background **worker** drains it via a pluggable `EmailProvider`
(console default, SMTP via nodemailer) with retries. Replaces `ConsoleMailer`
inline-send and the two `notify_email.pl` crons: **`NotifyService`** does
`materializeOffers` (PEND_OFFER→OFFER + email) and `sendReminders`, exposed as
admin actions (`/admin/notify`: send offers/reminders, view outbox, flush). The
worker also runs in-process on a timer (`EMAIL_WORKER_INTERVAL_MS`). Verified on
real MySQL (register→outbox→notify→drain).

**M5 — Hardening (transactions done).** A `Database` abstraction (`repos` +
`transaction`) gives a real unit-of-work: the mysql adapter uses
`BEGIN/COMMIT/ROLLBACK`; the in-memory adapter snapshots/restores. The four
multi-row writes are now **atomic** (deviation B2) — `change_status` (status +
coalesce + sibling promotion + Note), **lottery commit** (draw log + every
placement), **roll-new-year** (purge + import + settings), and **notify offers**
(status + email enqueue, transactional outbox). Email worker has a re-entrancy
guard. Verified: rollback test (in-memory) + all functional flows on the real
`BEGIN/COMMIT` path.

*Remaining M5 (operational, pre-cutover): load-test the Jan–Mar peak; parity pass
vs the Perl app on a shared DB.* Next: **M6** cutover (Sept–Dec).

## Run locally

**Docker Compose (everything):**
```bash
docker compose up            # MySQL (auto-migrated) + API + React
# open http://localhost:5173
```
The DB auto-loads `db/schema.sql` + `db/migrations/*.sql` on first init.

**Without Docker:**
```bash
npm install && npm start                      # API on :3001 (in-memory if DB_HOST unset)
cd web && npm install && npm run dev           # React on :5173 (proxies /api)
# For a real DB: load db/schema.sql into MySQL, set DB_HOST, run `npm run db:migrate`
```

**Sample data** (needs `DB_HOST` + migrations applied):
```bash
npm run db:seed:pre                           # pre-lottery: applicants awaiting the draw;
                                              #   small grades oversubscribed so a real draw waitlists
npm run db:seed:post                          # post-lottery: offers, waitlists, paperwork, registered —
                                              #   a spread across every status
npm run db:seed -- --only=current-students    # ONLY (re)load the Current_Student roster
npm run db:import-roster [file.csv]           # same roster load; defaults to db/sample-roster.csv
```
Both modes purge the per-year tables first, are re-runnable, and print login
details: parents `fam1`..`famN` (password `parentpass`); admin `admin` /
`admin12345` (override with `SEED_ADMIN_PASSWORD`). `db/sample-roster.csv` is a
no-PII sample in the real import format — you can also upload it in the admin
**Start New Year** page.

## Tests

```bash
npm test              # fast unit/integration suite (in-memory, no Docker) — 64 tests
npm run typecheck     # tsc --noEmit
npm run test:functional   # full stack vs REAL MySQL in Docker (auto-managed); auto-skips if no Docker
```

`test/functional/` spins up MySQL in Docker, loads `db/schema.sql` + the additive
migrations, and exercises the real flows through the mysql2 adapter + Fastify
(register→confirm→survey→login→add-child, re-enroll, admin status change + note,
and lottery preview/commit + draw log) — the reproducible version of the manual
docker+curl checks. The container is started and torn down automatically.

## Develop

```bash
npm install
npm test            # vitest — 16 tests (transitions, lottery invariants, change_status)
npm run typecheck   # tsc --noEmit
npm run lottery:demo [seed]   # prints a legacy-format trace to stdout
```

Cross-check the engine against the golden-master harness (same checker that
validates the real 2019 run):

```bash
npm run lottery:demo seed-A > /tmp/trace.txt 2>/dev/null
python3 new/analyze_lottery_results.py /tmp/trace.txt   # -> INVARIANT CHECK: PASS
```

## Next

M2 parent portal · M3 admin console + lottery/roll-year actions · M4 notify
(outbox) · M5 hardening + parity · M6 cutover (Sept–Dec idle window).
See `new/IMPLEMENTATION_PLAN.md §5`.
