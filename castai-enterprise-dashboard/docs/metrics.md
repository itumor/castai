# Metrics Mapping — CAST AI Enterprise Dashboard

**Status:** design document.
**Purpose:** the single metric → endpoint → field → unit → aggregation-rule mapping for
every KPI and table column. Companion to `docs/data-model.md` (table shapes, dtypes,
sentinels) and `docs/enterprise-hierarchy.md` (org scoping header
`X-CastAi-Organization-Id` on every org-scoped call).

**Global conventions**

- All `costreport.v1beta1` numerics are **JSON strings** on the wire →
  `pd.to_numeric(errors="coerce")`, failures → `pd.NA` (**never** 0).
- Windowed endpoints require `startTime`,`endTime` (RFC 3339). One window per refresh
  run; label every KPI with its window. Run-rate metrics are point-in-time.
- `useListingPrices` chosen once per run, passed to all calls in that run.
- Aggregation law: **ratio KPIs = SUM(numerator)/SUM(denominator)** on pairwise-complete
  masks. No averages of percentages anywhere.
- "CAST AI value?" = whether CAST AI publishes this aggregate (used as cross-check; the
  sliced tables always use the derived value). `Derived` = we compute it from raw sums.
- 730 = hours/month convention for run-rate → monthly conversion.

---

## v2 ADOPTED metric mapping (2026-09-21 — ADR v2 R1–R10, canonical)

The phase-2 design docs `docs/finops-model.md` (FinOps/savings) and
`docs/resource-metrics.md` (resource rename/semantics) are **adopted fully into
this document here**; those files remain as authoring evidence. This section is
the canonical v2 mapping. Table columns keep the canonical format
(name/definition/source/fields/formula/unit/time-range/aggregation/missing-data)
and add **Tier (1/1-batch/2)**: `1` = enterprise sweep at page load, `1-batch` =
user-triggered bounded enrichment batch over the current filtered set
(`services/enrichment_service.run_enrichment`; caps realized 100, others 400,
≤ 800 calls/run, 15-min session cache — invariant I6: never auto-fired),
`2` = single-cluster drill-down. **Anything a v2 row omits is resolved by the
ADR v2 pointer (docs/architecture.md R1–R10) — the ADR is the tiebreaker.**
Superseded v1 rows in §A/§B/§C/§E are annotated inline, never removed.

| Metric name | Definition | Source endpoint | Field(s) | Formula | Unit | Time range | Aggregation | Missing-data behavior | Tier |
|---|---|---|---|---|---|---|---|---|---|
| `cpu_utilization_pct` (was `cpu_efficiency`) | Headroom against schedulable capacity (allocatable basis) — **rename only, same 0–1 value** | `GET …/organization/clusters/summary` | `cpuUsed`, `cpuAllocatable{OnDemand,Spot,SpotFallback}` | `cpu_used / cpu_allocatable`; enterprise `Σ used / Σ allocatable` | stored 0–1, rendered % | point-in-time | ratio-of-sums; row mask used & allocatable present, **allocatable > 0** | missing/absent ⇒ `pd.NA`; 0 allocatable ⇒ `pd.NA`, not 0 % | 1 |
| `memory_utilization_pct` (was `memory_efficiency`) | RAM twin of the above | 〃 | `ramUsed`, `ramAllocatable*` | `ram_used / ram_allocatable`; enterprise ratio-of-sums | 0–1 → % | point-in-time | 〃 | 〃 | 1 |
| `cpu_request_efficiency_pct` | How much of what workloads **asked for** is actually consumed (rightsizing lens) — NEW | 〃 | `cpuUsed`, `cpuRequested{…}` | `cpu_used / cpu_requested`, **requested > 0 mask per row AND at enterprise level** | 0–1 → % | point-in-time | `Σ used / Σ requested` over `requested > 0` rows; `n_clusters_included` shown | requested = 0 row leaves the mask ("no requests", a valid state — never 0 %, never counted missing) | 1 |
| `memory_request_efficiency_pct` | RAM twin | 〃 | `ramUsed`, `ramRequested*` | 〃 | 0–1 → % | point-in-time | 〃 | 〃 | 1 |
| Monthly run rate (current) | Cost for a month if the current snapshot held — label "run-rate", never "actual" | 〃 | `costHourly{OnDemand,Spot,SpotFallback}` | `Σ 3 lifecycles × 730` | USD/month | point-in-time | `Σ` over present rows; coverage `n/n_missing` shown | row absent ⇒ `No-data`; KPI excludes + counts | 1 |
| Actual period cost | Compute cost accrued in the report window | `GET …/organization/clusters/report` (windowed) — `summary.totalCost` is "average"-flavored, live validation pending (finops §9) | `clusters[].summary.totalCost` | `Σ` over window | USD/window | report window (default trailing 30 d) | `Σ` per cluster over present rows | window without data ⇒ `No-data`, not 0 | 1 |
| Projected monthly cost | **No forecast endpoint exists** (spec-verified) — defined as the run rate under the explicit assumption "current snapshot holds" | derived | — | `= monthly_cost` (label-only, never a hidden third computation) | USD/month | point-in-time | as run rate | as run rate | 1 (label-only) |
| Optimized monthly cost | Cost at CAST AI's achievable optimum | `GET …/organization/overview` | `clusters[].optimalCostHourly` (direct field is canonical — never back-fill from other tiers) | `optimal_cost_hourly × 730` (algebra `= (cost − potential_savings) × 730` in-row) | USD/month | point-in-time | `Σ` over rows where optimal present | missing overview row ⇒ `No-data` (baseline 23/241) | 1 |
| Remaining savings opportunity | The still-uncaptured opportunity — **`= potential_savings`, full stop (alias)**. NOT `potential − realized` (mixes time directions — rule-5 violation; no `remaining` API field) | derived | — | `= potential_savings_monthly` | USD/month | point-in-time | as potential | as potential | 1 (alias) |
| `potential_savings_hourly` / `potential_savings` (raw) | Signed hourly/monthly delta — **never clamped, never floored at 0** (rule 9) | `GET …/organization/overview` | `clusters[].costHourly`, `clusters[].optimalCostHourly` — same-source pairwise on ONE overview item | `ov_costHourly − ov_optimalCostHourly`; monthly `× 730` | USD/h · USD/month | point-in-time | `Σ` — net headline INCLUDES negatives | overview row absent ⇒ `No-data`; row leaves every savings mask; never impute 0 | 1 |
| `potential_savings_percentage` | Signed %, same-source pairwise | 〃 | 〃 | `raw / ov_costHourly` (den > 0); enterprise `Σ raw / Σ ov_costHourly` | 0–1 → % | point-in-time | ratio-of-sums on the pairwise mask; no per-row clamping enters any denominator | `NA` on missing/zero den | 1 |
| Gross identified opportunity | Sum of positive deltas only | 〃 | — | `Σ raw │ raw > 0` (monthly `× 730`), `n_positive` count | USD/month | point-in-time | `Σ` | raw absent ⇒ excluded | 1 |
| Over-optimized headroom | Sum of negative deltas (optimized config costs more — typical for over-utilized READ_ONLY/DISCOVERED; ≤ $0.01/h negatives are precision artifacts) | 〃 | — | `Σ raw │ raw < 0` (× 730), `n_negative` chip; **never green, never clamped, explained in UI** | USD/month | point-in-time | `Σ` | raw absent ⇒ excluded | 1 |
| Cost change 7 d / 30 d | Δ% between two equal windows from the sweep's own report payloads (**+0 calls**, FleetResult.reports reuse) | `organization/clusters/report` ×1/org (already swept) | `totalDailyCost[]{timestamp,value}` | `(Σ_B − Σ_A) / Σ_A` over clusters present in BOTH windows | % | two labeled windows | ratio-of-sums; A = 0 ⇒ NA | missing window ⇒ `No-data` | 1 |
| Spot-covered spend | Share of current spend on spot nodes | `clusters/summary` | `costHourlySpot`, `Σ costHourly*` | `Σ spot_cost_hourly / Σ cost_hourly` | 0–1 → % | point-in-time | ratio-of-sums | NA-safe | 1 |
| Realized savings (window) | Savings CAST AI attributes as already achieved — **label "realized"; never merged with potential tiles (rule 5)** | `GET …/clusters/{clusterId}/savings` (**per-cluster only — no org endpoint exists**) | `summary.totalSavings` (x-check `Σ items.downscaling + items.spot`, tol 1 %) | pass-through `Σ` | USD/window | `startTime–endTime` (default trailing 30 d) | `Σ` over included clusters; every rendered aggregate shows "realized over **n of m** clusters" | cluster fetch fails/404 ⇒ excluded + `FetchError`; empty window ⇒ `No-data` ≠ 0 | **2 default; 1-batch opt-in (cap 100)** |
| Realized — downscaling / spot components | Node/bin-packing vs spot split; the ONLY sanctioned spot-savings number is `spotSavings` (never on-demand−spot mix) | 〃 | `items[].downscalingSavings`, `items[].spotSavings` | `Σ` per component | USD/window | 〃 | 〃 | `0` only on true API 0 | 2 / 1-batch |
| Realized savings % (primary) | Share of the pre-optimization baseline | 〃 | `summary{totalSavings, totalCost}` | `totalSavings / (totalCost + totalSavings)`; enterprise ratio-of-sums equivalent | % | window | ratio-of-sums | denominator 0/NA ⇒ NA | 2 / 1-batch |
| Actual spend (realized window) | What was actually paid in the window | 〃 | `summary.totalCost` | `Σ` | USD/window | window | `Σ` | as above | 2 / 1-batch |
| `waste_cpu_usd` / `waste_ram_usd` / `waste_storage_usd` | Cost of provisioned-but-unused CPU/RAM/storage (CAST AI rightsizing model — **double**, not string) | `GET …/organization/clusters/efficiency` (paged, windowed) — **v2: 6th Tier-1 call per org, default ON** | `items[].wasted.{cpu,ram,storage}` | pass-through | USD/window | efficiency window (default trailing 30 d) | `Σ` over present rows | cluster absent ⇒ `No-data` | 1 |
| `waste_total_usd` | Sum over the three resource classes | derived | — | `wasted.cpu + wasted.ram + wasted.storage` (**`min_count=1` per class**) | USD/window | 〃 | `Σ` | all classes absent ⇒ `pd.NA`, NEVER silently re-based | 1 |
| Waste share | Waste ÷ window resource spend | 〃 | `cpuCost.cost`, `ramCost.cost`, `storageCost.cost` | `Σ waste_total / Σ (cpu+ram+storage cost)` pairwise | % | same window | ratio-of-sums | NA-safe | 1 |
| Org waste cross-check | CAST AI's own rollup (reconciliation only — derived values are the sliced truth) | `GET …/organization/efficiency/summary` | `totalWaste`, `*Resources{provisioned,requested,used}`, `*Cost{…}` | drift > 5 % vs derived ⇒ data-quality banner | — | same window | 1 call/org | banner, never silent | 1 (shipped: drill-down-only) |
| `na_managed_nodes` / `na_coverage_pct` | Node-autoscaler managed node count / share | `clusters/summary` **(+0 calls)** | `nodeCount{OnDemand,Spot,SpotFallback}Castai` (spec: "managed by CAST.AI"), `nodes_total` | `Σ 3 counters min_count=1`; share = `na_managed_nodes / nodes_total` (total > 0) | count · 0–1 | point-in-time | `Σ`; ratio-of-sums | all counters absent ⇒ `pd.NA`; den ≤ 0 ⇒ `pd.NA` | 1 |
| Storage family: `storage_provisioned_gib`, `storage_claimed_gib`, `storage_active_claimed_gib`, `storage_cost_hourly`, `storage_commit_pct` | GiB provisioned / claimed-in-PVC / **ACTIVE claims (wire trap: `storageRequested` = claims accessed by any workload — NOT a scheduler request)** / cost; commit = claims-vs-provisioned proxy, labeled "commit", NEVER "utilization" (no used-bytes source exists at Tier 1 — `storage_used` is **N/A**) | `clusters/summary` | `storageProvisioned`, `storageClaimed`, `storageRequested`, `storageCostHourly` | `commit = claimed / provisioned` (provisioned > 0) | GiB · USD/h · 0–1 | point-in-time | `Σ`; commit ratio-of-sums | `pd.NA` on absent | 1 |
| GPU/TPU (hidden-group contract, resource-metrics §6) | `gpu_{provisioned,allocatable,requested,active,idle,reserved_unused,cost_hourly}` = Σ `gpu{…,Used,Idle,NotUsed}*` / `gpuCostHourly*` over 3 lifecycles (`min_count=1`); `gpu_active_pct = Σ used / Σ provisioned` (provisioned basis = waste lens); `tpu_{provisioned,requested,cost_hourly}` = Σ 3 lifecycles — **no `tpuUsed*` exists ⇒ TPU utilization N/A, never derive** | `clusters/summary` | `gpu{*}{OnDemand,Spot,SpotFallback}`, `tpu{*}*`, cost fields | counts / cost / ratio-of-sums | counts · USD/h · 0–1 | point-in-time | as stated | measured 0 stays 0; absent field ⇒ `pd.NA` ("–") | 1 (hidden columns, off the default grid) |
| Fleet spot-CPU-share trend | Spot adoption direction over the window (cost/CPU-weighted) | `GET …/organization/efficiency` series (+1 call/org, opt-in History expander button — never auto-fired) | `onDemand/spot/fallback` lifecycle blocks | `Σ spot / Σ total` per day (ratio-of-sums over buckets) | %/day | window | ratio-of-sums | absent series ⇒ per-chart info, siblings unaffected | 1 (opt-in) |
| Notifications counts | Unacked / critical+error / warning read counts | `GET /v1/notifications` — **3 × `page.limit=1` exact-count reads per org, flag OFF** | `countUnacked`, `count` | pass-through | count | point-in-time | `Σ` over orgs | org failure ⇒ excluded + banner | 1 (optional flag `CASTAI_ENABLE_NOTIFICATIONS`) |
| OOM kills (window), fleet total | OOMKilled event count — **org totals ONLY: the org response carries no `clusterId` — per-cluster OOM is Tier-2** | `GET …/organization/workload-event-metrics` (+1 call/org, flag OFF) | `series[].items[].eventCount` | `Σ` per org | count | window | `Σ` | per-org isolated | 1 (optional flag `CASTAI_ENABLE_CLUSTER_HISTORY`) / per-cluster: 2 |
| `overprovisioned_cpu_pct` (v2-OPS, ADR R11) | Share of CPU provisioned above what is needed (CAST AI rightsizing lens — the efficiency item's FLAT double) | `GET …/organization/clusters/efficiency` (already the 6th Tier-1 call — +0 extra calls) | `items[].cpuOverprovisionedPercent` (JSON double, **0–100 scale — not a 0–1 ratio**) | pass-through (no ×100, no ÷100) | % | efficiency window | `Σ`-none — row-level display only (picker column, off the default grid) | field/absent row ⇒ `pd.NA`, NEVER 0 | 1 |
| `overprovisioned_ram_pct` (v2-OPS) | RAM twin | 〃 | `items[].ramOverprovisionedPercent` | 〃 | % | 〃 | 〃 | 〃 | 1 |
| `overprovisioned_storage_pct` (v2-OPS) | Storage twin (ABSOLUTE GiB/cores exist ONLY on the per-cluster efficiency report — Tier 2 `load_cluster_overprovision`, never Tier-1-derived) | 〃 | `items[].storageOverprovisionedPercent` | 〃 | % | 〃 | 〃 | 〃 | 1 |
| `nodes_provider_managed` (v2-OPS) | Nodes NOT claimed by CAST-'s managed counters (provider/user-managed complement) | derived from the SAME `clusters/summary` item (**+0 calls**) | `nodes_total`, `na_managed_nodes` | `nodes_total − na_managed_nodes` — **negative-guard: `total < managed` ⇒ `pd.NA`** (counter-family mismatch, never negative-garbage); measured 0 stays 0 | count | point-in-time | `Σ` over present | either side NA ⇒ `pd.NA` | 1 |
| WA optimized split (drill-down row; also `enr_wa_coverage_*` batch keys) | VPA-only / HPA-only / V+H optimized workload counts + API vs annotation management split | `GET …/workload-autoscaling/clusters/{clusterId}/workloads-summary` (includeCosts=true) | `vpaOptimizedCount`, `hpaOptimizedCount`, `hpaVpaOptimizedCount`, `apiManagedCount`, `annotationManagedCount` | pass-through | count | point-in-time | none (drill-down tiles; batch `Σ` generic) | absent ⇒ NA (–), NEVER 0 | 2 / 1-batch |
| WA estimated monthly savings | Modeled savings from rightsizing WA requests — **estimated lens only, never summed with realized or potential (rule 5)** | 〃 | `costsPerHour{requested,recommended}` (**nullable: includeCosts absent**) | `(requested − recommended) × 730` | USD/month | point-in-time | none (drill-down tile) | either side absent/non-finite ⇒ NA + "includeCosts absent" caption, NEVER fabricated | 2 |
| WA original-vs-current requested (drill-down tiles) | Pre-WA template requests vs current requested (autoscaler-model: originalRequested* family) + actual usage | 〃 | `originalRequestedCpuCores`, `originalRequestedMemoryGibs`, `requestedCpuCores`, `requestedMemory`, `usageCpuCores`, `usageMemoryGibs`, `cpuCoresDifference`, `memoryDifference` | pass-through / delta tiles | cores · GiB | point-in-time | none | absent ⇒ NA | 2 / 1-batch |
| Rebalancing schedule (org) + cluster job status (v2-OPS, ADR R11) | Org schedule inventory (`name`, `cron`, `lastTriggerAt`, `nextTriggerAt`) + this cluster's latest job (`status` enum `JobStatus{Pending,InProgress,Finished,Failed,Skipped}`) — **fleet `rebalance_*` cells stay NA at Tier 1: linkage is NOT resolvable from the org payload (embedded `jobs[]` opaque by contract; `launchConfiguration` NodeSelectors are label selectors with NO cluster id — spec-verified); cluster linkage comes ONLY from `jobs[].rebalancingScheduleId` on the cluster-scoped endpoint** | `GET /v1/rebalancing-schedules` (**7th Tier-1 call/org, default ON, flag `CASTAI_ENABLE_REBALANCE_SCHEDULES`**) + `GET …/kubernetes/clusters/{clusterId}/rebalancing-jobs` (drill-down, ttl 900) | `schedules[]{id,name,schedule.cron,lastTriggerAt,nextTriggerAt}`; `jobs[]{rebalancingScheduleId,status,lastTriggerAt,nextTriggerAt}` | pass-through; latest job = max `lastTriggerAt` (never-triggered ⇒ soonest `nextTriggerAt`) | — · RFC-3339 ts | point-in-time | none (org list + per-cluster job) | failed/absent ⇒ N/A caption per side (failure-isolated); no rows ⇒ "none returned" | 1 (org inventory, no row join) + 2 (cluster jobs) |

**Negative-savings policy (rule 9, finops §2 — shipped):** raw
`potential_savings*` is NEVER clamped or floored at 0. The KPI trio is: **Net
potential savings** (`Σ raw × 730`, negatives included — hiding them overstates
filtered views) + **Gross identified opportunity** (positives only, `n_positive`
count) + **Over-optimized headroom** (negatives only, `n_negative` chip).
Negatives render as `🔻 −$X (cost increase)` (red-neutral triangle, never the
error family, never green); the raw value lives in tooltips and CSV. Semantic
root cause (READ_ONLY/DISCOVERED `optimalCostHourly` legitimately above current
spend on over-utilized clusters) is explained in the UI, never "fixed" in data.

**Three-lens no-double-counting rule (resource-metrics §7 — shipped):**
utilization % (point-in-time, `clusters/summary`), waste $ (trailing window,
`clusters/efficiency`, CAST's rightsizing model) and savings-opportunity $
(snapshot, `organization/overview`, CAST's optimal-node model) are THREE
independent lenses. Never add waste $ to spend (spend already includes the
idle capacity); never add waste $ to potential savings (two different estimate
models ⇒ double counts the same idle capacity); show in separate cards/sections
with window/source labels. Storage is the asymmetric case: waste $ exists
(`wasted.storage`) while storage utilization does NOT (no used bytes) — the
storage row shows commit % + waste $, never a fake "efficiency".

---

## A. Enterprise Cluster Table — column mapping (Tier 1, per page load)

Grain: `(organization_id, cluster_id)`. "N/A — no reliable source" = do not fabricate.

| Column | Endpoint (per child org) | Field(s) | Unit (wire) | Transform | Enterprise aggregation | CAST AI value? |
|---|---|---|---|---|---|---|
| `organization_name` | `GET /v1/organizations` | `organizations[].name` | — | stamp | — | — |
| `organization_id` | `GET /v1/kubernetes/external-clusters` | `items[].organizationId` (== scoping header) | — | — | — | — |
| `cluster_name` | 〃 | `items[].name` | — | — | — | — |
| `cluster_id` | 〃 | `items[].id` | — | — | — | — |
| `provider` | 〃 | `items[].providerType`; x-check `organization/overview → clusters[].provider` | string (eks/gke/aks/…) | category | `value_counts` | `OrganizationSummary.providers[]` (count+cost per provider) |
| `region` | 〃 | `items[].region.name` (display: `region.displayName`) | — | category | `value_counts` | no |
| `status` (FLEET_COLUMNS; data-model.md calls it `lifecycle_status`) | 〃 | `items[].status` (connecting/ready/warning/failed/deleting/deleted/hibernat*) | string enum | pass-through | `value_counts` | no |
| `agent_status` | 〃 | `items[].agentStatus` (waiting-connection/online/non-responding/disconnected/disconnecting) | string enum | pass-through; drives **Disconnected** sentinel | `value_counts` | no |
| `reporting_state` | `GET /v1/cost-reports/organization/overview` | `clusters[].state` (`CLUSTER_STATE_{OPTIMIZED,READ_ONLY,CALIBRATING,DISCOVERED,DISCONNECTED,FAILED}`) | string enum | pass-through | `value_counts` | via `bySource[]` split only |
| `kubernetes_version` | both sources | `items[].kubernetesVersion` / `clusters[].kubernetesVersion` | string | nullable ⇒ `Unknown` | no agg | no |
| `cpu_provisioned` | `GET /v1/cost-reports/organization/clusters/summary` | `items[].cpuProvisioned{OnDemand,Spot,SpotFallback}` | string, cores | to_num, sum 3 cols | `Σ` (hourly avg snapshot) | `OrganizationSummary.totalCpuProvisioned` |
| `cpu_allocatable` | 〃 | `cpuAllocatable{OnDemand,Spot,SpotFallback}` | string, cores | sum 3 | `Σ` | org efficiency summary `cpuResources.provisioned`*(≈)* |
| `cpu_requested` | 〃 | `cpuRequested{OnDemand,Spot,SpotFallback}` | string, cores | sum 3 | `Σ` | `cpuResources.requested` |
| `cpu_used` | 〃 | `cpuUsed` | string, cores | to_num | `Σ` | `cpuResources.used` |
| `cpu_efficiency` (superseded name 2026-09-21 — ships as `cpu_utilization_pct`, ADR v2 R8; see v2 ADOPTED table) | derived | `cpu_used / cpu_allocatable` | ratio 0–1 | NA-safe divide | `Σ cpu_used / Σ cpu_allocatable` (mask both) | ref: `OrganizationSummary.avgCpuUtilization` ("weighted avg", basis unspecified) |
| `memory_provisioned_gib` / `memory_allocatable_gib` / `memory_requested_gib` | `clusters/summary` | `ramProvisioned* / ramAllocatable* / ramRequested*` (×3 lifecycles each) | string, **GiB** | sum 3 each; pass-through, **no unit scaling** (millicore/MiB traps are Tier-2 node endpoints only) | `Σ` | `totalRamProvisioned`, `ramResources.*` |
| `memory_used_gib` | 〃 | `ramUsed` | string, GiB | to_num | `Σ` | `ramResources.used` |
| `memory_efficiency` (superseded name 2026-09-21 — ships as `memory_utilization_pct`, ADR v2 R8; see v2 ADOPTED table) | derived | `memory_used / memory_allocatable` | 0–1 | NA-safe | `Σ ram_used / Σ ram_allocatable` | ref: `avgRamUtilization` |
| `nodes_total` | 〃 | `nodeCountOnDemand + nodeCountSpot` | string→int | exclude unknown | `Σ` | `OrganizationSummary.totalNodes` |
| `nodes_spot` · `nodes_on_demand` | 〃 | `nodeCountSpot` · `nodeCountOnDemand` | int | to_num | `Σ`; spot share = `Σ spot / Σ total` | `spotNodeCount`, `onDemandNodeCount` |
| `nodes_fallback` | 〃 | `nodeCountSpotFallbackCastai` | int | **CAST-managed fallback only** | `Σ` (label exact scope) | exact total: **N/A — no reliable Tier-1 source** (Tier 2: count node list `lifecycleType=fallback`) |
| `nodes_unknown` | 〃 | `unknownNodeCount` ("not supported instance type") | int | to_num | `Σ` | no |
| `cost_hourly` | 〃 | `costHourly{OnDemand,Spot,SpotFallback}`; x-check `overview clusters[].costHourly` | string, USD/h | sum 3 | `Σ`, ×730 for monthly | `totalCostHourly` (USD/h) |
| `monthly_cost` | derived | `cost_hourly × 730` | USD/month | — | `Σ`; trailing-window alt: `organization/daily-cost` interval integration | `daily-cost` intervals (raw) |
| `optimal_cost_hourly` | `organization/overview` | `clusters[].optimalCostHourly` | string, USD/h | to_num; NA if item absent ⇒ `No-data` | `Σ` over present rows | — |
| `potential_savings_hourly` (FLEET_COLUMNS) · `potential_savings` (aux, monthly) | derived | `costHourly − optimalCostHourly` (hourly, pairwise on the overview item's own fields); `× 730` for the monthly auxiliary | USD/h · USD/month | NA-safe; clip only noise-level negatives | `Σ` (scheduling flavor, see §C) | `OrganizationSummary.potentialSavingsHourly` (USD/h) |
| `potential_savings_percentage` | derived | `(cost_hourly − optimal_cost_hourly) / cost_hourly` | 0–1 | NA-safe | `Σ savings_hourly / Σ overview_cost_hourly` (same-source — final-review correction) | no (derive; CAST AI's `%` only per-cluster in `SavingsRecommendation.savingsPercentage`, Tier 2) |
| `workload_autoscaler_status` | `GET /v1/workload-autoscaling/organizations/{organizationId}/components/workload-autoscaler` | `clusterAgentStatuses[].status` (`AGENT_STATUS_{INVALID,UNKNOWN,RUNNING}`) by `clusterId` | string enum | absent cluster ⇒ `Not installed` | coverage = count(RUNNING)/count(in-scope) | no |
| `woa_current_version` / `woa_latest_version` / `woa_updated_at` | 〃 | `currentVersion` · `latestVersion` · `updatedAt` | string/date | display only | no agg | no |
| `node_autoscaler_status` | **no Tier-1 endpoint** | architecture.md §9.4 (approved): Tier-1 cell = `"T2"` sentinel badge; `is_phase2` ships as separate aux column | — | Tier-1 ⇒ `"T2"` literal, never derived/fabricated | `value_counts` (badge) | exact `policies.enabled` = Tier 2 (`GET /v1/kubernetes/clusters/{clusterId}/policies`) |
| `is_phase2` | `external-clusters` | `items[].isPhase2` | bool | nullable ⇒ NA | count(true) | no |
| `problematic_nodes` | **Tier 2 only** | `GET /v1/kubernetes/clusters/{clusterId}/problematic-nodes → len(nodes)` | int | Tier-1 cell = `"T2"` sentinel string (rendered as "Tier 2" badge) | `Σ` over drilled clusters only | no org-level endpoint — **Tier-1: N/A** |
| `problematic_workloads` | **Tier 2 only** | `…/problematic-workloads → len(controllers)+len(standalonePods)` | int | Tier-1 cell = `"T2"` sentinel string (badge) | same | no org-level endpoint — **Tier-1: N/A** |
| `last_updated` | overview + external-clusters | `max(clusters[].sources[].lastCollectedAt)`, else `agentSnapshotReceivedAt` | date-time | max() per cluster | org freshness = `latestSyncTime` | `latestSyncTime` (org-level) |
| proxies (aux: `pod_count`, `unschedulable_pods`, `nodes_unknown`) | `clusters/summary` | `podCount`, `unschedulablePodCount`, `unknownNodeCount` (excluded from `nodes_total`), `clusterScore` (semantics unknown, not shipped) | string | aux cols | `Σ` pods; clusterScore: display only, **no aggregation** | no |
| `overview_cost_hourly` (aux, `EXTRA_COLUMNS`) | `organization/overview` | `clusters[].costHourly` | string, USD/h | to_num | `Σ`; same-source denominator of `potential_savings_pct` (final-review correction, §B) | `OrganizationSummary.totalCostHourly` |

## B. Enterprise KPI card mapping

| KPI | Rule (§3 of data-model) | Tier-1 inputs | Unit | Output provenance |
|---|---|---|---|---|
| Active clusters / total clusters | count where `lifecycle_status ∈ {ready, warning, connecting}` / count all | external-clusters × orgs | count | Derived |
| Enterprise monthly cost | `Σ cost_hourly × 730` | clusters/summary | USD/mo | Derived; x-check `OrganizationSummary.totalCostHourly × 730` |
| Enterprise CPU utilization | `Σ cpu_used / Σ cpu_allocatable` | clusters/summary | % | Derived; ref `OrganizationSummary.avgCpuUtilization`; windowed twin from `organization/efficiency/summary → cpuResources{used,provisioned}` |
| Enterprise memory utilization | `Σ ram_used / Σ ram_allocatable` | 〃 | % | Derived; windowed twin `ramResources{used,provisioned}` |
| CPU request commitment | `Σ cpu_requested / Σ cpu_allocatable` | 〃 | % | Derived |
| Enterprise waste (window) (superseded note — **v2 SHIPS at Tier-1**: `clusters/efficiency` is the 6th call per org, default ON, ADR v2 R2; see v2 ADOPTED table) | `Σ (wasted.cpu+wasted.ram+wasted.storage)` | organization/clusters/efficiency (paged) — **v1: NOT called at Tier-1**; waste KPIs unshipped (KPI renders the N/A path) | USD/window | Derived; x-check `organization/efficiency/summary → totalWaste` (shipped: drill-down-only) |
| Potential savings (opportunity) | `Σ (cost_hourly − optimal_cost_hourly) × 730` | organization/overview | USD/mo | Derived; x-check `potentialSavingsHourly` |
| Potential savings % | `Σ savings_hourly / Σ overview_cost_hourly` (denominator = Σ overview `costHourly`, same-source pairwise mask — final-review correction) | 〃 | % | Derived |
| Spot adoption (nodes / spend) | `Σ nodes_spot / Σ nodes_total` · `Σ spotCostHourly / Σ costHourly` | clusters/summary | % | Derived |
| WOA coverage | count(RUNNING)/count(in-scope clusters) | WOA org statuses | % | Derived |
| Unschedulable pressure | `Σ unschedulable_pod_count` | clusters/summary | pods | Derived |
| `unschedulable_pods_total` (shipped KPI-dict key; sibling `clusters_with_unscheduled_pods` = count of clusters with `unschedulable_pods > 0`) | `Σ unschedulablePodCount` | clusters/summary | pods | Derived |
| Org data coverage | `n_orgs_ok / n_orgs_total`, failed list | org_health | count/% | Derived (failure sentinel) |

## C. Savings taxonomy mapping (strict separation — never summed together)

| Bucket | Endpoint | Fields | Unit/window | Tier |
|---|---|---|---|---|
| Potential (estimated) | `GET …/clusters/{clusterId}/estimated-savings` | `recommendations{key}.monthly.priceBefore/priceAfter`, `savingsPercentage`, `currentConfiguration.totalPrice.monthly`, `lastUpdatedAt` | USD/month, snapshot | T2 authoritative; T1 approx = overview `costHourly−optimalCostHourly` |
| Realized (actual) | `GET …/clusters/{clusterId}/savings` (window) | `summary.totalSavings`, items `downscalingSavings`, `spotSavings` per `timestamp`, `summary.totalCost` | USD per window | T2 (v2 tier: **T2 default + 1-batch opt-in over the filtered set, cap 100**, ADR v2 R3) |
| Spot savings (realized) | 〃 | `items[].spotSavings` only | USD per window | T2 — never derived from on-demand−spot spend mix |
| Rightsizing opportunity | `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary`; `GET …/rightsizing-summary` | `cpuCoresDifference`, `memoryDifference`, `costsPerHour.{requested,recommended}`; `RightsizingRecommendation.Summary.{cpuCoresDifference,ramBytesDifference}` | cores/GiB/USD-h | T2 |
| Scheduling opportunity | `organization/overview` | `optimalCostHourly` (+ `isRebalancingRecommended` from estimated-savings) | USD/h | T1 / T2 |
| Platform impact (before/after, org grain) | `GET /v1/cost-reports/organization/cost-comparison` (`startTimeA`,`startTimeB`,`rangeDays`, opt `clusterIds[]`) | `summary.workloadOptimizationSavings` (per day), `savingsPerProvisionedCpuCore[Percent]`, `workloadCpuCoresReduced`, `periodA/B.usedCpuCores...` | USD/day, period-vs-period | T1 optional (org-level only, **no per-cluster rows**; label "estimated/impact", not realized) |

*Note: `recommendations{}` map keys are an open `additionalProperties` map — key names
not enumerated in the spec ⇒ discover at runtime, iterate generically.*

## D. Tier-2-only metric mapping (per selected cluster)

| Table.column | Endpoint | Fields | Unit |
|---|---|---|---|
| nodes: `instance_type/zone/state` | `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` (paged) | `items[].{instanceType, zone, state.phase, addedBy, unschedulable, createdAt, joinedAt}` | — |
| nodes: `cpu/mem capacity·allocatable·requests` | 〃 | `resources.{cpuCapacityMilli,cpuAllocatableMilli,cpuRequestsMilli,memCapacityMib,memAllocatableMib,memRequestsMib}` | **millicores / MiB → /1000, /1024** |
| nodes: `is_spot` | 〃 | `spotConfig.isSpot`; fallback via `lifecycleType=fallback` filter call only | bool |
| issues: node/workload problems | `…/problematic-nodes`, `…/problematic-workloads` | `nodes[].problems[]`, `controllers[].problems[]`, `standalonePods[].problems[]`, `hasProblems` | free-form strings |
| workloads: optimization state | `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads` (+`-summary` rollup) | per-workload optimization fields; summary counts + `recommended*` vs `requested*` | cores, Gi |
| workloads: autoscaler impact | `GET /v1/kubernetes/clusters/{clusterId}/workloads` | `workloads[].{name,resource,namespace,replicas,milliCpu,memoryMib,nodes,status,issues,costImpact}` | millicores, MiB |
| cluster_timeseries | `GET /v1/cost-reports/clusters/{clusterId}/overview` | `agent/agentless.resourceTimeseries[]`, `lastSnapshotAt`, `slo[]` (sparse semantics) | string numerics |
| node_autoscaler_enabled | `GET /v1/kubernetes/clusters/{clusterId}/policies` | `policies.v1.Policies.enabled` (nullable) | bool |
| node_count_history | `GET /v1/cost-reports/clusters/{clusterId}/node-count-history` | per spec | count/timestamp |

## E. N/A — no reliable API source (do not fabricate)

| Desired metric | Status | Reason / closest source |
|---|---|---|
| Tier-1 exact count of **all** fallback nodes (incl. unmanaged) | **N/A (Tier 1)** | `ClusterSummary` exposes only `nodeCountSpotFallbackCastai` (CAST-managed). Tier-2 exact: nodes list with `lifecycleType=fallback`. |
| Tier-1 `problematic_nodes` / `problematic_workloads` | **N/A (Tier 1)** (superseded 2026-09-21 — **v2 SHIPS via the `health` 1-batch**: 3 calls/cluster over the filtered set, cap 400; pre-batch cells render `n/a — load`, ADR v2 R3) | only per-cluster endpoints exist ⇒ Tier 2 back-fill; Tier-1 proxies (`unknownNodeCount`, `unschedulablePodCount`) are labeled proxies, not the same metric. |
| Tier-1 exact `node_autoscaler_enabled` per cluster | **N/A (Tier 1)** (superseded 2026-09-21 — **v2 SHIPS via the `na_policies` 1-batch**, cap 400; and `na_managed_nodes`/`na_coverage_pct` managed-share ship at Tier-1 +0 calls, ADR v2 R6) | only per-cluster `GET …/policies` (`enabled`); Tier-1 derived display from `isPhase2`+`status`, labeled derived. |
| Per-cluster **realized** savings at Tier 1 | **N/A (Tier 1)** (superseded 2026-09-21 — **v2 SHIPS via the `realized` 1-batch**, cap 100; default exposure stays Tier-2, ADR v2 R3; realized-as-default-Tier-1 remains REJECTED) | `…/savings` is per-cluster only ⇒ Tier 2 aggregate-on-demand over selected clusters; enterprise realized view not offered by default. |
| Estimated-savings scenario key names | **Not in spec** | `recommendations` is open map ⇒ runtime discovery; never hard-code keys. |
| CAST AI `avgCpuUtilization` weighting basis | **Spec-unspecified** | use as reference cross-check only. |
| `clusters/report` per-cluster `summary.totalCost` semantics | **Ambiguous ("Average compute cost")** | validation required before any use; default cost path is run-rate/daily-cost. |
| Uptime/SLA per cluster | **N/A** | no uptime endpoint (ALB/SLO signals in overview are partial producer coverage only ⇒ sparse, never zero-imputed). |
| Cost **budgets/forecasts** | **N/A — no reliable source** | no budget/forecast endpoint in spec. |

## F. Optional/auxiliary endpoints (evaluated, classified)

| Endpoint | Grain | Role | Decision |
|---|---|---|---|
| `GET /v1/cost-reports/allocation-group-summaries` | org × allocation-group × window | business-unit cost slice (`totalCostOnDemand/Spot/Fallback`, `requestedCpuHours`, …) | **Optional Tier-1 slice** — wrong grain for the per-cluster master table |
| `GET /v1/cost-reports/allocation-group-totals` | org × group × timed | group cost timeseries (paged) | Same; open q: ungrouped-workloads coverage |
| `POST /v1/cost-reports/clusters/active` | org × window → `clusterIds[]` | metrics-coverage oracle → `No-data` sentinel, KPI coverage counts | **Optional, config-flagged** (read-semantics POST; GET-only default) |
| `GET /v1/cost-reports/organization/daily-cost` | org × cluster × interval | trailing-window actual cost integration | Optional Tier-1 (alt to ×730 convention) |
| `GET /v1/billing/enterprise/platform-usage-*` | enterprise × child-org × feature | platform **fee/billing** usage by feature (`feature=` required, e.g. "phase2","woop") | Out of cluster-metrics scope; candidate for a separate admin view |

---

*All wire facts verified against `docs/openapi/castai-openapi.json` on 2025-09-21 by
programmatic extraction (no hand-typed fields). Anything not found in the spec is marked
N/A / spec-unspecified above.*
