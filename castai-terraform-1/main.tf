resource "castai_eks_clusterid" "target" {
  account_id   = data.aws_caller_identity.current.account_id
  region       = var.aws_region
  cluster_name = var.cluster_name
}

resource "castai_eks_user_arn" "target" {
  cluster_id = castai_eks_clusterid.target.id
}

module "castai_eks_role_iam" {
  source  = "castai/eks-role-iam/castai"
  version = "2.0.4"

  aws_account_id     = data.aws_caller_identity.current.account_id
  aws_cluster_name   = var.cluster_name
  aws_cluster_region = var.aws_region
  aws_cluster_vpc_id = local.cluster_vpc_id
  castai_user_arn    = castai_eks_user_arn.target.arn

  create_iam_resources_per_cluster = true
  attach_worker_cni_policy         = true
  attach_ebs_csi_driver_policy     = true
  attach_ssm_managed_instance_core = false
  enable_ipv6                      = local.cluster_ip_family == "ipv6"

  depends_on = [terraform_data.preflight]
}

resource "aws_eks_access_entry" "castai_nodes" {
  cluster_name  = data.aws_eks_cluster.target.name
  principal_arn = module.castai_eks_role_iam.instance_profile_role_arn
  type          = "EC2_LINUX"

  depends_on = [terraform_data.preflight]
}

module "castai_eks_cluster" {
  source  = "castai/eks-cluster/castai"
  version = "14.6.1"

  aws_account_id      = data.aws_caller_identity.current.account_id
  aws_cluster_name    = var.cluster_name
  aws_cluster_region  = var.aws_region
  aws_assume_role_arn = module.castai_eks_role_iam.role_arn

  castai_api_token           = var.castai_api_token
  wait_for_cluster_ready     = true
  delete_nodes_on_disconnect = var.delete_nodes_on_disconnect

  default_node_configuration_name = "default"
  node_configurations = {
    default = {
      name                 = "default"
      subnets              = var.node_subnet_ids
      security_groups      = var.node_security_group_ids
      instance_profile_arn = module.castai_eks_role_iam.instance_profile_arn
      min_disk_size        = 100
      volume_type          = "gp3"
      imds_v1              = false
      tags                 = var.node_tags
    }
  }

  node_templates = {
    default = {
      name               = "default"
      configuration_name = "default"
      is_default         = true
      is_enabled         = true
      should_taint       = false

      constraints = {
        architectures                               = ["amd64"]
        spot                                        = true
        on_demand                                   = false
        use_spot_fallbacks                          = true
        fallback_restore_rate_seconds               = 1800
        enable_spot_diversity                       = true
        spot_diversity_price_increase_limit_percent = 20
      }
    }
  }

  autoscaler_settings = {
    enabled                                 = true
    is_scoped_mode                          = false
    node_templates_partial_matching_enabled = false

    unschedulable_pods = {
      enabled = true
    }

    cluster_limits = {
      enabled = true
      cpu = {
        min_cores = var.min_cluster_cpu_cores
        max_cores = var.max_cluster_cpu_cores
      }
    }

    node_downscaler = {
      enabled = true

      empty_nodes = {
        enabled       = true
        delay_seconds = 300
      }

      evictor = {
        enabled                       = true
        dry_run                       = false
        aggressive_mode               = false
        scoped_mode                   = false
        cycle_interval                = "60s"
        node_grace_period_minutes     = 10
        ignore_pod_disruption_budgets = false
      }
    }
  }

  install_security_agent               = false
  install_workload_autoscaler          = false
  install_workload_autoscaler_exporter = false
  install_pod_mutator                  = false
  install_egressd                      = false
  install_live                         = false
  install_live_cni                     = false
  install_ai_optimizer                 = false
  install_omni                         = false

  depends_on = [aws_eks_access_entry.castai_nodes]
}

