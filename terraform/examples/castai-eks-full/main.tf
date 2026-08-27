# ------------------------------------------------------------------------------
# CAST AI Full-Mode Onboarding for EKS - Example Root
# ------------------------------------------------------------------------------
# This example wires the local reusable module `terraform/modules/castai-eks-full`
# to a root that holds only the values needed for a single existing EKS cluster.
#
# What this example deploys:
#   - The EKS cluster, VPC, and subnets are NOT created by this example.
#     They must already exist and be passed in as variables.
#   - CAST AI IAM role and instance profile for the cluster (via the
#     `castai/eks-role-iam` Terraform module).
#   - An EKS access entry + access policy association that grants the
#     CAST AI node instance profile role permission to join the cluster
#     with the AmazonEKSWorkerNodePolicy.
#   - Cluster registration with CAST AI (`castai_eks_cluster`).
#   - A Helm release of the CAST AI umbrella chart (full mode) installed via
#     the `castai/eks-cluster` Terraform module, including node autoscaler,
#     workload autoscaler, and security agent as configured.
#   - A default `castai_node_configuration` and `castai_node_template` so
#     CAST AI can start managing nodes immediately after registration.
# ------------------------------------------------------------------------------

module "castai_eks_full" {
  source = "../../modules/castai-eks-full"

  # AWS configuration
  cluster_name = var.cluster_name
  aws_region   = var.aws_region
  aws_profile  = var.aws_profile

  # Networking
  vpc_id                     = var.vpc_id
  subnets                    = var.subnets
  node_security_group_ids    = var.node_security_group_ids
  cluster_security_group_ids = var.cluster_security_group_ids

  # CAST AI authentication (token is sensitive; never echo in plan output)
  castai_api_token = var.castai_api_token
  api_url          = var.api_url
  grpc_url         = var.grpc_url

  # Cluster / node behaviour
  dns_cluster_ip             = var.dns_cluster_ip
  delete_nodes_on_disconnect = var.delete_nodes_on_disconnect

  # Component toggles
  install_security_agent      = var.install_security_agent
  install_workload_autoscaler = var.install_workload_autoscaler
  castai_namespace            = var.castai_namespace
}
