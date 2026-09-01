output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = var.cluster_name
}

output "cluster_endpoint" {
  description = "Kubernetes API server endpoint for the EKS cluster."
  value       = module.eks.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes version running on the EKS control plane."
  value       = module.eks.cluster_version
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded CA certificate for the EKS cluster API server, suitable for use in kubeconfigs and provider blocks."
  value       = module.eks.cluster_certificate_authority_data
}

output "cluster_oidc_issuer_url" {
  description = "OIDC issuer URL of the EKS cluster. Used to configure IAM roles for service accounts (IRSA)."
  value       = try(module.eks.cluster_oidc_issuer_url, null)
}

output "oidc_provider" {
  description = "OIDC provider for the EKS cluster, as an attribute object with arn and url. Used to wire up IRSA without an extra data source."
  value       = module.eks.oidc_provider
}

output "cluster_security_group_id" {
  description = "ID of the security group attached to the EKS cluster's ENIs (the cluster control plane security group)."
  value       = module.eks.cluster_security_group_id
}

output "vpc_id" {
  description = "ID of the VPC hosting the EKS cluster."
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "IDs of the VPC's private subnets across the selected AZs."
  value       = module.vpc.private_subnets
}

output "public_subnets" {
  description = "IDs of the VPC's public subnets across the selected AZs."
  value       = module.vpc.public_subnets
}

output "intra_subnets" {
  description = "IDs of the VPC's intra (private-without-route-to-NAT) subnets across the selected AZs."
  value       = module.vpc.intra_subnets
}

# Karpenter outputs surfaced from the eks-blueprints-addons module. Wrapped in
# try() so a future schema change that renames the underlying attribute does
# not break consumers; the outputs will then resolve to null.
output "karpenter_node_iam_role_name" {
  description = "Name of the IAM role assumed by Karpenter-provisioned EC2 nodes. Empty if the addons module did not expose this attribute."
  value       = try(module.eks_blueprints_addons.karpenter.node_iam_role_name, null)
}

output "karpenter_service_account_name" {
  description = "Name of the Kubernetes service account used by the Karpenter controller. Empty if the addons module did not expose this attribute."
  value       = try(module.eks_blueprints_addons.karpenter.service_account, null)
}

output "karpenter_node_instance_profile_name" {
  description = "Name of the IAM instance profile that Karpenter-provisioned nodes should use. Rendered into k8s/karpenter-nodeclass.yaml via envsubst."
  value       = try(module.eks_blueprints_addons.karpenter.node_instance_profile_name, null)
}
