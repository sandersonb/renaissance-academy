## ADDED Requirements

### Requirement: Parent account registration and confirmation
The system SHALL let a parent/guardian create a single account and SHALL require
email confirmation before login.

#### Scenario: New family registers
- **WHEN** a visitor submits valid registration details (name, contact, username, password)
- **THEN** the system creates a PENDING user + parent record and enqueues a confirmation email with an expiring token

#### Scenario: Registration is transactional
- **WHEN** any step of registration fails (e.g. the confirmation cannot be enqueued)
- **THEN** the whole account creation is rolled back, leaving no orphaned user or parent

#### Scenario: Confirmation activates the account
- **WHEN** the parent opens the confirmation link (completing any confirmation-time survey questions)
- **THEN** the account becomes CONFIRMED and login is allowed

### Requirement: Non-enumerating authentication
The system SHALL NOT reveal whether a username or account exists during login or
password recovery.

#### Scenario: Wrong password vs unknown user
- **WHEN** login is attempted with a wrong password OR an unknown username
- **THEN** the system returns the identical generic "invalid username or password" result

#### Scenario: Password reset does not disclose existence
- **WHEN** a password reset is requested
- **THEN** the reset email is sent only if the username+email match, and the response is the same either way

### Requirement: Legacy password compatibility with upgrade
The system SHALL verify legacy `crypt()` passwords and upgrade them to bcrypt on
successful login.

#### Scenario: Legacy user logs in
- **WHEN** a user with only a legacy `crypt()` hash logs in successfully
- **THEN** the password is re-hashed with bcrypt and stored for subsequent logins

### Requirement: Adding and re-enrolling students
The system SHALL let a confirmed parent add new applicants (entered into the lottery
as INITIAL) and re-enroll current students by exact roster match.

#### Scenario: New applicant
- **WHEN** a parent adds a student with an eligible grade/age
- **THEN** the student is created as an INITIAL applicant

#### Scenario: Returning student matched to roster
- **WHEN** a parent adds a current student whose name + date of birth match the current-student roster
- **THEN** the student is re-enrolled with the grade taken from the roster (not parent input)

#### Scenario: Returning-grade guard
- **WHEN** re-enrollment would apply to a student outside the allowed returning grades
- **THEN** the system rejects it (Kindergarten cannot be returning; a current 9th grader cannot re-enroll)

### Requirement: Offers, decline, and waitlist visibility
The system SHALL let a parent accept or decline an offer and SHALL show waitlist
position where applicable.

#### Scenario: Accept an offer
- **WHEN** a parent accepts an offer (answering any required registration survey questions)
- **THEN** the student moves to Awaiting Paperwork with a paperwork deadline

#### Scenario: Waitlist position shown
- **WHEN** a student is waitlisted
- **THEN** the dashboard shows their position, with sibling-waitlist ranked ahead of the regular waitlist

### Requirement: Registration paperwork download
The system SHALL show a parent only the registration packets they are entitled to,
as downloadable links, and SHALL NOT accept parent uploads.

#### Scenario: Entitled parent downloads a packet
- **WHEN** a parent has an admitted (Awaiting Paperwork) or returning student
- **THEN** the portal lists the relevant family + grade packets for download

#### Scenario: No parent upload path
- **WHEN** a parent views paperwork
- **THEN** completed forms are handled off-site (email/in person); the site provides no upload
