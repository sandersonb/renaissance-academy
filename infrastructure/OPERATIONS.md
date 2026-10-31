# Initial apply and retirement of the temporary EC2

This runbook creates the Terraform-managed host, then retires only the manually
provisioned replacement host. **It is not the application/DNS cutover.** The AL1
production host, RDS instance, shared legacy SG, key pair, VPC, and DNS stay in place.
Environment-specific instance IDs, plan filenames, hashes, and approvals belong
in the ignored local cutover checklist/review, not in this document.

## 1. Approve the initial plan

- Verify the caller is using the school account and intended AWS profile.
- Use the newly reviewed binary plan, not a stale inspection or another
  operator's plan. Verify its SHA-256 and that its Terraform inputs have not changed.
- The initial plan should only create the dedicated host/network/SSM resources
  and add a source-SG rule to RDS. It must not import, replace, update, or delete
  either existing EC2, the database, DNS, or the existing SGs.
- Confirm public web ingress remains disabled and the existing SSH allowlist/key
  are preserved. Starting a host is not permission to expose the application.
- Use one Terraform operator. The initial backend is local: identify the state
  custodian and a secure backup destination before applying. Preserve the lock
  file and local tfvars; do not commit state/plan files or credentials.
- Obtain explicit apply approval. Resource creation incurs ongoing charges.

After approval, from the repository root:

```bash
terraform -chdir=infrastructure apply REVIEWED_PLAN.tfplan
terraform -chdir=infrastructure output
```

**A saved-plan apply executes without Terraform's usual interactive approval
prompt.** Do not run it merely to inspect the plan. Do not add `-target`, use
`terraform destroy`, or replace it with an unreviewed automatic plan.

If apply partially fails, retain state and inspect the actual resources before
retrying. Do not terminate the manual fallback or indiscriminately destroy what
was created. Protect any allocated EIP even if association initially fails.

## 2. Verify the new base host

- Record instance ID, private IP, EIP/allocation ID, SG ID, and SSM role/profile
  from Terraform outputs in the local checklist.
- Wait for EC2 instance/system checks to pass. Verify the actual root disk is
  encrypted gp3, IMDSv2 is required, and only the dedicated SG is attached.
- Confirm Systems Manager reports the new instance Online, then test a fresh
  Session Manager connection using an authorized volunteer identity.
- Test a fresh SSH connection using the existing key from an allowed source;
  SSM must not silently replace the agreed SSH fallback.
- Verify the EIP belongs to the new instance, no unintended public web/API ports
  are reachable, and existing legacy/RDS rules are unchanged except the new grant.
- Back up the actual Terraform state securely immediately after the initial apply.
  School-owned remote state remains a separate approved improvement; do not treat
  the ignored local state as disposable or assume Git backs it up.

This configuration **does not install nginx/Node or deploy the application**.
Private nginx reachability, RDS TLS/client testing, root-cookie routing, certificates, worker
ownership, and application security remain later checklist gates.

## 3. Confirm the manual host is disposable

Retirement is a **separate, destructive action outside this Terraform state**.
Do not import the manual EC2 merely to manufacture a destroy in the initial plan.

- Match the exact manual instance ID, Name tag, AMI, VPC, subnet, and private IP
  against the local inventory. The target must NOT be the AL1 production instance
  or the new instance just reported by Terraform.
- Confirm neither public DNS nor any active nginx/pilot route depends on it.
- Confirm it contains no files/configuration needing preservation. If uncertain,
  stop here and agree a backup/inspection plan; metadata cannot prove a disk empty.
- Review **all attached EBS volumes and DeleteOnTermination flags**. Termination
  can permanently remove both root and secondary volumes; a successful dry run
  verifies API authorization, not preservation of the data.
- Obtain the retirement go-ahead after successful new-host access checks.

Operator templates (substitute the verified school profile, region, and manual ID):

```bash
aws --profile SCHOOL_PROFILE --region REGION ec2 describe-instances \
  --instance-ids MANUAL_INSTANCE_ID
aws --profile SCHOOL_PROFILE --region REGION ec2 terminate-instances \
  --instance-ids MANUAL_INSTANCE_ID --dry-run
```

For the dry run, `DryRunOperation` with a nonzero CLI exit code is the expected
permission-success signal. `UnauthorizedOperation` is not success. Neither result
is permission to skip target/data checks.

Only after those checks and the retirement go-ahead, use the same exact target
without `--dry-run`, then wait for termination and verify the expected volume cleanup.
Keep AL1 serving production. Do not delete the shared legacy SG, old RDS source
rule, SSH key pair, subnet, or VPC when cleaning up this one temporary instance.

## 4. Continue application preparation

Install/provision the new host, apply the production-hardening work, test against
an isolated schema with test mail, and configure the root-cookie preview. The
cookie selects the complete backend, not authentication; no preview IP gate is
planned, but admin/SSH/RDS restrictions remain. Do not change DNS,
enable public web ingress, run production migrations, or start email jobs as a
side effect of this infrastructure apply/cleanup. Follow the local cutover checklist.
