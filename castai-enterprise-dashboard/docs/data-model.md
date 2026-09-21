# Data Model & Aggregation — CAST AI Enterprise Dashboard

**Status:** design document (no app code yet).
**Audience:** implementers of the read-only Streamlit dashboard.
**Evidence base:** `docs/openapi/castai-openapi.json` (OpenAPI 3.0.1, 423 paths). Every
endpoint and field cited below was extracted programmatically from the spec; field
descriptions are quoted from the spec. Cross-refs: `docs/enterprise-hierarchy.md`
(org/cluster discovery, scoping header), `docs/metrics.md` (metric → endpoint mapping),
`docs/performance.md` (request budget).

---

## 0. Ground rules

1. **Composite identity.** Every cluster-level record carries `organization_id` +
   `organization_name`. Cluster names are **not** unique (3× `dev-vlab-cluster` observed
   in one org). Cache/dedup/UI keys are always `(organization_id, cluster_id)`.
2. **Org scoping.** With an Enterprise key, every org-scoped GET must send
   `X-CastAi-Organization-Id: <child org id>` (undocumented, load-bearing — see
   `enterprise-hierarchy.md` §3). Org-level endpoints below (`/v1/cost-reports/
   organization/*`) take **no** `organizationId` parameter; the organization comes from
   the key/header context. Tier 1 therefore = **one bounded fan-out across ~126 orgs**,
   not one global call.
3. **Numbers arrive as JSON strings** in all `cost-report.v1beta1` APIs (proto3 idiom):
   `"cpuProvisionedOnDemand": "4.5"`. Convert with `pd.to_numeric(errors="coerce")`;
   unparseable/absent → `pd.NA`, **never** silent `0`.
4. **Sparse means unknown, not zero.** CAST AI itself documents sparse signals, e.g.
   cluster SLO list: *"an omitted metric means no producer covers it here, not zero"*.
   We adopt the same convention dashboard-wide (§5).
5. **Timestamps** are RFC 3339 (`date-time`); parse with `pd.to_datetime(..., utc=True)`.
6. **Pricing consistency.** Several cost endpoints accept `useListingPrices` (bool). Pick
   one mode per refresh run and pass it to every endpoint in that run, or mixing will
   silently corrupt aggregates.
7. **Never invent fields.** If a desired metric has no spec field, it is marked
   **N/A — no reliable source** here and in `docs/metrics.md`.

### Refresh tiers

| Tier | What | When | Endpoints per refresh |
|---|---|---|---|
| **Tier 1** | Enterprise + per-cluster overview | Page load / manual refresh (cached `st.cache_data`, TTL e.g. 15 min) | 2 discovery calls + per-org: `external-clusters`, `organization/clusters/summary`, `organization/overview`, `organization/clusters/efficiency` (paged), `workload-autoscaling/organizations/{orgId}/components/workload-autoscaler` ⇒ ~5–6 × ~126 orgs ≈ **630–760 GETs** |
| **Tier 2** | Per-cluster drill-down | On demand, one selected cluster at a time (cached per cluster+window) | ≤ 8 GETs for the selected cluster only |

Tier 1 never calls per-cluster endpoints (would be ~1,000 × k calls — see
`performance.md` §1.4 for why that is unusable).

**Evaluated and classified (from sibling-agent input, verified here against the spec):**

- `POST /v1/cost-reports/clusters/active` (body `ActiveClustersFilter{startTime*,
  endTime*}` → `{clusterIds[]}`): a per-org batch **metrics-coverage oracle** — "which
  clusters have cost-report data in this window". Read-semantics POST. **Optional Tier-1,
  behind a config flag** (default GET-only posture per `security-requirements.md`; the
  master table can already infer coverage from presence/absence in the
  overview/summary responses). If enabled, its result feeds the `No-data` sentinel
  (§5) and KPI included-cluster counts.
- `GET /v1/cost-reports/allocation-group-summaries` / `-totals`: **wrong grain for the
  master table** — rows are allocation *groups* (`groupName`, `groupId`), not clusters;
  `clusterIds[]` is only a filter, responses contain no per-cluster rows. Costs are
  window **totals**, not hourly run-rates. Adopted only as the optional
  `allocation_group_costs` slice (§1.5a); they do **not** replace the per-org
  `clusters/summary` + `overview` fan-out.

---

## 1. Conceptual tables

All tables expose `organization_id`, `organization_name`; cluster tables expose
`cluster_id`, `cluster_name`. DTypes use pandas **nullable** types (`Int64`, `Float64`,
`boolean`, `string`, `category`, `datetime64[ns, UTC]`).

### 1.1 `organizations` — grain: one row per Enterprise-tree org *(Tier 1)*

Source: `GET /v1/organizations` → `organizations[]` (`castai.users.v1beta1.UserOrganization`),
filtered per `enterprise-hierarchy.md` §4 (ENTERPRISE root + CHILD with matching `parentId`).

| Column | DType | Source field | Notes |
|---|---|---|---|
| `organization_id` | string | `id` | PK |
| `organization_name` | string | `name` (required) | |
| `organization_type` | category | `type` | `ORGANIZATION_TYPE_ENTERPRISE` / `ORGANIZATION_TYPE_CHILD` |
| `parent_id` | string (NA-able) | `parentId` | **nullable per spec** ("beta feature") |
| `child_order_id` | Int64 | `childOrderId` | nullable |
| `org_created_at` | datetime64[ns, UTC] | `createdAt` | |

### 1.2 `org_health` — grain: one row per org per refresh *(Tier 1)*

Separate dataframe (not a column on the master table) so one failing org never hides or
corrupts others. Joined to `organizations` on `organization_id`.

| Column | DType | Meaning |
|---|---|---|
| `organization_id` / `organization_name` | string | key |
| `discovery_status` | category | `ok` / `empty` (200, 0 clusters) / `error` |
| `http_status` | Int64 | last non-200 status, NA if network error or n/a |
| `error_message` | string | sanitized message |
| `endpoints_ok` | string | per-endpoint bitmap-ish summary, e.g. `"clusters:ok,summary:ok,overview:fail,efficiency:ok,woa:ok"` |
| `clusters_returned` | Int64 | rows contributed |
| `fetched_at` | datetime64[ns, UTC] | |

Observed failure mode: HTTP **500** for bad org ids (not 401/403) — any non-200 is a
per-org skip, never fatal. Only `GET /v1/organizations` is fatal-on-failure.

**Shipped v1 replacement (2026-09-21, final review):** the separate `org_health`
frame was NOT built. Org failures ship as a `FetchError` list on
`FleetResult.errors` (`organization_id`, `organization_name`, `operation`,
sanitized `message`) plus a per-row `data_status` column on the master table
(`ok` / `partial` / `unavailable`; a failed org's rows are stamped
`unavailable` and drop out of every KPI pairwise mask). The UI renders the
FetchError list in the warning banner instead of joining a health frame.

### 1.3 `clusters` — **THE ENTERPRISE CLUSTER TABLE** — grain: `(organization_id, cluster_id)` *(Tier 1)*

One row per cluster. Assembled by LEFT JOINing five Tier-1 payloads on
`organization_id`/`cluster_id`. §2 gives the canonical column list with exact source fields.

### 1.4 `cluster_resources` — grain: `(organization_id, cluster_id)` *(Tier 1)*

Raw resource quantities, one row per cluster (wide). Source: `GET
/v1/cost-reports/organization/clusters/summary` per org →
`costreport.v1beta1.ClusterSummary` (all values JSON strings; units per spec descriptions).
Kept separate from `clusters` so the master table stays lean; join on composite key.

- CPU cores: `cpu_provisioned_{on_demand,spot,fallback}`,
  `cpu_allocatable_{on_demand,spot,fallback}`, `cpu_requested_{on_demand,spot,fallback}`
  (`Float64`), `cpu_used` (Float64, cores).
- RAM GiB: same matrix from `ramProvisioned* / ramAllocatable* / ramRequested* / ramUsed`
  (spec: *"Provisioned RAM GiB"*, *"Used RAM GiB"*).
- GPU counts: `gpuProvisioned*`, `gpuAllocatable*`, `gpuRequested*`, `gpuUsed*`,
  `gpuIdle*`, `gpuNotUsed*` (Int64 where integral).
- Storage GiB: `storage_provisioned`, `storage_requested`, `storage_claimed`
  (`storageProvisioned`, `storageRequested` = *"Storage GiB claimed in PVC accessed by any
  workload"*, `storageClaimed`).
- Counts (Int64): `node_count_on_demand`, `node_count_spot`,
  `node_count_on_demand_castai`, `node_count_spot_castai`,
  `node_count_spot_fallback_castai`, `unknown_node_count` (*"Number of nodes with not
  supported instance type"*), `pod_count`, `unschedulable_pod_count`.
- Costs USD/h (Float64): `cost_hourly_{on_demand,spot,fallback}`,
  `cpu_cost_hourly_*`, `ram_cost_hourly_*`, `gpu_cost_hourly_*`, `storage_cost_hourly`.
- `cluster_score` (Float64) — spec only says *"Cluster score"*; semantics/range
  **unknown** — keep raw, do not aggregate until validated.

### 1.5 `cluster_costs` — grain: `(organization_id, cluster_id)` + time-window **metadata row** *(Tier 1 windowed + Tier 2 detail)*

The dashboard standard cost metrics are **hourly-run-rate × 730 h = monthly estimate**
(units USD). Keep both hourly and monthly columns to make the convention explicit.

- Tier 1 (current run-rate): `cost_hourly_total = costHourlyOnDemand + costHourlySpot +
  costHourlySpotFallback` (from `ClusterSummary`); cross-check against
  `ClusterOverviewItem.costHourly`. `monthly_cost = cost_hourly_total * 730`.
- Tier 1 (trailing window, optional): `GET /v1/cost-reports/organization/daily-cost`
  (`startTime`, `endTime` required) → per cluster `intervals[]` of
  `costOnDemandPerHour / costSpotPerHour / costSpotFallbackPerHour` at each `timestamp`.
  Period cost = Σ over intervals of avg-hourly × interval duration. `grain:
  (organization_id, cluster_id, timestamp)` in a separate long table if charted.
- `GET /v1/cost-reports/organization/clusters/report` also returns per-cluster period
  `summary.totalCost` **but the spec describes it as "Average compute cost"** — whether
  "average" is per-day/per-cluster/per-interval is **not specified** ⇒ treat as
  **unknown semantics**, validate against live data before use; not a Tier-1 default.
- Currency: USD (spec: *"Total hourly price … in $ currency"* for savings; cost fields
  described as cost in USD/h in `OrganizationSummary`: *"Total estimated hourly cost
  across all clusters (USD)"*).

### 1.5a `allocation_group_costs` — **optional** slice, grain: `(organization_id, group_id)` (+ timed rows) *(Tier 1, windowed)*

Only if Siemens uses CAST AI allocation groups (business slicing). From
`GET /v1/cost-reports/allocation-group-summaries` per org → items
`{groupName, groupId, summary{totalCostOnDemand, totalCostSpot, totalCostSpotFallback,
cpuCost, ramCost, gpuCost, cpuCount (avg CPUs used), ramGib (avg), workloadCount,
requestedCpuHours, requestedRamGibHours, …}}` — all **period totals** (window from
`startTime`/`endTime`). `allocation-group-totals` adds the per-group **timed** series
(cursor-paginated). Open question recorded in §7: whether workloads in no group are
included in any row ⇒ never reconcile group sums against §3.1 unless verified.

### 1.6 `cluster_efficiency` — grain: `(organization_id, cluster_id, start_time, end_time)` *(Tier 1, windowed)*

Source: `GET /v1/cost-reports/organization/clusters/efficiency` per org
(**paginated**: `page.limit`/`page.cursor`, loop until `nextCursor` empty; `startTime`,
`endTime` required) → `ClusterEfficiencyDetails` per cluster:

| Column | DType | Source field | Unit |
|---|---|---|---|
| `cpu_provisioned` / `cpu_requested` / `cpu_used` | Float64 | `onDemandResources.cpuResources.{provisioned,requested,used}` + same under `spotResources`, `fallbackResources` (sum 3 lifecycles) | cores |
| `ram_provided/requested/used` | Float64 | `*.ramResources.*` | GiB |
| `cpu_overprovisioned_pct` / `ram_overprovisioned_pct` | Float64 | `cpuOverprovisionedPercent`, `ramOverprovisionedPercent` | % (CAST AI definition; exact denominator **not specified** — cross-check vs `1 − used/provisioned` on live data) |
| `cpu_cost_period` / `ram_cost_period` / `storage_cost_period` | Float64 | `cpuCost.cost`, `ramCost.cost`, `storageCost.cost` | USD per window |
| `wasted_cpu_cost` / `wasted_ram_cost` / `wasted_storage_cost` | Float64 | `wasted.cpu`, `wasted.ram`, `wasted.storage` | USD per window |
| `cpu_cost_per_unit_used` | Float64 | `cpuCost.perUnitUsed` | USD/core |

The org-wide rollup (`GET /v1/cost-reports/organization/efficiency/summary` →
`GetOrganizationEfficiencySummaryResponse`: `cpuResources/ramResources` provisioned/
requested/used, `totalWaste`) is CAST AI's own aggregate — use as **cross-check**, not as
the sliced-table source (§3.9).

### 1.7 `cluster_savings` — grain: `(organization_id, cluster_id)` *(Tier 1 headline + Tier 2 detail)*

| Column | DType | Tier | Source |
|---|---|---|---|
| `cost_hourly` | Float64 | T1 | `ClusterOverviewItem.costHourly` (org overview `clusters[]`) |
| `optimal_cost_hourly` | Float64 (NA-able) | T1 | `ClusterOverviewItem.optimalCostHourly` — *"Achievable hourly cost … agent clusters rightsized … Waste is the UI's (cost_hourly − optimal_cost_hourly)"* |
| `potential_savings_monthly` | Float64 | T1 (derived) | `(cost_hourly − optimal_cost_hourly) × 730` — **scheduling/rightsizing flavor**, see §4 |
| `potential_savings_pct` | Float64 | T1 (derived) | `(cost_hourly − optimal_cost_hourly) / cost_hourly` |
| `estimated_savings_monthly` | Float64 | T2 | `GET …/estimated-savings` → `recommendations{key→SavingsRecommendation}`: `monthly.priceBefore − monthly.priceAfter`; key names are an **open map — not enumerated in spec ⇒ discover at runtime** |
| `estimated_savings_pct` | Float64 | T2 | `SavingsRecommendation.savingsPercentage` (per key) |
| `current_config_monthly` | Float64 | T2 | `currentConfiguration.totalPrice.monthly` |
| `savings_report_generated_at` | datetime | T2 | `lastUpdatedAt` |
| `realized_savings_period` | Float64 | T2 | `GET …/savings` (start/end required) → `summary.totalSavings`; items split `downscalingSavings` / `spotSavings` per `timestamp` |
| `realized_cost_period` | Float64 | T2 | `summary.totalCost` (same window) |

### 1.8 `cluster_autoscaling` — grain: `(organization_id, cluster_id)` *(Tier 1 WOA status + Tier 2 node-autoscaler)*

| Column | DType | Tier | Source |
|---|---|---|---|
| `workload_autoscaler_status` | category | T1 | `GET /v1/workload-autoscaling/organizations/{organizationId}/components/workload-autoscaler` (one call per org → per-cluster array!) → `status` enum `AGENT_STATUS_INVALID` / `AGENT_STATUS_UNKNOWN` / `AGENT_STATUS_RUNNING`; absent cluster ⇒ `Not installed` |
| `woa_current_version` / `woa_latest_version` | string | T1 | `currentVersion`, `latestVersion` (upgrade-nudge column) |
| `woa_updated_at` | datetime | T1 | `updatedAt` |
| `is_phase2` | boolean (NA-able) | T1 | `externalcluster.v1.Cluster.isPhase2` — *"Indicates if the cluster is in phase 2"* ⇒ node-autoscaler-managed |
| `node_autoscaler_enabled` | boolean | **T2** | `GET /v1/kubernetes/clusters/{clusterId}/policies` → `policies.v1.Policies.enabled` (*"Enable/disable all policies"*, nullable). **No org-level endpoint exists** ⇒ Tier-1 column is `Unknown` until drill-down; derive `node_autoscaler_mode` Tier-1 display from `is_phase2` + `lifecycle_status` only. |

### 1.9 `cluster_nodes` — grain: `(organization_id, cluster_id, node_id)` *(Tier 2, lazy)*

Source: `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` (paginated;
`nextCursor`) → `externalcluster.v1.Node`. Relevant filters: `nodeStatus`, `lifecycleType`.

| Column | DType | Source field | Unit |
|---|---|---|---|
| `node_id` / `node_name` | string | `id`, `name` | |
| `instance_type` | category | `instanceType` | |
| `lifecycle` | category | derived: `spotConfig.isSpot` + lifecycle filter value (`on_demand`/`spot`/`fallback`); fallback flag only via API filter — **no per-node fallback field in schema** (risk, §7) | |
| `node_state_phase` | category | `state.phase` | matches `nodeStatus` enum (`ready`, `not_ready`, `interrupted`, `cordoned`, …) |
| `zone` | category | `zone` | |
| `cpu_capacity_cores` | Float64 | `resources.cpuCapacityMilli / 1000` | cores |
| `cpu_allocatable_cores` | Float64 | `resources.cpuAllocatableMilli / 1000` | cores |
| `cpu_requested_cores` | Float64 | `resources.cpuRequestsMilli / 1000` | cores |
| `mem_capacity_gib` / `mem_allocatable_gib` / `mem_requested_gib` | Float64 | `resources.mem*Mib / 1024` | GiB |
| `added_by` | category | `addedBy` | if `castai` ⇒ CAST-managed |
| `unschedulable` | boolean | `unschedulable` | |
| `node_created_at` / `joined_at` | datetime | `createdAt`, `joinedAt` | |

**Unit warning:** node API uses **millicores/MiB**; `ClusterSummary` uses **cores/GiB** —
normalize at ingest (single conversion helpers, never inline literals).

### 1.10 `cluster_issues` — grain: `(organization_id, cluster_id, [node|workload], name)` *(Tier 2)*

- Nodes: `GET /v1/kubernetes/clusters/{clusterId}/problematic-nodes` →
  `nodes[]{nodeId, name, problems[]}`, `hasProblems`. → `problematic_node_count = len(nodes)`.
- Workloads: `GET /v1/kubernetes/clusters/{clusterId}/problematic-workloads` →
  `controllers[]{name, kind, problems[]}` + `standalonePods[]{name, problems[]}` →
  `problematic_workload_count = len(controllers) + len(standalonePods)`.
- `problems[]` are free-form strings ("List of controller problems") — store as
  pipe-joined string, don't enum-parse.
- **No org-level problematic endpoint exists** ⇒ Tier-1 master-table columns
  `problematic_nodes`/`problematic_workloads` are `NA — Tier 2` until that cluster is
  drilled into (lazy cache back-fills the master view; never auto fan-out).
- Tier-1 **proxy** for node problems: `unknown_node_count` (unsupported instance types)
  and `unschedulable_pod_count` from `ClusterSummary` — label as *proxies*, not the same
  metric.

### 1.11 `workloads` — grain: `(organization_id, cluster_id, namespace, workload_name)` *(Tier 2)*

Two sources, different purposes:

- **Optimization state** (preferred): `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads`
  (+ `workloads-summary` for the rollup: `totalCount`, `optimizedCount`,
  `recommendedCpuCores` vs `requestedCpuCores`, `cpuCoresDifference`,
  `costsPerHour.{requested,recommended,originalRequested}` — the workload **rightsizing
  opportunity** at cluster level).
- **Autoscaler impact view**: `GET /v1/kubernetes/clusters/{clusterId}/workloads` →
  `workloads[]{name, resource (kind), namespace, replicas, milliCpu, memoryMib, nodes[],
  status, issues[], costImpact}`.

Columns: `namespace` (string), `workload_name` (string), `kind` (category),
`replicas` (Int64), `cpu_cores` (Float64 = `milliCpu/1000`), `memory_gib`
(Float64 = `memoryMib/1024`), `node_count` (Int64 = `len(nodes)`),
`issue_count` (Int64), `issues` (string), `optimization_status` (category, from WOA
source), `recommended_cpu_cores` / `recommended_memory_gib` (Float64, WOA source).

---

## 2. Canonical ENTERPRISE CLUSTER TABLE schema

One row per `(organization_id, cluster_id)`. All Tier-1 columns filled at page load;
Tier-2 columns stay `NA` until the cluster is drilled into. The "Candidate → actual"
column maps the original candidate names.

| # | Column | DType | Tier | Actual source field(s) | Transform / rule |
|---|---|---|---|---|---|
| 1 | `organization_name` | string | T1 | stamped from `organizations` | from the *requested* org, not just echoed `organizationId` |
| 2 | `organization_id` | string | T1 | `Cluster.organizationId` == scoping header | PK part 1 |
| 3 | `cluster_name` | string | T1 | `Cluster.name` | **not unique** |
| 4 | `cluster_id` | string | T1 | `Cluster.id` | PK part 2 |
| 5 | `provider` | category | T1 | `Cluster.providerType` (e.g. `eks`); cross-check `ClusterOverviewItem.provider` | |
| 6 | `region` | category | T1 | `Cluster.region.name` (canonical; `region.displayName` for labels) | |
| 7 | `lifecycle_status` | category | T1 | `Cluster.status`: `connecting, ready, warning, failed, deleting, deleted, hibernating, hibernated, resuming` | free-form string in schema ⇒ pass unknown values through |
| 8 | `agent_status` | category | T1 | `Cluster.agentStatus`: `waiting-connection, online, non-responding, disconnected, disconnecting` | drives **Disconnected** sentinel |
| 9 | `reporting_state` | category | T1 | `ClusterOverviewItem.state`: `CLUSTER_STATE_{OPTIMIZED,READ_ONLY,CALIBRATING,DISCOVERED,DISCONNECTED,FAILED}` | cost-reports view of the cluster |
| 10 | `kubernetes_version` | string | T1 | `Cluster.kubernetesVersion` / `ClusterOverviewItem.kubernetesVersion` | **nullable ⇒ `Unknown`** |
| 11 | `cpu_provisioned` | Float64 | T1 | `ClusterSummary.Σ cpuProvisioned{OnDemand,Spot,SpotFallback}` | cores |
| 12 | `cpu_allocatable` | Float64 | T1 | `Σ cpuAllocatable{…}` | cores |
| 13 | `cpu_requested` | Float64 | T1 | `Σ cpuRequested{…}` | cores |
| 14 | `cpu_used` | Float64 | T1 | `ClusterSummary.cpuUsed` | cores |
| 15 | `cpu_efficiency` | Float64 | T1 derived | `cpu_used / cpu_allocatable` (NA-safe; see §3.2 for the two-ratio convention) | 0–1 (superseded name 2026-09-21 — ships as `cpu_utilization_pct`, ADR v2 R8; see v2 contract below) |
| 16–20 | `memory_provisioned` / `memory_allocatable` / `memory_requested` / `memory_used` / `memory_efficiency` | Float64 | T1 / T1 derived | `ramProvisioned*`, `ramAllocatable*`, `ramRequested*`, `ramUsed` | GiB; same shape as CPU (`memory_efficiency` superseded name 2026-09-21 — ships as `memory_utilization_pct`, ADR v2 R8) |
| 21 | `nodes_total` | Int64 | T1 | `nodeCountOnDemand + nodeCountSpot` (+ `unknownNodeCount` shown separately) | |
| 22 | `nodes_spot` | Int64 | T1 | `nodeCountSpot` | |
| 23 | `nodes_on_demand` | Int64 | T1 | `nodeCountOnDemand` | |
| 24 | `nodes_fallback` | Int64 | T1 | `nodeCountSpotFallbackCastai` — **CAST-managed fallback only**; total fallback incl. unmanaged has **no Tier-1 field** (derive in Tier 2 from node list `lifecycleType=fallback` count) | |
| 25 | `nodes_unknown` | Int64 | T1 | `unknownNodeCount` | proxy signal, not "problems" |
| 26 | `cost_hourly` | Float64 | T1 | `Σ costHourly{OnDemand,Spot,SpotFallback}` (cross-check `ClusterOverviewItem.costHourly`) | USD/h |
| 27 | `monthly_cost` | Float64 | T1 derived | `cost_hourly × 730` | USD/month (730 h convention) |
| 28 | `optimal_cost_hourly` | Float64 | T1 | `ClusterOverviewItem.optimalCostHourly` | USD/h; NA when overview misses the cluster |
| 29 | `potential_savings` | Float64 | T1 derived | `(cost_hourly − optimal_cost_hourly) × 730` | USD/month; clip tiny negatives to 0, keep real negatives (cost > optimal can occur when `state=DISCOVERED`) |
| 30 | `potential_savings_percentage` | Float64 | T1 derived | `(cost_hourly − optimal_cost_hourly) / cost_hourly`, NA-safe | 0–1; format % |
| 31 | `workload_autoscaler_status` | category | T1 | org WOA statuses `status` | missing row ⇒ **`Not installed`** (distinct from `AGENT_STATUS_UNKNOWN`) |
| 32 | `node_autoscaler_status` | category | T1 derived / T2 exact | T1: from `is_phase2` + `lifecycle_status` (`Managed` / `Read-only` / `Unknown`); T2: `policies.enabled` | see §1.8 — **no Tier-1 API field** |
| 33 | `problematic_nodes` | Int64 | T2 | `len(problematic-nodes.nodes)` | Tier-1 ⇒ `pd.NA` (see §1.10; **not** `unknownNodeCount`) |
| 34 | `problematic_workloads` | Int64 | T2 | `len(controllers) + len(standalonePods)` | Tier-1 ⇒ `pd.NA` |
| 35 | `last_updated` | datetime64[ns, UTC] | T1 | best of: `max(sources[].lastCollectedAt)` (overview), `Cluster.agentSnapshotReceivedAt` | per-cluster data freshness; org-level `latestSyncTime` shown beside it |

**Shipped names (v1, 2026-09-21)** *(v2 contract below supersedes the
superseded-name references here — see ADR v2 R8 for the two renames):* #7
`lifecycle_status` ships as `status`;
#16–20 `memory_*` ship as `memory_*_gib` (`memory_provisioned_gib`,
`memory_allocatable_gib`, `memory_requested_gib`, `memory_used_gib`,
`memory_efficiency` unchanged); #9 `reporting_state`, #25 `nodes_unknown`,
#28 `optimal_cost_hourly`, #29 `potential_savings`, and aux `is_phase2` /
`pod_count` ship as `EXTRA_COLUMNS` appended after `FLEET_COLUMNS` (34 cols);
new aux `overview_cost_hourly` = overview `clusters[].costHourly` (the
same-source savings-% denominator, §3.7 **corrected**); rows #33/#34 ship as
the `"T2"` sentinel string (not Int64-NA); #35 `last_updated` ships as the
SWEEP fetch timestamp (`FleetResult.fetched_at` — per-cluster freshness is
future work; **delivered in v2 as the freshness trio below** — superseded
2026-09-21, see ADR v2 R5).

---

### §2.1 SHIPPED v2 column contract (2026-09-21, phase 2 — ADR v2 R5/R6/R8)

**70 columns = 34 `FLEET_COLUMNS` + 34 `EXTRA_COLUMNS` + 2
`REPORT_EXTRA_COLUMNS`** (source of truth: `services/cluster_service.py`,
`data/normalizers.py`; order IS the export contract). The 34-row provenance
table above stays valid for FLEET_COLUMNS with exactly two renames (ADR v2 R8):
`cpu_efficiency`→`cpu_utilization_pct` and
`memory_efficiency`→`memory_utilization_pct` — SAME 0–1 values, rename only;
the `*_pct` suffix encodes the display contract (render % at the edge), never a
0–100 stored scale. The three placeholder columns still carry the `"T2"`
sentinel as a *value* pre-batch (the v2 display layer renders it as
`"n/a — load"`; the `health`/`na_policies` enrichment batches fill real
values in `enr_*`-prefixed session columns — UX: docs/ux-v2.md §3).

`EXTRA_COLUMNS` (34, appended verbatim after FLEET_COLUMNS in this order):

| # | Column | DType | Source (exact) | Missing-data behavior |
|---|---|---|---|---|
| 1 | `reporting_state` | string | overview `clusters[].state` | absent ⇒ `pd.NA` |
| 2 | `optimal_cost_hourly` | Float64 USD/h | overview `clusters[].optimalCostHourly` | absent/unparseable ⇒ `pd.NA` |
| 3 | `is_phase2` | boolean | external-clusters `items[].isPhase2` | `pd.NA` (NA-able) |
| 4 | `pod_count` | Float64 | summary `podCount` | `pd.NA` |
| 5 | `nodes_unknown` | Float64 | summary `unknownNodeCount` (excluded from `nodes_total`) | `pd.NA` |
| 6 | `potential_savings` | Float64 USD/mo | `potential_savings_hourly × 730` (`ov_costHourly − ov_optimalCostHourly`, pairwise on the overview item) | hourly absent ⇒ `pd.NA` |
| 7 | `overview_cost_hourly` | Float64 USD/h | overview `clusters[].costHourly` — the same-source savings-% denominator | `pd.NA` |
| 8 | `cpu_request_efficiency_pct` | Float64 0–1 (render %) | derived `_safe_ratio_pos(cpu_used, cpu_requested)` (ADR R8) | `pd.NA` on missing sides OR `cpu_requested ≤ 0` ("no requests", never 0 %) |
| 9 | `memory_request_efficiency_pct` | Float64 0–1 (render %) | derived `_safe_ratio_pos(ram_used, ram_requested)` | same (`ram_requested ≤ 0` ⇒ `pd.NA`) |
| 10 | `na_managed_nodes` | Float64 | Σ summary `nodeCount{OnDemand,Spot,SpotFallback}Castai`, `min_count=1` (ADR R6, +0 calls) | all three absent ⇒ `pd.NA` |
| 11 | `na_coverage_pct` | Float64 0–1 (render %) | `na_managed_nodes / nodes_total` (`nodes_total > 0` mask) | denom absent/0 ⇒ `pd.NA` |
| 12 | `storage_provisioned_gib` | Float64 GiB | summary `storageProvisioned` | `pd.NA` |
| 13 | `storage_claimed_gib` | Float64 GiB | summary `storageClaimed` | `pd.NA` |
| 14 | `storage_active_claimed_gib` | Float64 GiB | summary `storageRequested` — **storage trap** (`resource-metrics §3`): wire name says "Requested", value is **ACTIVE PVC claims accessed by any workload**, NOT a scheduler-style request | `pd.NA` |
| 15 | `storage_commit_pct` | Float64 0–1 (render %) | `storage_claimed_gib / storage_provisioned_gib` (provisioned > 0 mask) — labeled "commit", NEVER "utilization" (no used-bytes source exists at Tier 1) | `pd.NA` |
| 16 | `storage_cost_hourly` | Float64 USD/h | summary `storageCostHourly` (component of `cost_hourly`; display split only) | `pd.NA` |
| 17 | `waste_cpu_usd` | Float64 USD/window | clusters/efficiency `items[].wasted.cpu` (**double**, not proto3-string; ADR R2 6th call) | call disabled/absent ⇒ `pd.NA` |
| 18 | `waste_ram_usd` | Float64 USD/window | `wasted.ram` | same |
| 19 | `waste_storage_usd` | Float64 USD/window | `wasted.storage` | same |
| 20 | `waste_total_usd` | Float64 USD/window | `cpu + ram + storage`, **`min_count=1` per class** — if every class is absent the total is `pd.NA`, never silently re-based | `pd.NA` on all-absent |
| 21 | `wa_display` | string (`pd.NA`-able) | `wa_display(wa_status, wa_entry)` — mapping table below; needs BOTH the status and the payload-arrived flag | org WA call failed ⇒ `pd.NA` (MAJOR-3) |
| 22 | `wa_agent_version` | string | org WA payload `clusterAgentStatuses[].currentVersion` | `pd.NA` |
| 23 | `wa_version_drift` | boolean | `currentVersion != latestVersion` ONLY when both present | else `pd.NA` |
| 24 | `wa_in_place_resize` | boolean | `inPlaceResizeEnabled` | non-bool/absent ⇒ `pd.NA` |
| 25 | `wa_last_reported` | datetime64[ns, UTC] | `updatedAt` (tz-aware coerce) | absent/unparseable ⇒ `NaT` |
| 26 | `agent_health` | string — 7 values | **derived Tier-1, +0 calls** (reliability-model §6) — precedence table below | both inputs unknown ⇒ `"Unknown"` |
| 27 | `latest_sync_time` | datetime64[ns, UTC] | `agentSnapshotReceivedAt` else sweep ts (`fetched_at`) | both missing ⇒ `NaT` |
| 28 | `snapshot_age_minutes` | Float64 minutes, ≥ 0 | tz-aware now − `latest_sync_time`; future skew clamped to 0 | ts missing ⇒ `pd.NA` |
| 29 | `data_freshness_status` | string | `"fresh"` (< 30 min) · `"stale"` (≥ 30 min) · `"unknown"` (na); 30-min law `FRESHNESS_FRESH_MINUTES` | (derived, never NA) |
| 30 | `is_ghost` | boolean (never NA) | `reporting_state == CLUSTER_STATE_UNSPECIFIED` **exactly** (audit #10) | `False` otherwise (4 baseline rows) |
| 31 | `has_positive_savings_opportunity` | boolean | `potential_savings_hourly > 0` (raw NEVER clamped, finops §2 rule 9) | raw absent ⇒ `pd.NA` |
| 32 | `has_negative_savings` | boolean | `potential_savings_hourly < 0` | raw absent ⇒ `pd.NA` |
| 33 | `kubernetes_version_short` | string | `kubernetes_version` regex `^v?(\d+)\.(\d+)` (`'v1.34.9'`/`'1.34.9'`→`'1.34'`, `'1.35'`→`'1.35'`) | unparseable ⇒ `pd.NA` |
| 34 | `kubernetes_version_known` | boolean (never NA) | the raw version string parsed? | `False` even when `_short` is NA |

`REPORT_EXTRA_COLUMNS` (2, appended last; DISPLAY-ONLY — §1.5 "average"-flavored
semantics, never fed to KPI sums): `report_period_cost` (Float64 USD/window,
report `clusters[].summary.totalCost`), `report_cost_pct_change` (Float64 —
**0–100 scale**, unlike every ratio column which is 0–1; the central pct
formatter switches per column, audit A6).

`wa_display` mapping (`normalizers.wa_display`, autoscaler-model §2.2 + MAJOR-3):

| Condition (first match) | Value |
|---|---|
| `wa_entry is None` (org WA call FAILED/absent) | `pd.NA` — row leaves the `wa_coverage` scope |
| `wa_status == AGENT_STATUS_RUNNING` | `"Running"` |
| `AGENT_STATUS_UNKNOWN` + `currentVersion` or `installedAt` present | `"Installed (status unknown)"` |
| `AGENT_STATUS_UNKNOWN` stub row | `"Unknown"` |
| `AGENT_STATUS_INVALID` | `"Invalid"` |
| any other/absent status, payload arrived | `"Not installed"` |

`agent_health` 7-value precedence (`normalizers.agent_health_value`, first
match wins, deterministic per row shape):

| Order | Value | Condition |
|---|---|---|
| 1 | `Failed` | `status == "failed"` |
| 2 | `Hibernated` | `status ∈ {hibernating, hibernated, resuming}` |
| 3 | `Connecting` | `status == "connecting"` OR `agent_status == "waiting-connection"` |
| 4 | `Disconnected` | `agent_status ∈ {disconnected, disconnecting}` |
| 5 | `Non-responding` | `agent_status == "non-responding"` OR `status == "warning"` |
| 6 | `Non-responding` | `agent_status == "online"` with a STALE snapshot (age ≥ 30 min) |
| 7 | `Connected` | `agent_status == "online"` (fresh or absent age — absent age is never stale) |
| 8 | `Unknown` | both fields missing/unrecognized |

Ghost semantics: `is_ghost` rows STAY VISIBLE in the table (👻 marker) but are
masked out of every KPI by the aggregators and excluded from filters unless the
"Show ghost rows" toggle is enabled (ADR v2 R5).

Auxiliary Tier-1 columns kept in `clusters` but excluded from the default grid:
`is_phase2`, `is_read_only` (`reporting_state == READ_ONLY`), `pod_count`,
`unschedulable_pod_count`, `woa_current_version`, `woa_latest_version`,
`spot_ratio` (`nodes_spot / nodes_total`), `data_sources` (pipe-joined `sources[].source`),
`reconcile_error` (nullable string), `cluster_created_at`.

**Dropped candidate names:** `status` split into `lifecycle_status` + `agent_status` +
`reporting_state` (three real, distinct API fields — collapsing them would lose the
Disconnected sentinel); `nodes_total` excludes `unknown_node_count` (kept as its own
column).

---

## 3. Enterprise KPI aggregation rules — **no naive averages of percentages**

General law:

- **Every ratio KPI = SUM(numerator) / SUM(denominator)** computed from raw quantities
  with a **pairwise-complete mask** (`num.notna() & den.notna()`), then divide. Never
  `mean()` of per-cluster ratios (weights tiny clusters equally with huge ones).
- Money sums include only rows where the value is present; expose
  `n_clusters_included` / `n_clusters_missing` next to every aggregate so a partially
  failed org can never masquerade as savings.
- `0/0` ⇒ `pd.NA` (display "–"), never 0 %.
- CAST AI also publishes its own org-level aggregates (`OrganizationSummary`,
  `organization/efficiency/summary`). Where both exist we show **our derived value** for
  slice consistency and keep CAST AI's value in `docs/metrics.md` as a reconciliation
  cross-check; drift > tolerance ⇒ data-quality warning.

| # | KPI | Formula (enterprise level) | Units | Source (raw fields) | CAST AI's own org value? |
|---|---|---|---|---|---|
| 3.1 | Enterprise active cost | `Σ cost_hourly × 730` over rows where `cost_hourly.notna()` | USD/month | `ClusterSummary.costHourly*` per cluster, per org | `OrganizationSummary.totalCostHourly` (USD/h) — reference |
| 3.2 | Enterprise CPU utilization ("efficiency") | `Σ cpu_used / Σ cpu_allocatable` (primary, CAST AI allocatable basis); secondary `Σ cpu_used / Σ cpu_provisioned` | 0–1 % | `cpuUsed`, `cpuAllocatable*`, `cpuProvisioned*` | `OrganizationSummary.avgCpuUtilization` *"Weighted average utilization across clusters"* — **weighting basis not specified in spec ⇒ treat as reference, not truth** |
| 3.3 | Enterprise CPU request commitment | `Σ cpu_requested / Σ cpu_allocatable` | 0–1 % | `cpuRequested*`, `cpuAllocatable*` | org efficiency summary `cpuResources{requested,provisioned,used}` — cross-check |
| 3.4 | Enterprise memory utilization | `Σ ram_used / Σ ram_allocatable` | 0–1 % | `ramUsed`, `ramAllocatable*` (GiB) | `OrganizationSummary.avgRamUtilization` — reference |
| 3.5 | Enterprise waste | `Σ (wasted.cpu + wasted.ram + wasted.storage)` over the efficiency window | USD per window | `clusters/efficiency` `wasted.*` per cluster | `organization/efficiency/summary → totalWaste` — cross-check |
| 3.6 | Potential savings (opportunity) | `Σ potential_savings` = `Σ (cost_hourly − optimal_cost_hourly) × 730` | USD/month | overview `clusters[]` | `OrganizationSummary.potentialSavingsHourly` (*"difference between current and rightsized cost"*) — cross-check |
| 3.7 | Potential savings % | `Σ (cost_hourly − optimal_cost_hourly) / Σ cost_hourly` where **both** fields are the OVERVIEW item's own (`costHourly`, `optimalCostHourly`); **corrected** at final review: the denominator is the overview item's own `costHourly` (same-source pairwise mask — not the summary-derived `cost_hourly`) | % | overview `clusters[]` | — (derive; never average per-cluster pcts) |
| 3.8 | Spot adoption | `Σ nodes_spot / Σ (nodes_spot + nodes_on_demand)`; also `Σ spotCostHourly / Σ costHourly` | % | ClusterSummary; `OrganizationSummary.spotNodeCount` cross-check | partial (`spotNodeCount` totals exist) |
| 3.9 | WOA coverage | `count(workload_autoscaler_status == 'AGENT_STATUS_RUNNING') / count(clusters in WOA scope)` | % | WOA org endpoint | no |
| 3.10 | Unschedulable pressure | `Σ unschedulable_pod_count` | pods | ClusterSummary | no |
| 3.11 | Cluster health mix | `value_counts` of `lifecycle_status` / `agent_status` / `reporting_state` | counts | external-clusters, overview | no |

**Shipped v1 (3.10):** the dashboard ships BOTH unschedulable KPIs —
`clusters_with_unscheduled_pods` (count of clusters with `unschedulable_pods
> 0`) AND `unschedulable_pods_total` (`Σ unschedulable_pods` across the fleet);
both live in the `enterprise_kpis` KPI dict.

**Two-ratio convention for "efficiency" (3.2).** CAST AI's `ResourceEfficiency` carries
`provisioned`, `requested`, `used`, `overprovisionedPercent` — i.e. CAST AI anchors
over-provisioning on **provisioned** capacity, while schedulability discussions anchor on
**allocatable**. The dashboard names both explicitly (`utilization_vs_allocatable`,
`utilization_vs_provisioned`); the default headline uses allocatable (Kubernetes
standard); neither is ever an average of per-cluster percentages.

**Window discipline.** Efficiency/waste metrics (3.2–3.5) are windowed (`startTime`/
`endTime`, default = trailing 30 d at page load); cost/run-rate metrics (3.1, 3.6–3.8)
are point-in-time. The grid labels each KPI with its window. One window is chosen per
refresh run and passed to all windowed calls.

---

## 4. Savings taxonomy — strictly separated

| Bucket | Definition (CAST AI semantics) | API source | Tier |
|---|---|---|---|
| **Potential / estimated savings** | Forward-looking estimate from current snapshot: `SavingsRecommendation` per scenario key: `monthly.priceBefore − priceAfter`, `savingsPercentage` | `GET …/clusters/{clusterId}/estimated-savings` (map key set not in spec ⇒ runtime discovery; each value may also carry `armSavingsMonthly`) + T1 approximation from overview `costHourly − optimalCostHourly` | T1 (approx) / T2 (authoritative) |
| **Realized / actual savings** | Savings CAST AI attributes as *already achieved* in a past window: `summary.totalSavings`, items `downscalingSavings`, `spotSavings` per timestamp; `summary.totalCost` = actual spend in same window | `GET …/clusters/{clusterId}/savings` (windowed) | T2 |
| **Spot savings** | Realized: savings item `spotSavings`. Opportunity at node level: on-demand vs spot price gap — derivable from `costHourlyOnDemand` vs `costHourlySpot` only as a *spend mix*, not a saving | `…/savings` items; ClusterSummary lifecycle costs | T2 |
| **Rightsizing opportunity** | Workload requests vs recommended: `cpuCoresDifference`, `memoryDifference`, `costsPerHour.requested − recommended`; cluster nodes rightsizing: `RightsizingRecommendation.Summary.cpuCoresDifference / ramBytesDifference` | `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary`; `GET …/rightsizing-summary` | T2 |
| **Scheduling opportunity** | Node bin-packing/right-sizing to target utilization: `ClusterOverviewItem.optimalCostHourly` (spec: *"agent clusters rightsized (layman), discovered clusters CPU-util rightsized"*); `rebalancing recommended` flag: `isRebalancingRecommended` | `organization/overview` (T1); `estimated-savings` (T2) | T1 / T2 |

Hard rules:

1. **Never add potential + realized.** Different time directions (estimate vs history).
2. Spot savings reported to users come **only** from the `spotSavings` realized field or
   clearly-labeled estimated-savings scenario keys — never from on-demand minus spot
   spend (that conflates mix with savings).
3. Every savings tile shows: bucket label, window (or "current snapshot"), source
   endpoint, included-cluster count.

---

## 5. Missing-data semantics

| Sentinel | Meaning | Pandas representation | Typical trigger |
|---|---|---|---|
| `0` | **Measured/returned true zero** | numeric `0` | API returned `"0"` / empty list with `hasProblems=false` |
| `pd.NA` | Value expected but **absent/unparseable** | `Float64`/`Int64`/`boolean` NA | field missing, `""`, conversion failure |
| `No-data` | Endpoint answered 200 but **no item for this cluster** (e.g. cluster absent from overview/efficiency response) | NA in value cols + `data_sources`/`endpoint_ok` flags rendered as "No-data" | overview item missing, summary item missing |
| `Disconnected` | Cluster not reporting | driven by `agent_status` ∈ {`non-responding`, `disconnected`, `disconnecting`} or `reporting_state = DISCONNECTED` ⇒ numeric metrics shown as NA, status columns keep the sentinel | agent down, hibernated |
| `Unknown` | Field genuinely unknown (nullable in spec) | string `"Unknown"` for display cols; NA in numeric | `kubernetesVersion` null |
| `Not installed` | WOA agent row absent from org status response | category value | WOA not deployed in that cluster |
| `Tier 2` (badge) | Column only exists after drill-down | NA + UI badge, never 0 | `problematic_*` before drill-down |
| `Org error`/`Partial` | Whole-org fetch failed | rows absent from master table; present in `org_health` with status; KPI banners show `n_orgs_failed` | HTTP 500/timeout for that org |

Implementation: all ingest coercion via `pd.to_numeric(..., errors="coerce")` and
`pd.to_datetime(..., errors="coerce", utc=True)`; aggregates via `.sum(min_count=1)` on
masked frames; **assert no fillna(0)** exists in transform code (lint rule).

**MAJOR-3 sentinel rule (shipped v1, final review):** if the org-level WA-status
CALL fails, `workload_autoscaler_status = NA` for every cluster of that org —
those rows leave the `wa_coverage` pairwise mask entirely (they are neither
counted as covered nor as installed-but-not-running). `Not installed` applies
ONLY when the org WA payload ARRIVED and the cluster is absent from it.

---

## 6. Pandas implementation guidance

**Scale.** ≈126 orgs, ≈1,000 clusters, ≈10,000 nodes, workloads 10–50k rows.

| Table | Rows | Cols | Est. memory (deep) |
|---|---|---|---|
| `organizations` + `org_health` | ~126 | ~8 / ~7 | < 100 KB |
| `clusters` (master) | ~1,000 | ~45 | **~1–2 MB** |
| `cluster_resources` | ~1,000 | ~60 | ~1 MB |
| `cluster_efficiency` | ~1,000 × windows | ~20 | < 1 MB |
| `cluster_nodes` | ~10,000 | ~18 | **~4–8 MB** (ids/names dominate) |
| `cluster_issues` | ~1–5k | ~8 | < 1 MB |
| `workloads` | ~10–50k | ~14 | **~5–20 MB** |

⇒ Everything fits trivially in memory; keep **one** master `clusters` frame per refresh
and per-cluster Tier-2 frames in `st.cache_data` keyed by
`(organization_id, cluster_id, window)`.

**Dtype recipe (after coercion):**

```python
id_cols   = "string"                                  # organization_id, cluster_id, node_id...
cats      = "category"                                # provider, region, agent_status, lifecycle_status, instance_type
money     = "Float64"                                 # USD
counts    = "Int64"                                   # nodes, pods, problems
ratios    = "Float64"                                 # 0..1
flags     = "boolean"                                 # is_phase2, unschedulable
times     = "datetime64[ns, UTC]"
```

**Vectorized patterns (no `.apply` row loops):**

```python
num = pd.to_numeric(raw, errors="coerce")                    # ingest
m = df["cpu_used"].notna() & df["cpu_allocatable"].notna()   # pairwise mask
util = df.loc[m, "cpu_used"].sum() / df.loc[m, "cpu_allocatable"].sum()
per_org = df.groupby("organization_id", observed=True).agg(
    cost=("cost_hourly", lambda s: s.sum(min_count=1)),
    used=("cpu_used", "sum"), alloc=("cpu_allocatable", "sum"))
per_org["util"] = per_org["used"] / per_org["alloc"]         # ratio of sums per org
```

- Lifecycle-wide sums: `df.filter(regex=r"cpuProvisioned(OnDemand|Spot|SpotFallback)$").sum(axis=1, min_count=1)`.
- Join keys: build all Tier-1 frames indexed by `cluster_id` within an org, then one
  `concat` + `merge(validate="one_to_one")` to catch API duplication bugs loudly.
- **Per-org failure representation:** `org_health` (§1.2) + excluded-from-KPI flags.
  KPI cards take `df.loc[df.org_id.isin(ok_orgs)]`; banner = failed orgs with
  `http_status`. A failed org contributes **nothing**, not zeros.
- Sorting/filtering in the grid must treat NA as "bottom/unknown", e.g.
  `df.sort_values("potential_savings", na_position="last")`.

**Pagination & retries.** `organization/clusters/efficiency` is cursor-paginated — loop
`page.cursor` until `nextCursor == ""` (max page limit is unspec'd ⇒ use conservative
limit, e.g. 500). `…/nodes` and `allocation-group-totals` likewise. **No
429/`Retry-After` behavior is documented anywhere in the spec ⇒ treat rate limits as
unknown:** conservative concurrency (≤ 8; `performance.md` default, ≤ 5 for discovery
per `enterprise-hierarchy.md`) + exponential backoff with jitter on any 429/5xx.

---

## 7. Assumptions, risks, unknowns

1. **Scoping header applies to all org-scoped cost-report endpoints** (no `organizationId`
   param exists). Verified live for `external-clusters`; assume same convention for
   `cost-reports/organization/*` — **integration-test on first run** per endpoint.
2. `optimalCostHourly` appears in the spec's `ClusterOverviewItem` (new overview API);
   availability on the live EU tenant must be smoke-tested; fallback = Tier-2
   `estimated-savings` only for sampled clusters.
3. `GetOrganizationClustersCostReportResponse.Summary.*` descriptions say *"Average …"*;
   the averaging basis is unspecified ⇒ **not used** until validated.
4. `recommendations{}` map keys of `estimated-savings` are not enumerated — keys are
   discovered from a live response once and handled generically (never hard-code
   `"rightsizing"`).
5. `overprovisionedPercent` denominators unspecified ⇒ validate against
   `1 − used/provisioned` on live data before labeling.
6. Per-node **fallback** flag: only filterable via the `lifecycleType` query param; the
   node schema itself exposes `spotConfig.isSpot` only. If a single-call node list must
   carry fallback, do one extra filtered call (`lifecycleType=fallback`) and mark nodes.
7. CAST AI `avgCpuUtilization` weighting basis unspecified — reference only (§3.2).
8. `clusterScore` semantics unknown — display raw, no aggregation.
9. 730 h/month convention declared explicitly; a "trailing-30d actual cost" alternative
   view uses `daily-cost` integration instead of ×730.
10. Numeric precision: proto3 string-decimals → float64 is fine at these magnitudes
    (≤ ~1e12); do not use float32.
11. **Rate limits unknown** — no 429/`Retry-After` semantics in the spec; see §6.
12. Allocation-group coverage unknown — whether `allocation-group-summaries` includes an
    "ungrouped" row is not stated; if not, group totals undercount the org ⇒ never
    reconcile §3.1 against allocation-group sums without a live check.
13. `POST /v1/cost-reports/clusters/active` is read-semantics but still a POST ⇒ behind
    config flag, default off (GET-only default posture); its org scoping (header) is the
    same convention as assumption 1, unverified.
