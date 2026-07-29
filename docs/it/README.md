# IT Guidebook

Operations documentation for technical staff running the Renaissance Academy
enrollment system.

Repository: <https://github.com/sandersonb/renaissance-academy>
Live host: `enrollment.renacademy.org`

## Contents

1. **[Deployment & Upgrades](deployment.md)** — clone/build/run, redeploy, rollback.
2. **[Database](database.md)** — schema, applying migrations (DB upgrades), backups, seeding.
3. **[nginx & TLS](nginx-tls.md)** — reverse proxy, admin IP restriction, Let's Encrypt certs.
4. **CLI & environment reference** — below.

## The stack in one paragraph

A Node/TypeScript API (Fastify, `npm start`) talks to the existing MySQL 8
database and serves a JSON API. A React single-page app (`web/`, built with Vite
to static files) is the parent + admin UI. nginx terminates TLS, restricts the
admin surface by IP, and reverse-proxies the API and the static app. Email is
queued in the database and delivered by an in-process worker, paced to stay under
Gmail's sending limits.

## CLI reference

Run these from the repo root. All DB commands need the `DB_*` environment set
(see below) — without `DB_HOST` the app uses a throwaway in-memory store.

| Command | Purpose |
|---|---|
| `npm ci` | Install exact dependencies (root API). |
| `cd web && npm ci && npm run build` | Build the React app to `web/dist/`. |
| `npm run db:migrate` | **Upgrade the database** — apply all additive migrations (idempotent). |
| `npm start` | Run the API (production). Use a process manager (systemd/pm2). |
| `npm run dev` | Run the API with auto-reload (development). |
| `npm run admin:create -- --username NAME` | Create an admin login (password via prompt or `ADMIN_PASSWORD` env). |
| `npm run db:seed:pre` / `:post` | Load sample data (dev/staging only — **never production**). |
| `npm run db:import-roster [file.csv]` | Load a current-student roster CSV into `Current_Student`. |
| `npm test` | Unit tests. |
| `npm run test:functional` | Integration tests against a disposable MySQL (needs Docker). |

## Environment variables

Copy `.env.example` to `.env` for local/non-Docker runs. In production, set these
in the service unit / container environment — **not** in a committed file.

| Variable | Default | Notes |
|---|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | — | MySQL connection. Unset `DB_HOST` → in-memory store. |
| `PORT` | `3001` | API listen port. |
| `APP_BASE_URL` | `http://localhost:5173` | Public base URL used in email links (e.g. `https://enrollment.renacademy.org`). |
| `BCRYPT_COST` | `12` | Password hashing cost. |
| `DUAL_WRITE_LEGACY_CRYPT` | `true` | Also write legacy `crypt()` during the Perl cutover window; turn off after retiring Perl. |
| `YEAR_BEGIN` `LOTTERY_OPEN` `POST_LOTTERY` | — | Startup defaults for the enrollment cycle; the `app_settings` table (edited in the portal) overrides these at boot. |
| `OFFER_EXPIRATION_DAYS` `PAPERWORK_EXPIRATION_DAYS` | `3` / `5` | Deadlines. |
| `ADMIN_IP_ALLOWLIST` | empty (allow all) | Comma-separated IPs/prefixes for the app-level admin gate (defense-in-depth behind nginx). |
| `TRUST_PROXY` | `false` | Set `true` behind nginx so the real client IP is used. |
| `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` | — | Create the first admin on first boot if none exist. |
| `EMAIL_PROVIDER` | `console` | `console` (logs, no delivery) or `smtp`. |
| `EMAIL_FROM` `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | — | SMTP settings when `EMAIL_PROVIDER=smtp`. |
| `EMAIL_WORKER_INTERVAL_MS` | `60000` | How often the outbox worker drains. `0` disables the in-process worker. |
| `EMAIL_BATCH_SIZE` | `20` | Max messages per drain. |
| `EMAIL_SEND_SPACING_MS` | `1500` | Delay between individual sends (avoids burst rate-blocks). |
| `EMAIL_DAILY_CAP` | `400` | Hard ceiling on sends per rolling 24h. Raise for Google Workspace. |
| `REMINDER_INTERVAL_MS` | `86400000` | Daily reminder re-enqueue. `0` disables. |
| `DEFAULT_PACKET_PATH` | `assets/default-packet.pdf` | Fallback registration PDF served when a packet slot has no upload. |

## Health & basics

- API health: `GET /api/settings` returns the current cycle info (public).
- On boot the API checks that required additive tables exist and **exits with a
  clear message** telling you to run `npm run db:migrate` if any are missing.
- Logs: unexpected 5xx errors are logged with the request URL/method. Email
  activity is logged by the worker.
