terraform {
  # Plan-time provider mocks in the offline tests require Terraform 1.11+.
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  profile             = var.aws_profile
  allowed_account_ids = [var.expected_account_id]

  default_tags {
    tags = {
      Project     = "renaissance-academy"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
