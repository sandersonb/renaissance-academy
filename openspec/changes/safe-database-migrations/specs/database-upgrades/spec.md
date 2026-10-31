# Database upgrades

## Purpose

Provide explicit, auditable database upgrades that preserve existing enrollment
content and stop safely when changes are incomplete or no longer match their history.

## ADDED Requirements

### Requirement: Read-only inspection and explicit writes
The tools SHALL report the selected database and pending/history state without
schema or data writes by default. All mutation commands MUST require `--apply`.

#### Scenario: Inspect a database without history
- **WHEN** an operator invokes migration inspection on a legacy database
- **THEN** pending changes are reported without creating a history table

### Requirement: Immutable serialized upgrade history
The system SHALL serialize migration writers per schema, record each started and
completed file with its checksum, skip applied files and reject history drift.

#### Scenario: Repeat an upgrade
- **WHEN** all migration files have been successfully applied without edits
- **THEN** a subsequent apply performs no migration SQL or reference-data changes

#### Scenario: Concurrent or changed upgrade
- **WHEN** another writer holds the lock or a recorded file is changed/missing
- **THEN** the attempt refuses without executing pending migration SQL

### Requirement: Fail-closed operator-reviewed recovery
The system SHALL retain unresolved failure/interruption state and block further
upgrades. It MUST NOT suppress SQL errors, automatically replay partial files or
claim a whole-file DDL rollback. Manual completion requires explicit acknowledgement,
the matching checksum, a recorded reason and `--apply`.

#### Scenario: Failure after committed DDL
- **WHEN** a later statement fails after an earlier schema statement committed
- **THEN** the partial change remains visible, the migration is unresolved, and
  another apply is blocked pending operator-reviewed completion

### Requirement: Preserve existing survey content
Upgrades SHALL preserve question content, existing option identities/labels and
saved answer associations. Only reviewed new metadata and identical legacy-visible
choices absent from storage SHALL be backfilled; unexpected mappings MUST stop.

#### Scenario: Changed or unrecognized catalog
- **WHEN** live question identifiers/kinds or stored hardcoded-choice content
  conflict with the reviewed migration mapping
- **THEN** the tool reports the conflict instead of replacing, deleting or merging
  the catalog with repository fixture data

### Requirement: Explicit insert-only cycle initialization
Schema migration SHALL NOT select the school year or open enrollment. Initial
configuration MUST require explicit year/open/post values and `--apply`, refuse
to overwrite existing settings, and leave future changes to approved staff operations.

#### Scenario: Initialization is omitted or repeated
- **WHEN** production startup has no initialized settings row
- **THEN** startup refuses without bootstrapping values or writing migrations
- **WHEN** initialization is requested for an already initialized database
- **THEN** the existing settings remain unchanged
