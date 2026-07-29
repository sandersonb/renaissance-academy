# Tasks

Retroactive checklist of the rebuild. Nearly all complete; the remainder is cutover.

## 1. Analysis & contract
- [x] Access-log / usage analysis (`new/LOG_ANALYSIS.md`)
- [x] Validated behavior spec from the Perl source (`new/RULES_SPEC.md`)
- [x] Architecture + deviation catalog (`new/IMPLEMENTATION_PLAN.md`, B1–B9 / S1–S6)

## 2. Domain (M1)
- [x] `Reg_Status` model + transition matrix
- [x] Capacity + seeded lottery engine/RNG, validated vs a real 2019 draw
- [x] `changeStatus` (matrix + capacity + sibling promotion), enrollment rules

## 3. Parent portal (M2)
- [x] Auth: register/confirm/login/logout, anti-enumeration, `crypt()`→bcrypt upgrade
- [x] Passwords module (bcrypt + legacy `crypt()` compat)
- [x] Enrollment: add child, exact-match re-enroll, K-age + returning-grade guards
- [x] Offers: accept (survey-gated), decline, materialize-on-load, language step
- [x] Data-driven surveys (B8): registration (Type A) + lottery (Type B)
- [x] React parent portal (login, register, confirm, dashboard, actions)

## 4. Admin console (M3)
- [x] Admin auth (DB-backed `admin_users`, no hard-coded creds), IP allowlist
- [x] Dashboard (grade × status, open slots, drill-down, status info)
- [x] Search + family view; parent/student CRUD; guarded + forced status; audit notes
- [x] Current-student roster CRUD
- [x] Editable grade capacity (MaxEnrollment)
- [x] Survey question manager + survey reports with CSV export
- [x] Staff-account management (list/create/deactivate with guards)
- [x] Lottery run + preview; illustrative preview; fresh-seed official run; history
- [x] Roll-new-year (validate → purge → import); cycle settings

## 5. Email (M4)
- [x] Transactional outbox + worker (console/SMTP)
- [x] Gmail-safe pacing: batch size, spacing, rolling daily cap, transient back-off
- [x] Daily de-duplicated reminders; delivery log + cap visibility

## 6. Documents
- [x] `enrollment_document` table; admin upload/replace/remove
- [x] Entitlement-gated parent serving (mirrors `enroll.pl`); no public links
- [x] Bundled default fallback + admin "using default" indicator

## 7. Hardening & tests (M5)
- [x] Transactions across multi-step mutations
- [x] Unit tests (in-memory) + functional tests (real MySQL via Docker)
- [x] Startup schema guard; error logging; canonical `HUMANIFY` labels

## 8. Docs
- [x] `CLAUDE.md`, `docs/it`, `docs/admin`, `docs/parents`, this OpenSpec record

## 9. Cutover (M6) — remaining
- [ ] Provision prod (nginx + Let's Encrypt TLS, systemd service)
- [ ] Point domain at the rebuild; verify admin IP gate + email delivery
- [ ] Retire Perl; disable `DUAL_WRITE_LEGACY_CRYPT`; drop phpMyAdmin
- [ ] Archive this change (`openspec/changes/archive/`)
