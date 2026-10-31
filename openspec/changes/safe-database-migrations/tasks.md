# Tasks

## 1. Migration engine and survey preservation

- [x] 1.1 Implement immutable discovery/history, read-only inspection, session lock, explicit apply and blocked failure states; verify unit and real-MySQL repeat/failure/lock/checksum tests.
- [x] 1.2 Replace replayable survey SQL with a checksummed reviewed catalog backfill; verify content/IDs/answer preservation and conflict rejection against MySQL 8.4.
- [x] 1.3 Add explicit audited manual-completion acknowledgement and document recovery limits; verify dry-run and mutation precondition tests.

## 2. CLI, initialization and startup

- [x] 2.1 Make migration CLI read-only by default with validated explicit DB configuration; verify argument/diagnostic tests and compiled CLI help.
- [x] 2.2 Separate insert-only cycle initialization from migration 006; verify explicit flags, no-write default, overwrite refusal and startup refusal for missing settings/history.
- [x] 2.3 Update dev/IT/host commands and Docker/test initialization to the new explicit flow; verify no active instructions claim silent replay is safe.

## 3. Integrated validation

- [x] 3.1 Run actual disposable MySQL 8.4 migration and application functional suites without touching existing containers, RDS or legacy code; record pass/skip/block status.
- [x] 3.2 Run unit tests, backend/frontend builds, typecheck and strict OpenSpec validation; update the private cutover checklist with implementation versus production-execution status.
