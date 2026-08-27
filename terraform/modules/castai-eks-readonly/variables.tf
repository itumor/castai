# ------------------------------------------------------------------------------
# AWS Configuration
# ------------------------------------------------------------------------------
variable "cluster_name" {
  type        = string
  description = "Name of the existing EKS cluster to onboard to CAST AI."

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

# ------------------------------------------------------------------------------
# CAST AI Authentication
# ------------------------------------------------------------------------------
variable "castai_api_token" {
  type        = string
  sensitive   = true
  nullable    = false
  description = "CAST AI organization-level API key used for read-only cluster onboarding. Required. Provide via TF_VAR_castai_api_token environment variable or a secrets backend."

  validation {
    condition     = length(var.castai_api_token) > 0
    error_message = "castai_api_token must not be empty."
  }
}

# ------------------------------------------------------------------------------
# Helm Configuration
# ------------------------------------------------------------------------------
variable "castai_chart_version" {
  type        = string
  description = "Version of the castai umbrella Helm chart to install. Leave empty to use the latest published version."
  default     = ""
}

variable "castai_namespace" {
  type        = string
  description = "Kubernetes namespace where CAST AI components are installed."
  default     = "castai-agent"
}

variable "castai_release_name" {
  type        = string
  description = "Helm release name for the CAST AI umbrella chart."
  default     = "castai"
}
