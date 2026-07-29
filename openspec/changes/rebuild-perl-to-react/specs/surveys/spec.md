## ADDED Requirements

### Requirement: Data-driven question management
The system SHALL let admins create and edit survey questions, their input types,
choices, active state, and order, taking effect immediately.

#### Scenario: Add a question that the parent flow serves
- **WHEN** an admin adds an active question with choices
- **THEN** the parent survey flow immediately serves it and stores answers

### Requirement: Two survey kinds at the right moment
The system SHALL ask lottery questions during account confirmation and registration
questions (grade-scoped) when an offer is accepted.

#### Scenario: Lottery questions at confirmation
- **WHEN** a parent confirms their account
- **THEN** the lottery questions are presented and answers stored per parent

#### Scenario: Registration questions at acceptance
- **WHEN** a parent accepts an offer
- **THEN** the grade-appropriate registration questions are presented before the student moves to Awaiting Paperwork
