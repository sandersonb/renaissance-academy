data "aws_subnet" "web" {
  id = var.subnet_id
}

data "aws_ami" "web" {
  owners = ["amazon"]

  filter {
    name   = "image-id"
    values = [var.ami_id]
  }
}

data "aws_security_group" "legacy" {
  filter {
    name   = "group-name"
    values = [var.legacy_security_group_name]
  }

  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
}

data "aws_security_group" "rds" {
  id = var.rds_security_group_id
}

resource "aws_security_group" "web" {
  name_prefix = "${var.name_prefix}-web-"
  description = "Enrollment AL2023 web host; separate from the legacy edge"
  vpc_id      = var.vpc_id

  # Rules are exclusively standalone resources below. Never mix with inline rules.
  tags = { Name = "${var.name_prefix}-web" }

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = data.aws_security_group.legacy.vpc_id == var.vpc_id && data.aws_security_group.rds.vpc_id == var.vpc_id
      error_message = "The legacy and RDS security groups must belong to the selected VPC."
    }

    precondition {
      condition     = data.aws_security_group.legacy.id != data.aws_security_group.rds.id
      error_message = "Legacy web and RDS must use distinct security groups; verify the inputs."
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "legacy_http" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = data.aws_security_group.legacy.id
  description                  = "Private nginx HTTP from the existing TLS edge"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each = var.ssh_ipv4_cidrs

  security_group_id = aws_security_group.web.id
  cidr_ipv4         = each.key
  description       = each.value
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "public_web" {
  for_each = var.enable_public_web ? toset(["80", "443"]) : toset([])

  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Public web ingress enabled for final cutover"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "internet_tcp" {
  for_each = toset([for port in var.outbound_tcp_ports : tostring(port)])

  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Outbound TCP ${each.key} for approved host services"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "rds" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = data.aws_security_group.rds.id
  description                  = "MySQL to the existing RDS security group"
  ip_protocol                  = "tcp"
  from_port                    = var.rds_port
  to_port                      = var.rds_port
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_web" {
  security_group_id            = data.aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.web.id
  description                  = "MySQL from the Terraform-managed enrollment web host"
  ip_protocol                  = "tcp"
  from_port                    = var.rds_port
  to_port                      = var.rds_port
}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web" {
  name_prefix        = "${var.name_prefix}-web-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.web.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "web" {
  name_prefix = "${var.name_prefix}-web-"
  role        = aws_iam_role.web.name
}

resource "aws_instance" "web" {
  ami                         = data.aws_ami.web.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnet.web.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true
  key_name                    = var.key_name
  iam_instance_profile        = aws_iam_instance_profile.web.name
  disable_api_termination     = true
  monitoring                  = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gib
    encrypted             = true
    delete_on_termination = true
  }

  # Standard credits avoid unbounded T4g surplus-credit charges. Measure whether
  # sustained workloads need a larger instance instead of unlimited bursting.
  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = "${var.name_prefix}-web" }

  depends_on = [aws_iam_role_policy_attachment.ssm]

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = data.aws_subnet.web.vpc_id == var.vpc_id
      error_message = "subnet_id must belong to vpc_id."
    }

    precondition {
      condition     = data.aws_ami.web.architecture == "arm64" && data.aws_ami.web.root_device_type == "ebs" && startswith(data.aws_ami.web.name, "al2023-ami-")
      error_message = "Select an Amazon-owned AL2023 ARM64 EBS-backed AMI."
    }

    precondition {
      condition     = length(var.ssh_ipv4_cidrs) == 0 || try(length(trimspace(var.key_name)) > 0, false)
      error_message = "Set an existing key_name when enabling SSH ingress, or use SSM-only access."
    }
  }
}

resource "aws_eip" "web" {
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-web" }

  # DNS coordination is expensive: retain this allocation across EC2 upgrades.
  # This guard is effective only while this resource block stays in configuration.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_eip_association" "web" {
  allocation_id       = aws_eip.web.id
  instance_id         = aws_instance.web.id
  allow_reassociation = false
}
