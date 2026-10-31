mock_provider "aws" {
  override_during = plan

  mock_data "aws_subnet" {
    defaults = {
      id     = "subnet-0123456789abcdef0"
      vpc_id = "vpc-0123456789abcdef0"
    }
  }

  mock_data "aws_ami" {
    defaults = {
      id               = "ami-0123456789abcdef0"
      name             = "al2023-ami-test-arm64"
      architecture     = "arm64"
      root_device_type = "ebs"
    }
  }

  mock_data "aws_security_group" {
    defaults = { vpc_id = "vpc-0123456789abcdef0" }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"}}]}"
    }
  }

  mock_resource "aws_security_group" {
    defaults = { id = "sg-22222222222222222" }
  }

  mock_resource "aws_eip" {
    defaults = {
      id        = "eipalloc-0123456789abcdef0"
      public_ip = "203.0.113.10"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      name = "test-enrollment-web"
      arn  = "arn:aws:iam::123456789012:role/test-enrollment-web"
    }
  }

  mock_resource "aws_iam_instance_profile" {
    defaults = { name = "test-enrollment-web-profile" }
  }
}

override_data {
  target = data.aws_security_group.legacy
  values = {
    id     = "sg-11111111111111111"
    vpc_id = "vpc-0123456789abcdef0"
  }
}

override_data {
  target = data.aws_security_group.rds
  values = {
    id     = "sg-33333333333333333"
    vpc_id = "vpc-0123456789abcdef0"
  }
}

variables {
  legacy_security_group_name = "test-legacy-edge"
  aws_profile                = null
  expected_account_id        = "123456789012"
  vpc_id                     = "vpc-0123456789abcdef0"
  subnet_id                  = "subnet-0123456789abcdef0"
  ami_id                     = "ami-0123456789abcdef0"
  rds_security_group_id      = "sg-33333333333333333"
  rds_port                   = 3306
  key_name                   = null
  ssh_ipv4_cidrs             = {}
  enable_public_web          = false
  outbound_tcp_ports         = [80, 443, 587]
}

run "ssm_keeps_ssh_as_an_independent_access_path" {
  command = plan

  variables {
    aws_profile    = "test-school"
    key_name       = "test-key"
    ssh_ipv4_cidrs = { "198.51.100.10/32" = "Test SSH fallback" }
  }

  assert {
    condition     = aws_iam_role_policy_attachment.ssm.policy_arn == "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" && aws_iam_role_policy_attachment.ssm.role == aws_iam_role.web.name
    error_message = "The EC2 agent role must have the SSM managed-node policy."
  }

  assert {
    condition     = aws_iam_instance_profile.web.role == aws_iam_role.web.name && aws_instance.web.iam_instance_profile == aws_iam_instance_profile.web.name
    error_message = "SSM agent permissions must reach EC2 through the instance profile."
  }

  assert {
    condition     = aws_instance.web.key_name == "test-key" && length(aws_vpc_security_group_ingress_rule.ssh) == 1 && aws_vpc_security_group_ingress_rule.ssh["198.51.100.10/32"].cidr_ipv4 == "198.51.100.10/32"
    error_message = "Adding SSM must not remove the explicitly configured SSH fallback."
  }
}

run "private_pilot" {
  command = plan

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.public_web) == 0 && length(aws_vpc_security_group_ingress_rule.ssh) == 0
    error_message = "Pilot defaults must not expose public web or SSH ingress."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.legacy_http.referenced_security_group_id == data.aws_security_group.legacy.id && aws_vpc_security_group_ingress_rule.legacy_http.from_port == 80 && aws_vpc_security_group_ingress_rule.legacy_http.to_port == 80
    error_message = "The pilot must admit only HTTP from the legacy security group."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.rds_from_web.security_group_id == data.aws_security_group.rds.id && aws_vpc_security_group_ingress_rule.rds_from_web.referenced_security_group_id == aws_security_group.web.id && aws_vpc_security_group_ingress_rule.rds_from_web.from_port == 3306 && aws_vpc_security_group_egress_rule.rds.referenced_security_group_id == data.aws_security_group.rds.id
    error_message = "RDS ingress/egress must reference the dedicated web/RDS groups."
  }

  assert {
    condition     = aws_instance.web.vpc_security_group_ids == toset([aws_security_group.web.id])
    error_message = "The new EC2 must not inherit the shared legacy security group."
  }

  assert {
    condition     = aws_instance.web.metadata_options[0].http_tokens == "required" && aws_instance.web.root_block_device[0].encrypted && aws_instance.web.credit_specification[0].cpu_credits == "standard"
    error_message = "Require IMDSv2, encrypted storage, and bounded CPU-credit costs."
  }

  assert {
    condition     = aws_eip.web.domain == "vpc" && aws_eip_association.web.allocation_id == aws_eip.web.id && !aws_eip_association.web.allow_reassociation
    error_message = "Use a separate retained VPC EIP without silently stealing an association."
  }

  assert {
    condition     = keys(aws_vpc_security_group_egress_rule.internet_tcp) == ["443", "587", "80"]
    error_message = "Default internet egress must be port-specific rather than allow-all."
  }
}

run "public_ingress_requires_opt_in" {
  command = plan

  variables {
    enable_public_web = true
    key_name          = "test-key"
    ssh_ipv4_cidrs    = { "198.51.100.10/32" = "Test admin" }
  }

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.public_web) == 2 && aws_vpc_security_group_ingress_rule.public_web["80"].from_port == 80 && aws_vpc_security_group_ingress_rule.public_web["443"].from_port == 443
    error_message = "Opt-in must expose only public IPv4 HTTP and HTTPS."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.ssh["198.51.100.10/32"].from_port == 22 && aws_vpc_security_group_ingress_rule.ssh["198.51.100.10/32"].cidr_ipv4 == "198.51.100.10/32"
    error_message = "SSH must stay limited to explicitly configured trusted sources."
  }
}

run "reject_world_open_ssh" {
  command = plan

  variables {
    key_name       = "test-key"
    ssh_ipv4_cidrs = { "0.0.0.0/0" = "Unsafe" }
  }

  expect_failures = [var.ssh_ipv4_cidrs]
}

run "reject_ssh_without_key" {
  command = plan

  variables {
    ssh_ipv4_cidrs = { "198.51.100.10/32" = "Test admin" }
  }

  expect_failures = [aws_instance.web]
}

run "reject_wrong_subnet_vpc" {
  command = plan

  override_data {
    target = data.aws_subnet.web
    values = {
      id     = "subnet-0123456789abcdef0"
      vpc_id = "vpc-fffffffffffffffff"
    }
  }

  expect_failures = [aws_instance.web]
}

run "reject_wrong_rds_vpc" {
  command = plan

  override_data {
    target = data.aws_security_group.rds
    values = {
      id     = "sg-33333333333333333"
      vpc_id = "vpc-fffffffffffffffff"
    }
  }

  expect_failures = [aws_security_group.web]
}

run "reject_x86_ami" {
  command = plan

  override_data {
    target = data.aws_ami.web
    values = {
      id               = "ami-0123456789abcdef0"
      name             = "al2023-ami-test-x86_64"
      architecture     = "x86_64"
      root_device_type = "ebs"
    }
  }

  expect_failures = [aws_instance.web]
}
