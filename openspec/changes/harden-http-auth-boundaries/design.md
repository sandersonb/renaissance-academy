# Design

## Context

See proposal.md. The preview uses NODE_ENV=production and a separate DB at the
canonical origin. Preserve SQL checksums, the loopback API/private nginx boundary,
admin network restrictions and the future root selector design.

## Goals / Non-Goals

**Goals:** safe isolated cookies, explicit browser-write policy, bounded auth
traffic/inputs, accurate network trust and mode-independent token/error protection.
**Non-Goals:** mail capture/queue delivery, AL1 routing, live activation, SQL/schema
changes, dependency upgrades, official-draw/reset concurrency or generic readiness.

## Decisions

- Derive protected mode from NODE_ENV and cookie realm from DB_NAME=known preview;
  no free-form cookie-name or verification-off env switches. Config carries these
  options; compatibility callers derive the same mode at server construction.
  Production/preview use distinct Secure __Host- root cookies; development uses
  distinct plain names at local HTTP. Never accept/clear legacy or selector cookies.
  Logout is same-origin protected, idempotent, and clears even an expired/missing token.
- Validate canonical root APP_BASE_URL (HTTPS in protected mode). Require its exact
  Origin plus X-Enrollment-Request: 1 on every protected API mutation; reject
  cross-site fetch metadata. The marker is not a secret or authentication. No CORS
  is enabled. Development permits absent headers, but rejects wrong supplied Origin.
- Move offer materialization to authenticated POST /api/me/refresh-offers and make
  GET /api/me business-read-only. The shared frontend helper refreshes explicitly
  and adds the marker to all mutation requests, including raw PDF upload.
- Use Node IP/BlockList parsing, not prefixes. Accept exact addresses and bounded
  CIDRs (/24 IPv4, /64 IPv6 or narrower), normalize mapped IPv4 and IPv6 spellings,
  reject wide/mapped-range overlaps. Empty admin list is allowed only in development.
  TRUST_PROXY=true trusts only hop zero at exact loopback. Reject malformed/multiple
  X-Forwarded-For at that trusted hop; untrusted network headers cannot grant access.
  Host validator matches this policy without changing operator network values.
- Bound auth JSON to 16 KiB; bound usernames/email/demographics/tokens. New passwords
  cannot exceed bcrypt's 72 UTF-8-byte boundary; login allows a bounded 1024 bytes
  for old-password compatibility. No username uniqueness DDL in this slice.
- In-memory fixed-window IP/account quotas count success and failure. Keys hash
  normalized identifiers (never passwords). Protected defaults: login 20/IP and
  10/account per 5 min; registration 10/IP and 3/identity per hour; reset/forgot/resend
  5/IP and 3/identity per 15 min. Development has higher bounded quotas. Storage
  caps at 10,000 entries; saturation fails closed, expiration restores availability.
  No permanent account lockout or production disable flag; limits are process-local.
- Production rejects console/unknown provider selection and never exposes debug
  tokens. Validate/build the HTTP boundary before optional admin bootstrap writes
  or timers. Keep SMTP delivery/lease work separate. API responses are no-store and
  errors never log raw SQL/body/cookies/URLs or reflect parser-secret snippets.

## Risks / Trade-offs

- [New cookie names log old clients out] → deploy updated frontend/backend together;
  no legacy fallback, no selector clearing or token copying across preview/production.
- [Origin policy changes scripts] → scripts must deliberately send configured Origin
  and marker; browser same-origin fetch works through current proxies. Test empty-body
  actions, raw upload and mismatches before rollout.
- [Process-local rate limits reset on restart/do not span replicas] → single-process
  preview scope, fail-closed bounded storage; future replica deployment needs shared limits.
- [Same-origin AL1 risk remains] → synthetic records/distinct test credentials and
  separate browser profile; selector is not isolation from legacy compromise.

## Migration Plan

Implement/rehearse locally with real MySQL and memory tests, preserve migration 009
and prior input bytes, and ship frontend/backend together only after explicit approval.
No service starts or live SQL. Mail sink, dangerous feature gates and actual routing
review remain required before public preview.
