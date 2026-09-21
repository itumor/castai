# FinOps / Savings Model — CAST AI Enterprise Dashboard v2

**Status:** design document (v2 content for `docs/metrics.md`; structure kept
adoption-ready). Authored 2026-09-21 from programmatic spec extraction
(`docs/openapi/castai-openapi.json`, 423 paths) — no hand-typed fields.
**Evidence carried forward:** `metrics.md` §C/§E (savings taxonomy, N/A list),
`data-model.md` §1.5–1.6, §3–4, §7 (aggregation law, window discipline, risks),
`api-matrix.md` §3.3–3.9, §5 (savings endpoint matrix — sibling-agent work,
independently re-verified here against the spec). Agent 2's standalone
efficiency doc is not present; its waste/efficiency facts above were
re-verified against the spec directly.

---

## 0. Conventions (inherit + delta)

Inherit from `data-model.md` §0: string-numerics coerced (`pd.to_numeric`,
failures → `pd.NA`, never 0), sparse=unknown, RFC 3339, one
`useListingPrices` mode per run, one window per run, ratio-of-sums only
(rule 4), composite key `(organization_id, cluster_id)`.

**Currency.** USD only, everywhere. Spec: `OrganizationSummary.totalCostHourly`
"Total estimated hourly cost across all clusters (USD)",
`potentialSavingsHourly` "(USD/h)", savings report is priced "in $ currency".
No currency field or conversion endpoint exists ⇒ hard-code USD, never infer.

**Money formatting (single formatter, `utils.formatting.fmt_usd`).**
`$1,234.56` (< $1k, 2 dp) · `$12.3k` / `$4.56M` (≥ $10k tile cards, exact
value in tooltip) · negatives `−$1,234` (unicode minus, **no parentheses**,
prose explained by the field's display rules) · per-cent precision kept only
in tooltips/diagnostics. Percentages: 1 dp, `–` for NA. Same formatter for
cost, savings, waste — mixing formats across tiles is a bug class.

**Tiers.** `1` = enterprise sweep at page load. `1-batch` = opt-in bounded
batch over the current filtered set, user-triggered, progress indicator,
15-min cache (see §6). `2` = single-cluster drill-down.

**Rule 5 (strict bucket separation).** Realized (history) and
estimated/potential (snapshot forecast) are NEVER summed, averaged, or
rendered on one axis without a split axis/legend. Spot savings shipped to
users come only from the realized `spotSavings` field or a labeled
estimated-savings scenario — never from on-demand−spot spend mix
(`data-model.md` §4 hard rule 2).

---

## 1. Cost tiers (the four cost numbers, disambiguated)

| Display name | Definition | Source API + fields | Formula | Unit | Time range | Aggregation | Missing-data behavior | Tier |
|---|---|---|---|---|---|---|---|---|
| Monthly run rate (current) | What the fleet would cost for a month if the current snapshot held. **Corrections of the v1 name:** label explicitly "run-rate", not "actual". | `GET …/organization/clusters/summary` → `costHourly{OnDemand,Spot,SpotFallback}`; x-check overview `clusters[].costHourly` | `Σ3 lifecycles × 730` | USD/month | point-in-time | `Σ` over present rows; coverage `n/n_missing` shown | row absent ⇒ `No-data`; KPI excludes + counts | 1 |
| Actual period cost | Compute cost actually accrued in the report window. | v1: `GET …/organization/clusters/report` (per org, windowed) — **spec describes `summary.totalCost` as "Average compute cost"; basis unspecified** (`data-model.md` §7.3). v2 alternative: `GET …/organization/daily-cost` → `intervals[]{timestamp, cost*PerHour}` integrated as Σ(avg-hourly×Δt) — clean semantics | Σ over window | USD per window | report window (default trailing 30d) | `Σ` per cluster over present rows | window without data ⇒ `No-data`, not 0 | 1 |
| Projected monthly cost | **No forecast/projection endpoint exists.** Verified: all 11 `projected*` matches are DBO cache domain; `forecast` ×1, unrelated. ⇒ Defined as **the run-rate under the explicit assumption "current snapshot holds"** — same number as Monthly run rate, different label. Savings-adjusted projection = Optimized monthly cost below. Never a hidden third computation. | derived | `= monthly_cost` | USD/month | point-in-time | as run rate | as run rate | 1 (label-only) |
| Optimized monthly cost | Monthly cost if the cluster ran at CAST AI's achievable optimum. | `GET …/organization/overview` → `clusters[].optimalCostHourly` *(spec: agent clusters rightsized; discovered CPU-util rightsized; else current cost)* | `optimal_cost_hourly × 730`. Algebraically `= (cost − potential_savings) × 730` within one row; the direct field is canonical — never back-fill from other tiers | USD/month | point-in-time | `Σ` over rows where optimal present | missing overview row ⇒ `No-data` (baseline: 23/241 rows) | 1 |
| Remaining savings opportunity | The still-uncaptured opportunity. **Design decision (explicit): `= potential_savings`, full stop.** NOT `potential − realized`: potential is a forward point-in-time snapshot, realized is a backward WINDOW total; subtracting mixes time directions (violates rule 5) and counts nothing meaningful (realized savings from a past window say nothing about how much of today's snapshot opportunity was "used"). No API field for "remaining savings" exists (spec `remaining` hits are credits domain). | derived | `= potential_savings_monthly` | USD/month | point-in-time | as potential | as potential | 1 (alias) |
| Cost change 7d / 30d | Δ% of actual period cost between two equal length windows (A = preceding, B = trailing). | two `organization/clusters/report` (or `daily-cost`) windows per org; org-level alt: `GET …/organization/cost-comparison` (`startTimeA`,`startTimeB`,`rangeDays`) — org grain only, **no per-cluster rows** (api-matrix §3.7) | `(Σ_B period_cost − Σ_A period_cost) / Σ_A period_cost` over clusters present in BOTH windows (pairwise) | % | two labeled windows | ratio of sums; per-cluster column `(B−A)/A` NA-safe, A>0 | missing window ⇒ `No-data`; A=0 ⇒ NA | 1 |
| Spot-covered spend | Share of current spend on spot nodes. | `clusters/summary` `costHourlySpot` (+ cast fallback separately) | `Σ spot_cost_hourly / Σ cost_hourly` | % | point-in-time | ratio of sums | NA-safe | 1 |

---

## 2. Potential (estimated) savings — incl. rule 9 negative handling

Source: `GET …/organization/overview` → `clusters[].costHourly`,
`clusters[].optimalCostHourly` (same-source pairwise — final-review MAJOR-1:
both fields of the SAME overview item). Org x-check:
`OrganizationSummary.potentialSavingsHourly`, `rightsizedCostHourly`.
Tier-2 authoritative per-cluster source: `GET
…/clusters/{id}/estimated-savings` →
`recommendations{(open map)→SavingsRecommendation{monthly{priceBefore,priceAfter},
hourly{…}, savingsPercentage, details, armSavingsMonthly}}`,
`currentConfiguration.totalPrice`, `lastUpdatedAt`,
`isRebalancingRecommended`; map keys are runtime-discovered, never hard-coded.

| Field | Definition | Formula / rule | Tier |
|---|---|---|---|
| `potential_savings_raw` | Signed hourly delta, full precision. | `ov_costHourly − ov_optimalCostHourly`; monthly ×730. **Never clamped, never floored at 0** (v1 `normalizers.py:218` already complies — regression-tested). | 1 |
| `potential_savings_display_pct` | Signed %, pairwise. | `raw / ov_costHourly` (NA-safe, den>0). | 1 |
| `potential_savings_display` | Grid string. | raw ≥ 0 ⇒ `"$X/mo (−Y%)"`; raw < 0 ⇒ `"No savings opportunity — optimized configuration estimated to cost more"` + tooltip shows raw value. | 1 |
| `has_positive_savings_opportunity` | Boolean. | `potential_savings_raw > 0`. Drives the "Opportunity" filter chip and the gross-opportunity KPI. | 1 |

**Negative semantics (empirical, baseline-fleet.csv).** 10/241 clusters are
negative, Σ −$3,314/mo vs Σ gross positives +$324,069/mo (netting effect
≈ 1.0% of the gross). Distribution: 7× `READ_ONLY`, 2× `OPTIMIZED`, 1× other; two rows
dominate (−$1,796/mo, −$1,197/mo). Root cause is semantic, not noise: for
READ_ONLY/DISCOVERED clusters `optimalCostHourly` is a CPU-util-rightsized
estimate that can legitimately exceed current spend when a cluster is
over-utilized — the optimum costs MORE. Small (≤ $0.01/h) negatives are
precision artifacts: observed `costHourly` carries 5 dp, `optimalCostHourly`
2 dp. **Never "fix" either class in data — explain in UI.**

**KPI treatment of negatives.**
1. Headline *Net potential savings* = `Σ potential_savings_raw × 730` —
   negatives included (honesty; hiding them overstates on filtered views).
2. Companion *Gross identified opportunity* = `Σ raw | raw>0` with
   `n_positive` count; *Over-optimized headroom* = `Σ raw | raw<0` with
   `n_negative` chip (baseline: "10 clusters · −$3.3k/mo").
3. Pct KPIs always `Σ raw / Σ ov_costHourly` on the pairwise mask
   (rule 4); no per-row clamping enters any denominator.

**Missing-data behavior.** overview row absent ⇒ `No-data` sentinel, row
leaves every savings mask (`data-model.md` §5). Never impute 0 (a 0 claim is
a *measured* statement).

---

## 3. Realized savings — verified contract

`GET /v1/cost-reports/clusters/{clusterId}/savings`
(`ClusterReportAPI_GetClusterSavingsReport`), **per-cluster only — no
org-level equivalent exists in the 423-path spec** (verified today; the only
org-grain look-alikes are `cost-comparison` impact metrics, which are
modeled/estimated and stay out of the realized bucket).

| Wire field | Type | Meaning (spec-verified) |
|---|---|---|
| params `startTime`,`endTime` | RFC 3339, REQUIRED | window |
| param `stepSeconds` | int, optional | bucket aggregation of items |
| param `useListingPrices` | bool, optional | per-run pricing mode (§0) |
| `items[].timestamp` | string date-time | bucket start |
| `items[].downscalingSavings` | string | USD per bucket |
| `items[].spotSavings` | string | USD per bucket |
| `summary.totalCost` | string | USD actual compute cost over window |
| `summary.totalSavings` | string | USD over window (= Σ items) |

| Display name | Definition | Formula | Unit | Time range | Aggregation | Missing-data | Tier |
|---|---|---|---|---|---|---|---|
| Realized savings | Savings CAST AI attributes as already achieved in the window (**rule 5: label "realized"; never merged with potential tiles**) | `summary.totalSavings` (x-check `Σ items.downscaling + items.spot`, tolerance 1%) | USD per window | startTime–endTime (default trailing 30d) | `Σ` over included clusters; coverage `n_included/n_requested` mandatory next to every number | cluster fetch fails/404 ⇒ excluded + FetchError entry; empty window ⇒ `No-data` ≠ 0 | 2 default; 1-batch opt-in (§6) |
| Realized savings — downscaling | Node/bin-packing component | `Σ items[].downscalingSavings` | USD/window | same | same | `0` only when API returned true 0 | 2 / 1-batch |
| Realized savings — spot | Spot component. The ONLY sanctioned spot-savings number | `Σ items[].spotSavings` | USD/window | same | same | as above | 2 / 1-batch |
| Realized savings % (primary) | Share of the pre-optimization baseline | `totalSavings / (totalCost + totalSavings)` — **baseline framing; assumption:** `totalCost` is post-savings actual spend ⇒ pre-optimization baseline = sum. Validate on first live response (§8); fallback publish both framings | % | window | enterprise: `Σ totalSavings / Σ (totalCost + totalSavings)` (ratio of sums) | denominator 0/NA ⇒ NA | 2 / 1-batch |
| Realized savings % (secondary, optional) | Share of actual spend | `totalSavings / totalCost` | % | window | ratio of sums | as above | 2 (diagnostic) |
| Actual spend (realized window) | What was actually paid | `summary.totalCost` | USD/window | window | `Σ` | as above | 2 / 1-batch |

**Window-shaped warning:** `monthly_cost` (run-rate) and period numbers must
never appear in one equation. A "monthly-ized" realized view = realized ÷
window-hours × 730, labeled "annualized from trailing window", opt-in only.

---

## 4. Waste metrics

Re-verified today against the spec (Agent 2's doc absent; `api-matrix.md`
§3.3–3.5 credited).

| Display name | Definition | Source API + fields | Formula | Unit | Time range | Aggregation | Missing-data | Tier |
|---|---|---|---|---|---|---|---|---|
| CPU waste cost | Cost of provisioned-but-unused CPU in window (CAST AI definition) | `GET …/organization/clusters/efficiency` (per org, **cursor-paged**, windowed) → `items[].wasted.cpu` (**double, not string**) per `clusterId` | pass-through | USD/window | efficiency window (default trailing 30d) | `Σ` over present rows | cluster absent ⇒ `No-data` | 1 (new sweep call) |
| Memory waste cost | same for RAM | 〃 `wasted.ram` | 〃 | 〃 | 〃 | 〃 | 〃 | 1 |
| Storage waste cost | same for storage (PVC lifecycle) | 〃 `wasted.storage` | 〃 | 〃 | 〃 | 〃 | 〃 | 1 |
| Total waste cost | Sum over resource classes | derived | `wasted.cpu + wasted.ram + wasted.storage` (`min_count=1` per class — if API ever omits one class the total is NA, never silently re-based) | USD/window | 〃 | `Σ` | 〃 | 1 |
| Waste share | Waste ÷ window resource spend | `items[].cpuCost.cost`, `ramCost.cost`, `storageCost.cost` | `Σ waste_total / Σ (cpu+ram+storage cost)` pairwise | % | same window | ratio of sums | NA-safe | 1 |
| Org cross-checks | CAST AI's own aggregates (reconciliation only — derived values are the sliced truth, `data-model.md` §3 opening law) | `GET …/organization/efficiency/summary` → `totalWaste`, `cpuResources/ramResources{provisioned,requested,used,overprovisionedPercent}`, `storageResources{provisioned,claimed,requested}`, `cpuCost/ramCost/storageCost{…}` | drift > 5% vs derived ⇒ data-quality banner | — | same window | 1 call per org | banner, never silent | 1 (optional flag) |

**Availability statement (mission question):** both grains exist — org-level
(`efficiency/summary`, 1 call/org) and cluster-level (`clusters/efficiency`,
paged). Enterprise aggregate = Σ over paged per-org cluster rows (the sweep
already pays one paged call per org); the summary call is the cross-check,
not the source.

`overprovisionedPercent` denominators are spec-unspecified ⇒ validate against
`1 − used/provisioned` on live data before labeling (`data-model.md` §7.5).

---

## 5. Idle disks, ephemeral storage, namespace/workload cost

| Display name | Source API + fields | Formula / note | Unit | Tier | Blockers |
|---|---|---|---|---|---|
| Idle disk count / monthly cost / size | `GET /v1/cost-reports/idle-resources/disks` (cursor-paged) → `idleDisks[]{name, integrationId, cloud, region|zone, project, lastAttach, lastDetach, createdAt, type, status, storageSizeBytes, storageCostMonthly}` *("cost × size; excludes throughput/IOPS")* | `idle_disk_monthly_cost = Σ storageCostMonthly` (already USD/**month** — do NOT ×730); `Gib = Σ bytes/2³⁰` | USD/month, GiB | **1-batch, config-flagged** | **Org scoping UNSPECIFIED**: no `organizationId` param, no org field in `IdleDisk`. Enterprise-key behavior unknown until smoked: header-scoped per org (then per-org fan-out) or key-global (then single call). Integration-test before shipping (§8). Page failures ⇒ partial + coverage. |
| Ephemeral (node local) storage utilization | `GET …/clusters/{id}/nodes/storage` → `nodes[]{nodeName, allocatableBytes, usedBytes, requestedBytes, totalBytes}` | `storage_used_ratio = Σ used / Σ total` (bytes — **a utilization signal, NOT a cost**; never label it "$ waste") | ratio | 2 | — |
| Namespace cost | `POST …/clusters/{id}/namespace-cost-summaries` (**POST, read-semantics**) → `items[]{namespace, summary{totalCost, avgCost, avgDaily*Cost, total*Hours}}`, cursor-paged | per-namespace window cost table; sortable leaderboard | USD/window | 2 (allowed at drill-down) or behind the POST config flag | v1 GET-only default posture (`security-requirements.md`) |
| Workload cost | `GET …/clusters/{id}/workload-cost-summaries`, `…/workload-costs` (timed) → workload-grain `cost{OnDemand,Spot,SpotFallback}` series | per-workload window cost | USD/window | 2 | — |
| Workload/namespace wasted cost ties | `GET …/clusters/{id}/workload-efficiency` → `waste{cpu, memoryGib}`, `costImpact{…}`, `noDataReason` | workload-level waste drill | USD/window | 2 | `noDataReason` drives `No-data` |

---

## 6. Realized-savings enterprise batch (Tier 1-batch) — RECOMMENDATION

**Problem.** Enterprise realized savings is per-cluster-only; the mandatory
two-stage rule forbids per-cluster fan-out at page load (241 clusters × k
calls; naive = `performance.md` §1.4 "unusable").

**Recommended design.** Realized savings default = **Tier-2 drill-down**
(already spec'd). v2 ADDS an explicit user-triggered **bounded batch** over
the *current filtered set*:

1. **Entry point:** savings-tab button "Compute realized savings for the
   N filtered clusters" (N = filtered count, shown on the button). Never
   auto-fired by page load, widget rerun, or sort.
2. **Bounds:** `realized_batch_max` default 100, hard ceiling = filtered set
   (≤ 241 fleet-wide). Over-limit sets require the user to narrow filters or
   confirm "run all 241" (one extra confirm dialog, logged).
3. **Concurrency 8** (`performance.md` default; reuse the sweep's
   ThreadPoolExecutor + backoff-with-jitter; per-call circuit breaker).
4. **Progress & cancellability:** `n/241 done`, ETA from running average;
   cancel button kills remaining futures; partial results stay visible.
5. **Cache:** `st.cache_data(ttl=900)` keyed
   `(organization_id, cluster_id, startTime, endTime, useListingPrices)` —
   re-runs and filter shuffles hit cache; the 15-min TTL is the refresh
   floor even for manual re-clicks.
6. **Pre-filter:** skip `reporting_state = DISCONNECTED` and clusters with
   `No-data` overview rows (uniform sentinel). Optional pre-flight via
   `POST …/cost-reports/clusters/active` behind the existing
   read-semantics-POST config flag (`data-model.md` §0 / §7.13).
7. **Failures:** per-cluster errors ⇒ FetchError list + exclusion from sums;
   every rendered aggregate shows "realized over **n of m** clusters". A
   failed cluster contributes nothing — never 0.

**Call-count math** (1 call per cluster; p50 ≈ 0.3 s, waves = ⌈N/8⌉):

| Batch N | Calls | Sequential floor | 8 workers ideal | Realistic (p95 + 1 retry wave) |
|---|---|---|---|---|
| 25 | 25 | ~7.5 s | ~1.2 s | ≤ 4 s |
| 50 | 50 | ~15 s | ~2.1 s | ≤ 6 s |
| 100 | 100 | ~30 s | ~3.9 s | ≤ 10 s |
| 241 | 241 | ~72 s | ~9.3 s | 15–45 s |

⇒ Batch ≤ 100 feels interactive; the 241 "run all" needs the progress bar +
background script mode. Cached re-runs are ~0 calls (only expired entries
refetch).

**Rejected alternatives:** page-load fan-out (violates the two-stage rule);
worker/scheduler pre-aggregation (v2 scope: no new infra); using
`cost-comparison` as a "realized" proxy (modeled impact, mislabeled-class
violation of rule 5); discovering an org-level realized endpoint (none
exists — verified).

---

## 7. Allocation groups (business attribution) — feasibility

**Feasible.** `GET /v1/cost-reports/allocation-groups` lists user-defined
groups; `GET /v1/cost-reports/allocation-group-summaries` (per org, windowed)
returns `items[]{groupName, groupId, summary{totalCostOnDemand/Spot/
SpotFallback, cpuCost, ramCost, gpuCost, tpuCost, cpuCount, ramGib,
workloadCount, requestedCpuHours, requestedRamGibHours,
requestedStorageGibHours}, versions[]}`; `allocation-group-totals` adds the
timed series. Both accept `clusterIds[]` filters (crop to a fleet slice) and
`includeIdleResourceCosts` (fair-share idle node distribution — one mode per
run, labeled).

**Proposed view (optional, config-flagged `allocation_groups_enabled`):**
tab "Business attribution" — table grain `(organization_id, group_id)` from
existing `allocation_group_costs` (`data-model.md` §1.5a):
`group_name · org · period_cost (Σ3 lifecycles) · cpu_cost · ram_cost ·
workload_count · requested_cpu_hours`, window-labeled period totals
(**not** run-rates). Stacked bar org × group.

**Hard caveats:** (a) groups are user-defined — orgs without any render an
empty-state, not zeros; (b) **ungrouped-workload coverage unknown**
(`data-model.md` risk 12): whether an implicit row catches unassigned
workloads is unspecified ⇒ validate Σgroups vs org period cost on first live
run; until verified, banner "group totals may not cover the org" and never
reconcile silenced; (c) grain is group, **not** cluster — never join into the
master table; (d) label/metadata-label facets (`/v1/cost-reports/node-labels`,
`/v1/cost-reports/workload-labels`) are POST endpoints → POST-flagged or T2.

---

## 8. Enterprise top-row KPI formulas (all rule 4: ratio-of-sums, pairwise masks, coverage counts)

| KPI | Formula | Source | Caveat label |
|---|---|---|---|
| Monthly run rate | `Σ cost_hourly × 730` | clusters/summary | "run-rate, current snapshot" |
| Potential savings / mo (net) + pct | `Σ ps_raw × 730` ; `Σ ps_raw / Σ ov_costHourly` | overview, same-source pairwise | "estimated"; chip `n_negative`, secondary gross-positive tile |
| Realized savings (window) + pct | `Σ totalSavings` ; `Σ totalSavings / Σ (totalCost+totalSavings)` | batch §6 | "realized · trailing Nd · n/m clusters"; renders N/A path when batch never ran |
| Remaining opportunity | `= net potential` (alias, §1) | overview | "remaining = potential by definition (do not subtract realized)" |
| Total waste (window) | `Σ (wasted.cpu+ram+storage)` | clusters/efficiency | window label; cross-check `totalWaste`, drift banner |
| Cost change 7d / 30d | `(Σ_B − Σ_A)/Σ_A` period cost, pairwise on both windows | report or daily-cost | windows printed on tile |
| Spot-covered spend | `Σ spot_cost_hourly / Σ cost_hourly` | clusters/summary | spend mix, NOT spot savings |

Every tile: included-cluster count, missing count, window, bucket label
(estimated/realized/mix — mix must never occur).

---

## 9. Validation checklist (first live run) & test requirements

**Live validations (spec-unspecified):** baseline-vs-actual framing of
`summary.totalCost` in `/savings` (§3); `idle-resources/disks` enterprise-key
scoping (§5); allocation-group ungrouped coverage (§7);
`overprovisionedPercent` denominators; `clusters/report`
`summary.totalCost` "Average" basis vs `daily-cost` integration
(reconciliation tolerance 2%, else default flips to daily-cost);
`optimalCostHourly` behavior for READ_ONLY over-utilized clusters (negative
magnitude sanity vs v2.5dp rounding).

**Unit tests:** (1) negative `potential_savings_raw` flows unclamped through
normalizer → aggregators → CSV/export (fixture = the 10 baseline negatives);
(2) display string switches at 0 with raw keep; (3) realized + potential never
co-summed (assert separate KPI dicts, fuzz merge attempts); (4) realized pct
denominators NA-safe (0 cost, missing summary); (5) waste totals re-base to
NA if one class absent (never silent 0); (6) batch honors cap/concurrency/TTL
(mock client: assert ≤8 in flight, max 241 keys, cached rerun = 0 new calls);
(7) per-cluster batch failure ⇒ excluded + counted, KPI shows `n/m`;
(8) ratio-of-sums regression: no `mean()` of per-cluster pcts anywhere in
finops code (lint); (9) idle-disk `storageCostMonthly` NOT ×730;
(10) USD formatter: negatives, k/M compaction, tooltip full precision.
