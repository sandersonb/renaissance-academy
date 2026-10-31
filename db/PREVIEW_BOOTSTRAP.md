# Fresh isolated preview initialization

`db:init-preview` is **not** a production migration/reset tool. It accepts only the
existing database named `enrollment_preview`, with an explicit utf8mb4 /
utf8mb4_unicode_ci default. A fresh apply requires no tables, views or visible stored
objects. Default invocation inspects metadata/history only, without creating a ledger
or reading family records. There is no database creation, force, reset or resume flag.

## Compatibility and UTF-8

The initializer executes three reviewed stages under one schema advisory lock:

1. `db/preview/base.sql`: fresh legacy-compatible InnoDB tables and public survey/cap
   reference fixtures. No families/admin accounts, old cycle row, dummy legacy views,
   DROP/TRUNCATE/LOCK TABLES, database-qualified names, disabled constraints or USE.
   The unused legacy cookie foreign key is retained; its user_id uses MEDIUMINT to
   match users.id rather than reproducing the dump's inconsistent INT width.
2. The **unchanged** migrations 001–008, followed by reviewed forward migrations, run and record their original
   checksums in `enrollment_schema_migrations`. Nothing is silently baselined or
   rewritten. Intermediate utf8mb3 storage is intentional for migration compatibility.
3. `db/preview/utf8mb4.sql`: explicit preview-only full-Unicode finalization, followed
   by table/column metadata verification. Binary BLOBs and native JSON keep their
   appropriate types. The app must remain stopped throughout these intermediate stages.

The bootstrap checksum covers both exact SQL assets and ordered migration identities.
Existing initialized previews upgrade through `db:migrate`, not this initializer;
the historical bootstrap checksum must not be rewritten when forward migrations
are added. See [session upgrade guidance](../docs/it/session-security.md).
Explicit writes enable autocommit, foreign-key checks and strict mode on their
dedicated connection so history is durable; inspection leaves session settings alone.
This changes **no production default, table, column, migration input or history**.
The old fixture remains unchanged for legacy regression tests. This is not a
production charset-conversion plan or evidence about actual production column encodings.

## Credentials and privileges

Use the separate migration account and root-only migration environment, not the
runtime `.env`. Shared verified TLS/hostname policy applies; see [TLS guide](../docs/it/database-tls.md).
Review actual `SHOW GRANTS` and selected account TLS metadata first. Required scoped
privileges: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, **REFERENCES**.
REFERENCES is additionally needed to create the legacy cookie foreign key and must
be granted separately by an approved admin; the tool never grants privileges.

For `partial_revokes=0`, the narrowly scoped additional grant is:

```sql
GRANT REFERENCES ON `enrollment\_preview`.* TO 'enrollment_migrator'@'192.0.2.42';
```

The address above is a reserved example: substitute the approved source host locally.
For `partial_revokes=1`, use the literal `enrollment_preview` identifier instead of
the escaped one. Never change that server setting just to run a grant. No DROP,
LOCK TABLES, CREATE VIEW, global privileges, GRANT OPTION or runtime grant expansion.
Use schema-scoped credentials; checking emptiness depends on metadata visibility.
Keep all other writers stopped: advisory locks coordinate cooperating tools, not
arbitrary administrative SQL or event schedulers. Inspect any unknown objects first.

## Inspection, then a separate explicit apply decision

The operator must upload the **updated trusted source** and rerun stopped-host
setup first; the earlier deployed release does not have this CLI/assets. Include
`db/preview` as well as `db/migrations`; never copy old/, secrets or dumps. Setup
does not connect to SQL or run this command. It never starts the API.

From `/opt/renaissance-academy/current`, using the separate protected Node env-file:

```bash
sudo env -i PATH=/usr/bin:/bin /usr/bin/node-22 --env-file=/root/enrollment-migration.env /opt/renaissance-academy/current/dist/app/cli/initPreview.js
```

Review the displayed target, checksum, state and issues. An empty approved target
should have state `empty`, no tables and no issues. Only after explicit review/approval,
repeat with `--apply`. The npm checkout equivalent is `npm run db:init-preview`.
Do not source/print secret files, put passwords in arguments, or substitute production
credentials or `DB_NAME=enrollment`. Account/schema isolation is not RDS resource isolation;
do not stress-test the shared production instance. Local tests are not live approval.

After success, inspect `db:migrate` and independently initialize the reviewed cycle
using `db:init-settings --apply` and explicit values. Bootstrap leaves app_settings
empty and starts no accounts, families, workers, mail or API. Other preview security,
mail-isolation, routing and service-activation gates still apply.

## Repetition and failure

`enrollment_preview_bootstrap` records running/applied/failed state, phase, checksum,
actor and timestamps. Apply on any nonempty/completed/partial schema refuses; it
never resets later synthetic preview data. Inspection of completed state is read-only.
Changed assets/catalogs or unexpected UTF-8/table metadata are reported, not adopted.

DDL can commit before a later failure. A crash may leave `running`; ordinary migration,
cycle and production-mode API readiness checks refuse incomplete bootstrap state—even
if all eight application migrations finished. The active initializer alone can run its
nested migrations, using connection-local ownership plus the held schema lock.

On failure, stop. Preserve state and diagnostics; do not replay SQL, mark history applied,
rewrite checksums, broaden grants, or delete unknown objects to make a rerun pass.
There is **no automatic bootstrap repair/resume/rollback**. An operator must review
the actual committed effects and approve either a rebuild of this disposable preview
or a fully verified manual recovery. Any destructive rebuild requires separate approval;
the bootstrap/migration user intentionally does not have DROP.

## Local verification

`npm run test:functional` requires Docker/OpenSSL and uses owned disposable MySQL
8.4.11 with generated TLS, restricted accounts, failure/interruption/concurrency checks
and four-byte Unicode round trips. It never reads operator DB credentials or connects
to RDS. Legacy application/migration suites must continue passing alongside it.
