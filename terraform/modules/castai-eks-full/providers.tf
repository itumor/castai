# ------------------------------------------------------------------------------
# AWS Provider
# ------------------------------------------------------------------------------
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# ------------------------------------------------------------------------------
# CAST AI Provider
# ------------------------------------------------------------------------------
# Configured with the organization-level API token. `api_url` is exposed as
# an optional input so users can target non-production CAST AI environments
# (e.g. staging) when needed. The `grpc_url` variable is not a provider
# argument; it is consumed by the `castai-eks-cluster` module below.
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
