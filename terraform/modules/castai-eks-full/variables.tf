# ------------------------------------------------------------------------------
# AWS Configuration
# ------------------------------------------------------------------------------
variable "cluster_name" {
  type        = string
  description = "Name of the existing EKS cluster to onboard to CAST AI in full mode."

  validation {
    condition     = length(var.cluster_name) > 0
    error_message = "cluster_name must not be empty."
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region where the existing EKS cluster is located."

  validation {
    condition     = length(var.aws_region) > 0
    error_message = "aws_region must not be empty."
  }
}

variable "aws_profile" {
  type        = string
  description = "Optional AWS CLI profile name. If null, the default credential chain is used."
  default     = null
}

variable "vpc_id" {
  type        = string
  description = "ID of the VPC where the existing EKS cluster is deployed. Required so that CAST AI IAM resources can be scoped to the correct VPC."

  validation {
    condition     = length(var.vpc_id) > 0
    error_message = "vpc_id must not be empty."
  }
}

variable "subnets" {
  type        = list(string)
  description = "List of subnet IDs that CAST AI may launch nodes into. At least one subnet is required."
  default     = []

  validation {
    condition     = length(var.subnets) > 0
    error_message = "subnets must contain at least one subnet ID."
  }
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
# CAST AI Authentication / Connectivity
# ------------------------------------------------------------------------------
variable "castai_api_token" {
  type        = string
  sensitive   = true
  nullable    = false
  description = "CAST AI organization-level API key used for full-mode cluster onboarding. Required. Provide via TF_VAR_castai_api_token environment variable or a secrets backend."

  validation {
    condition     = length(var.castai_api_token) > 0
    error_message = "castai_api_token must not be empty."
  }
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
# Cluster / Node Behaviour
# ------------------------------------------------------------------------------
variable "dns_cluster_ip" {
  type        = string
  description = "Optional DNS cluster IP for the EKS cluster's Kubernetes service. Required in some custom networking setups; null lets the module derive it automatically."
  default     = null
}

variable "delete_nodes_on_disconnect" {
  type        = bool
  description = "If true, nodes created by CAST AI are deleted when the cluster disconnects from CAST AI."
  default     = false
}

# ------------------------------------------------------------------------------
# Component Toggles
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
