# ------------------------------------------------------------------------------
# AWS Provider
# ------------------------------------------------------------------------------
# Region and optional profile come from the root variables. The profile is
# only set when a non-null value is supplied so that the default AWS
# credential chain is used when var.aws_profile is null.
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# ------------------------------------------------------------------------------
# CAST AI Provider
# ------------------------------------------------------------------------------
# Configured with the organization-level API token. `api_url` is exposed as
# an optional input so users can target non-production CAST AI environments
# (e.g. staging) when needed.
provider "castai" {
  api_token = var.castai_api_token
  api_url   = var.api_url
}

# ------------------------------------------------------------------------------
# Kubernetes Provider
# ------------------------------------------------------------------------------
# Configured dynamically against the existing EKS cluster using exec auth via
# the AWS CLI. No kubeconfig file, static token, or hardcoded endpoint is used.
provider "kubernetes" {
  host                   = data.aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args = [
      "eks",
      "get-token",
      "--cluster-name",
      data.aws_eks_cluster.this.name,
      "--region",
      var.aws_region,
    ]
  }
}

# ------------------------------------------------------------------------------
# Helm Provider
# ------------------------------------------------------------------------------
# Uses the same exec auth path as the Kubernetes provider so that Helm releases
# are installed into the existing EKS cluster with short-lived credentials.
provider "helm" {
  kubernetes = {
    host                   = data.aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args = [
        "eks",
        "get-token",
        "--cluster-name",
        data.aws_eks_cluster.this.name,
        "--region",
        var.aws_region,
      ]
    }
  }
}

# ------------------------------------------------------------------------------
# Existing EKS Cluster (read-only discovery)
# ------------------------------------------------------------------------------
# This root does NOT create, import, or manage the EKS cluster. It only
# reads the cluster metadata needed to configure the Kubernetes and Helm
# providers and to register the cluster with CAST AI.
data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

data "aws_caller_identity" "current" {}
