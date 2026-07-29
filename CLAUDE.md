# CLAUDE.md

Guidance for AI assistants (and new developers) working in this repository.

## What this is

A React/TypeScript rebuild of the live Perl school-enrollment-lottery app for
Renaissance Academy (grades K–9), migrating **behavior-first** onto the existing
MySQL schema. Public repo: <https://github.com/sandersonb/renaissance-academy>.

- **`src/`** — Node/TypeScript API (Fastify).
- **`web/`** — React + Vite parent & admin single-page app.
- **`db/`** — no-PII base schema (`schema.sql`) + additive `migrations/`.
- **`test/`** — Vitest unit tests + `test/functional/` (real MySQL via Docker).
- **`docs/`** — human documentation (IT, admin staff, parents).
- **`openspec/`** — spec-driven change records (specs + proposals).
- **`deploy/`** — nginx example.
- **`new/`** — the migration's source-of-truth analysis: `RULES_SPEC.md`
  (validated legacy behavior), `IMPLEMENTATION_PLAN.md` (architecture + the
  intentional-deviation catalog `B1–B9` / `S1–S6`), `LOG_ANALYSIS.md`.
- **`old/`** — the live Perl app. **Gitignored; contains real secrets + PII. Never
  read secrets from it into committed files, never commit it.**

## Architecture (hexagonal)

```
domain (pure, framework-free)      src/domain/*        regStatus, transitions, lottery engine, changeStatus, rules
  ▲
services (application logic)       src/app/services/*  auth, enrollment, offers, survey, notify, lottery, admin, documents, rollYear
  ▲
ports (interfaces)                 src/app/ports/*     repositories.ts, database.ts, mailer.ts, email.ts
  ▲
adapters (implementations)         src/app/adapters/*  memory/ (tests & dev) and mysql/ (mysql2, real schema)
  ▲
http (Fastify routes)              src/app/http/*      server.ts (routes), main.ts (entrypoint, worker, guards)
```

The **`Database`** abstraction (`ports/database.ts`) is `{ repos, transaction<T>(work) }`.
mysql does real `BEGIN/COMMIT/ROLLBACK`; memory does `structuredClone` snapshot/restore
so tests exercise the same atomic semantics. Every repository has **both** a memory and
a mysql implementation — keep them in lockstep.

## Commands

| Command | What |
|---|---|
| `npm test` | Unit tests (in-memory, no DB). Fast. |
| `npm run test:functional` | End-to-end against real MySQL in Docker. Auto-skips if Docker is absent. |
| `npm run typecheck` | `tsc --noEmit` (root). Run `cd web && npx tsc --noEmit` for the web app. |
| `npm run dev` / `npm start` | API with/without watch. Uses MySQL if `DB_HOST` is set, else an in-memory store. |
| `npm run db:migrate` | Apply all `db/migrations/*.sql` (idempotent-tolerant). |
| `npm run db:seed:pre` / `:post` | Seed a realistic pre- or post-lottery dataset (needs `DB_HOST`). |
| `npm run admin:create -- --username alice` | Create an admin login. |
| `cd web && npm run dev` / `npm run build` | React app dev server / production build. |

`docker compose up` brings up MySQL + API + web together (see `docs/it/`).

## Conventions & invariants

- **Additive-only migrations.** Never rename/drop legacy columns. New tables/columns
  only. The Perl app must keep working against the same DB during the cutover window.
- **Reg_Status is the spine.** Exact legacy strings in `src/domain/regStatus.ts`; the
  transition matrix lives in `src/domain/transitions.ts`. `HUMANIFY` is the single
  source of canonical human labels (used by dashboard, badges, parent portal, notes).
- **Keep memory + mysql adapters in sync.** A new repo method needs both, plus a unit
  test (memory) and ideally a functional test (mysql).
- **Transactional outbox for email.** State change + email enqueue commit together; a
  worker drains and paces sends (Gmail-safe throttle: batch + spacing + daily cap).
- **The lottery is a fresh, server-side random draw.** Preview is illustrative and its
  seed is never reused for the official run (fairness/legal requirement). Committing a
  draw sets `post_lottery=1` and blocks re-runs.
- **Admin surface is IP-gated** (nginx primary + `ADMIN_IP_ALLOWLIST` app-level).
  phpMyAdmin is intentionally *not* ported; admin CRUD lives in the portal.
- **Docs contain no secrets.** Ever.

## Testing philosophy

Three levels: (1) fast in-memory unit tests for all logic; (2) `test/functional/`
against real MySQL to catch adapter/SQL/collation issues the memory store can't; (3)
`docker compose` for the full stack. Add a test with every behavior change.

## Where to read more

- Behavior contract: `new/RULES_SPEC.md`
- Architecture + deviation rationale: `new/IMPLEMENTATION_PLAN.md`
- Ops & deploy: `docs/it/`
- Spec-driven change history: `openspec/`
