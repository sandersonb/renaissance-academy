# Optional Session Manager access alongside SSH

The stack enables **SSM Session Manager as an additional management path**. It
does not remove SSH, alter the configured SSH source CIDRs, create human IAM
users, or automatically grant access to another volunteer.

## Two independent authorization layers

1. **The instance/agent:** Terraform creates an EC2 role with
   `AmazonSSMManagedInstanceCore` and attaches it through an instance profile.
   The Amazon-provided AL2023 image includes the SSM agent; confirm it is running
   and reports `Online` after launch. Outbound HTTPS and working DNS are needed;
   no additional inbound port or paid VPC endpoint is needed with this subnet's
   internet route and public address.
2. **The human operator:** the volunteer's own IAM identity must be authorized
   to start sessions to the new instance and manage their own sessions. The EC2
   role does **not** grant that human permission. Review the other volunteer's
   existing identity with them; do not share credentials or grant AdministratorAccess
   just to enable Session Manager. Prefer MFA-backed identities and scoped access.

SSM access is controlled by IAM, **not by the SSH IP allowlist**. Retaining port
22 restrictions does not impose those source-IP restrictions on SSM. Decide any
IAM source-network/MFA requirements separately before delegating access.

Treat Session Manager shell access as privileged host administration. Default
SSM shell configuration can provide administrative OS access; it is not merely
read-only access to AWS resource metadata.

## After an approved infrastructure apply

These are operator instructions, not commands that should be executed during a
read-only infrastructure inspection. `StartSession` creates a real session.

1. Confirm the new instance is registered as an `Online` managed node in
   Systems Manager, in the right account and region.
2. Use the EC2 console **Connect → Session Manager**, or the Terraform output
   `ssm_session_command` with the appropriate local AWS profile.
3. CLI sessions require the separate **Session Manager plugin** in addition to
   AWS CLI. Each volunteer uses their own authenticated AWS profile.
4. Keep the existing SSH key and trusted `/32` rules until both volunteers have
   tested the agreed management/recovery paths.
5. Verify a fresh SSH connection from an allowed address as well; an already-open
   SSH connection is not evidence that a new connection will succeed.

For a CLI user, the output is equivalent to:

```bash
aws ssm start-session --profile SCHOOL_PROFILE --region us-west-2 --target NEW_INSTANCE_ID
```

Never grant `AmazonSSMFullAccess` solely to provide a shell. Specific operator
policies should scope target instances, permitted session documents, and the
operator's own sessions; these differ from the node's managed policy. No human
IAM policy attachments are created by this stack.

## Audit and logging decision

CloudTrail session API records and **terminal transcripts are different things**.
This stack does not configure account/region-wide Session Manager preferences,
CloudTrail trails, or transcript storage. Confirm the school's existing audit
configuration; choose retention and encrypted, restricted CloudWatch/S3 storage
before enabling session transcripts, which can contain credentials or student
data. This is a separate approved change with storage/KMS cost and access
implications, not an automatic part of enabling the node role.

## Troubleshooting without broadening access

- **No managed node / TargetNotConnected:** verify account/region, agent status,
  attached instance profile, DNS, and outbound HTTPS to SSM/ssmmessages. An SG
  ingress rule is not a fix for missing agent credentials.
- **AccessDenied starting a session:** inspect the operator's IAM permissions,
  boundaries, SCPs, and any MFA/session restrictions; do not attach broad admin
  policies as a shortcut.
- **CLI plugin missing:** install the Session Manager plugin or use the console;
  it is not an instance networking issue.
- **SSH still works but SSM does not:** use the existing SSH fallback to inspect
  `amazon-ssm-agent`; do not disable the firewall or remove SSH restrictions.

References:
- [Instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-instance-profile.html)
- [Session Manager setup](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started.html)
