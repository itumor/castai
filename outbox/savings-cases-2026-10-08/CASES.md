# CAST AI savings cases — complete matrix, API coverage, and rules

**Scope:** how cost/savings is calculated and reported for every cluster topology found live in the Siemens orgs on **2026-10-08** (window 2026-09-05 → 2026-10-05 unless noted). Every number below came from `https://api.eu.cast.ai` with `X-API-Key` + `X-CastAI-Organization-Id`. Raw payloads: `raw/<clusterId8>/01..07-*.json`.

**Number provenance legend** — every figure is traceable to one endpoint field:
- **(VR)** `POST /reporting/v1beta/organizations/{orgId}/clusters:runValueRealizationReport` — fields `cost.actualCost / projectedCost / autoscalerSavings / workloadAutoscalerSavings / totalSavings`, flags `woopAdopted / autoscalerAdopted / baselineType`
- **(TL)** `POST /reporting/v1beta/organizations/{orgId}:runValueRealizationTimelineReport` — monthly `timelineItems[].cost.*`
- **(WS)** `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary` — `originalRequested*` vs `requested*`
- **(WM)** `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary-metrics` — effect over time (⚠ retention ≈ 7 days)
- **(BP)** `GET /reporting/v1beta/organizations/{orgId}/clusters/{clusterId}/baseline-params` — `baselinePeriodStartTime/EndTime`, overprovisioning factors, baseline unit costs (**HTTP 404 = cluster has no baseline**, verified live)
- **(CS)** `GET /v1/cost-reports/clusters/{clusterId}/savings` — classic node-level savings (**HTTP 400 "cluster is read-only" for Karpenter/WOOP-only clusters**, verified live)
- **(ND)** `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` — per-node labels incl. `provisioner.cast.ai/managed-by=cast.ai`, `karpenter.sh/*`

---

## Canonical case matrix (standardized definitions)

| Case | Cluster configuration | Reporting rule | Example (30 days, earlier window) |
|---|---|---|---|
| **A — Monitoring only** | Cluster connected in read-only mode; neither autoscaler adopted | No realized savings data. Report **N/A**, not $0. | `bx-edex-prod-eu` |
| **B — Workload Autoscaler only** | CAST AI rightsizes workloads; Karpenter/EKS continues managing nodes | Report `workloadAutoscalerSavings` as **modeled potential savings**. No node-level realized savings. | `f8dd5b4f` — $431.26 |
| **C — Node Autoscaler only** | CAST AI manages nodes; workload rightsizing inactive | Report `autoscalerSavings` after the baseline period ends. | `ngm-kronos-eks` — $7,702 |
| **D — Both autoscalers** | CAST AI manages nodes and rightsizes workloads | Report `totalSavings` as realized savings. Show WAS savings separately for attribution; **never add them together**. | `k8s-andreas` — $150,024 realized; $619 WAS attribution |
| **E — Transition B → D** | Workload Autoscaler enabled first; Node Autoscaler enabled later | WAS savings continue independently. Node-level savings start after `baselinePeriodEndTime`. | `k8s-andreas` — WAS from April 2026; node savings from May 2026 |
| **F — Disconnected / reporting unavailable** | Agent disconnected or savings reporting unavailable | Flag as unavailable. Do not report $0 or silently exclude the cluster. | `rhx-test` |

### API detection logic

| Case | Observed detection signals |
|---|---|
| A | Empty report items; WAS summary HTTP 400; classic savings HTTP 400 |
| B | `woopAdopted=true`, `autoscalerAdopted=false`; classic 400; baseline 404 |
| C | `woopAdopted=false`, `autoscalerAdopted=true`; baseline-params HTTP 200 (`CLUSTER_HISTORY`) |
| D | Both adoption flags `true`; baseline available (`CLUSTER_HISTORY` or `INDUSTRY_AVERAGE`) |
| E | Historical WAS savings precede node savings; node baseline becomes effective later |
| F | `agentStatus∈{disconnected,non-responding,waiting-connection,archived}`; cluster missing from report items |

These HTTP status combinations are **observations from the verification flow**, not guaranteed API behavior.

### Key reporting principles

1. **Avoid double counting:** `totalSavings` currently equals `autoscalerSavings`. When both autoscalers are enabled, Workload Autoscaler impact is already included in realized savings.
2. **Baseline dependency:** Node-level realized savings require a valid baseline and begin after the baseline period ends. Workload rightsizing savings are calculated independently of that period.
3. **Adoption thresholds:** CAST AI reports node-level realized savings when at least 20% of nodes are CAST AI-managed, and WAS savings when at least 20% of workloads are managed in VPA mode.
4. **Baseline quality:** `CLUSTER_HISTORY` is preferred. `INDUSTRY_AVERAGE` uses fleet-wide assumptions and should be reviewed for unusually high estimated savings.
5. **Missing data is not zero savings:** Distinguish inactive autoscaling, missing baselines, disconnected agents, and unavailable reporting.

**Reporting recommendation:** Classify each cluster into Cases A–F before aggregation. Report realized node savings separately from WAS-only potential savings. For clusters using both autoscalers, show WAS as an attribution metric rather than an additional saving.

**Official CAST AI documentation:** [Realized Savings Report](https://docs.cast.ai/docs/savings-report) · [Savings Calculations and Baseline Methodology](https://docs.cast.ai/docs/savings-baseline) · [CAST AI Savings API Reference](https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport)

---

---

## classic `/savings` vs value-realization report — two methodologies, one Δ

Both are 30d-window numbers for the same cluster, and they legitimately differ. The fleet dashboard shows both
side by side: `classic $` = `GET /v1/cost-reports/clusters/{id}/savings?startTime&endTime` → `summary.totalSavings`
(string), with `Δ = classic − VR.totalSavings` (amber when |Δ| ≥ 5% of the VR number).

| Aspect | Value-realization report (VR) | Classic cost-reports savings |
|---|---|---|
| Endpoint (verified) | `POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport?startTime&endTime` | `GET /v1/cost-reports/clusters/{clusterId}/savings?startTime&endTime` |
| Formula | per day: `projected = max(original, current demand) × overprovisioningFactor × max(currentPrice, baselineUnitPrice)`, CPU+RAM; savings = `projected − actual` | daily decomposition: `downscalingSavings` + `spotSavings` → summed into `summary.totalSavings` |
| Counterfactual | frozen **baseline** (types see §2; 404 = none, Case B) | none — compares today vs an optimal node mix + spot |
| Spot price arbitrage | not counted as savings (price floors only) | counted (`spotSavings`) |
| Case B clusters | `woopAdopted=true` → `workloadAutoscalerSavings` available | **HTTP 400 "cluster is read-only"** — nothing to compute |
| Response cost figure | `cost.actualCost` (utilization pipeline) | `summary.totalCost` (billing pipeline) |
| Use it for | customer-facing realized savings (CFO dashboard) | ops decomposition (what mechanism saved money) |

**Why Δ ≠ 0:** ① different cost bases (billing vs utilization pipelines); ② spot price arbitrage counted only by
classic; ③ VR applies baseline unit-price floors + overprovisioning factors, classic compares node mixes directly;
④ window edges and rounding. Neither number is wrong — they answer different questions.

Live anchors: `ngm-kronos-eks` classic (window 2026-09-07→2026-10-07) `summary.totalSavings=$4,201.54`,
daily `items[].downscalingSavings/spotSavings`; VR for the nearby window 2026-09-05→2026-10-05
`autoscalerSavings=$7,702.24` — windows shifted by 2 days, so the |Δ| shown here is mostly methodology
(both are correct answers to different questions). `f8dd5b4f` (Case B) classic → `HTTP 400 cluster is read-only`.

---

## Live-verified detail: 16 clusters, 3 orgs (implementation evidence)

| Case | Topology | Detection (API) | Savings track & rule | Baseline | Live proof |
|---|---|---|---|---|---|
| **A — Connected, nothing enabled** | Agent connected, no node mgmt, no WOOP agent | (VR) item absent for cluster (empty `items[]`) **or** both flags false; (WS) 400 "should be installed"; (CS) 400 "read-only" | **No savings data exists.** Do not report as "$0" — report as n/a. | none | `cloudcore01`, `bx-edex-prod-eu` (IT IPS), `clo-master-eks` (SI GSW CLO) |
| **B — Workload Autoscaler ONLY (Karpenter manages nodes)** | CAST steers workloads only; nodes stay Karpenter/EKS | (VR) `woopAdopted=true` **and** `autoscalerAdopted=false`, `baselineType=BASELINE_TYPE_UNSPECIFIED`; (ND) 0% `provisioner.cast.ai/managed-by`, `karpenter.sh` labels present; (CS) **400 "cluster is read-only"** (expected, not an error) | **`workloadAutoscalerSavings` only** = Σ_per-day `(originalRequested − currentRequested) × max(currentPrice, baselinePrice)` per CPU+RAM. Accrues **without any baseline** and **even inside another cluster's baseline window**. `actualCost == projectedCost`, `totalSavings = 0` (no node track). | none needed | 8 Railigent X clusters, e.g. `f8dd5b4f`: (VR) `workloadAutoscalerSavings=$431.26`, `autoscalerSavings=$0`; (WS) 56/65 VPA-optimized, CPU 26.1→5.7 cores (−78%), RAM 99.7→36.1 GiB (−64%) |
| **C — Node Autoscaler ONLY (CAST AI manages nodes)** | CAST AI node mgmt ≥20%, no WOOP | (VR) `autoscalerAdopted=true`, `woopAdopted=false`; (ND) ≥20% `provisioner.cast.ai/managed-by`; (BP) 200 with `CLUSTER_HISTORY` | **Node-level `autoscalerSavings` only** = `projected − actual` per day, starting at `baselinePeriodEndTime`. Projected = `max(original,current demand) × overprovisioningFactor × max(currentPrice, baselineUnitPrice)` per CPU+RAM. **Zero inside baseline window.** | **required** — CLUSTER_HISTORY here | `ngm-kronos-eks`: (VR) `autoscalerSavings=$7,702.24`, (BP) baseline 2025-09-30→2025-11-06, CPU factor 5.2468, RAM 11.0015, $0.029858/core-h, $0.004142/GiB-h. `ngm-helios-eks`: `$14,967.86`, baseline until 2026-07-20 |
| **D — BOTH Node + Workload Autoscaler** | CAST AI node mgmt + WOOP both active | (VR) `autoscalerAdopted=true` **and** `woopAdopted=true` | Both computed. **`totalSavings == autoscalerSavings`** — WOOP savings are already priced into the projection (double-count guard: **never add `workloadAutoscalerSavings` on top**). `workloadAutoscalerSavings` is an explanatory decomposition. | required (node track); WOOP track independent | `k8s-andreas`: `totalSavings=$150,024.33`, `workloadAutoscalerSavings=$619.45` (INDUSTRY_AVERAGE); `ngm-sim-eks`: `totalSavings=$51,723.31`, WOOP `=$0` (adopted, 0/494 rightsized yet) |
| **E — Transition: WAS cluster later enables Node Autoscaler** | Case B → Case D over time | (TL): monthly `workloadAutoscalerSavings>0` appears **before** any `autoscalerSavings>0`; per cluster: (BP) `baselinePeriodEndTime` = the day node mgmt crossed the threshold | **Nothing is lost, nothing double counts.** WOOP savings accrue from activation (they do not wait for a baseline); node savings start accruing at `baselinePeriodEndTime`; both coexist after. | baseline window = connect → node-mgmt start; WOOP accrues **inside** it | Org Railigent X (TL): WAS savings since **2026-04** ($6), node autoscaler savings since **2026-05** ($94,422) — one month apart, both present after |
| **F — Not eligible / no reporting data** | Disconnected agent, or onboarded read-only with neither engine | (VR) empty `items[]` for the window; (01) `agentStatus=disconnected` | none — flag in reporting so it isn't silently dropped | none | `rhx-test` (disconnected, WOOP not installed) |

### Baseline type (BP `baselineType`) — standardized definitions
| Baseline type | How it is calculated | Reliability | Live example |
|---|---|---|---|
| CLUSTER_HISTORY | Uses at least 7 days of the cluster's own history before CAST AI node management | **Highest** | `ngm-kronos-eks` (CPU factor 5.2468 / RAM 11.0015) |
| PEER_CLUSTERS | Uses historical baseline data from eligible clusters within the same organization | Medium | (documented fallback) |
| INDUSTRY_AVERAGE | Uses averages from CAST AI's broader cluster fleet when no suitable cluster or peer history exists | Lowest | `k8s-andreas`: window 2026-04-15→16 (**24h**), CPU factor 169.58, RAM 35.44 |
| Overridden | CAST AI representative manually adjusts parameters or recalculates the baseline over a custom period | Requires review | (none in sample fleet) |
| UNSPECIFIED / No baseline | No baseline has been established, or node-level baseline reporting does not apply | N/A | all Case-B clusters — (BP) returns **HTTP 404** by design |

---

## Answers to the 5 open questions (email thread, Bosko → Ebrahim, 2026-10-06)

**Q1. How to recognize a cluster with workload autoscaling enabled but NOT node autoscaling?**
Three independent API signals (any order):
1. (VR) per-cluster flags: `woopAdopted=true` + `autoscalerAdopted=false` — **authoritative one-liner**; baselineType will be `BASELINE_TYPE_UNSPECIFIED`.
2. (ND) nodes: `provisioner.cast.ai/managed-by=cast.ai` share = 0% (well below 20%), nodes carry `karpenter.sh/*` or plain nodegroup labels instead.
3. (CS) classic savings endpoint answers **400 "this API is not available … cluster is read-only"** — a stable machine-readable signal the node track is off.
> ⚠ Do not use `totalSavings==0` as the detector: a healthy Case-B cluster has `totalSavings=0` **and** `workloadAutoscalerSavings>0` (verified: `f8dd5b4f` $431.26 with total 0).

**Q2. How to avoid double reporting?**
- Use **one** report object per cluster: the value-realization item. It already separates `autoscalerSavings` (node track) from `workloadAutoscalerSavings` (workload track); `totalSavings` equals the node track — **never sum the two tracks into one figure**.
- The WOOP effect is structurally inside the projection once a baseline exists (lower current requests → higher projected-vs-actual delta), so adding WAS on top counts it twice.
- ⚠ **Do not mix sources**: classic (CS) and (VR) measure the node track with different methodology — on `ngm-kronos-eks` the same 30 days read **$3,453.12 (CS)** vs **$7,702.24 (VR)**. Pick (VR) as the single source for board numbers and document the choice.
- Dedupe by `clusterId`, never by name (org has six clusters named `k8s`; 6 `k8s` + `staging` + `rhx-test` + `k8s-andreas` share one org).

**Q3. How to find its savings and what is the baseline?**
- Savings: (VR) `cost.workloadAutoscalerSavings` (workload track) and `cost.autoscalerSavings` (node track), window-scoped.
- Baseline = the no-CAST-AI counterfactual: for CPU and RAM separately, an **overprovisioning factor** (× demand) and a **baseline unit cost** (price floor), fixed at `baselinePeriodEndTime`. Selection order: CLUSTER_HISTORY → PEER_CLUSTERS → INDUSTRY_AVERAGE. Case-B clusters have **no baseline** — and don't need one for WOOP savings; (BP) returns 404 there.
- Savings math per day: `Realized = Projected − Actual`; Projected = `max(original, current demand) × factor × max(current, baseline price)`. WOOP savings = `(original − current) × max(current, baseline price)`, CPU + RAM separately.

**Q4. How to find the date workload autoscaler was enabled?**
- **Not from (WM)** in practice: the metrics endpoint returns only ~7 days of retention (verified: 2026-09-30→10-07 regardless of a 90-day request) — useless for install dates older than a week; it answers "since when within the last week".
- **From (TL)**: first monthly bucket with `workloadAutoscalerSavings > 0` (monthly grain). Railigent X: **2026-04**.
- Exact day/time: cluster change/audit history (console or audit API) — outside the reporting endpoints; flag it as a doc/console lookup, not a reporting number.

**Q5. What happens when a WAS-enabled cluster later enables node autoscaling?**
Case **E**. Verified live from (TL) at org level: WOOP savings accrue from 2026-04 ($6, then 507, 1695, 7395, 9076, 9127…) while node `autoscalerSavings` appears from 2026-05 ($94,422…) — i.e. the WOOP track **keeps accruing independently**, the node track **starts at `baselinePeriodEndTime`**, and the report carries both fields on the same cluster (`k8s-andreas` today). Baseline date does **not** restart for WOOP; WOOP savings do not stop or get absorbed.

---

## Cross-checks against the email thread (all reproducible)

| Thread claim | API re-verification (2026-10-08) | Result |
|---|---|---|
| `f8dd5b4f`: 56/65 workloads VPA-optimized; CPU 26.1→5.9 cores; RAM 99.8→35.8 GiB | (WS): `optimizedCount=56/65`, `originalRequestedCpuCores=25.92→requested=5.85` (rec. 4.94), RAM `99.67→36.27` | ✓ |
| Classic savings on `f8dd5b4f` → 400 "read-only" | (CS) 400 `this API is not available for cluster …: cluster is read-only` | ✓ |
| `f8dd5b4f` WOOP savings $431.26 / 30 d | (VR) `workloadAutoscalerSavings=431.2577…` | ✓ |
| Org ~$8,983 WOOP on $63,959 spend (30 d) | (VR) Σ items: WOOP `=$8,983.35`, actual `=$63,959` | ✓ |
| "20% node flag never fires" on Karpenter cluster | (ND) `f8dd5b4f`: 0/7 managed-by=cast.ai → 0% | ✓ |

## Known gotchas (verified live — bake into every consumer)
1. **Enterprise key needs `X-CastAI-Organization-Id` on every call** — without it the key sees zero clusters (nginx 404 / empty 200), which looks exactly like "cluster not found".
2. (BP) **404 = "no baseline"**, not an outage; (CS) **400 "read-only"** = Karpenter/WOOP-only signal, not an error.
3. (WM) retention ≈ 7 days — no long history.
4. (CS) vs (VR) node savings diverge (different methodology) — never mix both in one report.
5. WOOP can **raise** a resource's requests when workloads are under-provisioned: `4952c4ce` RAM 851.5→1157.2 GiB (+36%) while CPU halves — net WOOP savings still +$2,267.45. Per-resource deltas can be negative; don't clamp.
6. Org totals: `totalSavings` (node track) and WOOP savings are separate columns — Railigent X 30 d: node $150,024.33 (one cluster) + WOOP $8,983.35 (nine clusters ≈ 14% of $63,959 actual spend).
7. Timeline endpoint path is `POST .../organizations/{orgId}:runValueRealizationTimelineReport` (the `…/clusters:` variant 404s); max useful grain monthly for Board views.
