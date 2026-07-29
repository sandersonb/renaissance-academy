## ADDED Requirements

### Requirement: Admin-managed packet storage
The system SHALL let admins upload/replace/remove a PDF per fixed packet slot
(family, returning-family, and grade_0–grade_9), stored in the database.

#### Scenario: Upload replaces the slot
- **WHEN** an admin uploads a PDF to a slot
- **THEN** it validates as a PDF within the size limit, replaces any prior file, and becomes the served version

#### Scenario: Non-PDF rejected
- **WHEN** a non-PDF (or oversized file) is uploaded
- **THEN** the upload is rejected with an error

### Requirement: Entitlement-gated parent access
The system SHALL serve a packet to a parent only if their students' statuses entitle
them, mirroring the legacy rules, and SHALL never expose a public link.

#### Scenario: Entitlement rules
- **WHEN** a parent's entitlements are computed
- **THEN** a returning student (post-lottery) grants the returning-family packet; a new admitted student grants the (non-returning) family packet; each admitted student's grade grants that grade's packet

#### Scenario: Non-entitled request denied
- **WHEN** a parent requests a packet they are not entitled to
- **THEN** the request is denied (indistinguishable from a not-yet-uploaded packet)

### Requirement: Bundled default fallback
The system SHALL serve a bundled default packet for an entitled slot that has no
upload yet, and SHALL indicate to admins which slots are using the default.

#### Scenario: Default serves until a real upload exists
- **WHEN** an entitled parent requests a slot with no uploaded file
- **THEN** the bundled default PDF is served so the link is not broken

#### Scenario: Real upload wins
- **WHEN** a slot has an uploaded file
- **THEN** the uploaded file is served instead of the default, and the admin view shows the real file
