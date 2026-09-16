output "cluster_id" {
  description = "CAST AI cluster ID"
  value       = module.castai_eks_full.cluster_id
}

output "assume_role_arn" {
  description = "CAST AI assume role ARN"
  value       = module.castai_eks_full.assume_role_arn
}
