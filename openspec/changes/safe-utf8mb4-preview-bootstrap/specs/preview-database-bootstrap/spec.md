# Preview database bootstrap

## Purpose

Provide an explicit, non-destructive initialization path for the isolated fresh
preview while preserving production migration integrity and full-Unicode storage.

## ADDED Requirements

### Requirement: Preview-only explicit initialization
Initialization SHALL default to read-only inspection and SHALL permit writes only
with explicit apply to the existing enrollment_preview schema using the agreed
utf8mb4_unicode_ci default and shared verified transport policy.

#### Scenario: Wrong or populated target
- **WHEN** a different schema, incorrect default, or preexisting schema objects are found
- **THEN** initialization refuses before creating history or modifying data

### Requirement: Preserve existing migration identities
Initialization SHALL execute the existing migration inputs under their unchanged
checksums and SHALL NOT silently rewrite SQL, baseline history or mutate production.
Preview-specific assets SHALL have a recorded immutable initialization checksum.

#### Scenario: Fresh Unicode preview
- **WHEN** an approved empty preview is explicitly initialized
- **THEN** base tables, reference fixtures and tracked additive migrations are created,
  all application text storage is utf8mb4_unicode_ci, and supplementary characters round trip

### Requirement: Fail-closed interruption and repetition
Initialization SHALL use the schema migration lock and durable running/applied/failed
history. Partial failure, interruption and repeated apply MUST NOT replay base SQL,
reset records, or be mistaken for a ready application database.

#### Scenario: Failure after migration completion
- **WHEN** finalization fails after additive migrations have completed
- **THEN** API startup, cycle initialization and ordinary operator migration apply
  refuse until the bootstrap problem is explicitly resolved by an operator

#### Scenario: Competing operator
- **WHEN** another cooperative operator owns the schema lock
- **THEN** initialization refuses without writes

### Requirement: Scoped and inert operator handoff
Initialization SHALL work without DROP, LOCK TABLES, CREATE VIEW or administrative
privileges and SHALL NOT create accounts, families, active cycle settings or jobs.
Required foreign-key privileges and live execution gates SHALL be documented.

#### Scenario: Completed initialization
- **WHEN** initialization finishes successfully
- **THEN** cycle settings remain uninitialized and API/workers remain stopped;
  inspection and repeated-apply refusal preserve later synthetic preview data
