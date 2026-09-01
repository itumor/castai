provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

# The kubernetes and helm providers are declared in main.tf because they need
# the EKS cluster endpoint, CA certificate, and auth token from a data source
# that resolves after the cluster module has been applied. Keeping them next to
# the cluster module avoids a stale token during the first apply.
