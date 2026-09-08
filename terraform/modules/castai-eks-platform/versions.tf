terraform {
  required_version = ">= 1.3.2"

  required_providers {
    # AWS provider is used to discover the existing EKS cluster and create
    # the access entry / policy association for the CAST AI node instance
    # profile role.
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.23.0, < 7.0.0"
    }

    # CAST AI provider is required in platform mode so that the module can
    # register the cluster, install node configurations / templates and
    # manage CAST AI-side resources.
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
