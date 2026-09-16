terraform {
  required_providers {
    castai = {
      source  = "castai/castai"
      version = "~> 9.2"
    }
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23.0, < 7.0.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.1"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.2"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "castai" {
  api_token = var.castai_api_token
  api_url   = var.api_url
}

provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

variable "kubeconfig_path" {
  type    = string
  default = "/tmp/kubeconfig-castai-test"
}
