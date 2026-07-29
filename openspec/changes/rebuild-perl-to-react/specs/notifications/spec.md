## ADDED Requirements

### Requirement: Transactional outbox
The system SHALL enqueue emails in the same transaction as the state change that
triggers them, and deliver them asynchronously.

#### Scenario: Offer materialization enqueues email
- **WHEN** pending offers are materialized
- **THEN** the status change and the offer emails are enqueued together; a send failure cannot lose the state change

### Requirement: Provider-safe pacing
The system SHALL bound delivery to the provider's limits via a per-drain batch size,
inter-message spacing, and a rolling 24-hour daily cap.

#### Scenario: Daily cap respected
- **WHEN** more messages are queued than the daily cap allows
- **THEN** the worker sends up to the cap and defers the rest to later windows

#### Scenario: Throttle back-off without loss
- **WHEN** the provider returns a transient/rate-limit error
- **THEN** the message stays pending (no attempt burned) and is retried in a later window rather than dropped

### Requirement: Daily reminders without duplicates
The system SHALL re-send reminders to families with open items on a daily schedule
and SHALL skip recipients who already have a pending reminder.

#### Scenario: Reminder de-duplication
- **WHEN** reminders are queued while a recipient already has a pending reminder
- **THEN** that recipient is skipped so no duplicate is queued

### Requirement: Delivery observability
The system SHALL expose outbox counts, 24-hour sent volume against the cap, and a
recent-message log filterable by state.

#### Scenario: Admin inspects the email log
- **WHEN** an admin opens Notifications
- **THEN** they see queued/sent counts, sent-in-last-24h vs the cap, and recent messages with any errors
