# Historical Analytics Model — CAST AI Enterprise Dashboard (v2)

Status: **design document** (Agent 8 deliverable; no app code here).
Evidence base: `docs/openapi/castai-openapi.json` (423 paths), `docs/api-matrix.md`,
`docs/performance.md`, `services/{cost_service,cluster_service,castai_client}.py`,
`docs/baseline-fleet.csv` (**241 clusters / 57 child orgs** live baseline).

Cross-refs: data-model.md §0/§4/§5 (ground rules, savings taxonomy, N/A semantics),
performance.md §2.4 (historical timeouts: **60 s read / 180 s ceiling**), §4.1
(**history cache TTL = 6 h**), §6 (server-side down-sampling only).

---

## 1. Fleet-level history — derived from the existing sweep (0 extra calls)

### 1.1 What v1 already carries

The Tier-1 sweep (`services/cluster_service.build_fleet_dataframe`) fetches
`organization/clusters/report` per child org over the user-selected window
(default 30 d) and carries the raw payloads out on `FleetResult.reports`
(final-review MAJOR-2). `services.cost_service.trend_from_reports` sums each
org's `totalDailyCost[]{timestamp, value}` by timestamp → the enterprise
daily-cost series (`timestamp` datetime64[ns, UTC], `value` Float64 USD/day).

### 1.2 New fleet metrics from the SAME payloads (0 calls)

| Metric | Derivation | Window requirement |
|---|---|---|
| `cost_7d` | Σ last 7 daily buckets of the enterprise trend | ≥ 7 buckets |
| `cost_30d` | Σ last 30 daily buckets | ≥ 30 buckets |
| `cost_change_7d_pct` | `Σ(last 7) / Σ(preceding 7) − 1` (ratio of sums, same series) | ≥ 14 buckets |
| `cost_change_window_pct` | per org: `prev = totalCost/(1+totalCostPercentChange/100)` from report `summary{}`, then `Σ_org(totalCost)/Σ_org(prev) − 1` | any (API computes `previousPeriodStart/End`) |

Rules inherited from data-model.md §0/§5: fewer buckets than required ⇒ **N/A, never
extrapolate**; ratio-of-sums only (never a mean of per-org percentages); a `pct = −100`
with `totalCost = 0` yields an undefined `prev` ⇒ drop that org from both sums and count
the exclusion. Mid-window gaps count as 0 cost only when the org payload arrived;
absent org payloads (FetchError) are excluded from both numerator and denominator and
surfaced via the existing health banner.

### 1.3 60 d once vs 30 d twice — call-cost verdict

| Option | Calls (57 orgs) | Payload | Verdict |
|---|---|---|---|
| Widen sweep window to 60 d | **+0** (same 1 report call/org) | +30 daily points/org ≈ +2 KB/org (≈120 KB total) | **Chosen** when the History scope is active |
| Second report sweep [t−60, t−30] | +57 | comparable | Rejected: doubles report-family calls for data one call already returns |

Important nuance: `cost_change_window_pct` (§1.2) needs **no** window widening for
any user-selected window, because the report summary self-carries the previous-period
comparison. Widening to 60 d is only needed to draw 60 daily points and to compute a
fixed `cost_change_30d_pct` from the series itself. Policy: default sweep stays 30 d;
the History scope control requests 60/90 d explicitly. Past buckets are immutable →
the 6 h history TTL applies.

### 1.4 Per-org trend contribution / top movers (0 calls)

- **Org level:** trend per org = `aggregators.trend_from_org_report(report)` — Δ
  `Σ(last 7) − Σ(prev 7)` per org, ranked; render as the top-movers table.
- **Cluster level (window granularity):** each report's `clusters[].summary` carries
  `totalCost` + `totalCostPercentChange` + `clusterName` → per-cluster previous-period
  cost recovered arithmetically (`prev = total/(1+pct/100)`); merge across orgs, rank
  by absolute Δ. No daily granularity per cluster at fleet level (would need
  `organization/daily-cost`, +57 calls, opt-in only).

---

## 2. Node-count history — spec-verified, Tier-2 first

### 2.1 Confirmed fields (`ClusterReportAPI_GetClusterNodeCountHistory`)

`GET /v1/cost-reports/clusters/{clusterId}/node-count-history` — REQ `startTime`,
`endTime`; opt `stepSeconds` (NO documented enum on this operation — the
`30/300/600/900/3600/86400, 0=auto` enum is documented **only** on the three
workload-event-metrics endpoints), opt `timeZone` (IANA, default Etc/UTC). Response:
`items[]{timestamp, nodeCountOnDemand(int64), nodeCountSpot, nodeCountFallback,
nodeCountUnknown, source(DataSource: UNSPECIFIED|ONEOFF|CLOUDCONNECT|AGENT)}` +
`sources[]{source, firstCollectedAt, lastCollectedAt}` + `lastSnapshotAt`.
Agent+cloud merged server-side, agent wins per-point; **fallback is always 0 on
cloud-sourced points** (label exists only inside the cluster).

### 2.2 Per-cluster spot coverage metrics (Tier-2 drill-down)

```
known(t)            = on_demand(t) + spot(t) + fallback(t)      # unknown excluded
spot_share(t)       = spot(t) / known(t)                        # N/A when known(t)=0
spot_coverage_current = spot_share(last bucket)
spot_coverage_7d_avg  = Σ spot / Σ known                        # over last 7 daily buckets
spot_coverage_30d_avg = Σ spot / Σ known                        # over last 30 daily buckets
```
Ratio-of-sums over buckets (consistent with data-model §3), not a mean of daily
shares. `unknown` is shown as its own series, never silently allocated. Source
fidelity from `sources[]`/`lastSnapshotAt` rendered as a caption.

### 2.3 Enterprise spot trend — batch evaluation (241 calls)

Math at 8 workers, p50 ≈ 300 ms, ×1.25 overhead: 241 calls → 31 waves ≈ **12 s**;
payload ≈ 241 × 90 daily buckets × ~60 B ≈ **1.3 MB**. Budget: 286 (sweep) + 241 =
**527 ≤ 750 hard-stop** ⇒ technically affordable as an *opt-in* batch.

| Option | Calls | What it answers | Verdict |
|---|---|---|---|
| (A) `GET /v1/cost-reports/organization/efficiency` series (REQ start/end, opt stepSeconds) — items carry `onDemand{}`/`spot{}`/`fallback{}` lifecycle blocks (cpuResources/cpuCost) | **+57** (1/org) | **Fleet spot-CPU-share and spot-cost-share daily trend** | **Recommended** default; join the sweep family on demand (History scope), not the base 5-call bundle |
| (B) `node-count-history` × 241 | +241 | **Node-count-level** fleet spot share daily trend (exact) | Accepted **opt-in only**: explicit button, 6 h cache, background with progress + call-budget counter; pre-filter via `clusters/active` (+57) drops dead clusters |
| (C) Top-N-by-spend compromise (N=20 ranked by report `clusters[].summary.totalCost`) | +20 | approx. node-level trend on ~70–80 % of fleet spend, labeled as such | **Default when (A) is unavailable/empty**; always labeled "Top-20 by spend" |

(A) is the cheapest true-fleet answer (cost/CPU-weighted); (B) is exact node-level but
costs 4.2× the calls; (C) is the degradation/compromise path. Note (A)+(B) measure
different units (CPU vs node count) — the UI must label which.

---

## 3. Savings history (Tier-2 drill-down)

### 3.1 Estimated — `GET .../clusters/{clusterId}/estimated-savings-history`

REQ `fromDate`, `toDate` (date-time); opt `useListingPrices`.
`items[]{createdAt, current{}, optimizedSpotInstances{}, optimizedLayman{},
optimizedSpotOnly{}}`; each value is `CostDetails{costPerHour(double USD/hr),
totalNodeCount, spotNodeCount, totalCpu, spotCpu, totalRamGib, spotRamGib}`.
Entry cadence is server-side (evaluation snapshots) — expect **irregular, sub-daily
or sparse** items. Resampling: last-entry-per-UTC-day, ffill ≤ 3 d, never beyond
(data-model §5).

### 3.2 Realized — `GET .../clusters/{clusterId}/savings`

REQ `startTime`, `endTime`; opt `stepSeconds`, `useListingPrices`.
`items[]{timestamp, downscalingSavings(string), spotSavings(string)}`,
`summary{totalCost, totalSavings}` (USD, proto3 strings). Resampling: **sum** to
daily (savings are additive amounts, unlike the rate series in §3.1).

### 3.3 Chart spec — "Current vs optimal" (drill-down Savings tab)

- Panel 1 (estimated, labeled "estimated/potential"): lines `current.costPerHour`,
  `optimizedSpotInstances.costPerHour`, `optimizedLayman.costPerHour`,
  `optimizedSpotOnly.costPerHour` (USD/hr) over the window; shading between
  `current` and `optimizedSpotInstances` = modeled opportunity.
- Panel 2 (realized, labeled "realized"): stacked daily bars `downscalingSavings` +
  `spotSavings` (USD/day).
- **Never** in one scalar/axis: USD/hr rates (estimated) vs USD amounts (realized) —
  data-model.md §4 taxonomy (cost_service.py module contract: never mixed).

---

## 4. Cluster cost & efficiency series (drill-down History tab)

- `GET .../clusters/{clusterId}/cost` — REQ start/end; opt stepSeconds,
  useListingPrices. `items[]` = timestamp + 42 fields: per-offering
  `cost{OnDemand,Spot,SpotFallback}`, `cpuCount*`, `ramGib*`, `gpu*Cost/Count`,
  per-resource `*Cost*`, `storageGib/storageCost`, full `tpu*` set; `summary{}` =
  totals+avgs (`totalCost`, `totalCostOnDemand/Spot/SpotFallback`, `avg*`, storage/tpu).
- `GET .../clusters/{clusterId}/efficiency` — same params. `items[]` = timestamp + 42
  fields: per-offering provisioned/requested/used CPU+RAM, overprovisioning absolutes
  + percents, storage provisioned/claimed/requested + `storageCost` +
  overprovisioning; plus `summary{}`, `current{}`, `noDataReason`.
- History tab requests: `stepSeconds=86400` for 30–90 d windows (≤ 90 points, inside
  the ≤ ~1 000 points/request rule of performance.md §6). Honor `noDataReason`.

---

## 5. Pandas storage model

**Semi-wide** (one row per cluster × bucket, fixed metric columns per endpoint) —
chosen over true-long: each endpoint has a closed, known metric set; semi-wide avoids
pivot cost in charts and keeps dtypes strong. Cluster-level frames keyed by
`(cluster_id, timestamp)`; enterprise trend stays the v1 `timestamp/value` frame.

| Frame | Grain | Columns (dtypes) | 241 clusters × 90 d daily | × 90 d hourly |
|---|---|---|---|---|
| `cost_history` | cluster-day | `cluster_id category`, `organization_id category`, `timestamp datetime64[ns,UTC]`, `cost_on_demand/cost_spot/cost_spot_fallback/storage_cost/total_cost Float64` | 21,690 rows ≈ **1.5–2.5 MB** | not collected |
| `node_history` | cluster-bucket | `cluster_id category`, `timestamp`, `nodes_on_demand/spot/fallback/unknown UInt16`, `source category` | 21,690 rows ≈ **0.5 MB** | 520,560 rows ≈ **12–30 MB** — opt-in batch or ≤ 7 d single-cluster only |
| `savings_realized_history` | cluster-day | `cluster_id`, `timestamp`, `downscaling_savings Float64`, `spot_savings Float64` | 21,690 rows ≈ 1 MB | not collected |
| `savings_estimated_history` | cluster-entry | `cluster_id`, `created_at`, `current_cph/optimized_spot_instances_cph/optimized_layman_cph/optimized_spot_only_cph Float32`, `spot_node_count Float32` | sparse (≤ 21,690 rows) ≈ ≤ 1 MB | irregular cadence |

Dtype rules (performance.md §5.1): monetary **totals/sums stay Float64** (no blind
float32); per-hour rates may be Float32; node counts UInt16 (10 k nodes ≪ 65 535);
`cluster_id`/`organization_id`/`source` as `category`; timestamps pinned
`datetime64[ns, UTC]`. Down-sampling is **server-side** via explicit `stepSeconds`
(always pass it; probe 86400, fall back to `0`=auto on 400) — never client-side from
fine buckets.

---

## 6. Answer-check — which dataset answers which v2 question

| Question | Dataset / metric | Fleet-level without fan-out? |
|---|---|---|
| **Did costs increase?** | Enterprise daily trend (FleetResult.reports): `cost_7d/30d`, `cost_change_7d_pct`, `cost_change_window_pct` (§1.2) | **YES — 0 extra calls** |
| **Did Spot adoption improve?** | Cost/CPU-weighted: org `efficiency` series lifecycle blocks (+57 calls, §2.3-A). Node-weighted: node-count-history Top-20 (+20) or full opt-in batch (+241) | With the current 5-call bundle: **NO** — the report gives only a single-window spot-cost scalar, no trend and no per-offering percent change. **Yes with +57/***`efficiency`* |
| **Are we improving?** | Composite: cost trend (this doc §1) + org `efficiency/summary` `totalWaste` + `overprovisionedPercent` across two windows (+57 calls for the second window) | **Partially** — cost yes; efficiency direction yes with the +57 second window. Workload-normalized efficiency (per business unit of work): **NOT answerable** — no business-denominator metric in the API |
| **Is optimization coverage growing?** | WA org agent statuses, `isPhase2`, policies — all **current-state only**; no coverage-history endpoint exists in the spec | **NO.** No documented endpoint returns coverage-over-time. Only path: persist our own daily snapshot (fleet frame + WA statuses, local parquet) and diff over time — first-class v2 candidate, clearly labeled "coverage since <first snapshot>" |

### Not answerable at fleet level without per-cluster fan-out (explicit)
- Node-count spot adoption trend (exact, all clusters) — needs (B) or compromise (C).
- Realized savings trend fleet-wide — `.../savings` is per-cluster only (api-matrix
  §5.1, §12a); org proxies are **estimated** (`potentialSavingsHourly`) and must be
  labeled as such.
- Optimization-coverage trend from the API (any level) — no endpoint; snapshot locally.

---

## 7. Unknowns & validation plan

1. **No documented max window** on any of these endpoints (spec scanned: zero
   statements). Assume 90 d practical; probe once live with 366 d and record behavior.
2. `node-count-history` and per-cluster `cost`/`efficiency`/`savings` document no
   stepSeconds enum — send 86400, fall back to 0 (auto) on 400; log which happened.
3. Org `efficiency` series lifecycle blocks (`onDemand/spot/fallback` per item) are
   schema-confirmed but **not yet observed live** — validate population before shipping §2.3-A.
4. `estimated-savings-history` entry cadence/sparsity — empirical; the ffill ≤ 3 d
   rule bounds fabrication.
5. Retention horizon (how far back any series reaches) — empirical; render what
   arrives, annotate `sources[].firstCollectedAt` where present.

## 8. Implementation changes (for builders)

- **Client (`castai_client.py`):** add `get_org_efficiency(org_id, start, end, step_seconds)`
  (series variant; only `.../efficiency/summary` exists today), `get_cluster_efficiency`,
  `get_cluster_node_count_history`, `get_cluster_estimated_savings_history`; add
  `step_seconds` param passthrough on `get_cluster_cost` / `get_cluster_savings`.
- **History service (new `services/history_service.py`):** `fleet_window_metrics(reports)`
  → `cost_7d/30d`, `cost_change_7d_pct`, `cost_change_window_pct`;
  `top_movers(reports, n)`; `spot_coverage(items)` → current/7d/30d per §2.2;
  `resample_estimated(items)` / `resample_realized(items)` per §3. History fetchers use
  the 60 s read / 180 s ceiling timeout row and 6 h cache TTL (performance.md §2.4/§4.1).
- **Scope control:** History view requests the 60/90 d sweep window explicitly;
  default overview stays 30 d (§1.3). Opt-in full node-history batch gated behind an
  explicit action with the call-budget counter (§2.3-B).

## 9. Test requirements

- Pure-function tests (fixtures, no network): window metrics incl. <14-bucket N/A
  branches, `pct=-100` exclusion, min_count=1 gap semantics; top-movers ranking and
  deleted-cluster blacklist reuse; spot coverage with all-unknown / zero-denominator
  buckets; estimated-history resample (irregular cadence, ffill cap); realized daily
  summation of string numerics (`parse_number`).
- Wire-shape tests: `totalDailyCost` string values, `CostDetails` doubles, node-count
  int64, savings string USD, `noDataReason` passthrough.
- Call-budget tests: History scope ≤ `2 + N_orgs×6`; opt-in full node batch asserts
  `sweep + 241 ≤ 750`; Top-20 mode asserts exactly 20 node-history calls.
- Chaos: one org's report failure leaves other orgs in all derived metrics with the
  exclusion counted (existing FetchError banner).
</content>
