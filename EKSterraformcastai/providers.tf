# ------------------------------------------------------------------------------
# AWS Provider
# ------------------------------------------------------------------------------
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
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
