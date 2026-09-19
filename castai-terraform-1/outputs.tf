output "castai_cluster_id" {
  description = "CAST AI cluster ID."
  value       = module.castai_eks_cluster.cluster_id
}

output "castai_organization_id" {
  description = "CAST AI organization ID."
  value       = module.castai_eks_cluster.organization_id
}

output "castai_assume_role_arn" {
  description = "AWS IAM role assumed by CAST AI."
  value       = module.castai_eks_role_iam.role_arn
}

output "castai_node_instance_profile_arn" {
  description = "AWS instance profile used by CAST AI-managed nodes."
  value       = module.castai_eks_role_iam.instance_profile_arn
}

output "eks_authentication_mode" {
  description = "Authentication mode reported by the target EKS cluster."
  value       = local.cluster_authentication_mode
}

