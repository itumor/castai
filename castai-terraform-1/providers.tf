provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

provider "castai" {
  api_token = var.castai_api_token
}

provider "helm" {
  kubernetes = {
    host                   = data.aws_eks_cluster.target.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.target.certificate_authority[0].data)

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args = concat(
        [
          "eks",
          "get-token",
          "--cluster-name",
          var.cluster_name,
          "--region",
          var.aws_region,
        ],
        var.aws_profile == null ? [] : ["--profile", var.aws_profile]
      )
    }
  }
}

