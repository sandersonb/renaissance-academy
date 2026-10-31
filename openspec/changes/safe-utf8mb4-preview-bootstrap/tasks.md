# Tasks

## 1. Guarded initialization

- [x] 1.1 Add reviewed base/finalization assets and checksum/target/empty/default guards; verify unit tests pin original 001–008 hashes and document staged UTF-8 compatibility.
- [x] 1.2 Implement explicit-apply bootstrap history, shared locking and incomplete-bootstrap readiness gates; verify real failure/interruption/repetition/concurrency tests and document manual recovery limits.

## 2. Operator and release integration

- [x] 2.1 Add the shared-TLS CLI and release asset packaging; verify real CLI inspection/apply, restricted migration/runtime grants, installer tests and compiled help; document scoped REFERENCES and protected-env handoff.
- [x] 2.2 Verify complete utf8mb4 table/column metadata and supplementary-character round trips without cycle/family/job initialization; retain legacy application/migration regressions and document preview versus production scope.

## 3. Integrated validation

- [x] 3.1 Run fast and all real MySQL suites, installer tests, typecheck/builds, strict OpenSpec and whitespace checks; update the private checklist with local evidence and unperformed live gates.

## Local validation / live boundary

149 fast tests; 50 actual MySQL 8.4.11 functional tests (13 bootstrap, 19 migration,
10 flows, 8 TLS); 23 offline installer tests passed. Backend typecheck/build,
frontend build, Python 3.9 syntax, strict OpenSpec and whitespace checks passed.
Latest compiled initializer inspection/apply also passed in a separate disposable
TLS server under scoped non-admin privileges. Original 001–008 checksums are pinned.

Reviewed handoff: db/PREVIEW_BOOTSTRAP.md. Fresh source-only archive prepared
locally; no EC2 upload/install, RDS SQL, grant change, production conversion, service
activation or old/ access occurred. Live migration grant/TLS-property review and
the additional schema-scoped REFERENCES grant need separate operator approval.
Deploy updated stopped-host release, inspect only, then approve preview apply later.
No change was committed or archived.
