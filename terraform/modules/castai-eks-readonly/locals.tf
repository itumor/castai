locals {
  # CAST AI umbrella chart repository.
  castai_repository_url = "https://castai.github.io/helm-charts"
  castai_chart_name     = "castai"

  # Release metadata derived from variables for consistency.
  castai_namespace    = var.castai_namespace
  castai_release_name = var.castai_release_name
}
