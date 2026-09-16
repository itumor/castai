# ------------------------------------------------------------------------------
# CAST AI Full-Mode Onboarding via Terraform — E2E token-rotation test
# ------------------------------------------------------------------------------
# This root module wires the local reusable module
# terraform/modules/castai-eks-full to the existing disposable EKS cluster
# created by the token-rotation harness.
# ------------------------------------------------------------------------------

module "castai_eks_full" {
  source = "../../../terraform/modules/castai-eks-full"

  cluster_name = var.cluster_name
  aws_region   = var.aws_region

  vpc_id                     = var.vpc_id
  subnets                    = var.subnets
  node_security_group_ids    = var.node_security_group_ids
  cluster_security_group_ids = var.cluster_security_group_ids

  castai_api_token = var.castai_api_token
  api_url          = var.api_url
  grpc_url         = var.grpc_url

  delete_nodes_on_disconnect = false

  install_security_agent      = true
  install_workload_autoscaler = true
  castai_namespace            = "castai-agent"
}
