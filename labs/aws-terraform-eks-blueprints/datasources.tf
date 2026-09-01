data "aws_availability_zones" "available" {
  # Filter out AZs that AWS marks as constrained for new accounts in this region.
  # Leave the state list empty so we just consume the names in locals.azs.
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_caller_identity" "current" {}

# Public ECR auth token used by the Helm provider when fetching the Karpenter
# chart. Karpenter publishes the controller chart to the public ECR gallery,
# so the Helm release needs a short-lived bearer token in the repository
# credentials. Terraform refreshes the token on each apply (TTL ~12h).
# ECR Public's authorization endpoint only lives in us-east-1; the gallery is
# global but the API call must be made there. Pin the region on the data
# source so it does not inherit us-west-2 from the default AWS provider.
data "aws_ecrpublic_authorization_token" "token" {
  region = "us-east-1"
}
