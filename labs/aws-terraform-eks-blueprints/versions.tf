terraform {
  required_version = ">= 1.5"

  # Backend scaffolding: default is local; uncomment and configure for S3 + DynamoDB in shared environments.
  # backend "s3" {
  #   bucket         = "my-terraform-state-bucket"
  #   key            = "aws-terraform-eks-blueprints/terraform.tfstate"
  #   region         = "us-west-2"
  #   encrypt        = true
  #   dynamodb_table = "terraform-locks"
  # }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }

    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.15"
    }

    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}
