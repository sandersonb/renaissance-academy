# Proposal

## Why

Disabled admins retain authorized sessions and password reset leaves existing parent
sessions valid. Deletion alone cannot stop late logins from recreating stale access.

## What Changes

- Add version-bound modern sessions with atomic conditional issuance and current
  principal/activity/version checks in memory and MySQL adapters.
- Make admin state changes, last-active protection and session deletion transactional.
- Make password reset a single-use, transactional credential/version/token/session
  update; protect legacy bcrypt upgrade from overwriting a concurrent reset.
- Add forward migration 009; preserve 001–008 bytes and clear only modern sessions
  once during upgrade, requiring re-login. No legacy-cookie or family-data deletion.
- Add concurrency/rollback/HTTP regression tests and stopped-host upgrade guidance.

## Capabilities

### New Capabilities
- `revocable-auth-sessions`: effective session invalidation across lifecycle changes
  with race-safe issuance and single-use password reset.

### Modified Capabilities
None; the main spec inventory is empty.

## Impact

Auth/admin services, repository ports/adapters, a forward SQL migration and tests/docs.
No new dependencies, live SQL, deployment, old/ access, cookie/rate/CSRF changes,
SMTP activation or routing modifications in this first security slice.
