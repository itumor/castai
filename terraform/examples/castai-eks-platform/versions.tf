terraform {
  required_version = ">= 1.3.2"

  required_providers {
    # AWS provider is used to discover the existing EKS cluster and to grant
    # the CAST AI node instance profile role access via EKS access entries.
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23.0, < 7.0.0"
    }

    # CAST AI provider pins the version required by the wired-in modules
    # (castai-eks-full, castai-eks-platform and castai-eks-organization),
    # all of which declare castai ~> 9.2.1.
    castai = {
      source  = "castai/castai"
      version = "~> 9.2.1"
    }

    # Helm provider installs the CAST AI umbrella chart on the existing
    # cluster as part of the platform mode onboarding.
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
