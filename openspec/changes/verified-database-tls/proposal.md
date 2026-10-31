# Proposal

## Why

New application and operator connections currently have no verified TLS policy.
They must authenticate RDS's certificate and hostname without forcing the retiring
AL1 application's database connection to change.

## What Changes

- **BREAKING:** one shared, secure-by-default MySQL configuration for API, migration,
  initialization, admin, roster and seed tools. Require verified TLS in production;
  allow plaintext only through explicit local development/test configuration.
- Validate CA files, enable both certificate and hostname checks, use TLS 1.2+,
  and never retry in plaintext or offer a verification-disable switch.
- Prepare a public regional RDS CA bundle outside the secret .env directory and
  preserve operator secrets/idempotent host-setup behavior.
- Add a read-only TLS diagnostic and real MySQL positive/negative compatibility tests.
- Keep RDS global enforcement, users, AL1, schemas, credentials, DNS and services
  unchanged; optional server transport does not mean optional new-client validation.

## Capabilities

### New Capabilities
- `database-transport-security`: authenticated MySQL transport shared by every
  new entrypoint, explicit local exceptions, CA lifecycle and read-only verification.

### Modified Capabilities
None; the existing main spec inventory is empty.

## Impact

Shared MySQL configuration/pool, API and operator entrypoints, host installer,
dev configuration, docs and disposable MySQL 8.4 tests. Uses existing mysql2 and
Node/Python standard libraries; no new paid service or RDS/SQL account changes.
