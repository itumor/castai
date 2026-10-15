---
name: castai-node-autoscaling
description: Troubleshoot CAST AI Node Autoscaler scheduling, scale-up failures, pending pods, node templates, node configurations, kubelet maxPods, VPC CNI IP exhaustion, Spot/on-demand provisioning, and AWS quota or instance constraints. Not for workload requests/HPA tuning.
---

# CAST AI Node Autoscaler diagnosis

## Procedure
1. Determine whether the cluster is managed, node autoscaling enabled, and the **Unscheduled Pods policy** plus eligible Node template are enabled; check component versions.
2. Capture exact affected pod `FailedScheduling`/autoscaler events and node readiness. Distinguish CPU/memory shortage from taints, node selectors, affinity, topology spread, max pods, PVC zone constraints, and quota limits.
3. Resolve matching Node template(s): direct `scheduling.cast.ai/node-template` selector vs custom label matching; account for default/custom template status and node configuration associations.
4. Examine constraints: allowed instance families/types, min/max CPU and RAM, architecture, region/AZ/subnets, Spot availability/fallback, per-template CPU limit, launch permissions and quotas. Compare with **effective** workload requirements and DaemonSet overhead.
5. For EKS networking, distinguish VPC CNI secondary-IP from prefix-delegation settings; inspect the live `aws-node` DaemonSet configuration and kubelet pod limits instead of assuming prefix delegation from an instance type.
6. For removal/scale-down failures assess utilization, PDBs, `safe-to-evict`, node restrictions, system workloads, and eviction history. Avoid blanket removal of constraints, critical protections, or PDBs.
7. Recommend narrow corrections only after safety review, change approval, and a validation plan.

## Read-only examples
```sh
kubectl get pods -A --field-selector=status.phase=Pending -o wide
kubectl -n <namespace> describe pod <pod-name>
kubectl get nodes -L scheduling.cast.ai/node-template -o wide
kubectl -n kube-system get ds aws-node -o yaml
kubectl get pdb -A
```
The `aws-node` object may include cluster-specific configuration; redact details when sharing. Do not assume every cluster runs AWS VPC CNI.

## Quality gate
Never recommend widening templates or increasing Spot exposure without noting potential AZ, security, availability, cost, and scheduling implications. A simulation is not proof of successful provisioning.

## Output
**Why pod/node is blocked** / **Evidence** / **Template or constraint involved** / **Lowest-risk fix** / **Verification + rollback**.

## References
- [Node templates](https://docs.cast.ai/docs/node-templates)
- [Node configurations](https://docs.cast.ai/docs/node-configuration)
- [Autoscaler checklist](https://docs.cast.ai/docs/autoscaler-checklist)
- [Spot instances](https://docs.cast.ai/docs/spot)
