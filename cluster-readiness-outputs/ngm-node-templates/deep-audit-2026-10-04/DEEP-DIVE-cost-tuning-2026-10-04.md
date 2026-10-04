# Deep cost-tuning audit — NGM clusters (helios / integ / kronos)

**Date:** 2026-10-04 (Sunday — live snapshots are weekend-trough: 27 / 11 / 3 nodes right now)
**Scope:** everything beyond node templates/configs (covered separately in `../RECOMMENDATIONS-node-templates-configs.md` and `../OUTBOX-ngm-node-tuning-email.md`)
**Method:** 17 read-only CAST AI endpoints × 3 clusters + org-level, all payloads in this folder. Prior full audit: 2026-10-02.

---

## Ranked remaining levers (what's NOT yet tuned)

### 1. Workload rightsizing — the biggest lever you are declining (≈93% of requested CPU wasted)

Fresh `workload-efficiency` (30d window ending today):

| Cluster | Σ requested CPU | Σ wasted CPU | **Waste ratio** | Implied ~$/mo at waste |
|---|---|---|---|---|
| helios | 939 cores | 875 cores | **93%** | ~$10–15k (at helios unit cost) |
| integ | 309 cores | 294 cores | **95%** | ~$5–8k |
| kronos | 41 cores | 38 cores | **93%** | ~$0.3–0.5k |

Named offenders (request vs use):
- helios `argo/argocd-repo-server`: **24.2 cores requested, 0.2 used** — the single worst.
- helios `cqa2-*` and `uxpt-*` services: 5–8 cores each requesting at ~0–5% use.
- integ `it-*/enrich-analog-reindexation-cron` + `reset-offset-cron`: **26.9 / 12.2 / 11.4 / 10.8 cores requested, 0 used** across multiple tenant namespaces — idle reservations block packing between runs.
- kronos: waste is small in absolute terms; pattern identical.

Status data (today):
- WOOP **running** everywhere, `inPlaceResizeEnabled: true`.
- WOOP **v1.10.4 vs latest v1.14.1** (4 minors behind) on all 3 clusters.
- **helios has `resourceQuotasAffectingOptimization: true`** — WOOP optimization is constrained by namespace ResourceQuotas on production. integ/kronos: false.

**Actions:** (a) The organizational decision to keep WOOP metrics-only forfeits ~$28–52k/mo (priced in the Oct 2 report) — these numbers say the same with per-workload names; (b) if full WOOP stays off, at minimum fix the top-10 workloads above manually (requests set ~10–40× usage) — argocd-repo-server and the reindexation crons are zero-risk wins; (c) upgrade WOOP to v1.14.1; (d) clear/exempt the helios ResourceQuotas blocking optimization.

### 2. Rebalancer has converged on the on-demand curve — the "skipped" jobs are telling you

Today, fresh evidence across all three clusters:
- helios 02:00 run → `JobStatusSkipped`; integ 11:00 run → `JobStatusFailed`; both plans report **`achievedSavingsBelowThreshold`** — the algorithm cannot find a cheaper viable arrangement under your current on-demand-only constraint.
- Refreshed `estimated-savings` scenarios (CAST AI listing-price basis):
  - **Layman (rightsize, no spot):** helios −19.3%, integ −16.3%, kronos −62.4%
  - **SpotInstances (+fallback):** helios −25.3%, integ −16.3%, kronos −68.5%
  - **SpotOnly:** helios −64.3%, integ −57.6%, **kronos −84%**

Read: instance-to-instance reshuffling (what the nightly schedules do) is nearly exhausted. The remaining headroom requires *mode* changes — spot, rightsizing, or commitments — not more rebalancing cadence. Keep the schedules (they maintain hygiene) but stop expecting them to produce new savings.

### 3. CAST AI sees ZERO commitments/reservations for this org

`GET /v1/organizations/{org}/reservations` and `/reservations/balance` → **empty**. If Siemens holds AWS Savings Plans or RIs at the payer level (highly likely at ~$77.6k/mo across these 3 clusters and ~$161k/mo org-wide), CAST AI is currently **packing blind to commitment coverage** — it can pick instance types outside SP/RI coverage and drift off your discounted inventory.

**Actions:** (a) confirm with FinOps whether SP/RI/ODCRs exist in account `600442974479`/payer; (b) import/commitment mode in CAST AI so instance family priority respects them (customPriority + commitment-aware selection take precedence — documented); (c) if ODCRs exist, the node template "Target capacity reservations" feature (EKS-only) can pin provisioning into reserved capacity with `reserved=only` taints.

### 4. Spot is still 0% everywhere (confirmed live today)

27/11/3 running nodes → `spot: 0` on all. Combined with §2 numbers, the integ pilot on a dedicated tainted template remains the entry point (already spec'd in the email draft). New supporting stat: integ node count ranged **44→885 in the last 30 days** (helios 40→574, kronos 3→104) — that elasticity is exactly what spot discounts.

### 5. Evictor still `Incompatible` on all three clusters

`nodeDownscaler.evictor: { enabled: true, allowed: false, status: "Incompatible" }` — unchanged since Oct 2. Consequences today: continuous bin-packing is off; only the hourly/nightly scheduled rebalancings compact (and they now skip, see §2). Decision is still owed: upgrade to `managedByCASTAI=true` evictor or keep schedules-only with correct limits (>500 nodes: `maxTargetNodesPerCycle=5`, `cycleInterval=10m`). Until then the removal-disabled pins matter more: **helios 2, integ 1, kronos 1 removal-disabled nodes live right now** (was 8/10/1 on Oct 2 — improvement, but each remaining pin freezes one instance).

### 6. Guardrail: cluster-wide CPU limit is still meaningless

`clusterLimits: maxCores 16384, minCores 1` on all three — integ alone needs ~7k cores at burst; 16384 trips nothing. Recommended: integ 8,000 / helios 6,000 / kronos 1,500 (matches the template-level `resourceLimits` proposed in the email). This is a blast-radius control, not a cost lever.

### 7. Minor/cleanup items

- **cast-agent v0.161.1** everywhere — keep on the normal upgrade train alongside WOOP v1.14.1.
- `aws-node` DaemonSet on helios alone reserves **5.7 cores, uses 0.4** — normal for CNI, but included in the 93% waste figure.
- `spotInterruptionPredictionsType: aws-rebalance-recommendations` on all templates — deprecated upstream; switch to the CAST AI prediction model (confirm enum in console).
- Pinned AMI (`ami-0706179e8561145ae`) + AL2-caveat for kubeReserved/evictionHard — carried in the email draft (FAMILY_AL2023).
- Storage: today's `nodes/storage` endpoint returned thin data (weekend trough); rely on Oct 2 numbers (helios ~$2.4k/mo root disks + ~$6.4k PVs; PV audit pending).

## Healthy signals (verified today — no action)

- `unscheduledPods`: **0** on all three clusters (no stuck scale-ups).
- `problematic-nodes`: **0** on all three.
- `emptyNodes` downscaler at 90s and working — weekend collapse to 3–27 nodes proves it.
- Utilization vs provisioned: helios 8.9% (was 9.2%), integ 6.6%, kronos 5.5%; prov:req ≈ 1.32/1.58/1.46 — CAST AI packs to requests; the gap is requests-vs-usage (§1).

## Bottom line

| Lever | State today | Monthly headroom |
|---|---|---|
| Workload rightsizing (WOOP acceptance limit) | metrics-only, 93–95% CPU waste, helios quota-blocked | **$15–28k** (subset of the $28–52k priced Oct 2) |
| Spot (integ pilot first) | 0% everywhere | $19–36k (modeled range) |
| Commitment-aware packing | no SP/RI imported | opaque until FinOps confirms inventory |
| Rebalancing cadence | **converged** — skip/failed = expected | small; hygiene only |
| maxPods/density/AZ/family fixes | spec'd in email draft | $1.1k+ (disk) + resilience |

The next dollar is not in templates anymore — it's in accepting WOOP recommendations on the named workloads and running the integ spot pilot.

---

*Raw evidence: this folder (34 files, GET-only). Key files: `*/workload-efficiency.json`, `*/estimated-savings.json`, `*/policies.json`, `*/rebalancing-jobs.json`, `*/failed-plan.json`, `*/node-count-history.json`, `org-reservations*.json`.*
