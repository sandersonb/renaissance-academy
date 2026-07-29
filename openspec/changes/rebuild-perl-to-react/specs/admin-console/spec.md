## ADDED Requirements

### Requirement: IP-restricted admin access
The system SHALL restrict the admin UI and admin API to approved networks (nginx
edge allow/deny plus an app-level allowlist as defense-in-depth).

#### Scenario: Request from a disallowed IP
- **WHEN** an admin route is requested from an IP outside the allowlist
- **THEN** the request is rejected before reaching application logic

### Requirement: Enrollment dashboard
The system SHALL present enrollment by grade × status with per-grade capacity and
open seats, drill-down to the underlying students, and status explanations.

#### Scenario: Drill into a count
- **WHEN** an admin clicks a status/grade count on the dashboard
- **THEN** a filtered list of the exact students behind that count is shown

#### Scenario: Waitlist ordering in drill-down
- **WHEN** a waitlist is viewed
- **THEN** students appear in true offer order (sibling-wait ahead of regular wait, by position)

### Requirement: Family and student management
The system SHALL let an admin view a family, edit the parent and students, add/delete
students, change status through valid transitions, force a raw status for cleanup,
and record notes — all logged.

#### Scenario: Guarded status change
- **WHEN** an admin changes a student's status via the dropdown
- **THEN** only valid next transitions are offered, side-effects are applied, and a note is recorded

#### Scenario: Forced status override
- **WHEN** an admin forces a raw status
- **THEN** the change bypasses the transition matrix and is recorded as an auditable note

#### Scenario: Family mutations are atomic and audited
- **WHEN** an admin edits a parent/student, adds, or deletes a student
- **THEN** the change and its audit note commit together

### Requirement: Current-student roster management
The system SHALL provide full CRUD over the current-student roster used for
re-enrollment matching, filterable by grade and name.

#### Scenario: Correct a returning student before re-enrollment
- **WHEN** an admin edits a roster student's name, DOB, or grade
- **THEN** the change persists and is used for subsequent re-enrollment matches

### Requirement: Editable grade capacity
The system SHALL let an admin view and edit per-grade capacity (MaxEnrollment), used
by the dashboard and the lottery.

#### Scenario: Update caps
- **WHEN** an admin saves new per-grade caps
- **THEN** they persist and become the dashboard's Max Slots and the lottery's default caps

### Requirement: Staff account management
The system SHALL let an admin list, create, and deactivate admin accounts, with
safeguards.

#### Scenario: Create and deactivate admins
- **WHEN** an admin creates a new admin (username + 8+ char password) or deactivates one
- **THEN** the change applies, except deactivating one's own account or the last active admin is refused; password hashes are never returned

### Requirement: Survey results reporting
The system SHALL report survey answers as a per-question tally and a filterable list
of individual responses, exportable to CSV.

#### Scenario: Export responses
- **WHEN** an admin filters responses and exports
- **THEN** a CSV of the filtered responses is produced

### Requirement: Enrollment cycle settings
The system SHALL let an admin view and toggle the cycle gates (lottery-open,
post-lottery), effective immediately.

#### Scenario: Toggle a gate
- **WHEN** an admin toggles lottery-open or post-lottery
- **THEN** the change persists and takes effect across the app without a restart
