# Rebuild the Perl enrollment app as React/TypeScript

> **Catch-up record.** This documents the full rebuild retroactively so the current
> state is captured in OpenSpec. It will be **archived at production cutover**, at
> which point its specs become the deployed baseline in `openspec/specs/`.

## Why

The production enrollment-lottery app is legacy Perl/CGI with security and
maintainability problems: passwords stored with DES `crypt()`, `/admin` reachable
from any IP, hard-coded admin credentials, phpMyAdmin exposed, registration PDFs on
a public S3 bucket, unseeded/unauditable lottery, and email sent by fragile crons
that hit Gmail limits. The school needs a maintainable, secure system with in-app
data management (no phpMyAdmin) that preserves the established enrollment behavior.

## What Changes

A behavior-first React/TypeScript rebuild on the **same MySQL schema** (additive-only
migrations), so the Perl app remains a warm rollback during cutover.

- **Parent portal** — register/confirm/login (anti-enumeration, `crypt()`→bcrypt
  upgrade), add/re-enroll students, data-driven surveys, accept/decline offers,
  waitlist position, download entitled registration paperwork.
- **Lottery** — capacity- and sibling-aware draw with an **illustrative preview whose
  seed is never reused** for the official run (fairness/legal requirement), a
  recorded/auditable official run, a post-lottery re-run guard, and run history.
- **Admin console** — IP-restricted dashboard, family/student CRUD with guarded +
  forced status changes and audit notes, current-student roster CRUD, editable grade
  capacity, survey management, survey reports with CSV export, staff-account
  management, and cycle settings. **phpMyAdmin removed.**
- **Notifications** — transactional email outbox with a Gmail-safe paced worker
  (batch + spacing + daily cap + back-off) and daily de-duplicated reminders.
- **Documents** — admin-uploaded registration packets stored in the DB and served
  only to entitled parents, with a bundled default fallback. **Public S3 links
  removed.**
- **Annual cycle** — guarded "start a new year" (validate → purge → import) and live
  cycle gates.
- **Security** — bcrypt, IP-restricted admin (nginx + app allowlist), non-IP-pinned
  httpOnly sessions, DB-backed admin accounts (no hard-coded creds).

## Impact

- **Affected specs:** `parent-enrollment`, `lottery`, `admin-console`, `notifications`,
  `documents`, `surveys`, `annual-cycle` (all newly captured).
- **Database:** additive migrations `001`–`008`; no legacy columns changed.
- **Deployment:** new Node API + static React app behind nginx/TLS; Perl retired after
  a short cutover window (keep `DUAL_WRITE_LEGACY_CRYPT` on until then).
- **Operational change for staff:** all data management moves into the admin portal.
