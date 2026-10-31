# Design

## Context

See proposal.md. Modern parent/admin sessions are separate from legacy cookies,
but lookup currently checks only expiration. All live execution remains operator-only.

## Goals / Non-Goals

**Goals:** revoke effective authorization after admin changes/password reset,
prevent late credential verification from restoring access, preserve reset atomicity,
single-use tokens and last-active-admin protection, and retain legacy verification.

**Non-Goals:** cookies/Origin/rate limits, SMTP/queue changes, routing, production
deployment, reading old/, changing previous migration bytes, or canceling requests
already authorized before revocation commits.

## Decisions

- Add integer session_version to users/admin_users and their modern session tables.
  New records start at zero. Admin state changes advance the version; repeated
  activation is a no-op, repeated deactivation still deletes lingering sessions.
  Password replacement always advances the version. Counters never wrap: exhausted
  versions reject mutation and require operator review.
- Issue sessions using one conditional INSERT SELECT against the current principal,
  expected credential-snapshot version and active/confirmed state. Lookup joins the
  principal and verifies current activity/version plus expiration. Deletion alone
  was rejected because late logins or retained rows could restore access.
- Keep expensive password hashing outside database locks. A legacy bcrypt upgrade
  uses compare-and-set on original encpass, absent/empty bcrypt and expected version;
  competing upgrades reverify the current hash, while a concurrent reset rejects.
- Reset prevalidates the token, computes hashes, then locks the user row and
  conditionally consumes the still-valid token. Token consumption, credential/version
  replacement and modern-session deletion commit/rollback together. No family,
  legacy-cookie or mail deletion occurs; existing reset issuance remains separate.
- Admin state mutation locks admin rows in id order inside a transaction; validate
  the target/acting admin, self-deactivation and last-active count from locked rows,
  then update state/version and delete target sessions. Competing deactivations
  serialize rather than removing the last active account.
- Memory adapters keep version snapshots and dynamically resolve session maps
  after rollback; serialize transactions per shared store to avoid snapshot rollback
  clobbering another transaction. MySQL uses real row locks/atomic statements.
- Forward migration 009 adds columns and deletes only modern app_sessions and
  admin_sessions once, forcing clean re-login on upgrade. 001–008 and bootstrap
  assets remain byte-identical. Existing previews upgrade via db:migrate, never
  re-bootstrap or rewrite the historical bootstrap checksum.
  Preflight requires existing authentication tables to be InnoDB; no automatic
  production engine conversion is included.

## Risks / Trade-offs

- [DDL can partially commit] → existing durable migration failure/checksum guards;
  no replay or rollback promises. API requires current clean migrations.
- [Upgrade logs modern users out] → document explicit stopped-host/operator apply;
  legacy user_cookies and account data remain intact.
- [Noncooperating manual SQL bypasses version changes] → use supported lifecycle
  operations; this is not a defense against privileged database tampering.
- [Revocation is not request cancellation] → subsequent authorization checks reject;
  operations authorized before the commit may already be in flight.

## Migration Plan

Test locally on real MySQL 8.4.11, including races, HTTP rejection and rollback
failures. Ship updated source/catalog with API stopped, inspect normal db:migrate,
approve 009 apply separately, verify preview cycle/data retained, then continue
remaining security/mail/routing gates. No live apply/activation in implementation.
