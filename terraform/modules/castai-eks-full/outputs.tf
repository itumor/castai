# ------------------------------------------------------------------------------
# CAST AI Cluster Identity
# ------------------------------------------------------------------------------
output "cluster_id" {
  description = "CAST AI cluster identifier (UUID) for the onboarded EKS cluster."
  value       = module.castai-eks-cluster.cluster_id
}

output "cluster_name" {
  description = "Name of the onboarded EKS cluster."
  value       = var.cluster_name
}

# ------------------------------------------------------------------------------
# IAM
# ------------------------------------------------------------------------------
output "assume_role_arn" {
  description = "ARN of the CAST AI IAM role that the CAST AI controller assumes to manage the cluster."
  value       = module.castai-eks-role-iam.role_arn
}

output "instance_profile_arn" {
  description = "ARN of the IAM instance profile used by CAST AI-managed nodes."
  value       = module.castai-eks-role-iam.instance_profile_arn
}

# ------------------------------------------------------------------------------
# Helm / Namespace
# ------------------------------------------------------------------------------
output "castai_namespace" {
  description = "Kubernetes namespace where CAST AI components are installed."
  value       = var.castai_namespace
}

output "castai_full_mode" {
  description = "Boolean indicating that CAST AI is installed in full mode (node autoscaler + workload autoscaler + security agent)."
  value       = true
}
