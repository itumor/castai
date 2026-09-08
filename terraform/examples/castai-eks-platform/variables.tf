# ------------------------------------------------------------------------------
# CAST AI Platform-Scope Example - Variables
# ------------------------------------------------------------------------------
# This example wires the two CAST AI EKS modules together:
#   - terraform/modules/castai-eks-platform     (cluster onboarding
#                                                 + cluster extensions)
#   - terraform/modules/castai-eks-organization (organization resources)
#
# The platform module embeds `castai-eks-full` as an internal sub-module,
# so the example does NOT instantiate `castai-eks-full` separately.
#
# All variables below carry mock/placeholder defaults so that
# `terraform validate` succeeds without real AWS or CAST AI credentials.
# Override the values via terraform.tfvars or environment variables
# (TF_VAR_<name>) before running plan / apply.
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# AWS Configuration (forwarded to castai-eks-platform, which embeds castai-eks-full)
# ------------------------------------------------------------------------------
variable "cluster_name" {
  type        = string
  description = "Name of the existing EKS cluster to onboard to CAST AI."
  default     = "my-cluster"
}

variable "aws_region" {
  type        = string
  description = "AWS region where the existing EKS cluster is located."
  default     = "us-east-1"
}

variable "aws_profile" {
  type        = string
  description = "Optional AWS CLI profile name. If null, the default credential chain is used."
  default     = null
}

variable "vpc_id" {
  type        = string
  description = "ID of the VPC where the existing EKS cluster is deployed."
  default     = "vpc-dummy"
}

variable "subnets" {
  type        = list(string)
  description = "List of subnet IDs that CAST AI may launch nodes into."
  default     = ["subnet-dummy"]
}

variable "node_security_group_ids" {
  type        = list(string)
  description = "Security group IDs attached to nodes provisioned by CAST AI."
  default     = ["sg-dummy"]
}

variable "cluster_security_group_ids" {
  type        = list(string)
  description = "Optional list of additional security group IDs attached to the EKS cluster's ENIs."
  default     = []
}

# ------------------------------------------------------------------------------
# CAST AI Authentication / Connectivity
# ------------------------------------------------------------------------------
variable "castai_api_token" {
  type        = string
  sensitive   = true
  description = "CAST AI organization-level API key. Provide via TF_VAR_castai_api_token in real environments; the default below is a placeholder for static validation only."
  default     = "dummy"

  validation {
    condition     = length(var.castai_api_token) > 0
    error_message = "castai_api_token must not be empty."
  }
}

variable "api_url" {
  type        = string
  description = "CAST AI REST API URL. Used by castai-eks-full and castai-eks-platform."
  default     = "https://api.cast.ai"
}

variable "grpc_url" {
  type        = string
  description = "CAST AI gRPC endpoint. Consumed by the castai-eks-cluster sub-module."
  default     = "https://grpc.cast.ai"
}

variable "castai_api_url" {
  type        = string
  description = "CAST AI REST API URL used by the castai-eks-organization module. Kept separate from var.api_url so organization- and cluster-scoped endpoints can diverge."
  default     = "https://api.cast.ai"
}

# ------------------------------------------------------------------------------
# Cluster / Node Behaviour (forwarded to castai-eks-platform, which embeds castai-eks-full)
# ------------------------------------------------------------------------------
variable "dns_cluster_ip" {
  type        = string
  description = "Optional DNS cluster IP for the EKS cluster's Kubernetes service."
  default     = null
}

variable "delete_nodes_on_disconnect" {
  type        = bool
  description = "If true, nodes created by CAST AI are deleted when the cluster disconnects from CAST AI."
  default     = false
}

# ------------------------------------------------------------------------------
# Component Toggles (forwarded to castai-eks-platform, which embeds castai-eks-full)
# ------------------------------------------------------------------------------
variable "install_security_agent" {
  type        = bool
  description = "Install the CAST AI security agent (kvisor) as part of the umbrella chart."
  default     = true
}

variable "install_workload_autoscaler" {
  type        = bool
  description = "Install the CAST AI workload autoscaler."
  default     = true
}

variable "castai_namespace" {
  type        = string
  description = "Kubernetes namespace where CAST AI components are installed."
  default     = "castai-agent"
}

# ------------------------------------------------------------------------------
# Platform Extension Toggles (forwarded to castai-eks-platform)
# ------------------------------------------------------------------------------
# Each toggle gates a cluster-scoped CAST AI extension resource group. When
# false (the default), no resources are created for that group.
variable "enable_hibernation" {
  type        = bool
  description = "Enable the CAST AI hibernation extension."
  default     = false
}

variable "enable_rebalancing" {
  type        = bool
  description = "Enable the CAST AI rebalancing extension."
  default     = false
}

variable "enable_workload_scaling_policy_order" {
  type        = bool
  description = "Enable configuration of workload scaling policy ordering."
  default     = false
}

variable "enable_pod_mutation" {
  type        = bool
  description = "Enable the CAST AI pod mutation extension."
  default     = false
}

variable "enable_security_runtime_rule" {
  type        = bool
  description = "Enable the CAST AI security runtime rule extension."
  default     = false
}

variable "enable_finops" {
  type        = bool
  description = "Enable the CAST AI FinOps extension."
  default     = false
}

variable "enable_ai_optimizer" {
  type        = bool
  description = "Enable the CAST AI AI optimizer extension."
  default     = false
}

variable "enable_cache" {
  type        = bool
  description = "Enable the CAST AI cache extension."
  default     = false
}

variable "enable_edge" {
  type        = bool
  description = "Enable the CAST AI edge extension."
  default     = false
}

# ------------------------------------------------------------------------------
# Platform Extension Configuration Objects
# ------------------------------------------------------------------------------
# Each `*_config` variable carries the input payload for its corresponding
# extension. Empty by default so the example validates without overrides.
variable "hibernation_config" {
  type        = any
  description = "Configuration object for the hibernation extension."
  default     = {}
}

variable "rebalancing_config" {
  type        = any
  description = "Configuration object for the rebalancing extension."
  default     = {}
}

variable "workload_scaling_policy_order_config" {
  type        = any
  description = "Configuration object for workload scaling policy ordering."
  default     = {}
}

variable "pod_mutation_config" {
  type        = any
  description = "Configuration object for the pod mutation extension."
  default     = {}
}

variable "security_runtime_rule_config" {
  type        = any
  description = "Configuration object for the security runtime rule extension."
  default     = {}
}

variable "finops_config" {
  type        = any
  description = "Configuration object for the FinOps extension."
  default     = {}
}

variable "ai_optimizer_config" {
  type        = any
  description = "Configuration object for the AI optimizer extension."
  default     = {}
}

variable "cache_config" {
  type        = any
  description = "Configuration object for the cache extension."
  default     = {}
}

variable "edge_config" {
  type        = any
  description = "Configuration object for the edge extension."
  default     = {}
}

# ------------------------------------------------------------------------------
# Organization Toggles (forwarded to castai-eks-organization)
# ------------------------------------------------------------------------------
variable "enable_organization_group" {
  type        = bool
  description = "Enable CAST AI organization-group resources."
  default     = false
}

variable "enable_organization_members" {
  type        = bool
  description = "Enable CAST AI organization-members resources."
  default     = false
}

variable "enable_service_account" {
  type        = bool
  description = "Enable CAST AI service-account resources."
  default     = false
}

variable "enable_service_account_key" {
  type        = bool
  description = "Enable CAST AI service-account-key resources."
  default     = false
}

variable "enable_role_bindings" {
  type        = bool
  description = "Enable CAST AI role-binding resources."
  default     = false
}

variable "enable_sso_connection" {
  type        = bool
  description = "Enable CAST AI SSO connection resources."
  default     = false
}

variable "enable_enterprise_group" {
  type        = bool
  description = "Enable CAST AI enterprise-group resources."
  default     = false
}

variable "enable_enterprise_role_binding" {
  type        = bool
  description = "Enable CAST AI enterprise-role-binding resources."
  default     = false
}

variable "enable_enterprise_service_account" {
  type        = bool
  description = "Enable CAST AI enterprise-service-account resources."
  default     = false
}

# ------------------------------------------------------------------------------
# Organization Configuration Objects
# ------------------------------------------------------------------------------
variable "organization_group_config" {
  type        = any
  description = "Configuration object for the organization-group resource group."
  default     = {}
}

variable "organization_members_config" {
  type        = any
  description = "Configuration object for the organization-members resource group."
  default     = {}
}

variable "service_account_config" {
  type        = any
  description = "Configuration object for the service-account resource group."
  default     = {}
}

variable "service_account_key_config" {
  type        = any
  description = "Configuration object for the service-account-key resource group."
  default     = {}
}

variable "role_bindings_config" {
  type        = any
  description = "Configuration object for the role-bindings resource group."
  default     = {}
}

variable "sso_connection_config" {
  type        = any
  description = "Configuration object for the SSO connection resource group."
  default     = {}
}

variable "enterprise_group_config" {
  type        = any
  description = "Configuration object for the enterprise-group resource group."
  default     = {}
}

variable "enterprise_role_binding_config" {
  type        = any
  description = "Configuration object for the enterprise-role-binding resource group."
  default     = {}
}

variable "enterprise_service_account_config" {
  type        = any
  description = "Configuration object for the enterprise-service-account resource group."
  default     = {}
}
