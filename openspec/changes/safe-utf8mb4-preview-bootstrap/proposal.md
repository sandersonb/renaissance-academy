# Proposal

## Why

The isolated preview database is empty, while existing additive migrations require
legacy base tables. Importing the old dump would need unnecessary destructive/view
privileges and its explicit charsets would override the agreed UTF-8 default.

## What Changes

- Add a preview-only initialization CLI: inspection by default, explicit apply,
  fixed `enrollment_preview` target, empty-schema and utf8mb4/collation guards.
- Execute reviewed fresh-base SQL, unchanged migrations 001–008 and a separately
  checksummed preview UTF-8 finalization under the existing schema advisory lock.
- Persist bootstrap running/applied/failed history, reject repeat/nonempty applies,
  and block normal migration/cycle/startup readiness after incomplete bootstrap.
- Package the reviewed SQL with releases and document scoped privileges, failure
  handling and operator-only live handoff. No accounts, cycle settings or mail start.

## Capabilities

### New Capabilities
- `preview-database-bootstrap`: guarded fresh-preview initialization and explicit
  full-Unicode finalization without changing the production migration catalog.

### Modified Capabilities
None; the main spec inventory is empty.

## Impact

New SQL assets, bootstrap engine/CLI, small migration-readiness integration, host
source allowlist, docs and disposable MySQL 8.4.11 tests. No new dependencies,
existing migration-byte changes, AWS/RDS operations, production conversion or old/ access.
