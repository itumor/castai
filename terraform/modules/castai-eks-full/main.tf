# ------------------------------------------------------------------------------
# CAST AI Full-Mode Onboarding for EKS
# ------------------------------------------------------------------------------
# This module:
#   - discovers the existing EKS cluster,
#   - creates the CAST AI user ARN and cluster-id resources,
#   - provisions CAST AI IAM resources via the official `castai-eks-role-iam`
#     module,
#   - registers the cluster with CAST AI via `castai_eks_cluster.this`,
#   - installs the CAST AI umbrella chart (full mode) via the official
#     `castai-eks-cluster` module,
#   - grants the CAST AI node instance profile role access to the EKS cluster
#     via `aws_eks_access_entry` and `aws_eks_access_policy_association`,
#   - defines a default `castai_node_configuration` and `castai_node_template`
#     so CAST AI can start managing nodes immediately after registration.
#
# The EKS cluster, VPC and subnets are NOT created by this module. They must
# already exist and be passed in as variables.
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# CAST AI: Discover the EKS cluster and derive a CAST AI cluster-id
# ------------------------------------------------------------------------------
resource "castai_eks_clusterid" "cluster_id" {
  account_id   = data.aws_caller_identity.current.account_id
  region       = var.aws_region
  cluster_name = var.cluster_name
}

# ------------------------------------------------------------------------------
# CAST AI: User ARN used to assume the cluster registration role
# ------------------------------------------------------------------------------
resource "castai_eks_user_arn" "castai_user_arn" {
  cluster_id = castai_eks_clusterid.cluster_id.id
}

# ------------------------------------------------------------------------------
# CAST AI: IAM roles / instance profile / policies for EKS onboarding
# ------------------------------------------------------------------------------
module "castai-eks-role-iam" {
  source  = "castai/eks-role-iam/castai"
  version = "~> 2.0.4"

  aws_account_id     = data.aws_caller_identity.current.account_id
  aws_cluster_region = var.aws_region
  aws_cluster_name   = var.cluster_name
  aws_cluster_vpc_id = var.vpc_id

  castai_user_arn                  = castai_eks_user_arn.castai_user_arn.arn
  create_iam_resources_per_cluster = true
}

# ------------------------------------------------------------------------------
# AWS: Allow the CAST AI node instance profile role to access the EKS cluster
# ------------------------------------------------------------------------------
resource "aws_eks_access_entry" "castai_nodes" {
  cluster_name  = var.cluster_name
  principal_arn = module.castai-eks-role-iam.instance_profile_role_arn
  type          = "EC2_LINUX"
}

resource "aws_eks_access_policy_association" "castai_nodes_worker" {
  cluster_name  = var.cluster_name
  policy_arn    = "arn:aws:eks::aws:policy/AmazonEKSWorkerNodePolicy"
  principal_arn = module.castai-eks-role-iam.instance_profile_role_arn

  access_scope {
    type = "cluster"
  }
}

# ------------------------------------------------------------------------------
# CAST AI: Cluster module — installs Helm releases for full mode
# ------------------------------------------------------------------------------
module "castai-eks-cluster" {
  source  = "castai/eks-cluster/castai"
  version = "~> 14.9.0"

  aws_account_id     = data.aws_caller_identity.current.account_id
  aws_cluster_region = var.aws_region
  aws_cluster_name   = var.cluster_name

  castai_api_token    = var.castai_api_token
  api_url             = var.api_url
  grpc_url            = var.grpc_url
  aws_assume_role_arn = module.castai-eks-role-iam.role_arn

  delete_nodes_on_disconnect = var.delete_nodes_on_disconnect

  install_security_agent      = var.install_security_agent
  install_workload_autoscaler = var.install_workload_autoscaler

  # The configuration named "default" inside node_configurations is promoted
  # to the cluster default by name; this avoids a self-reference on the
  # module output and lets the castai-eks-cluster module own the resources.
  default_node_configuration_name = "default"

  node_configurations = {
    default = {
      subnets              = var.subnets
      security_groups      = var.node_security_group_ids
      instance_profile_arn = module.castai-eks-role-iam.instance_profile_arn
      dns_cluster_ip       = var.dns_cluster_ip
    }
  }

  # Default node template CAST AI will assign to newly reconciled nodes.
  node_templates = {
    default_by_castai = {
      configuration_id = module.castai-eks-cluster.castai_node_configurations["default"]
      is_default       = true
      is_enabled       = true
      should_taint     = false
    }
  }
}
