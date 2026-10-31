# Design

## Context

See proposal.md. Eight SQL migrations target an existing legacy MySQL schema;
none have reached production. Preserve the existing SQL/mysql2 approach and the
operator's separate preview schema. MySQL 8.4 DDL commits per statement, not per file.

## Goals / Non-Goals

**Goals:** explicit writes, strict immutable history, bounded serialization,
preserved survey identities/content, observable partial failure, manual recovery,
and independent insert-only initial cycle configuration.

**Non-Goals:** automatic down/resume, production baselining or execution, new ORM,
general SQL parsing, TLS rollout, other authentication/concurrency fixes, cloud changes.

## Decisions

- Discover ordered SQL files and hash their bytes plus any reviewed companion
  catalog manifest. Reject duplicate sequence IDs, missing/changed recorded files,
  gaps in applied history and unresolved running/failed states. Inspection queries
  only metadata/history; it must not create even the ledger.
- Use one dedicated mysql2 connection and schema-specific `GET_LOCK` with zero
  wait. Acquire it before any writes, re-inspect under lock, release/close in finally.
  Store filename/checksum, state, timestamps, actor, sanitized failure code and
  manual-completion reason/actor. A crash leaves running, which blocks replay.
  Write sessions enable STRICT_ALL_TABLES locally; inspection changes no session
  mode and no global server configuration is altered.
- Execute trusted complete SQL files using a migration-only multi-statement
  connection rather than splitting on semicolons/comments. Runtime pools remain
  unchanged. Roll back any open DML transaction on error without claiming DDL rollback.
- Reject untracked new-app artifacts when introducing the ledger; no blanket
  duplicate-error suppression or automatic adoption. Disposable older test DBs
  can be rebuilt; production discrepancies require an explicit investigation.
- Migration 002 keeps widening DDL; a versioned JSON companion defines reviewed
  legacy rendering mappings and identical hardcoded options. Preflight validates
  identifiers/briefs/kinds and flags unexpected options instead of replacing them.
  Preserve question text/grade/active state, existing option IDs/labels and answers.
  Validate transactional storage and the reviewed column widening to avoid shrink/
  charset loss. Lock reference rows while backfilling metadata/missing identical
  choices in a DML transaction. A human must still verify hardcoded live choices.
- Migration 006 creates only the table. `db:init-settings` previews by default;
  writing requires `--apply`, explicit year/open/post flags and a current clean
  migration history. Insert id=1 only; existing settings are never overwritten.
- Production startup reads migration status and requires a valid settings row;
  it never upgrades or initializes the database and does not mask settings errors.
- Recovery marks an interrupted/failed file complete only after operator manual
  verification, exact checksum, nonsecret reason, explicit acknowledgement and
  `--apply`; it executes no migration SQL and never changes an applied checksum.

## Risks / Trade-offs

- [DDL remains after error] → durable running state, block replay; inspect/complete
  manually or restore an approved backup. Recovery is an acknowledgement, not proof
  of arbitrary SQL effects; the operator must verify completion first.
- [Live catalog differs from reference] → conflict report and staff-reviewed mapping
  before migration; no guessing or fixture replacement.
- [Shared preview RDS resources] → tests use isolated disposable local containers;
  no production stress tests or credentials. Preview grants remain an operations task.
- [CLI defaults change] → update every active guide/dev/test call together; no boot migrations.
- [Strict startup history constrains rollback] → a rollback artifact must carry
  the matching approved catalog and compatible code. A release missing a later
  applied file is refused; no assumption that arbitrary older tags still start.

## Migration Plan

Implement and test locally on MySQL 8.4, then rehearse on the approved isolated
preview schema. Preserve backup/target review gates before the first production
apply. No automatic baseline for previously hand-migrated databases. SQL/catalog
files become immutable once applied; corrections after production use new files.
Schema rollback is operator-controlled; compatible application rollback is preferred.
