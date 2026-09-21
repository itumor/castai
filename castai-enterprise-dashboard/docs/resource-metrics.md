# Resource Metrics Semantics v2 — Rename, Formulas, Sources

**Status:** design document (v2 proposal; v1 facts verified against code + baseline).
**Audience:** implementers of the v2 metric rename and resource-section rework.
**Companions:** `docs/data-model.md` (tables/sentinels), `docs/metrics.md` (endpoint
mapping), `docs/api-matrix.md` (spec capsule). Every field below was extracted
programmatically from `docs/openapi/castai-openapi.json` — never invented.

---

## 1. v1 semantic verification (confirmed facts)

| v1 column | Actual formula (verified) | Evidence |
|---|---|---|
| `cpu_efficiency` | `cpu_used / cpu_allocatable` — *point-in-time* used-vs-allocatable | `data/normalizers.py:250` (`_safe_ratio(cpu_used, cpu_allocatable)`); `docs/baseline-fleet.csv` 187/187 comparable rows match exactly (`|eff − used/alloc| < 1e-6`), 54 NA rows all have absent summary numerics (disconnected agents) |
| `memory_efficiency` | `memory_used_gib / memory_allocatable_gib` | `data/normalizers.py:256` (`ram_used / ram_allocatable`); baseline 187/187 exact match |
| Enterprise KPIs of the same name | `Σ cpu_used / Σ cpu_allocatable`, `Σ memory_used_gib / Σ memory_allocatable_gib` (ratio-of-sums, pairwise mask) | `data/aggregators.py:152-153` (`weighted_ratio`); `tests/test_aggregations.py:123-125` pins 11/101 ≠ mean of per-cluster ratios |

So v1 "efficiency" is **allocatable-basis utilization**. The name "efficiency"
overlaps CAST AI's own `*Efficiency` report types and the new CAST AI
`overprovisionedPercent` family; v2 renames disambiguate.

## 2. v2 rename set

**Scale convention:** all ratios are **stored as 0–1 Float64** (nullable) and
**rendered as % at the display edge only** (`format="%.0f%%"`, `ui/tables.py`
ProgressColumn `min_value=0, max_value=1`; `ui/cards.py` `_pct_ratio`). The
`*_pct` suffix encodes the display contract, not a 0–100 stored scale — changing
stored units later would silently corrupt every aggregation test.

| v1 column (ship name) | v2 name | Formula (per cluster) | Pairwise mask (row) | Enterprise ratio-of-sums | Enterprise enterprise-level mask |
|---|---|---|---|---|---|
| `cpu_efficiency` | `cpu_utilization_pct` | `cpu_used / cpu_allocatable` | used & allocatable present, allocatable > 0 | `Σ cpu_used / Σ cpu_allocatable` | pair-complete rows, `Σ den != 0` |
| `memory_efficiency` | `memory_utilization_pct` | `memory_used_gib / memory_allocatable_gib` | used & allocatable present, allocatable > 0 | `Σ memory_used_gib / Σ memory_allocatable_gib` | same |
| — (new) | `cpu_request_efficiency_pct` | `cpu_used / cpu_requested` | used & requested present, **requested > 0** | `Σ cpu_used / Σ cpu_requested` (both sums over the same mask) | pair-complete **and `cpu_requested > 0` per row** — see §4 |
| — (new) | `memory_request_efficiency_pct` | `memory_used_gib / memory_requested_gib` | used & requested present, requested > 0 | `Σ used / Σ requested` | same requested>0 restriction |

Semantics: *utilization* = headroom against schedulable capacity (data-model
§3.2 allocatable basis, CAST AI primary anchor); *request efficiency* = how much
of what workloads **asked for** is actually consumed (rightsizing lens). The
pre-existing data-model KPI "CPU request commitment" = `Σ requested / Σ
allocatable` (§3.3, not yet shipped) is the **third distinct ratio** — never
confuse it with request efficiency (numerator vs denominator swapped).

**Migration mapping (old → new), full surface:**
- `services/cluster_service.py` `FLEET_COLUMNS`: rename 2 keys, insert 2 new keys.
- `data/normalizers.py`: rename 2 row keys; add 2 `_safe_ratio` row values.
- `data/aggregators.py` `enterprise_kpis`: rename `cpu_efficiency`/`memory_efficiency`
  keys (or alias — see UX compatibility note §7 risks); add 2 new `weighted_ratio` calls.
- `ui/tables.py` (`_DISPLAY_ORDER`, `_build_column_config`), `ui/cards.py`:
  rename + add new columns.
- `docs/baseline-fleet.csv`: regenerated columns; treat as a new fixture, not an
  in-place edit (v1 CSV is the golden reference for v1 tests).
- `tests/*`: update keyed assertions; add new ratio-of-sums guards (§8).
- `docs/metrics.md` §A/§B + `docs/data-model.md` §2/§3: rename rows; keep a
  `v1 → v2` mapping note for one release.

## 3. Storage — spec-verified sources

| Candidate | Source (endpoint → field) | Wire type / unit | Verdict |
|---|---|---|---|
| `storage_provisioned_gib` | Tier-1 `organization/clusters/summary` → `ClusterSummary.storageProvisioned` ("Storage GiB provisioned") | string, GiB | **Ship** |
| `storage_claimed_gib` | 〃 → `storageClaimed` ("Storage GiB claimed in PVC") | string, GiB | **Ship** |
| `storage_active_claimed_gib` | 〃 → `storageRequested` ("Storage GiB **claimed in PVC accessed by any workload**") | string, GiB | **Ship, renamed.** ⚠️ Wire-name trap: it is *active* claims (accessed by a workload), a subset of claims — it is NOT a scheduler-style request. Never expose it as "requested storage" verbatim. |
| `storage_cost_hourly` | 〃 → `storageCostHourly` ("Storage cost per hour") | string, USD/h | **Ship** (component of `cost_hourly`; display-only split) |
| `storage_cost_period` / `wasted_storage_cost_period` | Tier-1 *windowed* `organization/clusters/efficiency` (paged, startTime/endTime) → `storageCost.cost` (double USD/window), `wasted.storage` | double, USD/window | **Ship only when the efficiency fan-out is enabled** (v1: not called at Tier 1) |
| `storage_overprovisioned_pct` | 〃 → `storageOverprovisionedPercent` (0–100 double, CAST's own %; denominator **unspecified**) | double, % | **Validate first** — cross-check vs `1 − claimed/provisioned` on live data before labeling (data-model §7.5) |
| `storage_used_gib` (actual bytes written) | — | — | **N/A — no reliable Tier-1 source.** The only "used" storage in spec is *ephemeral disk* per node: Tier-2 `GET /v1/cost-reports/clusters/{clusterId}/nodes/storage` → `NodeStorageMetrics{totalBytes, allocatableBytes, usedBytes, requestedBytes}` (bytes, per-cluster only). PVC contents are never measured by any spec field. |
| `storage_efficiency_pct` (= used/provisioned) | — | — | **N/A — cannot be computed** (no used numerator at Tier 1). Instead ship the honest proxy: **`storage_commit_pct` = `storage_claimed_gib / storage_provisioned_gib`** (claims committed vs provisioned capacity), labeled "commit", never "utilization". Org-windowed twin: efficiency `storageResources{claimed,provisioned}` ratio-of-sums **as CAST AI's own aggregate cross-check**, not as the sliced source (windowed ≠ point-in-time). |

Also present in spec, out of scope for the fleet table: `GetOrganizationEfficiencySummaryResponse` → `storageResources{provisioned,claimed,requested,overprovisionedPercent}` + `storageCost{cost,perGib*}` + `totalWaste` (org rollup cross-check); `estimated-savings.currentConfiguration.provisionedStorageBytes`; idle-disk waste tab `GET /v1/cost-reports/idle-resources/disks` (`storageSizeBytes`, `storageCostMonthly`).

## 4. Enterprise aggregation — ratio-of-sums re-verification

Verified v1 (`data/aggregators.py`): every shipped ratio goes through
`weighted_ratio` = `SUM(num)/SUM(den)` over `num.notna() & den.notna()`;
`cpueff/memoryeff/spot_coverage/potential_savings_pct/wa_coverage` all comply;
`cost_by_organization` computes per-org pct from pairwise subset sums (lines
213-217), not a mean of cluster pcts. Tests pin these (§8).

**Gap for v2 (must fix):** `weighted_ratio`'s pair mask admits rows with
`denominator == 0` (num stacks, den adds 0 — mild inflation). Harmless today
(allocatable≈0 rows don't exist in baseline) but **decisive for request
efficiency**, where `requested == 0` is common (clusters with no sized
workloads). Add an optional `den_positive=True` restriction:
```python
pair &= den.gt(0)          # requested > 0 per row, per data-model §3 mask law
```
and reuse it for `cpu_allocatable`-based ratios. Enterprise-level masks:

| KPI | Mask (rows included) | Denominator-zero handling |
|---|---|---|
| `cpu_utilization_pct` (agg) | used & allocatable present, allocatable > 0, `data_status != unavailable` | Σ den == 0 ⇒ None ("–") |
| `cpu_request_efficiency_pct` (agg) | used & requested present, **requested > 0**, data ok/partial | Σ den == 0 ⇒ None |
| `memory_request_efficiency_pct` (agg) | mirror of CPU | 〃 |
| `storage_commit_pct` (agg) | claimed & provisioned present, provisioned > 0 | 〃 |

Expose `n_clusters_included` beside each new KPI (clusters outside the mask are
"no requests sized", a *valid* state — not no-data).

## 5. Zero-resource clusters — sentinel policy

Baseline observation: 0 rows with `provisioned==0 & cost>0`, 0 rows with
`allocatable==0`; 54 NA-efficiency rows are all `agent_status=non-responding`
(Disconnected — summary numerics absent). Current code already yields the right
three-way split; policy pins it:

| Situation | Stored value | Display | Never |
|---|---|---|---|
| `used == 0`, `allocatable > 0` | **0.0** (measured true zero utilization) | "0 %" | NA — a measured zero is data (data-model §5) |
| `allocatable == 0` (or requested/provisioned == 0) with data present | **NA** ratio; raw columns stay numeric (cost may be > 0 from storage/master lines) | "–" + optional "no capacity" chip derived from `provisioned == 0` | `0 %` — zero denominator is *undefined*, not zero usage |
| Field absent / unparseable / org payload failed | NA + existing `data_status` ∈ {ok, partial, unavailable} / Disconnected sentinel | "–" | `0` |
| Row absent from KPI mask (e.g. requested == 0 for request-efficiency) | cluster counted in `n_clusters_excluded`, not in `n_clusters_missing` | "no requests" footnote | silently counted as 0 % or as failure |

Invariant (lint-tested): `_safe_ratio` returns None on `den == 0`; no
`fillna(0)` anywhere in the ratio path.

## 6. GPU / TPU — optional columns (hidden by default)

All per-offering string fields on Tier-1 `ClusterSummary` (spec-verified):
GPU carries `gpu{Provisioned,Allocatable,Requested,Used,Idle,NotUsed}{OnDemand,Spot,SpotFallback}`
+ `gpuCostHourly*`; TPU carries `tpu{Provisioned,Allocatable,Requested}{...}` +
`tpuCostHourly*` (**no `tpuUsed*`** ⇒ no TPU utilization — N/A, never derive).

| v2 column | Formula | Note |
|---|---|---|
| `gpu_provisioned` / `gpu_allocatable` / `gpu_requested` | Σ 3 lifecycles, `min_count=1` | counts |
| `gpu_active` | Σ `gpuUsed*` ("GPU used (active)") | counts |
| `gpu_active_pct` | `gpu_active / gpu_provisioned` (mask: provisioned > 0); agg = `Σ used / Σ provisioned` | provisioned-basis chosen deliberately: GPU counts are whole devices; "active fraction of what we pay for" is the waste lens |
| `gpu_idle` / `gpu_reserved_unused` | Σ `gpuIdle*`, Σ `gpuNotUsed*` | CAST's own idle/reserved-but-unused split |
| `gpu_cost_hourly` | Σ `gpuCostHourly*` | USD/h |
| `tpu_provisioned` / `tpu_requested` / `tpu_cost_hourly` | Σ 3 lifecycles | counts/USD-h; utilization **N/A** |

Ship as a second column group, **hidden by default** (most rows are 0; a
measured 0 stays 0 — a GPU-less cluster renders `0`, an absent summary field
renders "–", per §5).

## 7. Waste vs utilization — coexistence without double counting

Three independent lenses, three sections of the UI:

| Lens | Basis | Time shape | Source | Nature |
|---|---|---|---|---|
| Utilization (`*_utilization_pct`, `*_request_efficiency_pct`) | cores/GiB ratios | point-in-time snapshot | `clusters/summary` | descriptive |
| Waste ($) | `wasted.{cpu,ram,storage}`, `storageCost.cost` | **trailing window** | `clusters/efficiency` (paged) + org `efficiency/summary → totalWaste` cross-check | opportunity **estimate** (CAST's model) |
| Savings opportunity ($) | `costHourly − optimalCostHourly` | current run-rate snapshot | `organization/overview` | opportunity **estimate** (CAST's other model) |

Rules:
1. **Never add waste $ to spend** — spend already includes the idle capacity
   (`wasted.*` is a re-interpretation of spend, not extra spend).
2. **Never add waste $ to potential savings** — two different CAST AI estimate
   models (windowed rightsizing model vs snapshot optimal-node model); summing
   double counts the same idle capacity. Show in separate cards/sections with
   window/source labels (data-model §4 hard rule 3).
3. Utilization % and waste $ are the *same phenomenon viewed over different
   bases*: low `cpu_utilization_pct` clusters are exactly the ones expected to
   carry `wasted.cpu` $ — correlate for diagnostics (e.g. waste leaderboard
   joined on cluster), but keep storage separate 🔽: storage waste $ exists
   (`wasted.storage`) while storage **utilization does not** (no used bytes —
   §3), so the storage row shows commit % + waste $, not a fake "efficiency".
4. Window discipline: waste numbers always carry `startTime–endTime`; summary
   ratios carry "current snapshot"; savings carry "current snapshot".

## 8. Proposed fleet-table resource section — column order

New `_DISPLAY_ORDER` resource block (keeps surrounding columns unchanged;
`*` = new for v2, `→` = renamed):

```
… nodes_total, nodes_spot,
cpu_provisioned, cpu_allocatable, cpu_requested, cpu_used,
cpu_utilization_pct (→), cpu_request_efficiency_pct (*),
memory_provisioned_gib, memory_allocatable_gib, memory_requested_gib, memory_used_gib,
memory_utilization_pct (→), memory_request_efficiency_pct (*),
storage_provisioned_gib (*), storage_claimed_gib (*),
storage_active_claimed_gib (*), storage_commit_pct (proxy, *) , storage_cost_hourly (*) ,
monthly_cost, potential_savings, …
[optional, hidden] gpu_provisioned, gpu_active, gpu_active_pct, gpu_cost_hourly,
   tpu_provisioned, tpu_requested, tpu_cost_hourly
```

Rationale: quantities before ratios (denominators visible next to the ratio
they feed); window-only waste columns stay off the default grid until the
efficiency fan-out flag ships.

---

*Verified 2026-09-21 codebase + `docs/baseline-fleet.csv` + programmatic
extraction from `docs/openapi/castai-openapi.json`. N/A = no reliable source —
never fabricate.*
