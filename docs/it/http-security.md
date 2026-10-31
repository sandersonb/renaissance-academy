# HTTP authentication boundaries

Implemented and tested locally; **not deployment or activation approval**. Keep the
API and workers stopped until session migration 009, isolated preview mail,
dangerous-action safety, dependency remediation, and actual routing review are complete.
This slice does not configure AL1, expose the preview, change RDS or send email.

## Browser cookies and mode

`NODE_ENV=production` enables protected HTTP behavior, including when the database is
`enrollment_preview`. The preview uses the same canonical HTTPS root hostname, not
`/new/`. Cookie names are fixed, derived from mode/schema, not operator-selectable:

| Mode | Parent cookie | Admin cookie |
|---|---|---|
| Protected preview (`DB_NAME=enrollment_preview`) | `__Host-ra-preview-parent` | `__Host-ra-preview-admin` |
| Protected production (other database name) | `__Host-ra-parent` | `__Host-ra-admin` |
| Local development/test | `ra-dev-parent` | `ra-dev-admin` |

Protected cookies have `Secure; HttpOnly; SameSite=Lax; Path=/` and **no Domain**.
Secure is determined by deployment mode, never a client-supplied forwarding header.
Development cookies omit Secure for local HTTP. Parent lifetime is seven days;
admin lifetime is twelve hours, subject to earlier server-side expiry/revocation.
Login sets and logout clears only the current realm/principal's cookie, with the same
attributes and `Max-Age=0` on clear. Missing/expired sessions can log out idempotently.
Logout still requires the write policy; admin logout also requires an allowed IP.

No `sid`/`asid`, other-realm, URL-encoded or duplicate auth cookies authorize requests.
Malformed unrelated cookies are ignored. Modern logout never clears legacy or
preview-selector cookies. Do not copy sessions/test accounts/outbox to production.

**Breaking compatibility:** deploy frontend and API from the same reviewed release.
Older modern cookies no longer authenticate; users must log in again. Distinct
cookie names are not isolation from malicious JavaScript served by the same legacy
origin. Use synthetic records, unique test credentials and a separate browser profile.

## Same-origin API writes

`APP_BASE_URL` must be a root HTTP(S) URL without credentials, subpath, query or fragment;
HTTPS is mandatory in protected mode. Its parsed origin (scheme/host/port) is the
only accepted `Origin`. Every API mutation requires:

- `Origin` equal to that configured origin, exactly (no trailing slash, `null`,
  lookalike hostname or missing value).
- `X-Enrollment-Request: 1`, a **nonsecret marker**, not authentication or a token.
- If `Sec-Fetch-Site` is present, it must be `same-origin` (not `same-site`/`cross-site`).

This includes login, registration, confirmation/reset, logout, bodyless actions,
PATCH/PUT/DELETE and raw PDF uploads. The browser sets Origin; the shared frontend
helper adds the marker to mutations and preserves PDF content type. Scripts must
deliberately send the configured Origin and marker, as well as any required session.
No CORS policy is enabled. GET/HEAD/OPTIONS are not mutation authorization shortcuts.
Local development allows omitted Origin/marker but rejects a wrong supplied Origin
or cross-site fetch metadata. Keep the Vite proxy same-origin and align APP_BASE_URL
with the local browser origin if sending Origin headers.

`GET /api/me` and its HEAD variant read the dashboard without materializing offers.
The client first calls authenticated `POST /api/me/refresh-offers`, then GET. Only
the current parent's pending offers are materialized. This is **not** a broader
concurrency fix for offer acceptance, official draw, rollover or reset operations.

## Admin and proxy policy

`ADMIN_IP_ALLOWLIST` accepts 1–64 comma-separated exact addresses or bounded numeric
CIDRs: IPv4 `/24`–`/32`, IPv6 `/64`–`/128`. Empty permits all only in development;
prefixes such as `203.0.113`, empty list entries, broad networks and IPv6 networks
overlapping the IPv4-mapped range are refused. Valid mapped IPv4 addresses normalize
to IPv4; e.g. `::ffff:192.0.2.0/120` is IPv4 `/24`. IPv6 spelling/case differences do
not change membership. Prefer exact approved staff IPs; do not broaden existing policies.

`TRUST_PROXY=true` trusts only hop zero at `127.0.0.1`/`::1` (including mapped
loopback). It does **not** trust arbitrary private peers. At that trusted hop,
X-Forwarded-For must be one valid client address, not a comma-separated chain.
Untrusted peers' forwarding headers cannot grant staff access or rotate rate-limit
identity. nginx must resolve only explicitly trusted upstream peers, then overwrite
X-Forwarded-For with `$remote_addr`, never `$proxy_add_x_forwarded_for`.

The host installer accepts the same bounded admin policy. nginx UI/API gates and
its separate trusted-edge list, SSH sources, RDS grants and private-backend SG rules
remain independent controls. This adds no public-preview IP gate. Actual AL1
configuration/version/headers and whole-root cookie routing still need separate review.

## Auth limits

Authentication/confirmation/admin-creation JSON bodies are limited to 16 KiB.
Usernames, email, demographic fields and survey responses are bounded; tokens must
be exactly 32 lowercase hex characters. New parent passwords (minimum 6 characters)
and new staff passwords (minimum 8) must fit bcrypt's **72 UTF-8-byte** boundary.
HTTP login allows up to 1024 UTF-8 bytes to preserve bounded historical-password
verification; this does not strengthen old DES/bcrypt credentials. BCRYPT_COST must
be an integer from 4 through 14 (default 12; test cost 4).

| Action | IP quota | Identity quota | Window |
|---|---:|---:|---|
| Parent/admin login (independent route quotas) | 20 | 10 per username | 5 minutes |
| Registration | 10 | 3 per username and per email | 1 hour |
| Forgot password | 5 | 3 per username and per email | 15 minutes |
| Reset password | 5 | 3 per token | 15 minutes |
| Resend confirmation | 5 | 3 per email | 15 minutes |

IP attempts are counted before body parsing; identity attempts are counted after
bounded validation. Success and failure both count. Keys hash normalized identifiers,
never passwords; identifiers themselves are not logged. Exhaustion returns generic
429 with Retry-After seconds. Active entries are not evicted to grant new attempts;
the 10,000-key capacity fails closed for new keys until expiry reclamation (up to
one minute sweep delay). Higher development quotas remain finite. There is no
production disable flag or permanent account lockout.

**Limitations:** fixed-window, process-local protection resets on restart and does
not span replicas. Identity quotas can temporarily affect legitimate users sharing
an identifier/IP. A future multi-process deployment requires reviewed shared limits.
This slice does not change database username uniqueness/collation.

## Tokens, errors and mail handoff

Production-mode provider selection must explicitly be `smtp`; console/missing/unknown
fallback fails startup. SMTP fields must be explicitly configured; the current
production validator requires credentials. Provider and HTTP policies are constructed
before optional admin bootstrap writes or worker/reminder timers. Production debug
tokens and emailDev shortcuts are disabled regardless of the injected provider.
API responses use `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and nosniff.
Parser/unknown-field errors cannot echo secret input; unexpected HTTP errors log only
a fixed category, route template and method, not raw SQL/body/cookies/token URLs.
The installer renders no-referrer on HTML and API responses. Actual outer-edge logs
and headers must be verified separately; an inner policy is not proof of outer behavior.

**Preview mail remains blocked:** SMTP setup is not mail isolation. Timer values `0`
do not block manual drains, queue claiming is not yet atomic, and SMTP transport
enforcement/recipient isolation need their own slice. Do not add dummy credentials
or use production SMTP to work around the current validator. Capture-only local mail
requires deliberate preview-specific provider/host support before API activation.

## Local verification and later upgrade

`npm test`, `npm run test:functional` (owned disposable MySQL 8.4.11 with scoped
SSL-required runtime credentials), root typecheck/build, `web` build and offline
installer tests cover negative/positive boundaries, cookie isolation, no-write GET,
owned offer refresh, upload compatibility, bounded quotas and safe startup/errors.
They do not use RDS credentials or real family records.

After **separate stopped-host deployment approval**, ship frontend/backend together,
preserve the protected operator `.env` and manually review any required fields.
Inspect pending 009 with ordinary `db:migrate`, then apply only with explicit approval.
Never re-bootstrap an initialized preview or rewrite prior checksums/history. See
[session-security.md](session-security.md), [database-tls.md](database-tls.md) and
[HOST_SETUP.md](../../infrastructure/HOST_SETUP.md). Leave API/workers stopped until
the remaining gates are explicitly cleared. Public cutover routes all application
traffic to new regardless of cookies and stops legacy writers/jobs; no ongoing A/B.
