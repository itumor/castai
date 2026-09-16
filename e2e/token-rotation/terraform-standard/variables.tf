variable "cluster_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnets" {
  type = list(string)
}

variable "node_security_group_ids" {
  type = list(string)
}

variable "cluster_security_group_ids" {
  type = list(string)
}

variable "castai_api_token" {
  type      = string
  sensitive = true
}

variable "api_url" {
  type    = string
  default = "https://api.eu.cast.ai"
}

variable "grpc_url" {
  type    = string
  default = "grpc.eu.cast.ai:443"
}
