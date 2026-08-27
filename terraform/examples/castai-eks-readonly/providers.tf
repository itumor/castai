# ------------------------------------------------------------------------------
# AWS Provider
# ------------------------------------------------------------------------------
# Region and optional profile come from the root variables. The profile is only
# set when a non-empty value is supplied so that the default AWS credential
# chain is used when var.aws_profile is null/empty.
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile != "" ? var.aws_profile : null
}

# ------------------------------------------------------------------------------
# Kubernetes Provider
# ------------------------------------------------------------------------------
# Configured dynamically against the existing EKS cluster using exec auth via
# the AWS CLI. No kubeconfig file, static token, or hardcoded endpoint is used.
# This matches the auth pattern used inside the castai-eks-readonly module so
# both providers resolve to the same cluster.
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
# This root does NOT create, import, or manage the EKS cluster. It only reads
# the cluster metadata needed to configure the Kubernetes and Helm providers.
data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

data "aws_caller_identity" "current" {}
