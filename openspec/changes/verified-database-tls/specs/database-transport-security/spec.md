# Database transport security

## Purpose

Authenticate encrypted MySQL connections consistently across the new application
and operator tools while allowing the retiring legacy application to remain unchanged.

## ADDED Requirements

### Requirement: Verified TLS by default
New database connections SHALL validate both the server certificate chain and its
DNS hostname using an explicitly configured public CA file and TLS 1.2 or newer.
Missing/invalid configuration MUST fail before connection or application work.

#### Scenario: Correct or incorrect server identity
- **WHEN** a server presents a trusted certificate matching the configured hostname
- **THEN** the connection succeeds with encryption
- **WHEN** the CA is untrusted, hostname differs, or server TLS is unavailable
- **THEN** the client refuses without retrying in plaintext or disabling verification

### Requirement: Explicit local plaintext exception
Plaintext SHALL require an explicit development/test setting and local destination.
Production SHALL reject that exception; AL1 is not changed by the new client policy.

#### Scenario: Legacy coexistence
- **WHEN** a server allows optional encrypted transport
- **THEN** a verified new client and a permitted legacy non-TLS client can coexist
  without altering the server-wide enforcement policy

### Requirement: Uniform entrypoint policy
API, migration, initialization, admin, roster and seed tools SHALL use the same
transport policy and SHALL NOT expose flags that bypass certificate/hostname checks.

#### Scenario: Operator tool configuration
- **WHEN** a database tool is configured for production without a valid CA
- **THEN** it refuses before making schema/data changes, including with --apply

### Requirement: Safe public CA preparation
Host setup SHALL prepare CA certificates separately from secret configuration,
validate downloaded material, preserve valid existing material and .env contents,
and SHALL NOT activate the API, connect to RDS or alter server/users during setup.

#### Scenario: Repeated setup or invalid download
- **WHEN** setup is repeated or a CA download is malformed
- **THEN** valid existing CA/secrets are not overwritten and no service is activated

### Requirement: Read-only transport diagnostic
The diagnostic SHALL report negotiated cipher/protocol and server enforcement
state without application-data reads, writes, credentials or certificate-key output.

#### Scenario: Diagnose optional server enforcement
- **WHEN** the diagnostic connects successfully using verified TLS
- **THEN** it reports encryption independently of whether global TLS is required
