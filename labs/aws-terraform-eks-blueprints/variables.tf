variable "cluster_name" {
  description = "Name of the EKS cluster. Also used to prefix most AWS resources created by the modules."
  type        = string
}

variable "region" {
  description = "AWS region in which to provision the cluster and supporting resources."
  type        = string
  default     = "us-west-2"
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS control plane. Pinned to 1.33 per the lab's version matrix."
  type        = string
  default     = "1.33"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC created by the VPC module. Must be large enough to host public and private subnets across 3 AZs."
  type        = string
  default     = "10.0.0.0/16"
}

variable "managed_node_instance_types" {
  description = "Instance types used by the EKS managed node group that bootstraps the cluster before Karpenter takes over."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "tags" {
  description = "Tags applied to every resource that supports tagging. Merged with module-level tags where applicable."
  type        = map(string)
  default = {
    Environment = "lab"
  }
}
