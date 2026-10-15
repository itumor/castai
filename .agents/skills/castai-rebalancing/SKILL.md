---
name: castai-rebalancing
description: Investigate CAST AI Rebalancer plans, estimated or available savings versus executed savings, why nodes are not replaced, Spot pricing, constraints, disruption, PDBs, and scheduled rebalance behavior.
---

# CAST AI Rebalancer / plan analysis

## Procedure
1. Identify cluster, plan ID and creation timestamp/timezone, scheduled/manual trigger, autoscaler policy, current node inventory, resource demand, and time of the observed comparison.
2. Check node autoscaler readiness and **Unscheduled Pods policy** (required for rebalancing), node-template matching, node configuration, capacity restrictions, and removal protection.
3. Distinguish simulated optimized topology from current billing. A plan's *available/estimated* savings are not necessarily executed/realized savings.
4. Check candidate node prices, purchase options, reservations, AZ/region, headroom, workload requests, PDBs, affinity, topology and rebalancer thresholds. Compare identical windows and price bases before deriving any delta.
5. Identify whether Workload Autoscaler recommendations were included; rightsizing upward can increase nominal cost for safety, and scheduled savings thresholds can block execution.
6. Evaluate interruption/drain constraints and potential operational impact. Do not trigger plan execution, force eviction, or relax protections without change approval.
7. Summarize what the plan says, why execution differs (confirmed vs hypothesis), how to verify, and safe next action.

## Safe checks
```sh
kubectl get nodes -o wide
kubectl get pdb -A
kubectl get pods -A --field-selector=status.phase=Pending
kubectl get events -A --sort-by=.metadata.creationTimestamp
```
Do not infer plan details from these commands alone: use redacted CAST AI plan/report data when authorized and available.

## Output
**Plan scope** / **Expected vs observed** / **Price and scheduling assumptions** / **Execution blocker(s)** / **Evidence** / **Recommendation requiring approval**.

## References
- [Rebalancing](https://docs.cast.ai/docs/rebalancing)
- [Node templates](https://docs.cast.ai/docs/node-templates)
- [Autoscaler preparation checklist](https://docs.cast.ai/docs/autoscaler-checklist)
- [Available savings](https://docs.cast.ai/docs/available-savings)
