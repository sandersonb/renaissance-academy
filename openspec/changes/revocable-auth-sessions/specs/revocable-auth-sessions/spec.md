# Revocable authentication sessions

## Purpose

Ensure modern parent and staff sessions lose authorization when their account's
security state changes, including concurrent credential verification and reset.

## ADDED Requirements

### Requirement: Effective admin revocation
Admin deactivation SHALL invalidate all existing modern sessions. Reactivation
MUST NOT restore prior tokens. Self-deactivation and concurrent removal of the last
active admin SHALL be refused without partially changing account/session state.

#### Scenario: Deactivate and reactivate
- **WHEN** an administrator is disabled and later re-enabled
- **THEN** old tokens remain unauthorized and a fresh login is required

#### Scenario: Competing deactivations
- **WHEN** concurrent changes would remove every active administrator
- **THEN** at least one administrator remains active and rejected changes roll back

### Requirement: Atomic single-use password reset
Successful reset SHALL consume the token, update credentials and invalidate all
modern parent sessions atomically. Expired/reused tokens and failed mutations
MUST NOT partially change credentials, tokens or session authorization.

#### Scenario: Reset races and failure
- **WHEN** two resets use one token or a write fails during reset
- **THEN** at most one reset succeeds and failed transactions preserve prior state

### Requirement: Race-safe session issuance
Sessions SHALL be issued and authorized against current account security state.
Credential checks or legacy upgrades begun before revocation MUST NOT create valid
post-revocation sessions or overwrite a concurrent password reset.

#### Scenario: Late login after security change
- **WHEN** credential verification finishes after password reset or admin state change
- **THEN** it cannot restore authorization from the stale credential snapshot

### Requirement: Forward-only isolated upgrade
The session upgrade SHALL preserve previous migration checksums, account/family
data and legacy cookies, while invalidating modern sessions once. Deployment,
schema writes and activation SHALL remain separately approved operator actions.

#### Scenario: Repeat migration application
- **WHEN** an applied upgrade is inspected or applied again
- **THEN** its checksum/history remain unchanged and fresh modern sessions are not deleted
