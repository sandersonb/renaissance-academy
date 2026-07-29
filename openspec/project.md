# Project — Renaissance Academy Enrollment

## Context

A behavior-first rebuild of the live Perl school-enrollment-lottery application
(grades K–9) as a React/TypeScript app on the **existing MySQL schema**. The Perl
app runs in production at `enrollment.renacademy.org`; the rebuild replaces it while
preserving behavior, adding security best practices, and eliminating phpMyAdmin.

Source: <https://github.com/sandersonb/renaissance-academy>. The validated behavior
contract is `new/RULES_SPEC.md`; the architecture and deviation catalog are in
`new/IMPLEMENTATION_PLAN.md`.

## Tech stack

- **API:** Node.js 22, TypeScript, Fastify. Hexagonal architecture — pure `domain/`,
  application `services/`, repository `ports/`, and `adapters/` (in-memory for
  tests/dev, mysql2 for the real schema).
- **Web:** React + Vite (parent portal + admin console), TypeScript.
- **Data:** MySQL 8 (legacy schema + additive migrations). No ORM; hand-written SQL.
- **Email:** transactional outbox in the DB; a paced worker delivers via console or SMTP.
- **Tests:** Vitest — fast in-memory unit tests + `test/functional/` against real MySQL in Docker.

## Conventions

- **Additive-only database changes.** Never rename/drop legacy columns; the Perl app
  keeps running against the same DB during cutover.
- Keep the **in-memory and mysql adapters in lockstep**; every repo method has both.
- `Reg_Status` values and the transition matrix are the domain spine; `HUMANIFY` is
  the single source of human-readable status labels.
- Security: admin surface is IP-restricted (nginx + app allowlist); passwords bcrypt
  with legacy `crypt()` verify-and-upgrade; sessions are httpOnly, non-IP-pinned;
  login is non-enumerating.
- Docs and committed files contain **no secrets or PII**.

## Intentional deviations from the legacy app

Catalogued as `B1–B9` (behavior) and `S1–S6` (security) in
`new/IMPLEMENTATION_PLAN.md`. Highlights: seeded/replayable lottery RNG, data-driven
surveys (`B8`), returning-grade guard (`B9`), transactional outbox (`B4`),
`crypt()`→bcrypt upgrade-on-login (`S3`), non-IP-pinned sessions (`S4`),
anti-enumeration auth, and — added during the rebuild — a legally-required
**non-reproducible official lottery draw** (preview never reused).

## Status

Feature-complete across parent portal, admin console, lottery, notifications,
surveys, documents, and the annual cycle. Tested at three levels (unit, functional,
compose). Pending: production cutover (nginx/TLS swap, Perl retirement, then
archiving the rebuild change record below).
