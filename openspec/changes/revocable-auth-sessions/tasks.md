# Tasks

## 1. Versioned repositories and upgrade

- [x] 1.1 Add forward migration 009 and version-aware repository ports/adapters; verify unchanged 001–008 hashes, memory/SQL validity and scoped upgrade tests; document one-time modern-session logout and ordinary preview upgrades.

## 2. Session lifecycle services

- [x] 2.1 Implement transactional admin revocation/last-active protection and stale-login rejection; verify memory and real MySQL HTTP/race/rollback tests and document reactivation behavior.
- [x] 2.2 Implement single-use atomic reset, session invalidation and reset-safe legacy upgrade; verify concurrent reset/login/upgrade and rollback tests, preserving legacy verification/dual-write behavior.

## 3. Integrated validation and handoff

- [x] 3.1 Run fast/all MySQL/installer suites, builds/typecheck, strict spec and whitespace checks; record local evidence and live migration/security/mail/routing gates in the private checklist.

## Local evidence / live boundary

164 fast tests, 68 real MySQL 8.4.11 functional tests (18 session-security tests),
23 installer tests, typecheck, backend/frontend builds and strict validation passed.
The final scoped session run additionally verifies preservation of the configured
cycle during 009. 001–008 hashes remain pinned; unrelated adminService bytes/NUL
were preserved. No dependencies were changed.

No EC2/RDS SQL, deploy, service activation, mail/routing change, credential read,
old/ access, commit or archive occurred. See docs/it/session-security.md for normal
forward migration of the already initialized preview (not re-bootstrap). Migration
009 and remaining cookie/Origin/rate/IP/mail/routing gates need separate live approval.
