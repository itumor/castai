# Research: AWS Terraform EKS Blueprints (2026)

This document captures the **current state** of the AWS Terraform EKS Blueprints ecosystem as of 2026. It is the starting point for the lab — read it before writing any Terraform.

## TL;DR

- The old monolithic `aws-ia/terraform-aws-eks-blueprints` module is **deprecated and split**. It is no longer the recommended single entry point for new EKS Terraform projects.
- Use the smaller, focused modules:
  - **`terraform-aws-modules/eks/aws`** — the EKS cluster itself.
  - **`aws-ia/eks-blueprints-addons/aws`** — the curated Kubernetes add-on suite (one module, many add-ons).
  - **`aws-ia/eks-blueprints-addon/aws`** (singular) — a helper for installing **one** add-on when you do not want the full add-on suite.
- Pin Kubernetes to **EKS 1.33**, Terraform **>= 1.5**, AWS provider **~> 6.0**, and use **Karpenter v1** with **EKS Pod Identity** (not IRSA) for new clusters.

## Why the old monolith is gone

`aws-ia/terraform-aws-eks-blueprints` was a single "batteries-included" module that wrapped the cluster, VPC, add-ons, and IRSA plumbing into one large surface. As EKS, add-ons, and Terraform matured, that surface became hard to version, hard to upgrade, and hard to compose. AWS split it into smaller, opinionated modules that compose cleanly. Treat the old repo as **legacy** — new projects should not depend on it.

- Deprecation notice: <https://github.com/aws-ia/terraform-aws-eks-blueprints> (README "Deprecation Notice" section)
- Successor modules: <https://github.com/aws-ia>

## Current recommended components

### 1. Cluster — `terraform-aws-modules/eks/aws`

The community standard for provisioning the EKS control plane, node groups, access entries, and cluster add-ons (VPC CNI, kube-proxy, CoreDNS).

- Module page: <https://registry.terraform.io/modules/terraform-aws-modules/eks/aws/latest>
- Source: <https://github.com/terraform-aws-modules/terraform-aws-eks>

Pin: **`~> 21.0`**.

### 2. Add-on suite — `aws-ia/eks-blueprints-addons/aws`

Installs and configures the typical Kubernetes add-ons (Argo CD, Karpenter, AWS Load Balancer Controller, ExternalDNS, secrets store CSI, metrics server, etc.) with sane defaults.

- Module page: <https://registry.terraform.io/modules/aws-ia/eks-blueprints-addons/aws/latest>
- Source: <https://github.com/aws-ia/terraform-aws-eks-blueprints-addons>

Pin: **`~> 1.0`**.

### 3. Single add-on helper — `aws-ia/eks-blueprints-addon/aws` (singular)

Use this when you want to install **just one** add-on (e.g., one Helm chart) without pulling in the entire suite. It exposes the same Helm-release + IRSA/Pod Identity plumbing as the suite, in a smaller surface.

- Module page: <https://registry.terraform.io/modules/aws-ia/eks-blueprints-addon/aws/latest>
- Source: <https://github.com/aws-ia/terraform-aws-eks-blueprints-addon>

### 4. VPC — `terraform-aws-modules/vpc/aws`

Pin: **`~> 6.0`**. Module page: <https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/latest>.

## Version matrix used in this lab

| Component | Version pin |
|---|---|
| Kubernetes (EKS) | **1.33** |
| Terraform | **>= 1.5** |
| AWS provider | **~> 6.0** |
| `terraform-aws-modules/eks/aws` | **~> 21.0** |
| `aws-ia/eks-blueprints-addons/aws` | **~> 1.0** |
| `terraform-aws-modules/vpc/aws` | **~> 6.0** |

The `terraform-aws-modules/eks/aws ~> 21.0` line requires AWS provider 6.x and Terraform 1.5+, so the rest of the matrix follows from that.

## Karpenter v1 (not v0)

Karpenter reached **v1.0** in 2024 and the API is now stable. The v1 CRDs replace the old v1beta1 names:

| Concept | Legacy (v0 / v1beta1) | Current (v1) |
|---|---|---|
| Node template | `AWSNodeTemplate` | **`EC2NodeClass`** (apiVersion `karpenter.k8s.aws/v1`) |
| Provisioner | `Provisioner` | **`NodePool`** (apiVersion `karpenter.sh/v1`) |
| Disruption | `consolidationPolicy` field on Provisioner | `disruption` block on NodePool |

What this means in practice:

- Any example you see that uses `kind: Provisioner` or `kind: AWSNodeTemplate` is **out of date**. Translate it to `NodePool` + `EC2NodeClass`.
- The legacy CRDs (`karpenter.sh/v1alpha1` Provisioner, `karpenter.k8s.aws/v1alpha1` AWSNodeTemplate) are removed in v1 — no fallback.

References:

- Karpenter upgrade guide (Provisioner → NodePool): <https://karpenter.sh/docs/upgrading/upgrade-guide/>
- EC2NodeClass spec: <https://karpenter.sh/docs/concepts/nodeclasses/>
- Module: <https://registry.terraform.io/modules/aws-ia/eks-blueprints-addons/aws/latest> (Karpenter submodule)

## IRSA vs EKS Pod Identity

For new clusters, prefer **EKS Pod Identity** over IRSA (IAM Roles for Service Accounts) for any add-on that supports it — including Karpenter.

Why:

- Pod Identity uses a per-cluster IAM association and an EKS-managed token, not OIDC thumbprints. No `aws_iam_openid_connect_provider` resource, no thumbprint rotation pain.
- Fewer moving parts: `aws_eksPodIdentityAssociation` instead of IRSA's three-resource dance (OIDC provider, IAM role, service-account annotation).
- Pod Identity is the AWS-documented path forward for new clusters; IRSA still works but is treated as legacy.

What to use for each add-on in this lab:

- **Karpenter** → EKS Pod Identity (`aws_eks_pod_identity_association`).
- **AWS Load Balancer Controller, ExternalDNS, etc.** → EKS Pod Identity where supported; IRSA as fallback.

References:

- EKS Pod Identity: <https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html>
- Karpenter on Pod Identity: <https://karpenter.sh/docs/getting-started/getting-started-with-karpenter/>

## How the pieces fit together

```
+--------------------------------------------------+
| terraform-aws-modules/vpc/aws (~> 6.0)           |
|   - public / private subnets, NAT, IGW           |
+--------------------------------------------------+
                       |
                       v
+--------------------------------------------------+
| terraform-aws-modules/eks/aws (~> 21.0)          |
|   - EKS 1.33 control plane                       |
|   - access entries, managed node groups           |
+--------------------------------------------------+
                       |
                       v
+--------------------------------------------------+
| aws-ia/eks-blueprints-addons/aws (~> 1.0)        |
|   (or aws-ia/eks-blueprints-addon/aws for one)   |
|   - Karpenter (NodePool + EC2NodeClass)          |
|   - AWS Load Balancer Controller                 |
|   - ExternalDNS, metrics-server, ...             |
|   - IAM: EKS Pod Identity associations           |
+--------------------------------------------------+
```

## Learning checklist

Before writing Terraform in this lab, confirm you can:

- [ ] Explain why the monolithic `aws-ia/terraform-aws-eks-blueprints` module is deprecated.
- [ ] Name the three current modules and what each one owns.
- [ ] Read a `~> 21.0` constraint and translate it to "allowed versions" in your head.
- [ ] Sketch a `NodePool` + `EC2NodeClass` pair from a legacy `Provisioner` + `AWSNodeTemplate` example.
- [ ] Describe one concrete reason EKS Pod Identity is preferred over IRSA for new clusters.

## Sources

- <https://registry.terraform.io/modules/terraform-aws-modules/eks/aws/latest>
- <https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/latest>
- <https://registry.terraform.io/modules/aws-ia/eks-blueprints-addons/aws/latest>
- <https://registry.terraform.io/modules/aws-ia/eks-blueprints-addon/aws/latest>
- <https://github.com/aws-ia/terraform-aws-eks-blueprints> (deprecation notice)
- <https://github.com/aws-ia>
- <https://github.com/terraform-aws-modules/terraform-aws-eks>
- <https://github.com/aws-ia/terraform-aws-eks-blueprints-addons>
- <https://github.com/aws-ia/terraform-aws-eks-blueprints-addon>
- <https://karpenter.sh/docs/upgrading/upgrade-guide/>
- <https://karpenter.sh/docs/concepts/nodeclasses/>
- <https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html>
