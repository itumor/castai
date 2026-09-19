terraform {
  required_version = ">= 1.11, < 2.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.23"
    }

    castai = {
      source  = "castai/castai"
      version = "~> 8.53"
    }

    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.1"
    }
  }
}

