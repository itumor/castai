# ------------------------------------------------------------------------------
# Example outputs
# ------------------------------------------------------------------------------
# These pass through the safe, read-only outputs from the underlying
# `castai-eks-readonly` module. No secrets, credentials, or authentication
# tokens are exposed here.

output "cluster_name" {
  description = "Name of the existing EKS cluster that CAST AI is connected to."
  value       = module.castai_eks_readonly.cluster_name
}

output "aws_region" {
  description = "AWS region of the existing EKS cluster."
  value       = module.castai_eks_readonly.aws_region
}

output "aws_account_id" {
  description = "AWS account ID that owns the existing EKS cluster."
  value       = module.castai_eks_readonly.aws_account_id
}

output "castai_namespace" {
  description = "Kubernetes namespace where CAST AI components are installed."
  value       = module.castai_eks_readonly.castai_namespace
}

output "castai_release_name" {
  description = "Helm release name of the CAST AI umbrella chart."
  value       = module.castai_eks_readonly.castai_release_name
}

output "castai_readonly_mode" {
  description = "Boolean indicating that CAST AI is installed in read-only mode."
  value       = module.castai_eks_readonly.castai_readonly_mode
}

output "castai_chart_version" {
  description = "Installed version of the castai umbrella Helm chart."
  value       = module.castai_eks_readonly.castai_chart_version
}
