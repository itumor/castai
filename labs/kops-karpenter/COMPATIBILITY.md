# kOps + Karpenter Lab — Compatibility

This document records the compatibility matrix, topology decisions, and IAM/networking
prerequisites for the hands-on lab that provisions a Kubernetes cluster with **kOps**
and uses **Karpenter** for autoscaling. It is the single source of truth for "which
versions, why these versions, and what the cloud environment must provide" before any
lab phase runs against AWS.

If anything below disagrees with the official kOps or Karpenter documentation, the
official docs win — and this file should be updated to reflect the correction.

## Current Version Matrix

| Component       | Version  | Notes                                                                 |
|-----------------|----------|-----------------------------------------------------------------------|
| kOps            | 1.36.x   | Installs and manages the cluster, including the Karpenter managed addon. |
| Kubernetes      | 1.36     | Control plane and node version selected by the kOps 1.36 release.    |
| Karpenter       | 1.13.0   | Shipped as a managed addon by kOps 1.36. Not installed by hand.       |

These are pinned at the start of the lab. Bumping any of them is a separate,
explicit change.

## Why This Combination Is the Current Supported Path

- **kOps 1.36 bundles Karpenter v1.13.0 as a managed addon**, so the controller is
  installed and upgraded by `kops update cluster` / `kops rolling-update cluster`
  rather than by a separate Helm chart. This keeps the controller version aligned
  with the kOps release cadence and avoids drift.
- **kOps 1.34 or newer is required** to use the Karpenter managed-addon path. The lab
  is pinned to 1.36.x, so this floor is comfortably satisfied and we stay on a
  current, supported kOps line.
- **IRSA (IAM Roles for Service Accounts) is required.** The Karpenter controller pod
  assumes an AWS IAM role via a Kubernetes ServiceAccount annotation; the cluster
  must have IRSA enabled at create time. kOps 1.36 enables IRSA when the cluster spec
  requests it.
- **Karpenter v1.13.0 is the version kOps 1.36 ships**, so we deliberately do not
  pin a different Karpenter version — picking one manually would either duplicate
  the addon or fight kOps during upgrades.

## Why None-DNS Topology, Not Gossip

The lab uses **None-DNS topology** (the default for `*.k8s.local` clusters in kOps
1.36). We are explicitly **not** using gossip.

- **Gossip is being removed.** Gossip-based cluster discovery is scheduled for removal
  in kOps 1.37. Building a lab on gossip in 2026 would mean rebuilding it on the next
  minor kOps release.
- **None-DNS was introduced in kOps 1.26** and has matured since. It requires a real
  DNS zone for the cluster's service and API endpoints, which is the standard path
  for production-shaped clusters.
- **`*.k8s.local` clusters default to None-DNS in kOps 1.36**, so we stay on the
  default topology rather than opting back into the legacy gossip path.

## IAM Requirements (Summary)

The lab expects the following IAM building blocks to already exist or be created by
a lab phase:

- **IRSA enabled on the cluster** — the cluster's OIDC provider is published and
  used to mint service-account-scoped AWS credentials.
- **Node instance role / instance profile** — used by kOps-managed InstanceGroups
  (the bootstrap nodes that join the cluster before Karpenter takes over). Tagging
  requirements for Karpenter to discover subnets and security groups are applied via
  this role's permissions.
- **Karpenter controller policy** — an IAM policy granting the permissions documented
  in the kOps Karpenter operations guide (EC2 describe/create/terminate, pricing
  lookups, subnet/security-group/launch-template reads by tag, etc.), attached to the
  IRSA role assumed by the `karpenter` ServiceAccount.
- **Instance profile for Karpenter-launched nodes** — referenced from
  `EC2NodeClass.spec.role` so nodes provisioned by Karpenter can join the cluster.

Concrete ARNs, role names, and policy documents are produced in a later phase; this
file only records what must exist.

## Networking Requirements (Summary)

- **VPC** provisioned (kOps can create one, or the lab can reuse an existing one).
- **Subnets tagged for InstanceGroup discovery** — the kOps Karpenter integration
  reads subnets by tag, so subnet tagging must follow the convention documented in
  the kOps operations guide (typically `kops.k8s.io/cluster=<cluster-name>` and
  `kubernetes.io/role/elb` / `kubernetes.io/role/internal-elb` as appropriate).
- **Security groups** allowing cluster control plane ↔ node communication on the
  ports required by Kubernetes and by the CNI in use.
- **Route tables and IGW/NAT** configured so control plane and nodes can reach the
  AWS APIs and (for private topologies) so nodes can reach the internet for image
  pulls.

The exact tags, CIDRs, and SG IDs are cluster-specific and are recorded in the
generated cluster spec, not here.

## References (Official Docs)

- kOps — Karpenter operations:
  https://kops.sigs.k8s.io/operations/karpenter/
- kOps — Gossip (and its deprecation/removal timeline):
  https://kops.sigs.k8s.io/gossip/
- Karpenter — Compatibility / supported Kubernetes versions:
  https://karpenter.sh/docs/upgrading/compatibility/

## Note on the Existing EKSctl Lab

This directory (`labs/kops-karpenter/`) is **separate** from the EKSctl-based
Karpenter lab that lives at the repository root
(`eksctl-karpenter-cluster*.yaml`, `deploy-karpenter-lab.sh`, `karpenter-*` manifests,
etc.). That existing lab targets EKS via `eksctl` and is preserved untouched.
The contents of this directory are the new kOps-managed path and do not modify
or replace it.
