# CAST AI Enterprise Dashboard — Architecture (FINAL, reconciled)

Lead-architect decision record after reconciling the six research workstreams
(docs/api-matrix.md, docs/enterprise-hierarchy.md, docs/data-model.md,
docs/ux-design.md, docs/performance.md, docs/security-requirements.md).
Status: APPROVED for implementation. Deviations from the original brief are
listed in §9 and are intentional.

## 1. Goal & scale

One read-only Streamlit dashboard across the whole CAST AI Enterprise:
Enterprise root -> N child organizations -> all clusters, in ONE table.
Verified live on 2026-09-21 against `https://api.eu.cast.ai` with a read-only
Enterprise key: 129 orgs (1 ENTERPRISE root, ~125 CHILD, 3 DEFAULT).
Design target: ~130 orgs / ~1,000 clusters / ~10,000 nodes. READ-ONLY: GET +
whitelisted read-semantics POST query endpoints only.

## 2. System shape

```
 CAST AI Enterprise key (env CASTAI_API_KEY, CASTAI_BASE_URL)
        |
        v
 config/settings.py  (env-first, st.secrets local fallback, https regional
        |             allow-list, fail-closed, single key accessor)
        v
 services/castai_client.py  (ONE httpx sync client; GET-only transport +
        |                   ALLOWED_READ_POST_PATHS; X-API-Key +
        |                   X-CastAi-Organization-Id per org; timeouts
        |                   5s/30s(60s historical); retry 429/5xx backoff+jitter,
        |                   NEVER retry 401/403; structured logs w/o secrets)
        v
 services/organization_service.py      services/cluster_service.py
   discover_enterprise_hierarchy()       build_fleet_dataframe()
   root resolve: CASTAI_ENTERPRISE_ID   ThreadPoolExecutor(8) org-bundle tasks;
   -> unique-ENTERPRISE heuristic       per-org failure isolated (FetchError)
        |                                       |
        v                                       v
 data/normalizers.py  (wire JSON -> typed rows; units: cores, GiB, USD/hr;
        |              proto3 string numerics parsed defensively; pd.NA)
        v
 data/aggregators.py  (ratio-of-sums KPIs, org rollups, weighted percentages)
        |
        v
 app.py (single page, layout="wide")
   filter bar -> KPI cards -> charts -> ENTERPRISE CLUSTER TABLE
   -> row-select drill-down (7 tabs; Tier-2 tabs button-armed)
 ui/{cards,charts,filters,tables}.py  +  st.fragment isolation
```

## 3. Two-tier retrieval (performance contract)

* **Tier 1 — page load (org-bundle fan-out, 8 workers, cache 15 min):**
  1. `GET /v1/organizations` (1 call, unpaginated)
  2. per org bundle (5 calls/org, joined on cluster_id):
     `external-clusters` (names/provider/region/status/agentStatus),
     `cost-reports/organization/clusters/summary` (one-row-per-cluster base:
     node counts, CPU/RAM prov/alloc/req/used, costHourly*, unschedulablePodCount),
     `cost-reports/organization/overview` (state, optimalCostHourly ->
     potential savings, sources/primarySource),
     `cost-reports/organization/clusters/report` (period cost for KPIs/charts),
     `workload-autoscaling/organizations/{orgId}/components/workload-autoscaler`
     (all clusters' WA agent status in 1 call)
  Optional flags (env): `+notifications` (1/org page 1), `+efficiency/summary`
  (1/org, org waste cross-check), `+clusters/active` POST coverage oracle.
  Budget: 1 + 126 x 5 ≈ **631 calls, ~20–35 s cold @ 8 workers**; warm < 5 s.
  Shipped v1: the per-org `clusters/report` payloads are carried out on
  `FleetResult.reports`; the daily-cost trend is derived from them
  (`services.cost_service.trend_from_reports`) with ZERO additional calls.
  Tier-1 budget = 1 + 5×N.
* **Tier 2 — drill-down (lazy, per tab, cache 15 min):** Overview+Resources tabs
  auto-load on selection (~2 logical loaders, ≤7 GETs, cached); Cost, Savings,
  WA, Nodes, Issues tabs load only after their "Load" button arms
  `st.session_state[f"tab_armed_{cluster_id}_{tab}"]`. Per-tab endpoints per
  api-matrix §4–§8 (overview, resource-usage, cost, estimated-savings(+history),
  savings (realized), rightsizing-summary, workloads-summary(+workloads),
  nodes (paginated 500), problematic-nodes/workloads, unscheduled-pods,
  policies, agent-status, node-count-history, notifications filter.clusterId).
* **Runtime assertion:** Tier-1 calls ≤ 2 + 5×N_orgs (instrumented).

## 4. Concurrency / resilience

ThreadPoolExecutor, default `max_workers=8` (env `CASTAI_MAX_WORKERS` 4–16,
cap 32); task = one org bundle; per-org partial failure -> org rows marked
`data_status="unavailable"` + FetchError shown in UI warning banner —
NEVER abort the sweep; only `GET /v1/organizations` failure is fatal.
Timeouts connect 5 s / read 30 s (60 s history); 4 attempts, exp backoff
0.5×2^n + full jitter ≤15 s, honor Retry-After (clamp 1–30 s); circuit breaker
after 5 consecutive 429/5xx per org; module-level token bucket 20 req/s.

**v1 descope note (2026-09-21, final review):** the 20 req/s token bucket, the
429 adaptive halving, and the per-org circuit breaker named above are NOT
implemented in v1 — the fixed worker pool (default 8) + exponential backoff
honoring Retry-After suffice at this request rate; revisit if 429s are
observed. The timeout/retry statements above stand as shipped.

## 5. Data & metrics contract (docs/data-model.md + docs/metrics.md)

* Grain: `(organization_id, cluster_id)`; `organization_*` stamped from the
  REQUEST scope; composite key everywhere (cluster names NOT unique — verified).
* Canonical table = `cluster_service.FLEET_COLUMNS` (34 cols, skeleton frozen)
  + `data.normalizers.EXTRA_COLUMNS` (7 aux cols appended after FLEET_COLUMNS:
  `reporting_state`, `optimal_cost_hourly`, `is_phase2`, `pod_count`,
  `nodes_unknown`, `potential_savings`, and the new `overview_cost_hourly`
  from overview `clusters[].costHourly`) (aux count superseded 2026-09-21 —
  see ADR v2)
  + `REPORT_EXTRA_COLUMNS` (2 report cols: `report_period_cost`,
  `report_cost_pct_change`) — 43 cols total (shipped v1, computed 2026-09-21).
  **v2 reality (ADR v2 R5/R6/R8, shipped 2026-09-21): 70 cols total =
  34 FLEET (with the R8 renames `cpu_efficiency`→`cpu_utilization_pct`,
  `memory_efficiency`→`memory_utilization_pct`) + 34 EXTRA (the 7 v1 aux above
  + 27 v2 cols in the request-efficiency, NA-coverage, storage, waste,
  WA-display, agent-health, freshness, ghost-quarantine, savings-polarity,
  and k8s-version families) + 2 REPORT.** Full contract:
  `docs/data-model.md` §2 "Shipped v2 column contract".
* KPI formulas (ratio-of-sums, pairwise-complete masks, NEVER mean of %):
  cpu_util = Σused/Σallocatable; ram_util likewise;
  potential_savings_pct = Σ(cost−optimal)/Σcost; spot_coverage = Σspot/Σnodes;
  monthly_cost = ΣcostHourly×730 (run-rate, labeled) vs `report` period cost
  (labeled actual); WA coverage = Σ(WA healthy)/Σclusters (agent statuses).
* Savings taxonomy never mixed: estimated (estimated-savings), realized
  (clusters/{id}/savings, per-cluster/Tier-2 only), rightsizing
  (workloads-summary/rightsizing-summary), scheduling (optimalCostHourly).
* Sentinels: `0 ≠ pd.NA ≠ "No data" ≠ "Disconnected" ≠ "Unknown" ≠ "Not
  installed" ≠ Tier-2 badge ("T2")`. Missing never becomes 0 in KPIs
  (pairwise mask); org failures live in an org_health dataframe.

## 6. UX contract (docs/ux-design.md)

Single page, wide layout, no sidebar; deep-link via st.query_params.
Filter bar (org/cluster/provider/region/status/agent status/WA status/search +
date range) → 2×5 st.metric(border=True) KPI cards → charts (cost-by-org bar,
current-vs-optimal, daily trend from report) → master table with
`st.dataframe(on_select="rerun", selection_mode="single-row")` selecting
(org_id, cluster_id) → drill-down tabs. Rerun invariants:
I1 table interactions 0 API calls; I2 selection = 2 cached loaders;
I3 Tier-2 arms = exactly the tab's calls; I4 filter edits 0 calls;
I5 Refresh button = sole cache-invalidation path (refresh_token arg).
≤25k rows/dataframe; no Styler >1k rows; emoji status pills; N/A rendering
per sentinels; "Last refreshed" timestamp always visible.

## 7. Caching

`@st.cache_data(ttl=…)` on data functions only; keys =
(base_url, enterprise_id, date_range, flags) — NEVER the API key (pickling
stores it); client built inside cached functions from config. TTLs: inventory
15 min; org cost/report 30 min; cluster detail bundle 15 min; nodes 10 min;
history 6 h. Manual "Refresh data" → bump refresh_token (scoped invalidation).

## 8. Security contract (docs/security-requirements.md)

Env-first config (CASTAI_API_KEY / CASTAI_BASE_URL / CASTAI_ENTERPRISE_ID /
CASTAI_MAX_WORKERS / feature flags), st.secrets local-only fallback;
base-URL https + regional allow-list (api.cast.ai / api.eu.cast.ai /
api.in.cast.ai configurable, allow-listed); settings fail closed (ConfigError).
GET-only client + ALLOWED_READ_POST_PATHS constant (cost-report query POSTs);
no header logging; redaction helper; unsafe_allow_html forbidden; key never in
logs/UI/cache keys/session_state; pinned requirements; startup scope self-check
= GET /v1/organizations with generic error surfaces.

## 9. Deviations from the original brief (intentional)

1. Single-page app instead of pages/01..05 — multipage loses filter/selection
   state per UX evidence; pages/ directory kept for a future trends page.
2. Allocation-group endpoints NOT used for the master table (wrong grain) —
   per-org fan-out with 5 calls/org instead.
3. Enterprise billing endpoints NOT a money source (feature usage only).
4. Node-autoscaler status & problematic-node/workload counts are Tier-2-only;
   fleet table shows "T2" badges, never fan-out-fetched or fabricated values.
5. Enterprise "Realized Savings" KPI renders as N/A at Tier-1 (only per-cluster
   source exists); realized savings appear in cluster drill-down.
6. Default date window for report-based KPIs/charts: last 30 days, selectable.

## 10. Acceptance criteria

Cold overview < 60 s (p95) @ 126 orgs; warm < 5 s; drill-down tab < 10 s cold /
< 2 s warm; table interaction < 1 s with 0 API calls; Tier-1 ≤ 2+5N asserted;
429 rate < 1 %; one failing org never blanks the dashboard; no metric without a
documented source (metrics.md); pytest green without real credentials;
security checklist 27/27 PASS before release.

Measured (first live run, 2026-09-21): fleet trend derivation adds 0 calls
(FleetResult.reports reuse); cold sweep measured ~80 s at 126 orgs.

---

## ARCHITECTURE DECISION RECORD v2 (2026-09-21, phase 2 — Fleet Intelligence)

Basis: 10 phase-2 research agents (docs/current-data-audit.md, api-delta-v2.md, enterprise-v2-refresh.md, finops-model.md, resource-metrics.md, autoscaler-model.md, reliability-model.md, historical-model.md, ux-v2.md, performance-v2.md). v1 ADR above still applies; this section supersedes where it conflicts.

**R1 — Cost bases:** every metric remains same-source pairwise. `potential_savings*` ↔ organization/overview pair (costHourly−optimalCostHourly; pct denominator = `overview_cost_hourly`); `monthly_cost` = clusters/summary run-rate ×730 (labeled). Export ships `overview_cost_hourly` (43 cols) so all percentages are reproducible from the CSV.
**R2 — Waste joins Tier-1:** `/organization/clusters/efficiency` becomes the 6th per-org call (default ON; `totalWaste` cross-check vs `/organization/efficiency/summary` in drill-down; >5% drift banner). Notifications and org OOM totals stay flag-gated OFF. Budget 1+6N (≈757 @126 orgs); default workers 12 to hold ~80–90 s cold.
**R3 — Enrichment batches (invariant I6: never auto-fire):** generic runner `services/enrichment_service.run_enrichment(kind, …)`, caps {realized: 100 clusters, na_policies/health/wa_coverage: 400; ≤800 calls/run}, concurrency 8, 15-min cache, session-merge `enr_<kind>_*` columns, `ValueError` refusal over cap. Kinds: realized ($/cluster savings), na_policies, wa_coverage (RUNNING-only scoping), health (node-phase classification + problematic counts/reasons, online-only — kills all three `T2` placeholders), spot_trend (org efficiency series, +1 call/org).
**R4 — History:** cost windows/change/top-movers from `FleetResult.reports` at **+0 calls**; per-cluster node-count/estimated-savings/cost histories Tier-2 (6 h TTL); fleet spot-adoption trend = spot_trend batch (+57 org calls); “coverage growing?” is not answerable from any endpoint → local daily snapshot persistence.
**R5 — P0 correctness pack (from audit/reliability/enterprise/research):** fix `_pod_count` (spec: array; code: int() → always None); `FetchError.kind` (= exception class) at all raise sites + health-banner distinct-org rollup (“Permission denied” vs “Temporarily unavailable” vs “Partial data”; never suppressed while errors exist); central pct formatter (0–1 vs 0–100 — `report_cost_pct_change` is 0–100!); k8s version normalized major.minor + coverage labeling (state-biased: OPTIMIZED 100% vs READ_ONLY 5%); 4 UNSPECIFIED ghost-rows quarantined from filters/KPIs; storage trap: wire `storageRequested` ships as `storage_active_claimed_gib`; `has_positive_savings_opportunity` + display fields; negatives never clamped (net headline + gross/headroom companions).
**R6 — Autoscaler:** `na_managed_nodes`/`na_coverage_pct` from summary `nodeCount*Castai` at **+0 calls**; `na_enabled` via `na_policies` batch; WA enum is exactly {INVALID, UNKNOWN, RUNNING} — display mapping {Running, Installed (status unknown), Unknown, Invalid, Not installed, NA} (+version-drift, in-place-resize, last-reported columns from the same org payload); per-workload “used” does not exist → N/A.
**R7 — Reliability:** node states = client-side classification of nodes `state.phase` (enum: unknown|pending|creating|ready|not_ready|draining|deleting|deleted|interrupted|cordoned; cordoned = phase ∨ unschedulable; >500-node clusters paginate with cap); org-level OOM has NO clusterId → fleet totals only (flag), per-cluster OOM Tier-2; `agent_health` derived Tier-1 (+0 calls); notifications 3×limit=1 count reads/org.
**R8 — Metric renames (Agent 5):** `cpu_efficiency`→`cpu_utilization_pct`, `memory_efficiency`→`memory_utilization_pct` (store 0–1, render %); NEW `cpu_request_efficiency_pct`, `memory_request_efficiency_pct` (used/requested, requested>0 mask); waste/spend/savings are three lenses — never summed.
**R9 — Rate limiting:** 429-reactive permit gate at the `CastAIClient._request` chokepoint (halve to floor 2, 60 s cooldown, +1/clean-60s). Token bucket & circuit breaker remain descoped.
**R10 — Pins/TTLs:** streamlit>=1.40,<2 (st.pills); notifications 5 min; batches/OOM 15 min; histories 6 h; drill-down loaders max_entries=128; CSV export cap 500 rows.

**Rejections:** realized-as-default-Tier-1 (per-cluster only, no org endpoint → batch); OOM per-cluster column at Tier-1 (impossible); token bucket/circuit breaker (premature); `potential − realized` “remaining” metric (rule-5 violation); namespace-cost-summaries POST at Tier-1 (read-only posture — Tier-2 flag only).

**ADR v2 amendments (final integration review, 2026-09-21):**
- **R2 correction:** the Tier-1 default worker count stayed **8** (the "12" line above was a proposal; measured 25 s cold @ 8 workers in the final review's live AppTest — no change needed). The efficiency-flag default ON ships via `config/settings.py:138` consumed in `cluster_service.py:296`.
- **R2 follow-up:** the org-level `totalWaste` cross-check + >5 % drift banner (`cost_service.waste_by_organization`/`waste_drift_flag`) is **wired in the drill-down** (org cross-check, 1 call/org cached) — see drill-down Cost tab; enterprise-wide banner descoped (cost: +2 calls/org).
- **R3 note:** `spot_trend` shipped as `history_service.spot_trend_from_org_efficiency` (opt-in expander, +1 call/org), NOT as an `enrichment_service` kind — it is org-level, not per-cluster.
- **R4 note:** local daily **coverage-snapshot persistence is descoped** for v2 (no endpoint for "coverage growing?" trends ships; zero fabricated data; future: local JSONL store).
- **R1 count line:** shipped fleet **70 columns** = 34 FLEET (2 renamed in place) + 34 EXTRA + 2 REPORT extras.
- **ADR v2 amendment R11 (OPS-VISIBILITY wave, 2026-09-22):** `/v1/rebalancing-schedules` joins Tier 1 as the **7th per-org call** (default ON, flag `CASTAI_ENABLE_REBALANCE_SCHEDULES`, carried org-level on `FleetResult.rebalance_schedules` — schedule↔cluster linkage is NOT row-resolvable so fleet `rebalance_*` cells stay NA), fleet gains the efficiency-item flat `overprovisioned_{cpu,ram,storage}_pct` trio (0–100 payload scale) + derived `nodes_provider_managed`, and the drill-down adds cached ttl-900 loaders for cluster `rebalancing-jobs` + latest-item overprovisioned ABSOLUTES.
