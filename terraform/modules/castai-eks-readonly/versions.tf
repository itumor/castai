terraform {
  required_version = ">= 1.3.2"

  required_providers {
    # AWS provider is used only for reading existing EKS cluster metadata.
    # No AWS resources are created or managed by this module.
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.33, < 7.0"
    }

    # Helm provider installs the CAST AI umbrella chart on the existing cluster.
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.1"
    }

    # Kubernetes provider is configured only so Helm can target the existing cluster.
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.2"
    }

    castai = {
      source  = "castai/castai"
      version = "~> 9.2.1"
    }
  }
}
