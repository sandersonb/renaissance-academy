# Tasks

## 1. Browser and network boundaries

- [x] 1.1 Implement cookie realms, origin/marker and exact/CIDR/loopback trust policies; verify pure/HTTP negative tests and document protected versus development behavior.
- [x] 1.2 Align host validation, move offer refresh to POST and update all frontend mutations/uploads; verify installer, frontend tests/build and real-MySQL GET-no-write/authorized-refresh behavior.

## 2. Authentication input and leak controls

- [x] 2.1 Add bounded auth fields/bodies and IP/identity quotas with bounded fail-closed storage; verify request limits, saturation, expiration and long-password compatibility and document defaults/limitations.
- [x] 2.2 Enforce production provider/token/error/cache safeguards before startup writes; verify leak/configuration tests and retain session/migration regressions; document remaining mail and routing gates.

## 3. Integrated validation

- [x] 3.1 Run fast/all MySQL/installer tests, typecheck/builds, strict spec and whitespace checks; update private notes with local proof, immutable migrations and unperformed live actions.
