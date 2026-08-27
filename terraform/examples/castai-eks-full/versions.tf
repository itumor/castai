terraform {
  required_version = ">= 1.3.2"

  required_providers {
    # AWS provider is used to discover the existing EKS cluster and to grant
    # the CAST AI node instance profile role access via EKS access entries.
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23.0, < 7.0.0"
    }

    # CAST AI provider registers the cluster with CAST AI and manages
    # node configurations / templates in full mode.
    castai = {
      source  = "castai/castai"
      version = "~> 8.58.0"
    }

    # Helm provider installs the CAST AI umbrella chart on the existing
    # cluster as part of the full mode onboarding.
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.1"
    }

    # Kubernetes provider is configured only so Helm can target the
    # existing cluster.
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.2"
    }
  }
}
