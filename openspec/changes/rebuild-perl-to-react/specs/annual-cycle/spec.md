## ADDED Requirements

### Requirement: Start a new lottery year
The system SHALL, as a guarded admin action, purge the prior year's per-year data and
import a new current-student roster, atomically and only after validation.

#### Scenario: Validate before purge
- **WHEN** an admin submits a roster CSV to start a new year
- **THEN** the CSV is validated first and, only if valid, the per-year tables are purged and the roster imported in one transaction

#### Scenario: Reference data preserved
- **WHEN** a new year is started
- **THEN** survey questions, grade capacity, and uploaded documents are preserved; the cycle resets to lottery-open, pre-lottery

### Requirement: Cycle gates govern behavior
The system SHALL gate parent actions on the lottery-open and post-lottery flags, held
in `app_settings` and applied live.

#### Scenario: Closed lottery blocks new entries
- **WHEN** lottery-open is off
- **THEN** parents cannot register or add new applicants

#### Scenario: Post-lottery restricts new applicants
- **WHEN** post-lottery is on
- **THEN** offer/waitlist handling is active and only new (INITIAL) applicants are added under the post-lottery rules
