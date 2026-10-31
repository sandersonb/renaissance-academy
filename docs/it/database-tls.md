# Verified database TLS

Every new MySQL entrypoint (API, migrations, cycle initialization, admin creation,
roster import, sample seeding and the TLS diagnostic) uses one transport policy.
It requires **certificate-chain and DNS-hostname verification**, TLS 1.2 or newer,
and an explicit public CA file. There is no plaintext retry or verification-off
production option. OS CA packages alone do not enable MySQL TLS.

## Production and isolated RDS preview

Configure these alongside explicit `DB_USER`, `DB_PASSWORD`, `DB_NAME` and optional
`DB_PORT` (default 3306) in the appropriate protected process environment:

```ini
NODE_ENV=production
DB_HOST=REPLACE_WITH_ACTUAL_RDS_DNS_ENDPOINT
DB_TLS_MODE=verify_identity
DB_TLS_CA_FILE=/etc/pki/renaissance-academy/rds-us-west-2-bundle.pem
```

`verify_identity` is the code default even when the mode is omitted. The prepared
host's startup validator additionally requires it explicitly. Use the actual RDS
DNS endpoint, not an IP, SSH-tunnel `localhost` alias, or arbitrary CNAME: the name
must match the server certificate. Missing, unreadable, malformed, non-CA or
private-key PEM input is refused. No credentials belong in CLI flags, Git or logs.

The [host installer](../../infrastructure/HOST_SETUP.md) downloads the official
[Oregon public CA bundle](https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem)
over verified HTTPS, validates it before atomic publication, and makes it
root-owned mode 0644 under a mode-0755 public directory. It contains **no private
key or password**. The API can read it without access to the root-only `.env`
directory. A valid cached bundle is preserved; a malformed existing file is
refused, not silently replaced. Existing `.env` contents are never upgraded or
overwritten: operators must add the TLS fields themselves if absent.

Use separate, schema-restricted runtime and migration accounts, and preview-only
credentials/schema plus test mail for preview. TLS does not confer SQL privileges
or authorize migrations. Never run seeds, roster replacement, application startup
or a lottery as a transport test against production.

## Optional server transport is not optional client verification

RDS MySQL can accept both encrypted and nonencrypted clients when
`require_secure_transport=OFF` ([AWS reference](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-ssl-connections.require-ssl.html)).
That permits the retiring AL1 client to keep its existing behavior while every
new client independently requires verified TLS. No RDS parameter, CA selection,
user requirement or legacy client was changed by this implementation.

Global enforcement and any per-user `REQUIRE SSL` changes require separate
approval and a check of legacy account sharing/compatibility. `REQUIRE SSL` alone
does not make a client verify the server's identity. Control-plane engine-default
metadata is not proof of the effective SQL setting or AL1's negotiated cipher;
those live checks remain operator work.

For manual SQL debugging, the host installer also provides the MariaDB `mysql`
CLI. It uses `--ssl --ssl-ca=... --ssl-verify-server-cert` rather than Oracle
MySQL's `--ssl-mode=VERIFY_IDENTITY`; see the
[administrator CLI example](../../infrastructure/HOST_SETUP.md#administrator-database-cli)
for TLS 1.2+, password prompting and disabled local SQL history. The client does
not consume `DB_TLS_*`, and package installation never opens a DB connection.

## Read-only session diagnostic

Development checkout, with approved DB/TLS variables already in the environment:

```bash
npm run db:check-tls -- --help
npm run db:check-tls
```

On the prepared EC2, use the compiled tool (tsx is pruned). An operator may create
a separate root-owned mode-0600 **Node env-file** containing approved diagnostic
credentials and the TLS variables above. Run from a clean environment so exported
variables cannot silently override the file:

```bash
sudo env -i PATH=/usr/bin:/bin /usr/bin/node-22 --env-file=/root/enrollment-tls-check.env /opt/renaissance-academy/current/dist/app/cli/checkDbTls.js
```

Node env-file syntax differs from the service's systemd EnvironmentFile syntax;
quote secrets containing `#` or whitespace. Do not source or print either file.
Run the check from the approved VPC host with the intended runtime account and
separately with the migration account before rehearsal/apply. Do not open MySQL
ingress or disable verification just to run it from a workstation.

The tool reads only selected database, server version, global transport requirement,
and session `Ssl_cipher` / `Ssl_version`. It does not read application records,
create migration history, apply SQL files, initialize settings or start workers.
Success requires `encrypted: true`, `certificate_and_hostname_verified: true`, a
nonempty cipher, and `TLSv1.2` or `TLSv1.3` in verified mode. The server requirement
may still be `0`; that does not weaken the new client's checks. Failure exits
nonzero with sanitized diagnostics; it never retries without TLS.

## CA lifecycle and failures

Monitor RDS certificate/CA expiry and AWS rotation notices separately from the
website's Let's Encrypt certificate. Use the current official regional roots,
not a pinned leaf certificate or a server private key. See
[AWS's CA and rotation guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).

In an approved maintenance window:

1. Retain the previous **public** bundle securely and review the updated bundle.
2. Explicitly stop the API, then rerun the trusted installer with the same source,
   proxy/admin options and `--rds-region us-west-2 --refresh-rds-ca`. Refresh is
   refused while the API is active. Setup never restarts it or changes RDS.
3. If an existing bundle is malformed, inspect and quarantine that specific file
   explicitly before re-provisioning; do not overwrite unknown material blindly.
4. Run the read-only verified diagnostic with each approved account. After review,
   explicitly restart the API and recheck. Pools retain CA bytes in memory, so a
   file replacement alone does not update a running pool.

On failure, check the CA path/read permissions, certificate dates/system clock,
actual endpoint hostname, network path and server TLS support. Repair the cause;
never set `rejectUnauthorized: false`, suppress hostname checks, or downgrade.

## Local development and tests

Plaintext needs **both** `DB_TLS_MODE=disabled` and `NODE_ENV=development` or
`test`, with destination exactly `localhost`, `127.0.0.1`, `::1` or the repository's
local Compose service `db`. It is rejected for production and remote destinations,
including RDS. `.env.example` and Compose deliberately use this local exception;
do not copy them unchanged into production or remotely hosted staging.

The npm/tsx commands do not auto-load `.env`. For a local file, explicitly use
Node's `--env-file` (or set the process environment), for example:

```bash
node --env-file=.env --import tsx src/app/cli/checkDbTls.ts
```

`npm run test:functional` requires Docker and OpenSSL. It generates short-lived
test certificates and runs owned disposable MySQL 8.4.11 containers over verified
TLS, including wrong-CA/hostname/TLS-unavailable refusals and a separate legacy
plaintext probe on an optional-transport server. It never uses operator DB_*
credentials or RDS. Passing it is local proof, not live EC2/RDS validation.
