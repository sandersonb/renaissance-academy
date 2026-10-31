# Proposal

## Why

The current runner replays every SQL file and suppresses errors, so repeat upgrades
can duplicate survey data and leave incomplete schemas. Before the first production
migration, upgrades need explicit approval, durable history and a safe failure path.

## What Changes

- **BREAKING:** `db:migrate` becomes read-only by default; writes require `--apply`.
- Track immutable migration checksums and running/applied/failed states, serialize
  writers with a connection-scoped MySQL advisory lock, and stop on all SQL errors.
- Block interrupted/failed/drifted histories; provide an explicit audited manual
  completion acknowledgement, never automatic DDL rollback or replay.
- Preserve survey text/options/answer associations; validate legacy mappings and
  import only reviewed identical hardcoded legacy choices absent from storage.
- **BREAKING:** separate initial year/lottery flags from migration 006; introduce
  read-only-by-default, insert-only cycle initialization and fail-closed production
  startup when migrations or initial settings are incomplete.
- Exercise the real runner against disposable MySQL 8.4 and update operational docs.

## Capabilities

### New Capabilities
- `database-upgrades`: explicit, serialized, auditable schema/reference upgrades,
  manual failure recovery, survey preservation and separate initial cycle setup.

### Modified Capabilities
None; current main specs have not yet been populated.

## Impact

Migration SQL/runner, new migration modules and initialization CLI, production
startup checks, Docker/dev/test setup and IT documentation. Retains mysql2/SQL;
no ORM, paid service, RDS execution, application activation or legacy-code edits.
No production migrations 001–008 have been run, per the operator; existing unknown
schemas will be rejected rather than silently baselined.
