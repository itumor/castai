# ------------------------------------------------------------------------------
# CAST AI Platform-Scope Onboarding for EKS
# ------------------------------------------------------------------------------
# This module wraps the `castai-eks-full` module so that platform-scoped
# consumers (AWS-account / org-level) can reuse the per-cluster onboarding
# logic while enabling optional extensions via toggle variables:
#   - hibernation
#   - rebalancing
#   - workload scaling policy order
#   - pod mutation
#   - security runtime rule
#   - finops
#   - ai optimizer
#   - cache
#   - edge
#
# Extension toggles are declared in variables.tf and wired to the appropriate
# CAST AI resources below. Configuration objects (type = any, default = {}) are
# exposed alongside each toggle so consumers can supply extension-specific
# configuration without forcing this module to model every option statically.
# ------------------------------------------------------------------------------

module "castai_eks_full" {
  source = "../castai-eks-full"

  # AWS
  cluster_name               = var.cluster_name
  aws_region                 = var.aws_region
  aws_profile                = var.aws_profile
  vpc_id                     = var.vpc_id
  subnets                    = var.subnets
  node_security_group_ids    = var.node_security_group_ids
  cluster_security_group_ids = var.cluster_security_group_ids

  # CAST AI connectivity
  castai_api_token = var.castai_api_token
  api_url          = var.api_url
  grpc_url         = var.grpc_url

  # Cluster / node behaviour
  dns_cluster_ip             = var.dns_cluster_ip
  delete_nodes_on_disconnect = var.delete_nodes_on_disconnect

  # Component toggles
  install_security_agent      = var.install_security_agent
  install_workload_autoscaler = var.install_workload_autoscaler

  castai_namespace = var.castai_namespace

  # Note: extension toggles (enable_hibernation, enable_rebalancing, ...) and
  # their configuration objects are declared as inputs on this module and are
  # consumed by the extension resources defined below. They are not forwarded
  # to castai-eks-full because that module does not declare them.
}

# ------------------------------------------------------------------------------
# Optional Extensions (cluster-scoped)
# ------------------------------------------------------------------------------
# Each extension below is gated by an `enable_*` toggle and sources its
# configuration from a corresponding `*_config` variable (type = any, default
# = {}). All resources use `count = var.enable_xxx ? 1 : 0` so they create no
# resources by default. The cluster_id is sourced from the castai-eks-full
# sub-module output so this module does not need to know the CAST AI
# resource identity.
#
# All resource attributes below were verified against the castai/castai
# provider v9.2.1 schema (terraform providers schema -json).
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# Hibernation schedule
# ------------------------------------------------------------------------------
# Schema (castai_eks_platform provider v9.2.1):
#   top-level: organization_id (opt, computed), name (req), enabled (req),
#              id (opt, computed)
#   blocks:
#     cluster_assignments { max=1, list of { assignment { cluster_id REQ } } }
#     pause_config        { max=1, { enabled REQ,
#                                    schedule { min=1 max=1 { cron_expression REQ } } } }
#     resume_config       { max=1, { enabled REQ,
#                                    job_config.node_config { instance_type REQ ... },
#                                    schedule { cron_expression REQ } } }
# ------------------------------------------------------------------------------
resource "castai_hibernation_schedule" "this" {
  count = var.enable_hibernation ? 1 : 0

  name    = lookup(var.hibernation_config, "name", "default-hibernation")
  enabled = lookup(var.hibernation_config, "enabled", true)

  dynamic "cluster_assignments" {
    for_each = lookup(var.hibernation_config, "cluster_assignments", null) == null ? [] : [1]
    content {
      dynamic "assignment" {
        for_each = [module.castai_eks_full.cluster_id]
        content {
          cluster_id = assignment.value
        }
      }
    }
  }

  dynamic "pause_config" {
    for_each = [1]
    content {
      enabled = lookup(lookup(var.hibernation_config, "pause_config", {}), "enabled", true)
      dynamic "schedule" {
        for_each = lookup(lookup(var.hibernation_config, "pause_config", {}), "schedule", null) == null ? [] : [1]
        content {
          cron_expression = lookup(lookup(lookup(var.hibernation_config, "pause_config", {}), "schedule", {}), "cron_expression", "0 0 * * ?")
        }
      }
    }
  }

  dynamic "resume_config" {
    for_each = [1]
    content {
      enabled = lookup(lookup(var.hibernation_config, "resume_config", {}), "enabled", true)
      dynamic "schedule" {
        for_each = lookup(lookup(var.hibernation_config, "resume_config", {}), "schedule", null) == null ? [] : [1]
        content {
          cron_expression = lookup(lookup(lookup(var.hibernation_config, "resume_config", {}), "schedule", {}), "cron_expression", "0 8 * * ?")
        }
      }
      dynamic "job_config" {
        for_each = lookup(lookup(var.hibernation_config, "resume_config", {}), "job_config", null) == null ? [] : [1]
        content {
          dynamic "node_config" {
            for_each = [lookup(lookup(lookup(var.hibernation_config, "resume_config", {}), "job_config", {}), "node_config", {})]
            content {
              instance_type     = lookup(node_config.value, "instance_type", "m5.large")
              config_id         = lookup(node_config.value, "config_id", null)
              config_name       = lookup(node_config.value, "config_name", null)
              subnet_id         = lookup(node_config.value, "subnet_id", null)
              zone              = lookup(node_config.value, "zone", null)
              kubernetes_labels = lookup(node_config.value, "kubernetes_labels", null)
            }
          }
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# Rebalancing schedule
# ------------------------------------------------------------------------------
# Schema (v9.2.1): name (req), id (opt/computed). NO cluster_id at top level.
# Blocks:
#   launch_configuration { max=1,
#     aggressive_mode (DEPRECATED), keep_drain_timeout_nodes, node_ttl_seconds,
#     num_targeted_nodes, rebalancing_min_nodes, selector,
#     target_node_selection_algorithm,
#     aggressive_mode_config { max=1, all REQ },
#     drain_failure_config { max=1 },
#     execution_conditions { max=1, enabled REQ, achieved_savings_percentage }
#   }
#   schedule            { min=1 max=1, cron REQ }
#   trigger_conditions  { min=1 max=1, savings_percentage REQ, ignore_savings }
# ------------------------------------------------------------------------------
resource "castai_rebalancing_schedule" "this" {
  count = var.enable_rebalancing ? 1 : 0

  name = lookup(var.rebalancing_config, "name", "default-rebalancing")

  dynamic "schedule" {
    for_each = lookup(var.rebalancing_config, "schedule", null) == null ? [] : [1]
    content {
      cron = lookup(lookup(var.rebalancing_config, "schedule", {}), "cron", "0 0 * * ?")
    }
  }

  dynamic "trigger_conditions" {
    for_each = lookup(var.rebalancing_config, "trigger_conditions", null) == null ? [] : [1]
    content {
      savings_percentage = lookup(lookup(var.rebalancing_config, "trigger_conditions", {}), "savings_percentage", 10)
      ignore_savings     = lookup(lookup(var.rebalancing_config, "trigger_conditions", {}), "ignore_savings", false)
    }
  }

  dynamic "launch_configuration" {
    for_each = [1]
    content {
      keep_drain_timeout_nodes        = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "keep_drain_timeout_nodes", null)
      node_ttl_seconds                = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "node_ttl_seconds", null)
      num_targeted_nodes              = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "num_targeted_nodes", null)
      rebalancing_min_nodes           = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "rebalancing_min_nodes", null)
      selector                        = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "selector", null)
      target_node_selection_algorithm = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "target_node_selection_algorithm", null)

      dynamic "aggressive_mode_config" {
        for_each = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "aggressive_mode_config", null) == null ? [] : [1]
        content {
          ignore_local_persistent_volumes        = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "aggressive_mode_config", {}), "ignore_local_persistent_volumes", false)
          ignore_problem_job_pods                = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "aggressive_mode_config", {}), "ignore_problem_job_pods", false)
          ignore_problem_pods_without_controller = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "aggressive_mode_config", {}), "ignore_problem_pods_without_controller", false)
          ignore_problem_removal_disabled_pods   = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "aggressive_mode_config", {}), "ignore_problem_removal_disabled_pods", false)
        }
      }

      dynamic "drain_failure_config" {
        for_each = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "drain_failure_config", null) == null ? [] : [1]
        content {
          disable_uncordon       = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "drain_failure_config", {}), "disable_uncordon", null)
          uncordon_after_seconds = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "drain_failure_config", {}), "uncordon_after_seconds", null)
        }
      }

      dynamic "execution_conditions" {
        for_each = lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "execution_conditions", null) == null ? [] : [1]
        content {
          enabled                     = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "execution_conditions", {}), "enabled", true)
          achieved_savings_percentage = lookup(lookup(lookup(var.rebalancing_config, "launch_configuration", {}), "execution_conditions", {}), "achieved_savings_percentage", null)
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# Rebalancing job
# ------------------------------------------------------------------------------
# Schema (v9.2.1): cluster_id (REQ), rebalancing_schedule_id (REQ),
#                  enabled (OPT), id (OPT/COMPUTED). No other top-level attrs.
# Binds a rebalancing schedule to a cluster.
# ------------------------------------------------------------------------------
resource "castai_rebalancing_job" "this" {
  count = var.enable_rebalancing ? 1 : 0

  cluster_id              = module.castai_eks_full.cluster_id
  rebalancing_schedule_id = castai_rebalancing_schedule.this[0].id
  enabled                 = lookup(var.rebalancing_config, "job_enabled", true)
}

# ------------------------------------------------------------------------------
# Workload scaling policy order
# ------------------------------------------------------------------------------
# Schema (v9.2.1): cluster_id (REQ), policy_ids (REQ, list of string), id (OPT).
# No other top-level attrs.
# ------------------------------------------------------------------------------
resource "castai_workload_scaling_policy_order" "this" {
  count      = var.enable_workload_scaling_policy_order ? 1 : 0
  cluster_id = module.castai_eks_full.cluster_id

  policy_ids = lookup(var.workload_scaling_policy_order_config, "policy_ids", [])
}

# ------------------------------------------------------------------------------
# Pod mutation
# ------------------------------------------------------------------------------
# Schema (v9.2.1):
#   top-level: cluster_id (REQ), name (REQ), enabled (REQ),
#              annotations (OPT map), labels (OPT map),
#              node_templates_to_consolidate (OPT list), patch (OPT),
#              organization_id (OPT CMP), source (CMP), id (OPT CMP).
#   blocks:
#     affinity { max=1, { node_affinity { max=1 } } },
#     distribution_groups { list, { name REQ, percentage REQ,
#                                   configuration { min=1 max=1,
#                                     annotations, labels,
#                                     node_templates_to_consolidate, patch,
#                                     spot_type } } },
#     filter_v2 { min=1 max=1, { pod, workload } },
#     node_selector { max=1, add/remove map },
#     pod_eviction { max=1, enabled REQ },
#     spot_config { max=1, distribution_percentage, spot_mode },
#     tolerations { list }
# ------------------------------------------------------------------------------
resource "castai_pod_mutation" "this" {
  count      = var.enable_pod_mutation ? 1 : 0
  cluster_id = module.castai_eks_full.cluster_id

  name    = lookup(var.pod_mutation_config, "name", "default-pod-mutation")
  enabled = lookup(var.pod_mutation_config, "enabled", true)

  annotations                   = lookup(var.pod_mutation_config, "annotations", null)
  labels                        = lookup(var.pod_mutation_config, "labels", null)
  patch                         = lookup(var.pod_mutation_config, "patch", null)
  node_templates_to_consolidate = lookup(var.pod_mutation_config, "node_templates_to_consolidate", null)

  # filter_v2 is REQUIRED (min=1, max=1). Empty inner blocks are valid.
  filter_v2 {
    dynamic "workload" {
      for_each = lookup(var.pod_mutation_config, "workload", null) == null ? [] : [1]
      content {
        dynamic "kinds" {
          for_each = lookup(lookup(var.pod_mutation_config, "workload", {}), "kinds", [])
          content {
            type  = kinds.value.type
            value = kinds.value.value
          }
        }
        dynamic "names" {
          for_each = lookup(lookup(var.pod_mutation_config, "workload", {}), "names", [])
          content {
            type  = names.value.type
            value = names.value.value
          }
        }
        dynamic "namespaces" {
          for_each = lookup(lookup(var.pod_mutation_config, "workload", {}), "namespaces", [])
          content {
            type  = namespaces.value.type
            value = namespaces.value.value
          }
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# Security runtime rule
# ------------------------------------------------------------------------------
# Schema (v9.2.1): name (REQ), severity (REQ), rule_text (REQ), category (OPT),
#                  enabled (OPT), labels (OPT map), resource_selector (OPT),
#                  rule_engine_type (OPT). No cluster_id (org-scoped).
# ------------------------------------------------------------------------------
resource "castai_security_runtime_rule" "this" {
  count = var.enable_security_runtime_rule ? 1 : 0

  name      = lookup(var.security_runtime_rule_config, "name", "default-runtime-rule")
  severity  = lookup(var.security_runtime_rule_config, "severity", "MEDIUM")
  rule_text = lookup(var.security_runtime_rule_config, "rule_text", "{}")

  category          = lookup(var.security_runtime_rule_config, "category", null)
  enabled           = lookup(var.security_runtime_rule_config, "enabled", true)
  labels            = lookup(var.security_runtime_rule_config, "labels", null)
  resource_selector = lookup(var.security_runtime_rule_config, "resource_selector", null)
  rule_engine_type  = lookup(var.security_runtime_rule_config, "rule_engine_type", null)
}

# ------------------------------------------------------------------------------
# FinOps - Allocation Group
# ------------------------------------------------------------------------------
# Schema (v9.2.1): name (REQ), cluster_ids (OPT set), namespaces (OPT list),
#                  labels (OPT map), labels_operator (OPT), id (OPT/CMP).
# No cluster_id top-level. cluster_ids is a SET.
# ------------------------------------------------------------------------------
resource "castai_allocation_group" "this" {
  count = var.enable_finops ? 1 : 0

  name = lookup(var.finops_config, "allocation_group_name", "default-allocation-group")

  cluster_ids     = lookup(var.finops_config, "allocation_group_cluster_ids", [module.castai_eks_full.cluster_id])
  namespaces      = lookup(var.finops_config, "allocation_group_namespaces", null)
  labels          = lookup(var.finops_config, "allocation_group_labels", null)
  labels_operator = lookup(var.finops_config, "allocation_group_labels_operator", null)
}

# ------------------------------------------------------------------------------
# FinOps - Commitments (plural)
# ------------------------------------------------------------------------------
# Schema (v9.2.1): import_mode (OPT), organization_id (OPT), id (OPT/CMP).
#   azure_reservations / gcp_cuds are computed-only lists (read-back).
#   azure_reservations_csv / gcp_cuds_json are the OPT configurable inputs.
# Nested block: commitment_configs { list,
#     allowed_usage, auto_assignment, prioritization, scaling_strategy, status,
#     assignments { list, cluster_id REQ, priority CMP },
#     matcher { max=1, name REQ, region REQ, type OPT }
#   }
# ------------------------------------------------------------------------------
resource "castai_commitments" "this" {
  count = var.enable_finops ? 1 : 0

  import_mode = lookup(var.finops_config, "commitments_import_mode", null)

  azure_reservations_csv = lookup(var.finops_config, "commitments_azure_reservations_csv", null)
  gcp_cuds_json          = lookup(var.finops_config, "commitments_gcp_cuds_json", null)

  dynamic "commitment_configs" {
    for_each = lookup(var.finops_config, "commitment_configs", [])
    content {
      allowed_usage    = lookup(commitment_configs.value, "allowed_usage", null)
      auto_assignment  = lookup(commitment_configs.value, "auto_assignment", null)
      prioritization   = lookup(commitment_configs.value, "prioritization", null)
      scaling_strategy = lookup(commitment_configs.value, "scaling_strategy", null)
      status           = lookup(commitment_configs.value, "status", null)

      dynamic "matcher" {
        for_each = lookup(commitment_configs.value, "matcher", null) == null ? [] : [1]
        content {
          name   = lookup(lookup(commitment_configs.value, "matcher", {}), "name", "")
          region = lookup(lookup(commitment_configs.value, "matcher", {}), "region", "")
          type   = lookup(lookup(commitment_configs.value, "matcher", {}), "type", null)
        }
      }

      dynamic "assignments" {
        for_each = lookup(commitment_configs.value, "assignments", [])
        content {
          cluster_id = assignments.value.cluster_id
        }
      }
    }
  }
}

# NOTE: castai_reservations is DEPRECATED in provider v9.2.1. The plural
# castai_commitments resource is the supported replacement. No resource
# definition is emitted here.

# ------------------------------------------------------------------------------
# AI Optimizer
# ------------------------------------------------------------------------------
# Schema (v9.2.1): cluster_id (REQ), service (REQ), model_specs_id (REQ),
#                  port (REQ), node_template_name (OPT), edge_location_ids (OPT).
#                  Computed-only: cloud_provider, current_replicas, namespace,
#                                 region, status, status_reason, id.
# Nested blocks:
#   fallback { max=1, enabled, model, provider_id },
#   hibernation { max=1, enabled,
#     hibernate_condition { min=1 max=1, duration REQ, request_count OPT },
#     resume_condition    { min=1 max=1, duration REQ, request_count OPT } },
#   horizontal_autoscaling { max=1, enabled, min/max_replicas REQ,
#                            target_metric, target_value REQ },
#   vllm_config { max=1, hugging_face_token, secret_name }
# ------------------------------------------------------------------------------
resource "castai_ai_optimizer_hosted_model" "this" {
  count      = var.enable_ai_optimizer ? 1 : 0
  cluster_id = module.castai_eks_full.cluster_id

  service            = lookup(var.ai_optimizer_config, "service", "default-ai-optimizer")
  model_specs_id     = lookup(var.ai_optimizer_config, "model_specs_id", "castai-default-model")
  port               = lookup(var.ai_optimizer_config, "port", 8080)
  node_template_name = lookup(var.ai_optimizer_config, "node_template_name", null)
  edge_location_ids  = lookup(var.ai_optimizer_config, "edge_location_ids", null)
}

# ------------------------------------------------------------------------------
# Cache
# ------------------------------------------------------------------------------
# Schema (v9.2.1): cache_group_id (REQ), database_name (REQ), mode (REQ),
#                  id (OPT/CMP). NO top-level enabled/cluster_id.
# ------------------------------------------------------------------------------
resource "castai_cache_configuration" "this" {
  count = var.enable_cache ? 1 : 0

  cache_group_id = lookup(var.cache_config, "cache_group_id", "default-cache-group")
  database_name  = lookup(var.cache_config, "database_name", "default-db")
  mode           = lookup(var.cache_config, "mode", "Auto")
}

# ------------------------------------------------------------------------------
# Edge
# ------------------------------------------------------------------------------
# Schema (v9.2.1): cluster_id (REQ), organization_id (REQ), name (REQ),
#                  edge_location_id (REQ), user_data_base64 (OPT),
#                  default (CMP), id (CMP).
#                  cloud-specific nested objects (single, optional):
#                    aws    { boot_disk_size_gib, image_id, tags }
#                    gcp    { boot_disk_size_gib, image_id, labels }
#                    nebius { boot_disk_size_gib, image_id, labels }
#                    oci    { boot_disk_size_gib, image_id, tags }
#                    custom { custom map }
#                  cri { socket } (single, optional)
# ------------------------------------------------------------------------------
resource "castai_edge_configuration" "this" {
  count = var.enable_edge ? 1 : 0

  cluster_id       = module.castai_eks_full.cluster_id
  organization_id  = lookup(var.edge_config, "organization_id", "")
  name             = lookup(var.edge_config, "name", "default-edge")
  edge_location_id = lookup(var.edge_config, "edge_location_id", "default-edge-location")
  user_data_base64 = lookup(var.edge_config, "user_data_base64", null)

  aws = lookup(var.edge_config, "cloud", "aws") == "aws" ? {
    boot_disk_size_gib = lookup(var.edge_config, "aws_boot_disk_size_gib", null)
    image_id           = lookup(var.edge_config, "aws_image_id", null)
    tags               = lookup(var.edge_config, "aws_tags", null)
  } : null

  gcp = lookup(var.edge_config, "cloud", "aws") == "gcp" ? {
    boot_disk_size_gib = lookup(var.edge_config, "gcp_boot_disk_size_gib", null)
    image_id           = lookup(var.edge_config, "gcp_image_id", null)
    labels             = lookup(var.edge_config, "gcp_labels", null)
  } : null

  cri = lookup(var.edge_config, "cri", null) == null ? null : {
    socket = lookup(lookup(var.edge_config, "cri", {}), "socket", null)
  }
}
