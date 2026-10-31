# Enrollment EC2 networking and stable public IP

Terraform for a **fresh AL2023 ARM64 EC2**, a dedicated security group, an SSM
instance role, encrypted root disk, and a reusable Elastic IP in the existing
VPC. The existing AL1 host, manually provisioned AL2023 host, RDS database, and
DNS records are **not adopted, replaced, or deleted**.

The only write to existing infrastructure is **one additional ingress rule on
the selected RDS security group**, allowing MySQL from the new web SG. Existing
RDS rules (including legacy access) remain untouched. Coordinate ownership if
another Terraform stack manages the RDS SG's rules inline/exclusively.

## Scope and defaults

| Area | Behavior |
|---|---|
| Pilot ingress | TCP 80 from the existing legacy SG, using private addresses |
| Public web | Disabled until `enable_public_web = true`; then IPv4 80/443 |
| SSH | No ingress by default; optional trusted IPv4 CIDRs (/24 or narrower) |
| Management | SSM instance role; requires agent health and caller permissions |
| API/MySQL | No public 3001, 5173, or 3306 ingress on the web host |
| Egress | TCP 80/443/587 to internet, and MySQL to RDS SG |
| Identity/storage | IMDSv2 required, encrypted gp3 root disk |
| Costs | t4g.micro, 12 GiB root disk, standard CPU credits, basic monitoring |
| DNS/TLS/app | Not configured by this stack; separate cutover steps |

No NAT gateway, load balancer, RDS Proxy, VPC endpoints, new RDS instance, or paid
enhanced-monitoring service is provisioned. SSM uses the public subnet's internet
route and HTTPS egress. AmazonProvidedDNS and the default Amazon Time Sync
Service are assumed; custom DNS/NTP would need explicit network review.
The old SG source authorizes **every ENI with that SG**, not only one old server;
verify its membership and remove pilot ingress after retiring the old edge.

This does not install Node/nginx, deploy the app, configure AL1 preview routing, issue a
certificate, enable IAM DB authentication, or change database backup retention.
See **[SSM.md](SSM.md)** for the agent/operator permission distinction, optional
Session Manager use, audit considerations, and preserving the SSH fallback.
See **[OPERATIONS.md](OPERATIONS.md)** for the approved-plan apply sequence,
base-host verification, state custody, and separate retirement of the temporary
manual EC2 without touching AL1 or the shared legacy security group.
See **[HOST_SETUP.md](HOST_SETUP.md)** for the idempotent root host installer,
uploaded-source deployment, protected `.env`, nginx/systemd setup, and explicit
first start after the application/DB security gates are complete.

## Local setup and validation

Requires Terraform >= 1.11, AWS credentials for the school's account, and API
permissions for the selected EC2/VPC/IAM operations. Never put AWS access keys,
DB passwords, private keys, or credential-bearing user data into Terraform.

```bash
terraform -chdir=infrastructure init
terraform -chdir=infrastructure fmt -check -recursive
terraform -chdir=infrastructure validate
terraform -chdir=infrastructure test
```

Tests use a **mock AWS provider** and make no AWS API calls. They do not validate
actual permissions, routing, image availability, SSM agent health, or connectivity.
Commit `.terraform.lock.hcl`; never commit `.terraform/`, state, local tfvars, or
plan files. The example values below are deliberately not production inventory.

```bash
cp infrastructure/terraform.tfvars.example infrastructure/terraform.tfvars
```

Populate the ignored file with the actual account, VPC/subnet, pinned AMI, RDS SG,
and optional SSH sources/key-pair name. Use an AWS profile or temporary environment
credentials via the normal provider credential chain, not hard-coded keys.
The provider rejects accounts other than `expected_account_id`.
Select the school profile explicitly through `aws_profile` in local tfvars or
`AWS_PROFILE` when `aws_profile = null`. Keep any CLI identity check on the same
profile (for example, `aws --profile SCHOOL_PROFILE sts get-caller-identity`);
do not accidentally use an employer or personal default profile.

An authenticated **AWS MCP connection is separate from local Terraform SDK
credentials**. If Terraform reports `failed to get shared config profile`, the
named profile is not available to its local credential chain even if MCP reads
work. Arrange the approved local short-lived login/profile before planning;
never copy tokens from MCP into tfvars or expose credential files in logs.

Before planning/applying, verify:

- The target subnet belongs to the selected VPC and has an internet-gateway route;
  subnet ACLs allow the expected traffic and stateful-SG return traffic is understood.
- The pinned AMI is available in the selected region and is Amazon AL2023 ARM64.
  AMI lookup is pinned rather than tracking "latest" and silently replacing EC2.
- The explicitly configured `legacy_security_group_name` resolves to the actual old
  AL1 host SG; there is no deployment-specific name default.
- The selected RDS SG is attached to the intended database, is in the same VPC,
  and the configured listener port is correct. An SG grant does not validate DB
  credentials, TLS configuration, DNS resolution, or RDS public-access settings.
- Any configured EC2 key pair exists in the region and its private key is available
  to the appropriate volunteer. Keep at least one tested recovery access path.
- The deployer can create the role/profile, attach the SSM policy, and pass only
  the required instance role to EC2. The instance role grants **SSM**, not IAM DB
  authentication, Secrets Manager, or CloudWatch-agent permissions.
- Default EBS encryption uses the account's appropriate KMS configuration; check
  permissions if the account uses a customer-managed default key.

## State and reviewed apply

Default state is **local** and ignored, not disposable. Back it up securely and
let only one operator run Terraform at a time. State/plan files contain private
inventory and may contain future secrets; keep them off public storage.
For shared ongoing operation, migrate to a school-owned S3 backend with blocked
public access, encryption, versioning, scoped IAM, and state locking. Do not
silently create a backend in a volunteer's personal account or lose state between
volunteers. S3 locking uses `use_lockfile = true` with Terraform >= 1.10; this
initial configuration does not provision that backend or an extra lock table.

```bash
aws sts get-caller-identity
terraform -chdir=infrastructure plan -out=cutover.tfplan
terraform -chdir=infrastructure show cutover.tfplan
```

Review before authorizing an apply. The plan should contain only new EC2, EIP,
security group/rules, IAM role/profile/policy attachment, and the single added
RDS rule. There must be **no existing EC2/RDS/DNS replacements or deletions**.
Inspect caller account, resolved legacy SG, image, subnet, SSH sources, cost,
and every rule. A plan is not approval to apply it.

After explicit approval:

```bash
terraform -chdir=infrastructure apply cutover.tfplan
terraform -chdir=infrastructure output
```

Terraform launches a **third EC2 during transition**: old AL1, manually created
AL2023, and this new managed instance. It does not terminate either existing
instance. Once the managed host is verified, retire the unused manual host in a
separately approved action to avoid ongoing duplicate costs. If launch or EIP
association partially fails, inspect state/console before retrying: an allocated
but unassociated address is still billed.

Use the output `private_ip_address` for the legacy nginx's root-path preview
upstream. The selected plan uses a routing cookie, not `/new/`; whole-app dispatch,
cache/session isolation and an isolated preview schema still need implementation
and validation. The selector is not authentication, and no preview IP gate is
planned; admin network restrictions remain. The public EIP is available for
restricted SSH or later public ingress; an EIP does not
open ports on its own. Verify a fresh SSM/SSH connection, then MySQL with verified
TLS, without running migrations/seeds or starting mail jobs against production.

## DNS and certificate handoff

Ask school IT for a **single approved A-record update to `elastic_ip_address`**
only when the new host is ready for public ingress. Verify the actual DNS record
chain/owner, existing TTL, and any AAAA records first. DNS is deliberately absent
from Terraform because the school's IT team owns it. Keep existing Let's Encrypt
cron/challenge routing intact during the pilot.

Before setting `enable_public_web = true`, configure nginx TLS and renewal,
admin IP gates, application security, and monitoring. Enable public ingress and
validate the new EIP with the intended Host/SNI before requesting the DNS switch.
Keep the old edge forwarding to the same authoritative app/database during DNS
propagation; do not allow divergent writers. No public IPv6 ingress is created.

## Keeping the IP through future EC2 changes

The EIP allocation is a **separate resource** with `prevent_destroy = true`; it
is not tied to the instance's lifecycle. Reboot/stop-start or replacing the host
does not require a new DNS address while this allocation is retained. AWS permits
moving it to another compatible target in the region/network border group.

However, **this is not an automated zero-downtime upgrade controller**. Changing
AMI/subnet/other replacement inputs creates a new instance and can move the EIP
as soon as EC2 is running, **before the app is ready**. Instance replacement and
EIP reassociation require an explicit maintenance/staging plan. `create_before_destroy`
does not provide application readiness, data migration, session draining, or
rollback. API termination protection is enabled; understand and deliberately
handle it before approved replacement/retirement.

Never run `terraform destroy` as an upgrade procedure. `prevent_destroy` blocks
normal planned EIP deletion while its resource block remains, but cannot protect
against console/API release, removing the configuration, or losing state. Keep
the allocation ID/state and transfer operational ownership securely. Roll back
application traffic at nginx first; don't destroy infrastructure to roll back.

## Cost notes

[AWS public IPv4 pricing](https://aws.amazon.com/vpc/pricing/) currently lists
**$0.005 per address-hour** for both in-use auto-assigned IPv4 and Elastic IPs
(about $3.65 per 730-hour month, before credits/taxes). Replacing one auto-assigned
IP with one associated EIP generally leaves the steady-state IPv4 charge unchanged.
The EC2's initial auto-assigned public IP is released when its EIP is associated;
idle EIPs and overlapping instances still cost money. T4g compute and gp3 storage
are separate charges. No extra address is needed for stop/start or a later move
of the retained EIP. Review credit-balance, memory/disk, and load before increasing
instance size; standard CPU credits can throttle sustained CPU use.

The existing RDS daily snapshots/7-day retention remain unchanged. Verify whether
these are automated backups with PITR versus scheduled snapshots, the latest
restorable time, and a successful isolated restore before cutover.
