# Karpenter + CAST AI CLM Learnings — karpenter-lab

Cluster: `karpenter-lab` in `us-west-2` (account 050451381948).

## Karpenter production design

- **Karpenter version:** 1.14.1 chart, image `public.ecr.aws/karpenter/controller:1.14.1`.
- **EC2NodeClass `general`:** AL2023 pinned AMI, IMDSv2, encrypted gp3, `karpenter.sh/discovery` tag-based subnet/SG selection.
- **NodePool `general`:** Spot-first with On-Demand fallback, `instance-category` in `t/m/c/r`, generation `>4`.
- **NodePool `critical-on-demand`:** On-Demand only, `NoSchedule` taint `workload-type=critical`.
- **NodePool `general-live`:** CLM-enabled, single AZ (`us-west-2a`), instance families `c3/m3/r3/i2`, private-only EC2NodeClass, `live.cast.ai/install=true` label, `live.cast.ai/not-ready` startup taint.

## Common pitfalls and fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Karpenter ImagePullBackOff | Chart ignores `registry:` field | Use `controller.image.repository: public.ecr.aws/karpenter/controller` |
| IRSA `Unauthorized` | Missing `eks:DescribeCluster`, `ec2:*`, `iam:PassRole`, `sqs:*`, `pricing`, `ssm`, `events` | Add to inline policy on controller role |
| Karpenter nodes can't join cluster | `KarpenterNodeRole` not in `aws-auth` ConfigMap | Add `eksctl-KarpenterNodeRole-<cluster>` mapping to `system:bootstrappers` + `system:nodes` |
| `CreateFleet` rejects `kmsKeyId` | Empty `kmsKeyID: ""` in EC2NodeClass | Remove the key entirely |
| No subnets found | Subnets not tagged with `karpenter.sh/discovery=<cluster>` | Tag all VPC subnets and security groups |
| HPA doesn't scale | `metrics-server` not installed | Install metrics-server |
| HPA load generator rejected | Interactive/wget-based load | Use a CPU stress sidecar with `while :; do :; done` in `test.sh` |
| Sidecar removal fails | JSON patch `containers/-` not idempotent | Use strategic merge patch with `$patch: delete` by container name |
| `tail -n1 test-results.log` not `RESULT: PASS` | Cleanup messages printed after result | Disable EXIT trap, cleanup, then print result |
| CLM migration `SubnetMismatch` | Nodes in public vs private subnets in same AZ | Create CLM-only EC2NodeClass selecting private subnet by ID |
| CLM dashboard shows zero migrations | `castai-live-controller` scaled to 0 / `live.cast.ai/migration-enabled=false` | Enable CLM in CAST AI console; then trigger rebalance |
| `castai kubectl get no` Unauthorized | kubeconfig stale | `aws eks update-kubeconfig --name <cluster> --region <region>` |
| Scaling `system-ng` to zero breaks Karpenter | Karpenter controller has nodeAffinity `karpenter.sh/nodepool DoesNotExist` | Keep at least 1 `system-ng` node for control-plane pods |

## Key files

- `karpenter-production/values.yaml` — Helm values for Karpenter 1.14.1.
- `karpenter-production/manifests.yaml` — source manifests with envsubst placeholders.
- `karpenter-production/manifests.rendered.yaml` — rendered, applied manifest.
- `karpenter-production/deploy.sh` — envsubst + apply + verify.
- `karpenter-production/test.sh` — end-to-end test (Spot, On-Demand, HPA, consolidation).
- `karpenter-production/test-results.log` — committed PASS log.
- `karpenter-production/alpha-features.yaml` — reference-only alpha gates.
- `eksctl-karpenter-cluster-us-west-2.yaml` — cluster config with EBS/EFS addons.
- `project-skills/karpenter-castai-clm/SKILL.md` — reusable skill for this repo.

## Destroy checklist

1. Delete test workloads and NodeClaims.
2. Scale Karpenter deployment to 0 so it stops provisioning.
3. Terminate remaining Karpenter-provisioned EC2 instances manually (tag `karpenter.sh/nodepool`).
4. Run `eksctl delete cluster -f eksctl-karpenter-cluster-us-west-2.yaml --wait=false`.
5. Verify CloudFormation stacks and EKS cluster are gone.
