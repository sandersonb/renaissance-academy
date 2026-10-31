# Design

## Context

See proposal.md. RDS provides a server certificate already; its parameter group
has engine-default require_secure_transport, documented OFF. The effective SQL
variable/AL1 session cipher have not been queried. No global setting must change.
mysql2 verifies a chain by default when TLS is used but requires verifyIdentity
explicitly for hostname checks. Its IP/SNI edge behavior is avoided by requiring
a DNS hostname for verified connections, specifically the real RDS endpoint.

## Goals / Non-Goals

**Goals:** identical fail-closed policy for all new DB entrypoints, no downgrade,
read-only proof of session encryption, public CA preparation and local negative tests.

**Non-Goals:** AL1 updates, forcing global TLS, ALTER USER, IAM auth, migrations,
schema creation, production SQL/credentials, DNS/SG changes or service activation.

## Decisions

- Centralize explicit DB fields/TLS in a shared factory used by API and all DB
  tools. DB_TLS_MODE defaults to verify_identity. Require DB_TLS_CA_FILE, parse
  only public CA certificates, and set rejectUnauthorized=true, verifyIdentity=true,
  minVersion=TLSv1.2. There is no custom servername/verification-off/fallback flag.
- disabled mode requires NODE_ENV=development/test and a literal loopback or the
  repository's local Docker service name db. Production rejects it before connecting.
  Verified mode rejects IP literals; use a DNS name in the certificate. Local TLS
  tests use localhost with a generated matching certificate.
- Keep runtime pool multi-statements disabled. Migration-only connections retain
  their explicitly approved multi-statement capability but share the same TLS policy.
- Host setup downloads the public regional CA bundle over verified HTTPS into
  /etc/pki/renaissance-academy (root-owned/readable, separate from root-only .env).
  Validate before publication, preserve a valid existing bundle and existing secrets;
  fail instead of overwriting unexpected files. Document explicit rotation/restart.
- db:check-tls connects once using the same policy and reads only database/version,
  require_secure_transport and session cipher/protocol. No app data, DDL, history,
  seeding or jobs. Live use remains an explicit operator action, not part of setup.
- Disposable MySQL 8.4 tests mount generated test certificates and explicitly
  allow both TLS/plain clients. Prove matching TLS works, bad CA/hostname and
  absent server TLS fail, and optional transport still accepts a legacy-style client.

## Risks / Trade-offs

- [Server stays optional] → new clients independently require verified TLS; after
  confirming separate DB accounts an operator can require SSL per new user without
  changing AL1. Global enforcement waits until legacy retirement and approval.
- [CA rotation] → official public bundle, root ownership, preserve existing material,
  monitor expiry and explicitly refresh/restart/recheck; never disable verification.
- [IP/tunnel aliases] → do not weaken identity checks; use the certificate's actual
  DNS hostname and execute the diagnostic from the approved VPC host.
- [Control-plane evidence is not runtime proof] → record live SQL/session check as
  pending until operator credentials/TLS diagnostic are authorized on EC2.

## Migration Plan

Implement/test locally, update host/dev/operator guides and .env examples, then
prepare CA and configure new runtime/migration credentials on EC2. Run read-only
TLS checks against the approved preview schema before any rehearsal/apply. Do not
change RDS users/parameters, old code or live services as part of implementation.
