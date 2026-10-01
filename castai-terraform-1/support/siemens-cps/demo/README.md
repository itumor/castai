# CLM + Rebalancing demo package (Siemens CPS)

Runnable assets for action item #3 — *"Demo container live migration + rebalancing
on a test cluster"*. Run them in the order below, following
[`../04-clm-rebalancing-demo-runbook.md`](../04-clm-rebalancing-demo-runbook.md)
as the narrative. 15-min slot in [`../06-follow-up-agenda.md`](../06-follow-up-agenda.md), item 4.

## Contents

| Asset | Purpose |
|---|---|
| `preflight.sh` | Automates runbook §0: K8s ≥ 1.30, AL2023 nodes, containerd 2.x, `castai-live-daemon` ready, ≥ 2 CLM-enabled nodes, same-zone/subnet hint. Read-only. |
| `manifests/clm-demo-apps.yaml` | Runbook §2 workloads in namespace `clm-demo`: `clm-test-deployment` (3× nginx), `clm-test-single-replica` (Recreate, the downtime-without-CLM story), `clm-test-statefulset` (Redis in-memory cache on TCP 6379), services `clm-test-svc` / `clm-test-redis`. |
| `watch-continuity.sh` | Runbook §3 headline check: hammers HTTP every 1 s and reads back a seeded Redis key over persistent TCP; gaps are printed with timestamps and summarized on exit. |
| *(repo root)* `karpenter-production/deploy.sh`, `test.sh`, `eksctl-karpenter-cluster-us-west-2.yaml` | Rebuild our own rehearsal lab (`karpenter-lab`, us-west-2) if a dry run is wanted before the customer call. Lab was destroyed after the last pass; see `KARPENTER-CASTAI-CLM-LEARNINGS.md`. |

## Run order (test cluster, never production for a first run)

```bash
# 0. Point kubectl at the target cluster, then verify prerequisites:
bash preflight.sh

# 1. Enable CLM components (runbook §1) if preflight 0.5/0.6 fail:
#    helm flags castai-live daemon + aws-vpc-cni + evictor liveMigration,
#    then console: enable CLM on the node template, run a full rebalancing.

# 2. Deploy demo workloads (runbook §2):
kubectl apply -f manifests/clm-demo-apps.yaml
kubectl -n clm-demo rollout status deploy/clm-test-deployment
kubectl -n clm-demo rollout status statefulset/clm-test-statefulset

# 3. Headline moment (runbook §3) — three terminals:
#    T1: start the client; it must show no GAP lines during the demo:
bash watch-continuity.sh
#    T2: watch migrations appear while the rebalance executes:
kubectl get migrations -A -w
#    T3: console — Rebalancer → Prepare new plan → Generate → discuss preview → Execute
#        (non-aggressive mode first). Watch node labels:
kubectl get nodes -L autoscaling.cast.ai/draining -w

# 4. Cleanup:
kubectl delete -f manifests/clm-demo-apps.yaml
```

## Talking points while it runs

- Plan lifecycle: Generating → Ready → In progress → Completed (Partial when PDBs
  block drains → `rebalancing.cast.ai/status=drain-failed`; Obsolete after ~1 h).
- Label matrix (runbook §2): `live.cast.ai/migration-enabled`,
  `autoscaling.cast.ai/removal-disabled` (recover-on-source), `disposable` (evict fallback).
- Single-replica/StatefulSet: without CLM a rebalance means downtime; with CLM the
  Redis cache and the TCP session cross the node boundary intact.
- Tie-in: this is how the T3a-first strategy converges the cluster (agenda item 1).
