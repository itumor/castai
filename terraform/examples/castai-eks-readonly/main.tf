# ------------------------------------------------------------------------------
# CAST AI Read-Only / Savings-Assessment Installation
# ------------------------------------------------------------------------------
# This example wires the local reusable module `terraform/modules/castai-eks-readonly`
# to a root that holds only the values needed for a single existing EKS cluster.
#
# What this example deploys:
#   - No AWS resources of any kind (no IAM, no VPC, no EKS).
#   - No `castai/castai` Terraform provider usage.
#   - One Helm release of the castai umbrella chart with `tags.readonly=true`
#     and all other automation tags explicitly set to `false`.
#
# The module installs only CAST AI observability components:
#   - castai-agent
#   - castai-spot-handler
#   - castai-kvisor
#   - gpu-metrics-exporter (bundled with the observability stack)
#
# All automation components (cluster-controller, evictor, pod-mutator,
# workload-autoscaler, pod-pinner, live migration, node autoscaler) are
# disabled at the Helm values level.
# ------------------------------------------------------------------------------

module "castai_eks_readonly" {
  source = "../../modules/castai-eks-readonly"

  # AWS configuration
  cluster_name = var.cluster_name
  aws_region   = var.aws_region
  aws_profile  = var.aws_profile

  # CAST AI authentication (token is sensitive; never echo in plan output)
  castai_api_token = var.castai_api_token
  castai_api_url   = var.castai_api_url

  # Helm configuration
  castai_chart_version = var.castai_chart_version
  castai_namespace     = var.castai_namespace
  castai_release_name  = var.castai_release_name
}
