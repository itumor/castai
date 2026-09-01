# ------------------------------------------------------------------------------
# CAST AI Read-Only Installation
# ------------------------------------------------------------------------------
# IMPORTANT:
# This installation is intentionally CAST AI READ-ONLY.
# Do not enable full, node-autoscaler, or workload-autoscaler tags
# without a reviewed change and the corresponding cloud IAM resources.
#
# Read-only mode installs only the observability components:
#   - castai-agent
#   - castai-spot-handler
#   - castai-kvisor
#   - gpu-metrics-exporter (bundled with the observability stack)
#
# The following automation components are explicitly disabled:
#   - castai-cluster-controller
#   - castai-evictor
#   - castai-pod-mutator
#   - castai-workload-autoscaler
#   - castai-workload-autoscaler-exporter
#   - castai-pod-pinner
#   - castai-live (Container Live Migration)
#   - Node Autoscaler / automatic node provisioning
#   - Workload Autoscaler / automatic resource changes
# ------------------------------------------------------------------------------

resource "helm_release" "castai" {
  name       = local.castai_release_name
  repository = local.castai_repository_url
  chart      = local.castai_chart_name
  version    = var.castai_chart_version != "" ? var.castai_chart_version : null

  namespace        = local.castai_namespace
  create_namespace = true

  # The CAST AI API key is marked sensitive in the variables.tf file.
  # Terraform state will still contain this value; use an encrypted remote
  # backend with strict access controls in production.
  set_sensitive = [
    {
      name  = "global.castai.apiKey"
      value = var.castai_api_token
    }
  ]

  # Mode selection: read-only only. Explicitly disable all automation tags.
  set = concat(
    [
      {
        name  = "global.castai.provider"
        value = "eks"
      },
      {
        name  = "tags.readonly"
        value = "true"
      },
      {
        name  = "tags.full"
        value = "false"
      },
      {
        name  = "tags.node-autoscaler"
        value = "false"
      },
      {
        name  = "tags.workload-autoscaler"
        value = "false"
      },
    ],
    var.castai_api_url != "" ? [
      {
        name  = "global.castai.apiURL"
        value = var.castai_api_url
      }
    ] : []
  )
}
