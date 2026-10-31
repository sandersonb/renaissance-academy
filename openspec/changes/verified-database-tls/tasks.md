# Tasks

## 1. Shared verified transport

- [x] 1.1 Implement the shared secure-by-default configuration and wire every new DB entrypoint; verify unit coverage for CA/mode/hostname failures and no bypass flags.
- [x] 1.2 Add read-only TLS diagnostics and document optional RDS enforcement versus client validation; verify CLI help and real session reporting without schema/data writes.

## 2. Host and development integration

- [x] 2.1 Prepare validated regional RDS CA material outside the private env directory, preserving existing files and explicit activation; verify installer/idempotency/failure tests and update host/env/dev guides.
- [x] 2.2 Extend disposable MySQL fixtures with test certificates and optional/disabled transport; verify valid TLS, untrusted CA, wrong hostname, no fallback, pool/migration/CLI consistency and legacy plaintext compatibility.

## 3. Integrated validation and handoff

- [x] 3.1 Run actual MySQL 8.4 application/migration/TLS suites, fast/installer tests, typecheck, builds and strict spec validation; record local proof separately from unperformed live SQL checks.
- [x] 3.2 Update the private checklist with read-only AWS observations, certificate lifecycle and remaining operator/account/enforcement gates; verify no AWS/user/schema/service changes were made.

## Validation evidence and live handoff

Local: 142 fast tests, 37 real MySQL 8.4.11 functional tests (10 flows, 19 migration,
8 TLS), 20 offline installer tests; backend typecheck/build, frontend build and
strict OpenSpec validation passed. Source/compiled diagnostic help and the compiled
diagnostic against an owned disposable TLS server passed. Both CA parsers accepted
the official public regional bundle. No production credentials/data were used.

Live EC2/RDS transport, effective SQL enforcement, AL1 session cipher and account
separation remain unverified. Run the approved read-only diagnostic with each
account before rehearsal/apply; local completion does not authorize SQL, host
setup/activation, RDS/user/SG/DNS changes or legacy modification. See the TLS guide
and Git-excluded cutover checklist. No change has been committed or archived.
