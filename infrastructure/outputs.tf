output "elastic_ip_address" {
  description = "Stable IPv4 for the one-time IT DNS request; allocation is retained across EC2 replacement."
  value       = aws_eip.web.public_ip
}

output "elastic_ip_allocation_id" {
  description = "Retain this allocation/state; do not release it during a server upgrade."
  value       = aws_eip.web.id
}

output "instance_id" {
  description = "New Terraform-managed instance; neither pre-existing EC2 is adopted or changed."
  value       = aws_instance.web.id
}

output "private_ip_address" {
  description = "Use this private IPv4 for the old nginx pilot upstream, not the public EIP."
  value       = aws_instance.web.private_ip
}

output "web_security_group_id" {
  value = aws_security_group.web.id
}

output "legacy_security_group_id" {
  description = "Resolved legacy SG ID; verify that the old AL1 host is actually attached to it."
  value       = data.aws_security_group.legacy.id
}

output "rds_ingress_rule_id" {
  description = "Only this added rule on the existing RDS SG belongs to this Terraform state."
  value       = aws_vpc_security_group_ingress_rule.rds_from_web.id
}

output "ssm_session_command" {
  description = "Requires caller SSM permissions and a running/registered SSM agent on the instance."
  value       = "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.web.id}${var.aws_profile == null ? "" : " --profile ${var.aws_profile}"}"
}

output "ssm_instance_role_arn" {
  description = "EC2 agent identity, not a human operator role. Does not grant volunteers access by itself."
  value       = aws_iam_role.web.arn
}

output "ssm_instance_profile_name" {
  value = aws_iam_instance_profile.web.name
}

output "public_web_enabled" {
  value = var.enable_public_web
}
