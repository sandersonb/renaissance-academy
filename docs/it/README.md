# IT Guidebook

Operations documentation for technical staff running the Renaissance Academy
enrollment system.

Repository: <https://github.com/sandersonb/renaissance-academy>
Deployment hostname: configure locally; examples use `enrollment.example.org`.

## Contents

1. **[Deployment & Upgrades](deployment.md)** — clone/build/run, redeploy, rollback.
2. **[Database](database.md)** — schema, applying migrations (DB upgrades), backups, seeding;
   **[database TLS](database-tls.md)** — verified transport, CA lifecycle and diagnostic.
3. **[nginx & TLS](nginx-tls.md)** — reverse proxy, admin IP restriction, Let's Encrypt certs.
4. **CLI & environment reference** — below.
5. **[Session security](session-security.md)** — lifecycle revocation and forward upgrade boundary.
6. **[HTTP security](http-security.md)** — isolated secure cookies, same-origin writes,
   auth limits, exact networks, proxy trust and remaining preview gates.

## The stack in one paragraph

A Node/TypeScript API (Fastify, `npm start`) talks to the existing MySQL 8
database and serves a JSON API. A React single-page app (`web/`, built with Vite
to static files) is the parent + admin UI. nginx terminates TLS, restricts the
admin surface by IP, and reverse-proxies the API and the static app. Email is
queued in the database and delivered by an in-process worker, paced to stay under
Gmail's sending limits.

## CLI reference

Run these from the repo root. All DB commands need the `DB_*` environment set
(see below) — without `DB_HOST` the app uses a throwaway in-memory store only
outside production. DB CLIs require explicit credentials; none auto-load `.env`.
The prepared production host uses compiled JavaScript, not npm/tsx entrypoints.

| Command | Purpose |
|---|---|
| `npm ci` | Install exact dependencies (root API). |
| `npm run build` | Compile the API to `dist/` for the [AL2023 host setup](../../infrastructure/HOST_SETUP.md). |
| `cd web && npm ci && npm run build` | Build the React app to `web/dist/`. |
| `npm run db:migrate` | Read-only target/history/pending report; `-- --apply` explicitly upgrades. See [migration safety](../../db/README.md). |
| `npm run db:init-settings` | Read-only cycle report; explicit year/open/post values plus `--apply` initialize once, never overwrite. |
| `npm run db:init-preview` | Read-only fresh-preview plan; explicit `--apply` initializes only empty `enrollment_preview`. See [bootstrap guide](../../db/PREVIEW_BOOTSTRAP.md). |
| `npm run db:check-tls` | Read-only server/session metadata; verify negotiated transport without app data reads or writes. See [TLS guide](database-tls.md). |
| `npm start` | Development convenience (tsx). Prepared production hosts run `dist/app/http/main.js` under systemd. |
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
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Port 3306 | Explicit credentials/schema required. Actual certificate DNS name for verified TLS. Unset host → in-memory only outside production. |
| `DB_TLS_MODE` | `verify_identity` | Certificate AND hostname verification, TLS 1.2+. `disabled` requires explicit local dev/test; never production/RDS. |
| `DB_TLS_CA_FILE` | — | Absolute readable public CA PEM; required for verified TLS. See [TLS guide](database-tls.md). |
| `PORT` | `3001` | API listen port. |
| `HOST` | `0.0.0.0` | API bind address; the host installer requires `127.0.0.1` behind nginx. |
| `APP_BASE_URL` | `http://localhost:5173` | Canonical root origin for email links/write policy; HTTPS required in production mode, no credentials/path/query/fragment. |
| `BCRYPT_COST` | `12` | Integer 4–14. |
| `DUAL_WRITE_LEGACY_CRYPT` | `true` | Also write legacy `crypt()` during the Perl cutover window; turn off after retiring Perl. |
| `YEAR_BEGIN` `LOTTERY_OPEN` `POST_LOTTERY` | — | Dev/fixture defaults only. Production requires separately initialized `app_settings`, never a guessed env/calendar fallback. |
| `OFFER_EXPIRATION_DAYS` `PAPERWORK_EXPIRATION_DAYS` | `3` / `5` | Deadlines. |
| `ADMIN_IP_ALLOWLIST` | empty (development only) | 1–64 exact IPs or bounded CIDRs (/24 IPv4, /64 IPv6 or narrower); production empty/broad/invalid lists fail. nginx remains independently restricted. |
| `TRUST_PROXY` | `false` | `true` trusts only the immediate loopback nginx hop; nginx must overwrite X-Forwarded-For with a single resolved client IP. |
| `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` | — | Create the first admin on first boot if none exist. |
| `EMAIL_PROVIDER` | `console` (development only) | Production-mode preview/production require explicit `smtp`; missing/console/unknown fallback fails. Capture-only preview mail remains a separate blocked gate. |
| `EMAIL_FROM` `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | — | SMTP settings when `EMAIL_PROVIDER=smtp`. |
| `EMAIL_WORKER_INTERVAL_MS` | `60000` | How often the outbox worker drains. `0` disables the in-process worker. |
| `EMAIL_BATCH_SIZE` | `20` | Max messages per drain. |
| `EMAIL_SEND_SPACING_MS` | `1500` | Delay between individual sends (avoids burst rate-blocks). |
| `EMAIL_DAILY_CAP` | `400` | Hard ceiling on sends per rolling 24h. Raise for Google Workspace. |
| `REMINDER_INTERVAL_MS` | `86400000` | Daily reminder re-enqueue. `0` disables. |
| `DEFAULT_PACKET_PATH` | `assets/default-packet.pdf` | Fallback registration PDF served when a packet slot has no upload. |

## Health & basics

- API health: `GET /api/settings` returns the current cycle info (public).
- On boot the API checks required tables. Production also requires clean/current
  migration history and initialized cycle settings; no boot migrations or defaults.
- Unexpected HTTP 5xx logs use only a fixed category, route template and method,
  never raw URLs/query tokens, SQL, request bodies or cookies. Actual host/edge and
  mail-worker logging/isolation must be reviewed before activation.
