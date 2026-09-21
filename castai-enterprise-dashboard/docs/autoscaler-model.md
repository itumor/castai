# Autoscaler / Optimization Model (v2)

**Owner:** Agent 6 (Autoscaler/Optimization). **Status:** PROPOSED — replaces v1
placeholders (`node_autoscaler_status="T2"` on 100 % of rows; raw
`AGENT_STATUS_*` values in the WA column). Sources verified 2026-09-21 against
`docs/openapi/castai-openapi.json` (423 paths) and `docs/baseline-fleet.csv`
(241 clusters, live pull). **No live API probing** in v2 authoring — the repo
key returned 403 on `GET /v1/organizations`; every live-verifiable assumption
below is marked and has a test.

---

## 1. Node Autoscaler (NA) — killing the "T2" placeholder

### 1.1 Confirmed facts (spec-verified)

- Only real source: `GET /v1/kubernetes/clusters/{clusterId}/policies`
  (`PoliciesAPI_GetClusterPolicies`, stable, per-cluster, no org/list
  equivalent). Response `policies.v1.Policies` top-level fields:
  `enabled` (bool), `unschedulablePods{...}`, `clusterLimits{...}`,
  `spotInstances{enabled, maxReclaimRate, spotBackups, spotDiversityEnabled,
  spotInterruptionPredictions}`, `nodeDownscaler{enabled, emptyNodes,
  evictor{enabled, dryRun, aggressiveMode, status}}`, `isScopedMode`,
  `nodeTemplatesPartialMatchingEnabled`, `defaultNodeTemplateVersion`.
- **`nodeTemplates` is NOT in the policies payload** (mission note corrected).
  Evictor exposes `status` ∈ `{Unknown, Compatible, Incompatible, Missing,
  InvalidConfig}` (helm-chart discovery state) — usable as a deployment-health
  hint, not as the enable flag.
- No org-level or list-field equivalent exists (api-matrix §12e still binds).

### 1.2 Delivery model — RECOMMEND **(b) opt-in bounded fleet batch**

| Option | Calls (241 clusters today / ~1,000 design) | Verdict |
|---|---|---|
| (a) Tier-2 drill-down only | 0 Tier-1; 1 per opened cluster | Keeps 100 % placeholder; solves nothing fleet-wide |
| (b) **Opt-in bounded batch** ("Load NA status" on filtered set) | 1/cluster over the **filtered** set; full fleet = 241 (~30 s @ 8 workers) / worst case 1,000 (~2 min) | **CHOSEN**: user-initiated, bounded by filter, cache 15 min, progress bar; respects Tier-1 contract |
| (c) Background progressive fill | up to +1,000 per refresh cycle, unbounded | Violates runtime assertion Tier-1 ≤ 2+5N; indistinguishable from a silent sweep |

Rationale: the two-stage rule is mandatory (architecture §3: Tier-1 ≤ 5
calls/org). Option (b) keeps Tier-1 untouched and makes the extra cost
explicit and filtered-set-bounded. Batch over **currently filtered** cluster
ids only, reuse `build_fleet_dataframe` conventions: ThreadPoolExecutor(8),
per-cluster failure → cell = `NA-error` sentinel, never abort the batch;
merge into the fleet frame via `st.session_state`/cache key
`(refresh_token, na_loaded_ids)`; progress via `st.progress`.

### 1.3 NA metrics

| Column | Source | Tier | Definition |
|---|---|---|---|
| `na_enabled` | `policies.enabled` | T2 drill-down; **opt-in batch** fills fleet col | true/false/NA |
| `na_spot_enabled` | `policies.spotInstances.enabled` | same | true/false/NA |
| `na_evictor_training` | `nodeDownscaler.evictor.dryRun` | T2 only | dryRun label |
| `na_managed_nodes` | **Tier-1 already available**: `summary nodeCountOnDemandCastai + nodeCountSpotCastai + nodeCountSpotFallbackCastai` (spec desc: "managed by CAST.AI") | **T1, 0 extra calls** | Int64, NA-safe |
| `na_coverage_pct` | derived | T1 | `na_managed_nodes / nodes_total`, pairwise, never mean-of-% |

**Managed-node rule (not invented):** the canonical CAST-managed distinction is
the `*Castai` counters in `organization/clusters/summary`. Per-node `labels`
contain `scheduling.cast.ai/spot` etc., but the spec documents **no** dedicated
"cast-managed" label key — do NOT infer management from label regexes at fleet
level. `nodes_total` currently excludes fallback Castai nodes → recompute
masked. Caveat: `na_coverage_pct > 0` proves autoscaling *acted*; it cannot
prove `enabled=true` when 0 CAST nodes exist — the column pair is labeled
"managed nodes (share)", not "enabled".

---

## 2. WA status quality — the 182/241 UNKNOWN problem

### 2.1 Root cause

The **enum has exactly three values**: `AGENT_STATUS_INVALID`,
`AGENT_STATUS_UNKNOWN`, `AGENT_STATUS_RUNNING` (spec
`workloadoptimization.v1.GetAgentStatusResponse.AgentStatus`). **There is no
PAUSED/SKIPPED/etc.** Baseline: 182 UNKNOWN / 55 RUNNING / 4 Not installed /
0 others. The v1 join (org payload `clusterAgentStatuses[]` by `clusterId`)
works correctly — 182 UNKNOWNs are **literal payload statuses**, not join
misses. Only 4 clusters are absent from the payload ("Not installed", MAJOR-3
rule intact). `wa_available=False` (org call failed) → `pd.NA` (keep as is).

### 2.2 Presentation value set (proposed, doc §5-aligned)

| Raw payload | Display | Notes |
|---|---|---|
| `AGENT_STATUS_RUNNING` | **Running** | |
| `AGENT_STATUS_UNKNOWN` + `currentVersion`±`installedAt` present | **Installed (status unknown)** | split UNKNOWN by payload completeness — see §2.3 |
| `AGENT_STATUS_UNKNOWN`, stub row | **Unknown** | keep sentinel |
| `AGENT_STATUS_INVALID` | **Invalid/Error** | |
| row absent, org call OK | **Not installed** | MAJOR-3 |
| org call failed | `pd.NA` | MAJOR-3 |

Flanking Tier-1 columns (same payload, 0 extra calls): `wa_agent_version`
(`currentVersion`), `wa_version_drift` (`currentVersion != latestVersion`),
`wa_inplace_resize` (`inPlaceResizeEnabled`), `wa_last_reported` (`updatedAt`,
rendered as age; "Paused" does NOT exist at agent level — pause semantics live
per-workload in `recommendationStatus.type=STATUS_STOPPED`, Tier-2 only).

### 2.3 UNKNOWN reduction lever

`updatedAt` + `workloadAutoscalerReplicaCount` separate "agent installed but
never/stall reporting" (stale `updatedAt`, empty version) from "reporting but
engine-undetermined" (fresh `updatedAt`, replicas ≥ 1). **ASSUMPTION (live
unverifiable — key revoked):** UNKNOWN rows in the top org
(SMO-RI-CSX-CS: 33/34) carry stub fields. Ship the split behind
`field-present` heuristics only; add fixture test asserting every combination
renders a defined value; re-validate on next key refresh before trusting the
`wa_coverage` denominator change.

---

## 3. WA coverage metrics (`workloads-summary`, includeCosts)

Spec-verified fields: `totalCount, optimizedCount, hpaOptimizedCount,
vpaOptimizedCount, hpaVpaOptimizedCount, apiManagedCount,
annotationManagedCount, recommendedCpuCores/requestedCpuCores/
cpuCoresDifference, recommendedMemory/requestedMemory/memoryDifference,
originalRequestedCpuCores/originalRequestedMemoryGibs, usageCpuCores,
usageMemoryGibs, costsPerHour{requested, recommended, originalRequested}`
(USD/h, nullable).

| Column | Definition | Tier |
|---|---|---|
| `wa_total_workloads` | `totalCount` | T2 (per-cluster call) |
| `wa_optimized_workloads` | `optimizedCount` (+ hpa/vpa splits) | T2 |
| `wa_coverage_pct` | `optimizedCount/totalCount` | T2; **RECOMMENDED: one opt-in fleet batch** |
| `wa_estimated_savings_per_hour` | `costsPerHour.requested − costsPerHour.recommended` ("estimated", never "realized") | T2 |
| original/current/recommended cpu+mem | `originalRequested*` (pre-CAST), `requested*` (current), `recommended*` | T2 |

**Fleet "WA coverage %" KPI recommendation:** the ONLY batch worth shipping is
`workloads-summary` over clusters whose WA agent is **RUNNING** (join on the
Tier-1 WA column; UNKNOWN/Not-installed are excluded by definition) → baseline
55 calls @ 8 workers ≈ 7–10 s, cache 15 min, progress bar; design worst case
bounded by RUNNING count, not 1,000. KPI = Σoptimized/Σtotal (ratio-of-sums,
pairwise mask). `includeCosts=true` in the same batch; guard `costsPerHour`
nullable schema.

---

## 4. Workload-level table (WA drill-down tab)

Per row of `GET /v1/workload-autoscaling/clusters/{id}/workloads`
(cursor-paginated, `page.limit` ≤ 500, loop `nextCursor`):

| UI column | Schema field | Support |
|---|---|---|
| namespace / name / kind | `namespace` / `name` / `kind` (string) | ✅ |
| policy | `scalingPolicyName` (+ `suggestedScalingPolicyName` tooltip) | ✅ |
| current (cpu/mem) | Σ `containers[].resources.requests.{cpuCores,memoryGib}`×replicas | ✅ (aggregate) |
| recommended | Σ `containers[].recommendation.requests.*` | ✅ (null when no rec → NA) |
| used | **NOT per-workload in this schema** (usage only aggregated in workloads-summary / -metrics series) | **N/A per row — render "N/A"; optional Tier-2+ via `workload-efficiency` report** |
| estimated savings | `costsPerHour.requested − .recommended` (nullable) | ✅ labeled estimated |
| status | `recommendationStatus.type` ∈ `UNKNOWN/WAITING/APPLIED/STOPPED` (+`lowConfidence` flag, `error.message`) | ✅ |
| managed-by | `managedBy` ∈ `API/ANNOTATIONS` | ✅ |

Filters to expose (server-side): `namespaces[]`, `kinds[]`,
`recommendationStatusType`, `managementOptions` (`READ_ONLY`/`MANAGED`),
`workloadHasError`, `searchQuery`.

---

## 5. Automation column (fleet table) semantics

**Confirmed by spec description:** cluster `status=warning` ⇒ "Autoscaling does
NOT work in this state; the autoscaler will not issue commands **(Phase 2
only)**". Baseline reality: 0 warning, 8 `failed`, 228 ready, 1 hibernated,
4 blank; **191/241 clusters are `isPhase2=False`** where `warning` can never
fire. `agentStatus` (connectivity) is independent of `status` (lifecycle).

Automation value set — **real fields only**, Tier-1 source `status` +
`agent_status` (no extra calls), exact `policies.enabled` merged only from
the §1.2 batch as `NA-verified` overlay:

| Value | Rule (first match wins) |
|---|---|
| **Halted (failed)** | `status=failed` |
| **Halted (warning)** | `status=warning` (Phase-2 only; document) |
| **Hibernating/ed** | `status∈{hibernating,hibernated,resuming}` |
| **Agent disconnected** | `agent_status∈{disconnected,disconnecting,non-responding}` |
| **Connecting** | `status=connecting` or `agent_status=waiting-connection` |
| **Automating (expected)** | `status=ready` AND `agent_status=online` — never claim `enabled=true` at Tier-1 |
| `pd.NA` | both fields absent (4 blank baseline rows) |

Filter `Automation` = multiselect over exactly this domain (ux-design
deferred-filter slot). Persist caveat in tooltip: Tier-1 value is
lifecycle-expected, not the policies flag.

---

## 6. Implementation changes

1. `data/normalizers.py`: add `na_managed_nodes`, `na_coverage_pct` to
   EXTRA_COLUMNS from summary `*Castai` counters (min_count=1 sums); WA display
   mapping function `wa_display(wa_entry, wa_available)` → §2.2 value set +
   `wa_agent_version`, `wa_version_drift`, `wa_inplace_resize`, `wa_last_reported`.
2. `services/cluster_service.py`: pass full `wa_entry` (not just `.status`) to
   `build_fleet_row`; add optional `policy_overrides` map merge for the NA batch.
3. `services/optimization_service.py`: new `load_na_status_batch(client,
   org_id, cluster_ids)` (ThreadPoolExecutor(8), cache 15 min, per-cluster
   isolation) + `load_wa_coverage_batch` over RUNNING-only ids; extend
   `load_cluster_wa` to also paginate `get_wa_workloads` into a workloads df.
4. `services/castai_client.py`: add `page.limit`/`page.cursor` plumbing on
   `get_wa_workloads` (exists), `includeCosts=True` on
   `get_wa_workloads_summary`.
5. `app.py`/`ui/filters.py`: "Load NA status" + "Load WA coverage" buttons
   (filtered-set scoped) with `st.progress`; Automation filter per §5;
   workloads table renderer with N/A used-column.

## 7. Test requirements

- fixtures_api.py: org WA payload variants (stub UNKNOWN row, version-rich
  UNKNOWN row, INVALID, absent row, wa call 500) → exact display column mapping;
  policies variants (enabled/spot/evictor dryRun; missing sub-objects).
- test_normalizers.py: `na_managed_nodes` string-numeric sums, NA-safe;
  `na_coverage_pct` pairwise (excluded when nodes_total=0/NA); MAJOR-3
  regression intact.
- test_aggregators.py: KPI `wa_coverage` = ratio-of-sums over batch-augmented
  frame; denominator excludes NA cells only.
- Integration: assert Tier-1 call count unchanged (≤2+5N) when batches not
  armed; batch armed with filterƒed ids = len(filtered) calls, failures
  isolated (one 500 → its cells = NA, others filled).
- One live smoke (next valid key): verify UNKNOWN-row field completeness
  assumption §2.3 before enabling the split in production rendering.
