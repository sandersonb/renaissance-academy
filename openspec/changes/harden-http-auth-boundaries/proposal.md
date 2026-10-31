# Proposal

## Why

Session revocation is now implemented, but browser/request boundaries still permit
insecure cookies, imprecise admin IP matching, unbounded auth traffic and token leaks
under a mistaken console-mail configuration. These must be closed before preview exposure.

## What Changes

- **BREAKING:** namespaced parent/admin cookies; Secure host-only __Host- cookies
  in production-mode preview/production, with no legacy-cookie fallback.
- Require configured same-origin and a nonsecret browser request marker for API
  mutations in production mode; move offer materialization out of GET /api/me.
- Bound auth bodies/fields and credential/mail-request traffic with IP/account rate limits.
- Parse exact/CIDR admin networks correctly and trust only the loopback nginx hop.
- Make production token suppression/provider selection fail closed and sanitize errors;
  align frontend, host validation, docs and real MySQL HTTP tests.

## Capabilities

### New Capabilities
- `http-auth-boundaries`: transport-safe cookies, request-origin/abuse controls,
  exact admin network/proxy enforcement and protected-mode token/error behavior.

### Modified Capabilities
None; main specs are not yet archived.

## Impact

HTTP/config/auth validation, frontend fetch helper, host validator, tests/docs.
No new paid service/dependency, SQL migration rewrite, live deployment, mail delivery
activation, AL1 configuration or routing implementation in this slice.
