# Deployment & Upgrades

Repository: <https://github.com/sandersonb/renaissance-academy>

## Prerequisites (server)

- **Node.js 22+** and npm
- **MySQL 8** (the existing `enrollment` database, or a fresh one from `db/schema.sql`)
- **nginx** (TLS + reverse proxy + admin IP restriction — see [nginx-tls.md](nginx-tls.md))
- **git**
- A process manager for the API (systemd shown below; pm2 is fine too)

## First-time deployment

```bash
# 1. Get the code
git clone https://github.com/sandersonb/renaissance-academy.git
cd renaissance-academy

# 2. Install and build
npm ci                        # API dependencies
cd web && npm ci && npm run build && cd ..   # → web/dist/ (static files nginx serves)

# 3. Configure
cp .env.example .env
$EDITOR .env                  # set DB_*, APP_BASE_URL, EMAIL_*, ADMIN_IP_ALLOWLIST, TRUST_PROXY=true

# 4. Prepare the database
#    - New DB:      mysql enrollment < db/schema.sql
#    - Then always: apply additive migrations
npm run db:migrate

# 5. Create the first admin (or set ADMIN_BOOTSTRAP_* in .env)
npm run admin:create -- --username youradmin

# 6. Start the API (foreground test first)
npm start                     # should log "enrollment API listening on ..."
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
ExecStart=/usr/bin/npm start
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
cd web && npm ci && npm run build && cd ..   # rebuild the static app

npm run db:migrate                   # apply any new migrations (safe/idempotent)

sudo systemctl restart enrollment-api
journalctl -u enrollment-api -n 50   # confirm it came up cleanly
```

Migrations are **additive and idempotent** — re-running `db:migrate` is safe and a
no-op when nothing is new. The startup guard will refuse to serve (with a clear
message) if a required table is missing, so a forgotten migration fails loudly
rather than silently.

## Docker Compose (dev/staging convenience)

`docker compose up` starts MySQL + API + web together. The DB container
auto-loads the base schema; **run migrations once** the first time:

```bash
docker compose up -d
docker compose exec api npm run db:migrate
# open http://localhost:5173
```

Seed sample data (never against production):

```bash
docker compose exec -e DB_HOST=db api npm run db:seed:post
```

## Rollback

During the cutover window the **legacy Perl app is the warm fallback**. Because
the rebuild is additive-only on the same database, you can revert nginx to the
Perl app without data migration. Keep `DUAL_WRITE_LEGACY_CRYPT=true` until Perl is
fully retired so password changes made in the new app still authenticate in Perl.

To roll back a bad *new-app* release: `git checkout <previous-tag>`, rebuild,
restart. Additive migrations don't need reverting (older code ignores new
tables/columns).

## Post-deploy checklist

- [ ] `GET https://enrollment.renacademy.org/api/settings` returns JSON.
- [ ] Parent login works; admin portal is reachable **only** from allowed IPs.
- [ ] A test email sends (or the outbox drains) — check the **Settings → Email log**.
- [ ] Registration paperwork downloads (upload at least the family packet, or the
      bundled default serves — see the admin **Paperwork** page).
- [ ] TLS certificate valid and auto-renewing (see [nginx-tls.md](nginx-tls.md)).
