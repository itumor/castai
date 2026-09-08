# ------------------------------------------------------------------------------
# Example outputs
# ------------------------------------------------------------------------------
# Pass-through outputs from the three wired-in modules. No secrets,
# credentials, or authentication tokens are exposed here.

# ------------------------------------------------------------------------------
# Cluster Identity (from castai-eks-platform, which wraps castai-eks-full)
# ------------------------------------------------------------------------------
output "cluster_id" {
  description = "CAST AI cluster identifier (UUID) for the onboarded EKS cluster."
  value       = module.castai_eks_platform.cluster_id
}

output "cluster_name" {
  description = "Name of the onboarded EKS cluster."
  value       = module.castai_eks_platform.cluster_name
}

# ------------------------------------------------------------------------------
# IAM (from castai-eks-platform, which wraps castai-eks-full)
# ------------------------------------------------------------------------------
output "assume_role_arn" {
  description = "ARN of the CAST AI IAM role that the CAST AI controller assumes to manage the cluster."
  value       = module.castai_eks_platform.assume_role_arn
}

output "instance_profile_arn" {
  description = "ARN of the IAM instance profile used by CAST AI-managed nodes."
  value       = module.castai_eks_platform.instance_profile_arn
}

# ------------------------------------------------------------------------------
# Helm / Namespace (from castai-eks-platform, which wraps castai-eks-full)
# ------------------------------------------------------------------------------
output "castai_namespace" {
  description = "Kubernetes namespace where CAST AI components are installed."
  value       = module.castai_eks_platform.castai_namespace
}

output "castai_full_mode" {
  description = "Boolean indicating that CAST AI is installed in full mode (node autoscaler + workload autoscaler + security agent)."
  value       = module.castai_eks_platform.castai_full_mode
}

# ------------------------------------------------------------------------------
# Platform Module (from castai-eks-platform)
# ------------------------------------------------------------------------------
output "platform_cluster_id" {
  description = "Cluster ID exposed by the platform module (sourced from its internal castai-eks-full sub-module)."
  value       = module.castai_eks_platform.cluster_id
}

output "platform_cluster_name" {
  description = "Cluster name exposed by the platform module."
  value       = module.castai_eks_platform.cluster_name
}

# ------------------------------------------------------------------------------
# Organization Module (from castai-eks-organization)
# ------------------------------------------------------------------------------
output "organization_resource_ids" {
  description = "Map of organization-scope resource group -> id of the created resource. Each value is null when the corresponding enable_* toggle is false."
  value       = module.castai_eks_organization.resource_ids
}

output "organization_enabled_flags" {
  description = "Map of organization-scope resource group -> enable flag, reflecting the current module configuration."
  value       = module.castai_eks_organization.enabled_flags
}
