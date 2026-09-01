# Auth token source for the kubernetes/helm providers below. Created after the
# cluster module so the token is regenerated on each refresh.
data "aws_eks_cluster_auth" "cluster" {
  name = module.eks.cluster_name
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  token                  = data.aws_eks_cluster_auth.cluster.token
}

provider "helm" {
  kubernetes = {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    token                  = data.aws_eks_cluster_auth.cluster.token
  }
}

# Placeholder VPC module. Wired up to use the standard terraform-aws-modules VPC
# with three AZs, public + private + intra subnets, and a single NAT gateway for
# the lab. Detailed inputs (subnet CIDRs, NAT count, etc.) will be added in a
# later step.
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = local.name
  cidr = var.vpc_cidr

  azs             = local.azs
  private_subnets = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 4, k)]
  public_subnets  = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 8, k + 48)]
  intra_subnets   = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 8, k + 52)]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
    "karpenter.sh/discovery"          = local.name
  }

  tags = local.tags
}

# EKS cluster. Uses the standard terraform-aws-modules/eks blueprint with a
# single bootstrap managed node group; Karpenter takes over scheduling after
# the core add-ons (vpc-cni, kube-proxy, coredns, pod-identity-agent) come up.
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name               = var.cluster_name
  kubernetes_version = var.cluster_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Spread the control plane across the intra subnets so it has no route to
  # the NAT gateway (and therefore no egress to the public internet).
  control_plane_subnet_ids = module.vpc.intra_subnets

  # Public endpoint so the lab can reach the API from a workstation; cluster
  # creator gets admin via the access entries API below.
  endpoint_public_access                   = true
  enable_cluster_creator_admin_permissions = true

  # Module v21 of terraform-aws-modules/eks/aws renamed this input from
  # `cluster_addons` to `addons`. The task spec uses `cluster_addons`; using
  # `addons` matches the actual installed module schema.
  addons = {
    vpc-cni = {
      before_compute = true
      most_recent    = true
    }
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    eks-pod-identity-agent = {
      before_compute = true
      most_recent    = true
    }
    aws-ebs-csi-driver = {
      most_recent = true
    }
  }

  eks_managed_node_groups = {
    core = {
      name           = "core"
      instance_types = var.managed_node_instance_types
      min_size       = 2
      max_size       = 3
      desired_size   = 2
      ami_type       = "AL2023_x86_64_STANDARD"
      capacity_type  = "ON_DEMAND"

      # Label nodes so Karpenter discovers this cluster via the same tag below.
      labels = {
        "karpenter.sh/controller" = "true"
      }
    }
  }

  # Tag the cluster-managed node security group so Karpenter can discover it.
  node_security_group_tags = merge(local.tags, {
    "karpenter.sh/discovery" = local.name
  })

  tags = local.tags
}

# EKS Blueprints add-ons module: installs the rest of the cluster add-ons
# (cluster-autoscaler, AWS LB controller, metrics-server, ...) and enables
# Karpenter via EKS Pod Identity. Karpenter gets:
#   * an SQS interruption queue (output as `karpenter_queue_name`)
#   * a node IAM role assumed by Karpenter-provisioned EC2 nodes
#   * a service account wired to an IRSA role for the controller
module "eks_blueprints_addons" {
  source  = "aws-ia/eks-blueprints-addons/aws"
  version = "~> 1.0"

  cluster_name     = module.eks.cluster_name
  cluster_version  = module.eks.cluster_version
  cluster_endpoint = module.eks.cluster_endpoint

  # The eks module always creates an OIDC provider (enable_irsa defaults to
  # true), so this attribute is normally set. Wrapped in try() so a future
  # schema change that drops the output does not break the bootstrap path.
  oidc_provider_arn = try(module.eks.oidc_provider_arn, null)

  enable_karpenter = true

  # Prefer EKS Pod Identity for the Karpenter controller. The add-ons module
  # still creates the IAM role/policy; we associate it with the Karpenter
  # service account below.
  karpenter = {
    # Public ECR creds so Helm can pull the Karpenter chart from
    # public.ecr.aws/eks-anywhere/kubernetes-sigs/karpenter.
    repository_username = data.aws_ecrpublic_authorization_token.token.user_name
    repository_password = data.aws_ecrpublic_authorization_token.token.password

    chart_version = "1.6.0"

    # Add Pod Identity trust so the Karpenter controller IAM role can be
    # assumed by EKS Pod Identity (pods.eks.amazonaws.com) in addition to
    # the default IRSA/OIDC trust.
    trust_policy_statements = [
      {
        sid     = "PodIdentity"
        effect  = "Allow"
        actions = ["sts:AssumeRole", "sts:TagSession"]
        principals = [{
          type        = "Service"
          identifiers = ["pods.eks.amazonaws.com"]
        }]
      }
    ]

    values = [
      yamlencode({
        # Pin the controller to the bootstrap managed node group so it is
        # schedulable while the Karpenter NodePool/EC2NodeClass are wired up.
        nodeSelector = { "karpenter.sh/controller" = "true" }
        dnsPolicy    = "Default"
      })
    ]
  }

  tags = local.tags
}

# EKS Pod Identity association for the Karpenter controller.
# This lets the Karpenter pods in the 'karpenter' namespace assume the
# controller IAM role created by the blueprints-addons module, without
# needing IRSA/annotation-based role assumption.
resource "aws_eks_pod_identity_association" "karpenter" {
  cluster_name    = module.eks.cluster_name
  namespace       = "karpenter"
  service_account = "karpenter"
  role_arn        = module.eks_blueprints_addons.karpenter.iam_role_arn

  depends_on = [module.eks_blueprints_addons]
}
