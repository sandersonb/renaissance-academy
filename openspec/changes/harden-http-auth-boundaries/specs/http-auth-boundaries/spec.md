# HTTP authentication boundaries

## Purpose

Protect modern parent/staff HTTP authentication and state-changing requests while
keeping preview and production cookies and administrative network access distinct.

## ADDED Requirements

### Requirement: Isolated transport-safe cookies
Protected deployments SHALL use separate Secure, HttpOnly, host-only root cookies
for parents/admins and distinct preview/production namespaces. Legacy/selector cookies
MUST NOT authorize modern requests or be cleared by modern logout.

#### Scenario: Login and logout isolation
- **WHEN** a protected user logs in or out
- **THEN** only that realm's auth cookie is set/cleared with consistent protections,
  and expired/missing sessions can be logged out without restoring access

### Requirement: Explicit same-origin state changes
Protected API mutations SHALL require the configured origin and a browser request
marker; neither is authentication. Wrong/null/missing origin or cross-site metadata
MUST fail before application writes. Dashboard GET SHALL NOT materialize offers.

#### Scenario: Forged write and legitimate refresh
- **WHEN** a cross-origin request attempts a write or a browser intentionally refreshes offers
- **THEN** the forged request is refused and only the authenticated same-origin POST can update offers

### Requirement: Bounded authentication traffic and fields
Auth requests SHALL have bounded bodies, validated fields and finite IP/identity
quotas with bounded storage. Limit exhaustion SHALL return 429 and a retry hint,
not reveal account existence or enable bypass through eviction/untrusted headers.

#### Scenario: Abuse limits and recovery
- **WHEN** attempts exceed the quota or limiter storage is saturated
- **THEN** requests fail closed without credential processing until the bounded window recovers

### Requirement: Precise admin network and proxy trust
Admin access SHALL match validated addresses/CIDRs, never string prefixes. Protected
empty/broad/invalid policies MUST fail startup. Forwarded headers SHALL be trusted
only from the configured loopback hop and SHALL NOT turn an untrusted peer into staff.

#### Scenario: Spoofed peer and equivalent addresses
- **WHEN** an untrusted peer supplies allowed forwarding headers or an approved address uses equivalent IPv6 spelling
- **THEN** spoofing does not authorize admin access and validated equivalent addresses match consistently

### Requirement: Protected-mode token and error handling
Protected mode SHALL reject console/unknown mail fallback, suppress debug tokens,
prevent credential-bearing error output and prohibit caching of API data. These
controls SHALL NOT depend solely on a particular email-provider class.

#### Scenario: Misconfigured provider and malformed request
- **WHEN** console fallback is selected in protected mode or credential-bearing input is malformed
- **THEN** configuration/request fails without leaking tokens, input, SQL or secrets
