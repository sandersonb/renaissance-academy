# Deployment & Upgrades

Repository: <https://github.com/sandersonb/renaissance-academy>

## Prerequisites (server)

- **Node.js 22+** and npm
- **MySQL 8.4** (existing `enrollment`; base dump only for a NEW disposable schema)
- **nginx** (TLS + reverse proxy + admin IP restriction — see [nginx-tls.md](nginx-tls.md))
- **git**
- A process manager for the API (systemd shown below; pm2 is fine too)

## First-time deployment

For AL2023 use [the host setup guide](../../infrastructure/HOST_SETUP.md). Upgrade
semantics are defined in [db/README.md](../../db/README.md): all tools inspect by
default, writes need --apply, cycle initialization is separate, and partial
failures need operator review. [Verified RDS TLS](database-tls.md) is implemented
for all new clients; live session verification remains a separate release gate.
Do not source .env in a shell or run production changes based only on this example.

```bash
# 1. Get the code
git clone https://github.com/sandersonb/renaissance-academy.git
cd renaissance-academy

# 2. Install and build
npm ci                        # API dependencies
npm run build                 # compiled API/CLIs in dist/
cd web && npm ci && npm run build && cd ..   # → web/dist/ (static files nginx serves)

# 3. Configure
cp .env.example .env
$EDITOR .env                  # explicit NODE_ENV=production, HOST=127.0.0.1, DB_*, HTTPS URL, SMTP/admin config
# Replace the example's LOCAL DB_TLS_MODE=disabled with verify_identity, set the
# actual RDS DNS endpoint and an absolute public DB_TLS_CA_FILE before remote use.
# Keep email/reminder timers 0 until the approved job-ownership handoff.

# 4. Prepare the database
#    First run db:check-tls with each approved DB account/environment (read-only).
#    - New DB:      mysql enrollment < db/schema.sql
#    - Then always: apply additive migrations
npm run db:migrate             # READ ONLY; explicitly provide the migration DB environment
npm run db:migrate -- --apply  # Only after target/backup/privilege/TLS review
# Then inspect db:init-settings --help and explicitly initialize approved year/gates.
# No guessed calendar-year seed; existing settings are never overwritten.

# 5. Create the first admin (or set ADMIN_BOOTSTRAP_* in .env)
npm run admin:create -- --username youradmin

# 6. Start the API (foreground test first)
node --env-file=.env dist/app/http/main.js  # only after explicit migrations/cycle/security gates
```

Then point nginx at `web/dist` (static) and `127.0.0.1:3001` (API) per
[nginx-tls.md](nginx-tls.md).

### Running the API as a service (systemd example)

`/etc/systemd/system/enrollment-api.service`:

```ini
[Unit]
Description=Renaissance Academy Enrollment API
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/renaissance-academy
EnvironmentFile=/opt/renaissance-academy/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/renaissance-academy/dist/app/http/main.js
Restart=on-failure
User=enrollment

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now enrollment-api
sudo systemctl status enrollment-api
journalctl -u enrollment-api -f      # follow logs
```

## Upgrading / redeploying a new version

```bash
cd /opt/renaissance-academy

# (recommended) back up the database first — see database.md
git pull origin main

npm ci                               # in case API deps changed
npm run build                         # rebuild compiled API/CLIs
cd web && npm ci && npm run build && cd ..   # rebuild the static app

npm run db:migrate                   # read-only target/history/pending report
npm run db:migrate -- --apply        # explicit approved pending upgrades only

sudo systemctl restart enrollment-api
journalctl -u enrollment-api -n 50   # confirm it came up cleanly
```

Applied migrations are tracked and skipped; SQL errors are never suppressed.
Changed files/unresolved failures block upgrades and production startup. Do not
retry a partially committed DDL file blindly; follow the operator recovery guide.

## Docker Compose (local development only)

Compose explicitly permits plaintext only to its local `db` service under
`NODE_ENV=development`. It is not a production or remote staging configuration;
all remotely hosted RDS clients must use [verified TLS](database-tls.md).

Only a NEW volume's base schema auto-loads. Use the explicit local setup sequence
in the root README (including cycle initialization); old untracked dev DBs need
review or a separate disposable project, never silent baselining:

```bash
docker compose -p enrollment-local run --rm api npm ci
docker compose -p enrollment-local run --rm api npm run db:migrate -- --apply
# Initialize an explicitly reviewed LOCAL test cycle, then:
docker compose -p enrollment-local up -d
# open http://localhost:5173
```

Seed sample data (never against production):

```bash
docker compose exec -e DB_HOST=db api npm run db:seed:post
```

## Rollback

Prefer a prepared compatible **new-app** release rollback, with an explicit
maintenance/restart and data-compatibility check. Do not edit deployed code or
applied SQL/checksums just to force a rollback. The strict startup guard requires
the deployed migration catalog to match recorded history; an older artifact
missing a later applied migration is intentionally refused. Rehearse a compatible
artifact/catalog or forward-fix rather than assuming any older tag will start.

There is one public cutover, not ongoing old/new family access. A break-glass
return to Perl is a separate, bounded decision with stopped writers/jobs and
verified password/data compatibility. Additive DDL alone does not guarantee it.
Retain DES dual-write only if that explicit rollback window requires it; never
restore an older backup over legitimate subsequent writes without reconciliation.

## Post-deploy checklist

- [ ] `GET https://enrollment.example.org/api/settings` returns JSON (substitute the approved hostname locally).
- [ ] Parent login works; admin portal is reachable **only** from allowed IPs.
- [ ] A test email sends (or the outbox drains) — check the **Settings → Email log**.
- [ ] Registration paperwork downloads (upload at least the family packet, or the
      bundled default serves — see the admin **Paperwork** page).
- [ ] TLS certificate valid and auto-renewing (see [nginx-tls.md](nginx-tls.md)).
- [ ] Database diagnostic confirms certificate/hostname-verified TLS 1.2+ for
      runtime and migration accounts; public CA lifecycle/expiry is monitored.
