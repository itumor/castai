# ngm-helios-eks — Efficiency analysis (draft for Ibrahim, call 30 Sep)

Owner action item: "deeper analysis of the Helios cluster configuration and share findings with Gerolf and the team, including metrics on workload per vCPU before and after autoscaling" (Marko Markovic, Ibrahim, Shahar).

**Critical framing:** workload autoscaling runs in recommendation-only mode (0 of 3,598 workloads optimized). There is no measured "after" yet — the after below is the **projected** state from CAST AI recommendations. Say exactly this in the meeting; don't let anyone claim a measured before/after.

## Cluster state (live, 24 Sep 2026)

- 218 nodes, 100% on-demand, 0 spot. Mix led by m6a.4xlarge (72), c5a.4xlarge (26), r6a.4xlarge (23).
- 2,606 vCPU provisioned; **1,201 vCPU requested; actual utilization 5.27%** (RAM 15.04%).
- Run-rate $102.24/h vs $42.28/h optimal → up to ~$44k/month still on the table.
- August: $19,610 saved by downscaling (their FinOps bill: $27k; implied no-CAST baseline ≈ $46.6k).

## Workload requests vs recommendations (per-workload, replica-weighted)

Cluster total: **~2,277 cores requested → ~454 cores recommended (excess ~1,823 vCPU)**.
(Component-level summary endpoint: 1,029.6 → 341.6 — different aggregation scope; use replica-weighted for the waste story.)

### Top downsize (excess cores)

| Workload | req → rec (cores) | excess |
|---|---|---|
| argo/argocd-repo-server ×8 | 33.6 → 1.9 | 31.7 |
| gmbd/grid-model-builder-v2-graph-db ×1 | 12.2 → ~0 | 12.2 |
| cqa2/algorithmic-core-v2-cqa2-alglib-adapter2 | 13.1 → 1.2 | 11.9 |
| cqa2/eqc-equipment-profile-service ×12 | 51.0 → 40.3 | 10.7 |
| gmbd/ggv-grid-view-generator | 10.2 → 0.2 | 10.1 |
| gmbd/mil2 druid-db-mea-historical ×3 (not both) | 9.8 → 0.1 | 9.7 |
| cqa2/mea-historian-ingestion-batch-enrichment ×8 | 10.0 → 0.6 | 9.4 |
| gmbd/eqc-equipment-profile-service ×2 | 8.5 → 0.3 | 8.2 |
| cqa2/asset-processor ×6 | 7.5 → 0.1 | 7.4 |

Namespaces `siemens-digital-grid-*` (gmbd, cqa2, mil2) dominate the waste — those are Gerolf's own dev teams' charts. This is the "devs must right-size for on-prem" evidence, in their own namespaces.

### Top upsize (reliability, not cost!)

| Workload | req → rec (cores) | deficit |
|---|---|---|
| kube-system/kube-proxy ×211 | 21.1 → 89.0 | 67.9 |
| helios/fts-logging-beat-filebeat ×211 | 2.1 → 21.7 | 19.6 |
| datadog ×211 | ~0 → 14.3 | 14.3 |
| cqa2/druid-db-mea-historical ×2 | 10.5 → 24.6 | 14.1 |
| kube-system/efs-csi-node ×211 | ~0 → 6.3 | 6.3 |

Talking point: right-sizing protects critical daemonsets (under-provisioned kube-proxy/CSI/logging agents on 211 nodes) — cost pressure does not mean cutting reliability.

## Proposed way of working (aligned with Gerolf's on-prem driver)

1. Keep R&D in recommendation mode — no live changes.
2. Devs own the fix in their Helm charts (git remains source of truth).
3. CAST AI provides the per-workload export as the worklist; reviewed in the cost session.
4. Apply mode reserved for the prod-like test (ngm-sim2) for measured before/after.

## Still to add before Fri 3 Oct

- [ ] Node-template / evictor tuning review (rebalancing frequency, night consolidation windows).
- [ ] Spot enablement plan (candidate workload classes, suggested 30–50% target on R&D).
- [ ] Integ numbers already in `.kimchi/docs/si-gsw-meeting-prep-2026-09-30.md` §2.
- [ ] Raw data: `/tmp/helios-workloads.json` (re-pull before the call; it's live state).