# Design

## Context

See proposal.md. The operator created an empty enrollment_preview using
utf8mb4_unicode_ci; runtime and migration TLS diagnostics passed. Production's
default is latin1, and live table encodings have not been inventoried. Existing
001–008 inputs are checksummed and must remain byte-identical.

## Goals / Non-Goals

**Goals:** initialize only the agreed fresh preview, preserve legacy migration
compatibility/history, verify all resulting text storage is full Unicode, and
make an interrupted bootstrap visibly unusable until operator recovery.

**Non-Goals:** converting production, changing 001–008 or their checksums, reading
old/, provisioning accounts, guessing cycle values, making the app production-ready,
automatic DDL rollback/resume, fixture family seeding or live SQL execution.

## Decisions

- db:init-preview accepts only --help and --apply. It rejects any DB_NAME other
  than enrollment_preview before connecting and validates the selected schema
  and utf8mb4_unicode_ci default again on the connection. Bare invocation reads
  only metadata and initialization history, never application records.
- Keep the existing dump and migration catalog unchanged. A reviewed static base
  asset creates the 13 legacy-shaped InnoDB tables in dependency order, containing
  only public reference fixtures (not the dump's old cycle row or dummy views).
  No DROP, TRUNCATE, IF NOT EXISTS, USE, database-qualified names, table locks,
  definer clauses, global changes or disabled foreign-key checks. This alternative
  avoids runtime SQL rewriting, duplicate migration catalogs or adoption of history.
- Run original migrations under their original checksums, then a separate static
  preview-only conversion asset finalizes all 21 application tables to utf8mb4 /
  utf8mb4_unicode_ci. Intermediate legacy-compatible charsets are intentional;
  no app/cycle activation is allowed before verified completion. BLOB/JSON types
  keep their appropriate binary/native semantics.
- One existing schema advisory lock spans base, migrations and finalization.
  MySQL's reentrant lock accounting permits the unchanged migration apply helper
  on the same connection; tests prove all references release. A separate bootstrap
  row stores a checksum of both assets and ordered migration identities, phase,
  actor, timestamps, state and sanitized error code before base DDL.
  Explicit writes enable session-local autocommit, constraint checks and strict
  mode to make history durable; read-only inspection leaves these settings alone.
- Normal migration inspection/readiness also recognizes the bootstrap marker.
  In-progress work is accepted only on the owning connection with a matching
  connection-local random nonce AND the held schema lock. A new connection cannot
  automatically resume a running/failed bootstrap; API and cycle checks refuse it.
- Apply requires no preexisting tables/views/visible stored objects. Repeated apply,
  partial history, unknown objects, wrong defaults or input drift refuse. Completed
  inspection stays read-only and can detect UTF-8 drift. No automatic cleanup or
  bootstrap repair command is offered; recovery is explicitly operator-reviewed.
- Preserve the user_cookies foreign key. Its fresh creation additionally requires
  schema-scoped REFERENCES; document this missing operator grant and prove it with
  restricted-user tests. Do not silently drop integrity or grant DROP/LOCK/CREATE VIEW.
  Use MEDIUMINT for cookie user_id to match users.id rather than reproducing the
  dump's inconsistent INT width, which its disabled constraint checks concealed.

## Risks / Trade-offs

- [DDL commits before later failure] → durable running/failed marker, no replay or
  automatic deletion; schema-local manual completion/rebuild is separately approved.
- [Preview differs intentionally from production charsets] → retain original
  legacy-fixture regressions and catalog hashes; no claim that preview validates a
  production Unicode conversion or actual live survey catalog.
- [Database defaults do not override explicit table SQL] → explicit finalization
  plus table/column metadata checks and supplementary-character round trips.
- [Concurrent noncooperating SQL] → advisory lock serializes cooperating tools only;
  operator must keep application/other writers stopped and inspect grants first.
- [Future migrations add storage] → bootstrap checksum and final verification make
  asset/catalog drift visible; update and rehearse the fresh initialization path.

## Migration Plan

Implement/rehearse locally; ship db/preview with the updated trusted source.
Review migration grants/TLS and add REFERENCES only with separate approval. Inspect
the exact preview target first, explicitly approve --apply later, then independently
initialize reviewed cycle settings. No API activation, live apply or production
conversion is authorized by implementation or a passing test.
