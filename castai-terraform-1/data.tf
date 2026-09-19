data "aws_caller_identity" "current" {}

data "aws_eks_cluster" "target" {
  name = var.cluster_name
}

data "aws_subnet" "nodes" {
  for_each = toset(var.node_subnet_ids)
  id       = each.value
}

data "aws_security_group" "nodes" {
  for_each = toset(var.node_security_group_ids)
  id       = each.value
}

locals {
  cluster_authentication_mode = data.aws_eks_cluster.target.access_config[0].authentication_mode
  cluster_ip_family           = lower(data.aws_eks_cluster.target.kubernetes_network_config[0].ip_family)
  cluster_vpc_id              = data.aws_eks_cluster.target.vpc_config[0].vpc_id
}

resource "terraform_data" "preflight" {
  input = {
    authentication_mode = local.cluster_authentication_mode
    cluster_vpc_id      = local.cluster_vpc_id
    security_group_ids  = var.node_security_group_ids
    subnet_ids          = var.node_subnet_ids
  }

  lifecycle {
    precondition {
      condition     = contains(["API", "API_AND_CONFIG_MAP"], local.cluster_authentication_mode)
      error_message = "EKS cluster authentication mode must be API or API_AND_CONFIG_MAP. Migrate legacy CONFIG_MAP authentication before installing CAST AI."
    }

    precondition {
      condition = alltrue([
        for subnet in data.aws_subnet.nodes : subnet.vpc_id == local.cluster_vpc_id
      ])
      error_message = "Every node subnet must belong to the EKS cluster VPC."
    }

    precondition {
      condition = alltrue([
        for subnet in data.aws_subnet.nodes : !subnet.map_public_ip_on_launch
      ])
      error_message = "Every node subnet must have public-IP auto-assignment disabled. Supply private worker subnets."
    }

    precondition {
      condition = alltrue([
        for security_group in data.aws_security_group.nodes : security_group.vpc_id == local.cluster_vpc_id
      ])
      error_message = "Every node security group must belong to the EKS cluster VPC."
    }
  }
}

