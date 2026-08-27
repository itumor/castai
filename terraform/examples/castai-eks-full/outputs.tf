# ------------------------------------------------------------------------------
# Example outputs
# ------------------------------------------------------------------------------
# These pass through the safe outputs from the underlying
# `castai-eks-full` module. No secrets, credentials, or authentication
# tokens are exposed here.

# ------------------------------------------------------------------------------
# CAST AI Cluster Identity
# ------------------------------------------------------------------------------
output "cluster_id" {
  description = "CAST AI cluster identifier (UUID) for the onboarded EKS cluster."
  value       = module.castai_eks_full.cluster_id
}

output "cluster_name" {
  description = "Name of the onboarded EKS cluster."
  value       = module.castai_eks_full.cluster_name
}

# ------------------------------------------------------------------------------
# IAM
# ------------------------------------------------------------------------------
output "assume_role_arn" {
  description = "ARN of the CAST AI IAM role that the CAST AI controller assumes to manage the cluster."
  value       = module.castai_eks_full.assume_role_arn
}

output "instance_profile_arn" {
  description = "ARN of the IAM instance profile used by CAST AI-managed nodes."
  value       = module.castai_eks_full.instance_profile_arn
}

# ------------------------------------------------------------------------------
# Helm / Namespace
# ------------------------------------------------------------------------------
output "castai_namespace" {
  description = "Kubernetes namespace where CAST AI components are installed."
  value       = module.castai_eks_full.castai_namespace
}

output "castai_full_mode" {
  description = "Boolean indicating that CAST AI is installed in full mode (node autoscaler + workload autoscaler + security agent)."
  value       = module.castai_eks_full.castai_full_mode
}
