# Database upgrades — explicit, tracked, read-only by default

The operator reports that migrations 001–008 have **not** reached production.
The existing legacy schema remains the base; `Child` is InnoDB. Never load
`db/schema.sql` into an existing live database: it contains DROP statements.
It is a no-PII fixture for a **new disposable local/preview schema** only.

For the newly empty RDS `enrollment_preview`, **do not import that dump**. Use the
[guarded preview initializer](PREVIEW_BOOTSTRAP.md): read-only by default, fixed
preview target, explicit apply, unchanged migration identities and independently
recorded utf8mb4 finalization. Package `db/preview` with the updated release first.

## Commands

Configure DB_HOST, DB_NAME, DB_USER and DB_PASSWORD explicitly in the process
environment; DB_PORT defaults to 3306. There is no implicit root user/database,
no .env auto-loading, and no secret command-line flags. Do not source secret
files in a shell or paste credentials/output containing PII into chat.

```bash
npm run db:migrate                 # READ ONLY: target, history, pending, conflicts
npm run db:check-tls               # READ ONLY: verified transport/session metadata
npm run db:migrate -- --apply      # Explicit schema/reference-data writes
npm run db:init-settings           # READ ONLY: existing cycle (after migrations)
npm run db:init-preview            # READ ONLY: exact fresh-preview target/history
```

Initialize the first cycle separately using reviewed values (2027 below is an
**example**, not the school's approved production year):

```bash
npm run db:init-settings -- --year=2027 --lottery-open=false --post-lottery=false
npm run db:init-settings -- --year=2027 --lottery-open=false --post-lottery=false --apply
```

All three values are required to write; existing settings are never overwritten.
Normal annual changes use the separately approved staff workflow. Migration 006
does not select the calendar year or open enrollment. Production startup refuses
missing/incomplete migration history and an uninitialized/invalid cycle.

On the prepared host, dev dependencies/tsx are pruned. Use the compiled CLI with
the **migration account's** root-only environment file, not runtime credentials:

```bash
/usr/bin/node-22 --env-file=/root/enrollment-migration.env /opt/renaissance-academy/current/dist/app/adapters/mysql/migrate.js --help
```

Run from `/opt/renaissance-academy/current` so the approved SQL/catalog files are
found. Node env files do not override existing exported DB_* variables: use a
clean operator environment and always inspect the displayed target before apply.
The operator file uses Node's env-file syntax: quote secrets containing `#`,
whitespace or other special characters rather than reusing shell syntax.
The companion initializer is `dist/app/cli/initSettings.js`. No migration or
initialization is run by API boot or host setup. All new DB clients default to
`DB_TLS_MODE=verify_identity`, require an absolute public `DB_TLS_CA_FILE`, and
verify the certificate chain AND the actual DNS hostname with TLS 1.2+. Put these
fields in both runtime and migration environments. Before any RDS rehearsal/apply,
run the compiled `dist/app/cli/checkDbTls.js` diagnostic with each approved account.
See [database TLS configuration/lifecycle](../docs/it/database-tls.md), including
the restricted explicit local plaintext exception. Local proof does not authorize
live SQL or imply AL1/global TLS enforcement was changed.

## Guarantees and limits

- Bare invocation reads only: no ledger/table creation, SQL-file execution or seeds.
- `enrollment_schema_migrations` stores checksums, state, timestamps, actor and
  any audited manual-completion acknowledgement. Applied SQL and JSON companions
  are immutable. Repeated apply skips them; later staff survey edits stay intact.
- One schema-specific MySQL advisory lock covers apply, initialization and recovery
  on the same connection. A competing writer refuses rather than racing.
- Explicit writes enable STRICT_ALL_TABLES on that connection only, rather than
  relying on permissive legacy settings that can silently truncate values. Read-only
  inspection does not change session mode; no global server parameters are changed.
- Unknown/missing/changed history, out-of-order application and untracked new-app
  schema block execution. Old manually upgraded dev DBs are not silently adopted.
- SQL errors are never ignored. MySQL may commit DDL before a later failure;
  running/failed state blocks further applies even after a crash. There is **no
  automatic down migration, rollback guarantee or partial-file replay**.
- Complete trusted SQL files are executed by MySQL, not split on semicolons or
  stripped of comments. Multi-statements are enabled only on the dedicated tools'
  connection, not the API pool.
  These files are reviewed code, not a SQL sandbox: do not switch databases,
  qualify another schema, manipulate the ledger/lock, or leave transactions open.
  Use schema-restricted operator credentials. Checksums protect migration inputs,
  not against arbitrary manual schema edits made outside this workflow.
- Production startup uses the same strict catalog/history check. Code-only
  rollbacks with an unchanged catalog are straightforward; an older release that
  lacks a newly applied file is refused. Rehearse a compatible rollback artifact
  with the approved catalog or forward-fix; never rewrite applied checksums.
- Survey 002 includes its reviewed JSON in the checksum. Validate IDs/briefs/kinds
  before writes; keep question text, grades, active state, existing option IDs/labels
  and answers. Backfill new rendering metadata and identical reviewed legacy
  hardcoded choices only. Unexpected mappings/options block for staff review.
  Reference/history storage must be InnoDB. Column storage is checked before widening to avoid shrinking an already-wider
  custom column or converting an unexpected charset/constraint. Its DML backfill
  locks survey rows while validating/updating. Before the first real apply, staff
  must compare the JSON with the current legacy form: DB metadata cannot prove
  the content of choices still hardcoded in Perl. No live catalog review has been
  performed merely by passing disposable fixture tests.

## Operator-reviewed recovery

1. Stop other deployment activity and inspect the target/history and actual schema
   using the approved release SQL and checksum. Preserve logs/backups. A running
   record can mean an active operator, not just an interruption: confirm the
   operator/lock is no longer active before manual work. Connection loss leaves
   unresolved state, not permission to replay.
2. Decide whether to finish the intended effects with separately approved manual
   SQL, restore/reconcile an approved backup, or rebuild **only a disposable** test
   schema. Do not drop production, edit history by hand, or blindly rerun the file.
3. If manually completed, verify **all** effects, including the survey JSON backfill
   where applicable. The tool cannot prove arbitrary manual repairs for you.
4. Preview an acknowledgement using the filename/checksum printed by inspection
   and a nonsecret verification reason. This still reports the unresolved state:

```bash
npm run db:migrate -- --repair FILENAME.sql --checksum SHA256 --reason 'Verified all intended effects against approved release'
```

5. Only after verification, repeat with `--acknowledge-manual-verification --apply`.
   This records completion/actor/reason; **it executes no migration SQL**. It only
   accepts a matching running/failed file, never rewrites an applied checksum, and
   refuses other history problems. An acknowledgement is not an automatic repair.

Inspection exits nonzero when blockers exist. Diagnostics intentionally omit raw
mysql2 errors/SQL/parameters; inspect sensitive server diagnostics privately when
needed. Reasons must not contain credentials or family data.

## Validation and release gate

Forward migration 009 adds version-bound modern sessions and forces modern
re-login once. See [session lifecycle and upgrade guide](../docs/it/session-security.md).
Use normal `db:migrate` for an existing preview; never rerun bootstrap or rewrite
its historical checksum to adopt a newer catalog. Cycle settings/data are preserved.

`npm run test:migrations` runs real MySQL 8.4.11 in a uniquely named disposable
Docker container, bound only to localhost on an ephemeral port. It never uses
DB_* from your environment, touches RDS, or removes pre-existing containers.
Docker is required; failure to run is not silently reported as a successful skip.
`npm run test:functional` additionally exercises application flows on 8.4.11.
The harness uses generated test certificates and verified TLS; OpenSSL is required.
It also tests optional-server legacy coexistence and wrong-CA/hostname/no-TLS
refusals without fallback. No production transport setting is changed.

Before production: rehearse on the isolated preview schema with schema-restricted
credentials and test mail; review actual catalog conflicts, intended cycle values,
backup/restore, target, privileges and TLS. No production SQL is authorized merely
because the local tests or build pass. See the Git-excluded cutover checklist.
