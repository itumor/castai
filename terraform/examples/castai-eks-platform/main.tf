# ------------------------------------------------------------------------------
# CAST AI Platform-Scope Onboarding for EKS - Example Root
# ------------------------------------------------------------------------------
# This example wires two local reusable modules together:
#
#   - terraform/modules/castai-eks-platform     - cluster onboarding (full mode)
#                                                 + cluster-scoped CAST AI extensions
#   - terraform/modules/castai-eks-organization - organization-scoped CAST AI resources
#
# Note: `castai-eks-platform` embeds `castai-eks-full` as an internal
# sub-module and derives `cluster_id` from it. This example therefore uses
# only the platform module for cluster onboarding and extensions; it does
# NOT instantiate `castai-eks-full` separately, which would create
# duplicate IAM, access entry and cluster resources.
#
# What this example deploys (with all `enable_*` flags left at their default
# false value):
#   - The EKS cluster, VPC and subnets are NOT created by this example.
#     They must already exist and be passed in as variables.
#   - CAST AI IAM role and instance profile for the cluster (via the
#     `castai/eks-role-iam` Terraform module inside the platform module's
#     internal `castai-eks-full` sub-module).
#   - An EKS access entry + access policy association granting the CAST AI
#     node instance profile role permission to join the cluster.
#   - Cluster registration with CAST AI and Helm installation of the CAST AI
#     umbrella chart (full mode).
#   - A default `castai_node_configuration` and `castai_node_template`.
#   - No platform extensions (hibernation, rebalancing, pod mutation, ...)
#     and no organization resources (groups, members, role bindings, ...)
#     are created until their `enable_*` toggles are flipped to true.
#
# Flip the relevant `enable_*` toggles in terraform.tfvars to provision the
# associated CAST AI resources. All config objects default to `{}` so the
# plan remains valid when toggles are turned on without overrides.
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# castai-eks-platform - cluster onboarding + cluster-scoped extensions
# ------------------------------------------------------------------------------
# The platform module owns its own `castai-eks-full` sub-module and derives
# `cluster_id` internally from it. This example never instantiates
# `castai-eks-full` separately, so there is exactly one set of cluster
# onboarding resources. Consumers reference cluster identity and IAM
# outputs via the platform module.
module "castai_eks_platform" {
  source = "../../modules/castai-eks-platform"

  # AWS configuration
  cluster_name               = var.cluster_name
  aws_region                 = var.aws_region
  aws_profile                = var.aws_profile
  vpc_id                     = var.vpc_id
  subnets                    = var.subnets
  node_security_group_ids    = var.node_security_group_ids
  cluster_security_group_ids = var.cluster_security_group_ids

  # CAST AI authentication
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

  # Extension toggles (defaults to false -> no resources created)
  enable_hibernation                   = var.enable_hibernation
  enable_rebalancing                   = var.enable_rebalancing
  enable_workload_scaling_policy_order = var.enable_workload_scaling_policy_order
  enable_pod_mutation                  = var.enable_pod_mutation
  enable_security_runtime_rule         = var.enable_security_runtime_rule
  enable_finops                        = var.enable_finops
  enable_ai_optimizer                  = var.enable_ai_optimizer
  enable_cache                         = var.enable_cache
  enable_edge                          = var.enable_edge

  # Extension configuration objects
  hibernation_config                   = var.hibernation_config
  rebalancing_config                   = var.rebalancing_config
  workload_scaling_policy_order_config = var.workload_scaling_policy_order_config
  pod_mutation_config                  = var.pod_mutation_config
  security_runtime_rule_config         = var.security_runtime_rule_config
  finops_config                        = var.finops_config
  ai_optimizer_config                  = var.ai_optimizer_config
  cache_config                         = var.cache_config
  edge_config                          = var.edge_config
}

# ------------------------------------------------------------------------------
# castai-eks-organization - organization-scoped CAST AI resources
# ------------------------------------------------------------------------------
# Provisions organization-scope CAST AI resources (groups, members, service
# accounts, keys, role bindings and SSO connections). All `enable_*` toggles
# default to false, so by default no organization resources are created.
module "castai_eks_organization" {
  source = "../../modules/castai-eks-organization"

  # CAST AI authentication
  castai_api_token = var.castai_api_token
  castai_api_url   = var.castai_api_url

  # Component toggles (defaults to false -> no resources created)
  enable_organization_group         = var.enable_organization_group
  enable_organization_members       = var.enable_organization_members
  enable_service_account            = var.enable_service_account
  enable_service_account_key        = var.enable_service_account_key
  enable_role_bindings              = var.enable_role_bindings
  enable_sso_connection             = var.enable_sso_connection
  enable_enterprise_group           = var.enable_enterprise_group
  enable_enterprise_role_binding    = var.enable_enterprise_role_binding
  enable_enterprise_service_account = var.enable_enterprise_service_account

  # Configuration objects
  organization_group_config         = var.organization_group_config
  organization_members_config       = var.organization_members_config
  service_account_config            = var.service_account_config
  service_account_key_config        = var.service_account_key_config
  role_bindings_config              = var.role_bindings_config
  sso_connection_config             = var.sso_connection_config
  enterprise_group_config           = var.enterprise_group_config
  enterprise_role_binding_config    = var.enterprise_role_binding_config
  enterprise_service_account_config = var.enterprise_service_account_config
}
