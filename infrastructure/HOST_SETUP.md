# Prepare the AL2023 host from uploaded source

`setup-host.py` is a standalone Python 3 script intended to be run **as root on
the new AL2023 ARM64 EC2**. It does not execute on your workstation or via Terraform.
Only the Python standard library is required before starting.

## What it does

- Installs nginx, Amazon Linux's namespaced Node.js 22/npm packages, and OS helpers
  from configured `dnf` repositories. No curl-to-shell runtime installer.
- Installs the `mariadb105` MySQL-compatible CLI client (`mysql`) for administrator
  debugging, as [documented for AL2023 by AWS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-install-cli.html).
  Checks only `mysql --no-defaults --version`; does not install/start a database
  server, store client credentials, or connect to a database.
- Creates separate non-login build/runtime users. npm lifecycle scripts and builds
  run as the build user with a cleared environment, never as root or with `.env`.
- Copies **allowlisted application inputs** from an uploaded source directory,
  builds the compiled API and Vite frontend, prunes runtime dev dependencies, and
  publishes root-owned content-addressed releases. No Vite development server/tsx
  is used by the service.
- Never traverses/copies `old/`, `.env*`, local node_modules, Terraform state, Git
  internals, or raw database dumps. Rejects source symlinks and special files.
- Configures nginx for **private HTTP behind the existing TLS edge**, with SPA
  fallback, 16 MiB uploads, sanitized forwarded headers, and exact/nested admin
  UI/API IP gates. Admin access defaults to **deny all** unless CIDRs are supplied.
  Its access log omits queries/referrers/bodies to avoid logging reset tokens;
  the existing outer edge's logging still needs separate review.
- Installs a hardened systemd API unit with loopback binding, root-read
  `EnvironmentFile`, and a fail-closed startup validator.
- Creates `/etc/renaissance-academy/.env` once, root-owned mode 0600, with blank
  secrets, SMTP mode, no bootstrap admin password, and both email timers disabled.
  **Existing `.env` contents are always preserved.**
- Prepares a validated public regional RDS CA bundle under
  `/etc/pki/renaissance-academy` (root-owned/readable, separate from secrets).
  Fresh `.env` files select verified database TLS; cached CA material is preserved
  unless `--refresh-rds-ca` is explicitly supplied with the API stopped.
- Validates nginx before reload, preserves unrelated nginx configuration, starts/
  enables nginx and the existing SSM agent, but **never enables, starts, or restarts
  the enrollment API**. SSH access and security groups are not changed.
- If SELinux is enabled, uses standard `/var/www` labels and enables
  `httpd_can_network_connect` for nginx proxying; does not disable SELinux.

This is not an OS-wide update/reboot, database migration/seed/import, admin-account
creation, production readiness certification, AL1 cookie-routing implementation, public-ingress
change, certificate issuance, or DNS cutover.

## Upload only the intended source

Use the current trusted checkout, including uncommitted host/build changes. Do
not copy the entire repository/infrastructure directory to the server: it may
contain local credentials, Terraform state, or legacy data. The following archive
contains the needed current inputs and the single-file installer:

```bash
tar --exclude=node_modules --exclude='.env*' --exclude='*.swp' \
  -czf enrollment-source.tar.gz \
  package.json package-lock.json tsconfig.json tsconfig.build.json \
  src assets db/migrations db/preview/base.sql db/preview/utf8mb4.sql \
  web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts \
  web/index.html web/src infrastructure/setup-host.py
```

Include `web/public` explicitly if the project later has one. Transfer the archive
using the agreed SSH/SSM path, extract it into a trusted directory on EC2 (for
example `/var/tmp/enrollment-source`), and keep the legacy directory out of it.
The installer rejects symlinks, including symlinked parent source directories.

Before building, review/trust the source and package locks: npm packages execute
code as the build user. Do not run this installer on an unrelated/shared host.
Builds are sequential with a 512 MiB Node heap limit to suit the t4g.micro. If
resource pressure/build errors occur, the candidate is not activated; do not
work around them by running npm as root.

## Run setup

Replace the proxy IP with the **old nginx host's private IP**, not an office IP
or public address. Each trusted proxy must be one exact /32 or /128 host.
Admin CIDRs refer to the **real client** addresses the trusted edge forwards.

```bash
sudo python3 /var/tmp/enrollment-source/infrastructure/setup-host.py \
  --source-dir /var/tmp/enrollment-source \
  --server-name enrollment.example.org \
  --trusted-proxy-cidr OLD_EDGE_PRIVATE_IP/32 \
  --admin-cidr STAFF_PUBLIC_IP/32
```

Repeat `--admin-cidr` / `--trusted-proxy-cidr` as necessary. Omitting admin CIDRs
denies all admin clients; it does not open access. `--server-name` is required:
substitute the approved deployment hostname for the reserved example above.
This is a named nginx vhost, not a replacement for
the stock/default server: use the intended Host header when testing directly.
No CIDR, hostname, or secret is inferred from Terraform state.
`--rds-region` defaults to `us-west-2` and selects the official public CA URL/path;
it does not configure or change an RDS instance.

### Repeat behavior

- Identical source/installer/Node version reuses the existing release; no npm
  rebuild. `.env` is not overwritten. Old releases are retained, not deleted.
- Valid cached public CA material is not downloaded/replaced on rerun. Invalid or
  unexpected CA paths are refused. An explicit CA refresh or region change also
  requires stopping an active API; see [TLS lifecycle](../docs/it/database-tls.md).
- Root-managed files may be updated only if they match the last setup manifest;
  unrecognized files or local edits cause refusal rather than silent overwrite.
- With an active API, an unchanged setup is a no-op. A release/configuration
  change refuses until the operator explicitly stops the API in an approved window.
- Package install/reconciliation, systemd reload and service enablement are
  idempotent; no API activation is hidden in a rerun.
- A nonblocking root-owned setup lock prevents concurrent installer runs from
  racing on releases or the first `.env` creation.
- The setup manifest is `/var/lib/renaissance-academy-setup/state.json`; it has no
  secret values. If a run fails, retain it and inspect the diagnostic. Do not
  delete unknown releases/configuration or bypass source/ownership checks blindly.
  A failed nginx test restores the previous vhost and saves its diagnostic in
  root-only `/var/lib/renaissance-academy-setup/nginx-validation.log`.

## Mandatory operator work afterwards

### 1. Configure secrets locally on EC2

```bash
sudoedit /etc/renaissance-academy/.env
```

Set the dedicated DB user's credentials, RDS hostname/database, SMTP credentials
and sender, canonical root HTTPS application URL, and restricted `ADMIN_IP_ALLOWLIST`.
The app accepts 1–64 exact IPs or bounded CIDRs (/24 IPv4, /64 IPv6 or narrower);
never use string prefixes. Do not use the RDS master user. The independent nginx
gate uses the `--admin-cidr` networks. Keep `HOST=127.0.0.1`, `PORT=3001`,
`NODE_ENV=production`, `TRUST_PROXY=true`, and `EMAIL_PROVIDER=smtp`.
Set `DB_HOST` to the actual RDS DNS endpoint, `DB_TLS_MODE=verify_identity`, and
`DB_TLS_CA_FILE=/etc/pki/renaissance-academy/rds-us-west-2-bundle.pem` (or the chosen
region's path). Existing `.env` files need these fields added manually; setup
never edits operator values. The unprivileged API needs read access to the public
CA, not to the `.env` directory. Do not use IP literals or a tunnel alias as the
verified server hostname.

Use systemd EnvironmentFile syntax: no `export`, no inline comments, and quote
values containing whitespace. **Do not source this file in a shell, print it,
copy it into a release, commit it, or paste its contents into chat/logs.**
The service manager reads the root-only file and passes its values to the
unprivileged process. The runtime user cannot read the file directly.

Leave `EMAIL_WORKER_INTERVAL_MS=0`, `REMINDER_INTERVAL_MS=0`, and bootstrap admin
values blank during the pilot. Timer disablement does not block manual notify/
drain actions. Coordinate the single owner of legacy/new notification jobs.

### 2. Complete the remaining cutover/security gates

Environment configuration is necessary **but not sufficient to make this app
production-ready**. The setup script intentionally does not hide these tasks:

- For a fresh isolated `enrollment_preview`, first inspect the guarded
  [preview bootstrap](../db/PREVIEW_BOOTSTRAP.md) and explicitly approve its separate
  --apply later. It preserves 001–008 checksums, finalizes full Unicode and creates
  no cycle/families/jobs. The migration account needs scoped REFERENCES for the
  retained foreign key, not DROP/LOCK TABLES/CREATE VIEW. Never import the old dump.
- Inspect/test/approve tracked migrations separately; only --apply writes. Do not
  bypass the ledger by looping over SQL files or importing a base dump into live DB.
  See [db/README.md](../db/README.md) for compiled operator CLI paths and manual
  recovery. Use the migration account's separate secret environment, not runtime
  credentials, and complete the RDS TLS gate before any RDS execution.
- Initialize the cycle once with explicit reviewed year/open/post-lottery values
  using db:init-settings and --apply. Production refuses missing history/settings;
  it does not choose a year, open enrollment or migrate at boot. Existing settings
  cannot be overwritten by the initialization tool.
- Run the [compiled read-only TLS diagnostic](../docs/it/database-tls.md) with the
  intended runtime and migration accounts before any rehearsal/apply. Shared
  certificate AND hostname verification is implemented locally, but actual EC2/RDS
  session encryption and effective server enforcement still need verification.
  Server-wide TLS can remain optional for AL1; no RDS/user change is implicit.
- Deploy/test the [HTTP boundaries](../docs/it/http-security.md) only after explicit
  approval: frontend/API must ship together, canonical Origin/marker are required
  for writes and nginx must overwrite X-Forwarded-For with one resolved address.
  Local implementation is not proof of actual AL1 routing or public exposure.
- Resolve the other production-hardening blockers in the local checklist
  (mail isolation/claiming, concurrency, rollover safety, dependencies, etc.).
- The chosen preview stays at `/` under the final hostname, selected by an AL1
  nginx cookie; no `/new/` rebasing is required. Configure the preview's isolated
  schema/restricted DB user and test mail sink before starting it. APP_BASE_URL
  stays the canonical HTTPS root. At cutover, switch the stopped unit to production
  credentials/schema; never copy test sessions, accounts or queued mail across.
- Implement/test whole-app cookie routing, unique new auth cookies, cache
  separation and email links opened without a preview cookie before enabling opt-in.
  The selector is not authentication. There is no preview IP gate; staff/admin
  network restrictions stay in place, separate from the routing cookie.
- Verify enrollment year/gates/caps from app_settings, legacy coexistence, worker
  ownership, and approved paperwork. Production requires valid DB cycle settings;
  changing .env YEAR_BEGIN/LOTTERY_OPEN is not production initialization.
- Confirm inner/outer proxy headers and admin denial from unauthorized clients;
  public SG ingress remains a separate Terraform switch. TLS/cert renewal and DNS
  still belong to their explicit later cutover steps.
- The public November switch must send every application request to new regardless
  of cookies and stop legacy writers. AL1 is only a temporary trusted TLS edge;
  cookie routing does not isolate preview users from a compromised legacy origin.

### 3. Explicit first start

Only after the configured secrets and these gates are ready:

```bash
sudo systemctl enable --now enrollment-api.service
sudo systemctl status enrollment-api.service
sudo journalctl -u enrollment-api.service -n 50
curl -H 'Host: enrollment.example.org' http://127.0.0.1/api/settings
```

The startup validator rejects missing/placeholder secrets, console email,
in-memory DB fallback, non-loopback API binding, bad ports, non-HTTPS base URL,
empty/broad/invalid admin IP allowlists, out-of-bounds bcrypt cost, nonroot base URLs,
non-verified DB TLS mode, and missing/invalid
public CA material. It prints field names, never their values.
It cannot prove credentials work, migrations are correct, SMTP delivers, or
application security is complete. Authenticated production DB login/app startup
can mutate data; do not use it as a harmless read-only test.

For subsequent code/config updates, explicitly stop the API in the agreed window,
rerun setup with the updated trusted source and same network options, then
explicitly restart after review. Back up root-only host configuration securely;
cleanup old releases only after deciding the rollback/retention window.

## Administrator database CLI

The installed `mysql` command is the **MariaDB client**, usable with RDS MySQL.
It does not consume the application's `DB_*` / `DB_TLS_*` environment variables.
For approved debugging, use a schema-restricted read-only account where possible.
Replace the example endpoint, username and schema with the approved values:

```bash
MYSQL_HISTFILE=/dev/null mysql --no-defaults \
  --protocol=TCP \
  --host=your-instance.region.rds.amazonaws.com --port=3306 \
  --user=your_read_only_user --password \
  --database=your_approved_schema \
  --ssl --ssl-ca=/etc/pki/renaissance-academy/rds-us-west-2-bundle.pem \
  --ssl-verify-server-cert --tls-version=TLSv1.2,TLSv1.3 \
  --skip-reconnect --skip-auto-rehash --local-infile=0
```

Use the **actual RDS DNS endpoint**, not an IP or tunnel alias, so certificate and
hostname verification can succeed. MariaDB requires `--ssl-verify-server-cert`;
`--ssl` alone is not identity verification. Oracle MySQL instead uses
`--ssl-mode=VERIFY_IDENTITY`; do not interchange the two clients' flags. See the
[MariaDB client reference](https://mariadb.com/docs/server/clients-and-utilities/mariadb-client/mariadb-command-line-client)
and [database TLS guide](../docs/it/database-tls.md).

`--no-defaults` must be the first client option and avoids loading saved option
files. `--password` without a value prompts privately; never put the password in
arguments or source the application's `.env`. SQL history is disabled for this
invocation; this does not disable server/audit/session logging. Do not copy family
records or credentials into chat or logs. Installing the client does not grant DB
access or authorize SQL changes. Do not disable TLS verification if connection fails.

For an already-prepared host, an operator can install just the client with
`sudo dnf install mariadb105`, then check `mysql --no-defaults --version`, without
rerunning application builds or starting a database server. That is a separate
live host action; the script change does not install it remotely by itself.

## Local verification (no host changes)

```bash
python3 -m unittest discover -s infrastructure/tests -p 'test_setup_host.py'
npm run build
npm test
```

The Python tests simulate privileged commands and validate copying, idempotency,
secret preservation, startup guards and templates. They are **not** evidence of
a real dnf/nginx/systemd run on AL2023. Verify those on the EC2 when you approve
running the script; generating it does not authorize remote execution.

Reference: [Node.js packages and namespaced executables in AL2023](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html).
