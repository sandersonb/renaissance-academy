## ADDED Requirements

### Requirement: Capacity- and sibling-aware draw
The system SHALL offer seats up to each grade's open capacity and SHALL place the
remaining applicants on the waiting list, with sibling-considered applicants ranked
ahead of the regular waiting list.

#### Scenario: Oversubscribed grade
- **WHEN** a grade has more INITIAL applicants than open seats
- **THEN** the draw offers up to the open seats and waitlists the rest in order

#### Scenario: Seats already consumed by returning students
- **WHEN** returning students (ACPT_REENROLL) occupy seats in a grade
- **THEN** open capacity is reduced accordingly and the lottery does not change their status

### Requirement: Illustrative, non-binding preview
The system SHALL provide a preview that is explicitly a sample and SHALL NOT reuse
its seed for the official run.

#### Scenario: Preview is a dry run
- **WHEN** an admin previews the draw
- **THEN** no student status changes and no run is recorded; the result is one random sample

#### Scenario: Preview seed is never the official seed
- **WHEN** the official lottery is run after any number of previews
- **THEN** the official draw uses a fresh server-generated seed unrelated to any preview

### Requirement: Official draw is recorded and one-time per cycle
The system SHALL apply the official draw atomically, record it immutably, set the
post-lottery phase, and prevent an accidental re-run.

#### Scenario: Commit the official lottery
- **WHEN** an admin runs the official lottery
- **THEN** every applicant is placed, the run (with its seed, caps, and counts) is recorded, and post_lottery is set to true

#### Scenario: Re-run is blocked once post-lottery
- **WHEN** the lottery has already run (post_lottery is true)
- **THEN** committing another draw is rejected until an admin explicitly clears the post-lottery gate

### Requirement: Draw history
The system SHALL expose a read-only history of past runs with date, seed, and
placement counts.

#### Scenario: Admin reviews past runs
- **WHEN** an admin opens the lottery history
- **THEN** each recorded run shows its timestamp, draw seed, and offered/waitlisted/sibling-wait counts
