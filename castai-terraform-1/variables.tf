variable "cluster_name" {
  type        = string
  description = "Name of the existing EKS cluster to onboard into CAST AI."

  validation {
    condition     = length(trimspace(var.cluster_name)) > 0
    error_message = "cluster_name must not be empty."
  }
}

variable "aws_region" {
  type        = string
  description = "AWS Region containing the existing EKS cluster."

  validation {
    condition     = length(trimspace(var.aws_region)) > 0
    error_message = "aws_region must not be empty."
  }
}

variable "node_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs available to CAST AI-managed EKS nodes."

  validation {
    condition     = length(var.node_subnet_ids) > 0
    error_message = "node_subnet_ids must contain at least one private subnet ID."
  }

  validation {
    condition     = length(distinct(var.node_subnet_ids)) == length(var.node_subnet_ids)
    error_message = "node_subnet_ids must not contain duplicates."
  }
}

variable "node_security_group_ids" {
  type        = list(string)
  description = "Worker-compatible security group IDs for CAST AI-managed EKS nodes."

  validation {
    condition     = length(var.node_security_group_ids) > 0
    error_message = "node_security_group_ids must contain at least one security group ID."
  }

  validation {
    condition     = length(distinct(var.node_security_group_ids)) == length(var.node_security_group_ids)
    error_message = "node_security_group_ids must not contain duplicates."
  }
}

variable "max_cluster_cpu_cores" {
  type        = number
  description = "Maximum total vCPU allowed by the CAST AI autoscaler."

  validation {
    condition     = var.max_cluster_cpu_cores > 0 && var.max_cluster_cpu_cores == floor(var.max_cluster_cpu_cores)
    error_message = "max_cluster_cpu_cores must be a positive integer."
  }

  validation {
    condition     = var.max_cluster_cpu_cores >= var.min_cluster_cpu_cores
    error_message = "max_cluster_cpu_cores must be greater than or equal to min_cluster_cpu_cores."
  }
}

variable "castai_api_token" {
  type        = string
  description = "CAST AI API token. Supply through TF_VAR_castai_api_token."
  sensitive   = true

  validation {
    condition     = length(trimspace(nonsensitive(var.castai_api_token))) > 0
    error_message = "castai_api_token must not be empty."
  }
}

variable "aws_profile" {
  type        = string
  description = "Optional shared AWS CLI profile. Null uses the standard AWS credential chain."
  default     = null
  nullable    = true

  validation {
    condition     = var.aws_profile == null || length(trimspace(var.aws_profile)) > 0
    error_message = "aws_profile must be null or a nonempty profile name."
  }
}

variable "min_cluster_cpu_cores" {
  type        = number
  description = "Minimum total vCPU maintained by the CAST AI autoscaler."
  default     = 1

  validation {
    condition     = var.min_cluster_cpu_cores > 0 && var.min_cluster_cpu_cores == floor(var.min_cluster_cpu_cores)
    error_message = "min_cluster_cpu_cores must be a positive integer."
  }
}

variable "node_tags" {
  type        = map(string)
  description = "AWS tags added to CAST AI-managed nodes."
  default     = {}
}

variable "delete_nodes_on_disconnect" {
  type        = bool
  description = "Delete CAST AI-created nodes when disconnecting the cluster. Keep false for safe teardown."
  default     = false
}

