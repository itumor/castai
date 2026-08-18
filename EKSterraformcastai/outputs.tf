# ------------------------------------------------------------------------------
# Safe / Read-Only Outputs
# ------------------------------------------------------------------------------
# No secrets, credentials, or authentication tokens are exposed here.

output "cluster_name" {
  description = "Name of the existing EKS cluster that CAST AI is connected to."
  value       = data.aws_eks_cluster.this.name
}

output "aws_region" {
  description = "AWS region of the existing EKS cluster."
  value       = var.aws_region
}

output "aws_account_id" {
  description = "AWS account ID that owns the existing EKS cluster."
  value       = data.aws_caller_identity.current.account_id
}

output "castai_namespace" {
  description = "Kubernetes namespace where CAST AI components are installed."
  value       = helm_release.castai.namespace
}

output "castai_release_name" {
  description = "Helm release name of the CAST AI umbrella chart."
  value       = helm_release.castai.name
}

output "castai_readonly_mode" {
  description = "Boolean indicating that CAST AI is installed in read-only mode."
  value       = true
}

output "castai_chart_version" {
  description = "Installed version of the castai umbrella Helm chart."
  value       = helm_release.castai.metadata.version
}
