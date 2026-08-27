# ------------------------------------------------------------------------------
# Existing AWS Account
# ------------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

# ------------------------------------------------------------------------------
# Existing EKS Cluster (read-only discovery)
# ------------------------------------------------------------------------------
# This module does NOT create, import, or manage the EKS cluster. It only
# reads the cluster metadata needed to configure the Kubernetes and Helm
# providers and to register the cluster with CAST AI.
data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

# ------------------------------------------------------------------------------
# EKS Cluster Authentication Token (optional, for reference)
# ------------------------------------------------------------------------------
# The providers above use exec-based authentication via `aws eks get-token`,
# which is the recommended approach for Terraform because it produces a
# short-lived token on demand. This data source is kept for convenience in
# case other consumers need a token value directly.
data "aws_eks_cluster_auth" "this" {
  name = var.cluster_name
}
