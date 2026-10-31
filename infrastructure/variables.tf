variable "aws_region" {
  description = "Region containing the existing VPC, RDS instance, and EC2 key pair."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Optional local AWS profile. Null uses the normal environment/role credential chain; never put keys here."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.aws_profile == null ? true : can(regex("^[A-Za-z0-9_.-]+$", var.aws_profile))
    error_message = "aws_profile must be null or a nonempty profile name containing letters, digits, underscores, dots, or hyphens."
  }
}

variable "expected_account_id" {
  description = "AWS account allowed to receive changes; prevents applying with the wrong profile."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must be a 12-digit AWS account ID."
  }
}

variable "name_prefix" {
  description = "Stable resource-name prefix. Changing it can replace resources; review the plan."
  type        = string
  default     = "enrollment-prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,29}$", var.name_prefix))
    error_message = "name_prefix must be 3-30 lowercase letters, digits, or hyphens, starting with a letter."
  }
}

variable "vpc_id" {
  description = "Existing VPC; this configuration does not create or change VPC routing."
  type        = string
}

variable "subnet_id" {
  description = "Existing public subnet for the new instance; verify its internet-gateway route."
  type        = string
}

variable "ami_id" {
  description = "Pinned Amazon-owned AL2023 ARM64 AMI in aws_region. No automatic latest-AMI replacements."
  type        = string

  validation {
    condition     = can(regex("^ami-([0-9a-f]{8}|[0-9a-f]{17})$", var.ami_id))
    error_message = "ami_id must be an EC2 AMI ID."
  }
}

variable "instance_type" {
  description = "ARM64 EC2 size; the selected type must support the pinned ARM64 image."
  type        = string
  default     = "t4g.micro"

  validation {
    condition     = startswith(var.instance_type, "t4g.")
    error_message = "This initial low-cost configuration supports t4g instance types."
  }
}

variable "root_volume_size_gib" {
  description = "Encrypted gp3 root volume size. Must also meet the selected AMI's minimum."
  type        = number
  default     = 12

  validation {
    condition     = var.root_volume_size_gib >= 8 && floor(var.root_volume_size_gib) == var.root_volume_size_gib
    error_message = "root_volume_size_gib must be an integer of at least 8."
  }
}

variable "key_name" {
  description = "Existing EC2 key-pair name. Required when SSH CIDRs are configured; private key stays outside Terraform."
  type        = string
  default     = null
  nullable    = true
}

variable "ssh_ipv4_cidrs" {
  description = "Map of trusted IPv4 CIDRs to descriptions. Empty defaults to SSM-only access; no world-open SSH."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for cidr in keys(var.ssh_ipv4_cidrs) :
      can(cidrnetmask(cidr)) && try(tonumber(split("/", cidr)[1]) >= 24, false)
    ])
    error_message = "SSH sources must be valid IPv4 CIDRs with /24 or narrower prefixes (prefer /32)."
  }
}

variable "legacy_security_group_name" {
  description = "Existing old-edge SG name, resolved inside vpc_id. Read only; never manages its existing rules."
  type        = string
}

variable "rds_security_group_id" {
  description = "Existing RDS SG. Only one new source-SG ingress rule is managed, not the group or database."
  type        = string
}

variable "rds_port" {
  description = "Actual RDS MySQL TCP listener port; confirm in RDS Connectivity & security."
  type        = number
  default     = 3306

  validation {
    condition     = var.rds_port >= 1 && var.rds_port <= 65535 && floor(var.rds_port) == var.rds_port
    error_message = "rds_port must be an integer TCP port between 1 and 65535."
  }
}

variable "enable_public_web" {
  description = "Explicit final-ingress gate. False permits nginx HTTP only from the legacy SG; true adds public IPv4 80/443."
  type        = bool
  default     = false
}

variable "outbound_tcp_ports" {
  description = "Internet egress ports for packages/ACME/SSM (80/443) and SMTP STARTTLS (587). RDS egress is separate."
  type        = set(number)
  default     = [80, 443, 587]

  validation {
    condition = alltrue([
      for port in var.outbound_tcp_ports : port >= 1 && port <= 65535 && floor(port) == port
    ])
    error_message = "outbound_tcp_ports must contain integer TCP ports between 1 and 65535."
  }
}
