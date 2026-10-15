---
name: castai-workload-autoscaling
description: Diagnose CAST AI Workload Autoscaler (WAS/WOOP) CPU and memory rightsizing, VPA recommendations, HPA interaction, scaling policy assignment, annotations, predictive scaling, resource limits, and rollout or restart behavior.
---

# CAST AI Workload Autoscaler

## Procedure
1. Identify workload kind/name/namespace, cluster, version, policy, whether horizontal/vertical optimization is enabled, and observed versus desired change.
2. Compare resource requests/limits, usage trends, startup peaks, lookback duration, CPU throttling, OOMs, HPA min/max/target signals, replicas, and application SLOs. Do not optimize solely on average CPU.
3. Explain recommendation generation versus actual application; check whether there is enough historical data and whether a policy has `Automatically optimize workloads` enabled.
4. Resolve policy matching and precedence. `workloads.cast.ai/configuration` annotations can override scaling-policy fields; check for invalid YAML and GitOps conflicts.
5. Check rollout constraints: PDBs, single replicas, immediate vs deferred apply, availability, HPA/VPA conflict, in-place resize eligibility, and startup characteristics.
6. For failures, inspect workload/pod events and Cast AI workload-autoscaler component health; pin version and timestamp before interpreting behavior.
7. Propose a scoped policy or annotation adjustment, starting with recommendation-only where supported; document expected impact and rollback. Do not apply without approval.

## Read-only examples
```sh
kubectl -n <namespace> get deploy <deployment> -o yaml
kubectl -n <namespace> describe deploy <deployment>
kubectl -n <namespace> get hpa
kubectl -n <namespace> get pods -l <label-selector> -o wide
kubectl -n castai-agent get deploy | grep -E 'autoscaler|exporter'
```
Avoid exposing env vars or Kubernetes Secret values when forwarding full manifests. Use redacted snippets where possible.

## Quality gate
Distinguish VPA request rightsizing from actual cloud cost reduction; the latter depends on node capacity optimization and reporting methodology. Never promise no restarts or zero downtime unless validated for the exact workload and policy.

## Output
**Recommendation vs applied state** / **Controlling policy/annotation** / **Safety constraint** / **Proposed setting** / **Health checks**.

## References
- [Workload Autoscaling overview](https://docs.cast.ai/docs/workload-autoscaling-overview)
- [Scaling policies](https://docs.cast.ai/docs/woop-scaling-policies)
- [Annotation reference](https://docs.cast.ai/docs/workload-autoscaler-annotations-reference)
- [Configuration](https://docs.cast.ai/docs/workload-autoscaling-configuration)
- [Vertical and horizontal autoscaling](https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa)
