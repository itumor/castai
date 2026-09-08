# ------------------------------------------------------------------------------
# AWS Configuration (passthrough to castai-eks-full)
# ------------------------------------------------------------------------------
variable "cluster_name" {
  type        = string
  description = "Name of the existing EKS cluster to onboard to CAST AI."
}

variable "aws_region" {
  type        = string
  description = "AWS region where the existing EKS cluster is located."
}

variable "aws_profile" {
  type        = string
  description = "Optional AWS CLI profile name. If null, the default credential chain is used."
  default     = null
}

variable "vpc_id" {
  type        = string
  description = "ID of the VPC where the existing EKS cluster is deployed."
}

variable "subnets" {
  type        = list(string)
  description = "List of subnet IDs that CAST AI may launch nodes into."
  default     = []
}

variable "node_security_group_ids" {
  type        = list(string)
  description = "Security group IDs attached to nodes provisioned by CAST AI."
  default     = []
}

variable "cluster_security_group_ids" {
  type        = list(string)
  description = "Optional list of additional security group IDs attached to the EKS cluster's ENIs."
  default     = []
}

# ------------------------------------------------------------------------------
# CAST AI Authentication / Connectivity (passthrough to castai-eks-full)
# ------------------------------------------------------------------------------
variable "castai_api_token" {
  type        = string
  sensitive   = true
  description = "CAST AI organization-level API key used for full-mode cluster onboarding."
}

variable "api_url" {
  type        = string
  description = "CAST AI REST API URL."
  default     = "https://api.cast.ai"
}

variable "grpc_url" {
  type        = string
  description = "CAST AI gRPC endpoint."
  default     = "https://grpc.cast.ai"
}

# ------------------------------------------------------------------------------
# Cluster / Node Behaviour (passthrough to castai-eks-full)
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
# Component Toggles (passthrough to castai-eks-full)
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
# Extension Toggles
# ------------------------------------------------------------------------------
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
# Extension Configuration Objects
# ------------------------------------------------------------------------------
variable "hibernation_config" {
  type        = any
  description = "Configuration object for the hibernation extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "rebalancing_config" {
  type        = any
  description = "Configuration object for the rebalancing extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "workload_scaling_policy_order_config" {
  type        = any
  description = "Configuration object for workload scaling policy ordering. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "pod_mutation_config" {
  type        = any
  description = "Configuration object for the pod mutation extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "security_runtime_rule_config" {
  type        = any
  description = "Configuration object for the security runtime rule extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "finops_config" {
  type        = any
  description = "Configuration object for the FinOps extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "ai_optimizer_config" {
  type        = any
  description = "Configuration object for the AI optimizer extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "cache_config" {
  type        = any
  description = "Configuration object for the cache extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "edge_config" {
  type        = any
  description = "Configuration object for the edge extension. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}
