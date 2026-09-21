# CAST AI Enterprise Dashboard — UX / UI Design Spec **v2**

**Owner:** Streamlit UX/Dashboard workstream
**Status:** Draft v2 — supersedes the v1 §6 "10 max KPI" cap and the ship-delta tab list; everything else in `docs/ux-design.md` remains normative unless restated here.
**Scale target:** ~126 orgs / **1,000 fleet rows** / ~10k nodes. Read-only posture unchanged (no mutation affordance ever).

Relationship to v1: single page with drill-down, `st.metric(border=True)`, `st.dataframe` (no AgGrid, no `st.data_editor`), emoji dual-coding, ≤25k rows per dataframe, **zero pandas Styler**, `help=` tooltips naming API source — all kept verbatim.

---

## 1. Rerun invariants v2 (normative)

| # | User action | API-call budget | Mechanism |
|---|---|---|---|
| I1–I5 | unchanged from ux-design.md §4 | unchanged | unchanged |
| **I6 (new)** | Page load, filter edit, sort, row selection, tab render | **enrichment batches: 0 calls — they never auto-fire** | Every batch result lives in `st.session_state["enrichment"]`; the only writer is an explicit button click inside the enrichment panel (§4). No loader in the main script path may call a batch loader. A code review must be able to grep `batch_` and find zero call sites outside §4 handlers. |

`⟳ Refresh` (I5) additionally **clears all enrichment** (stale windows) and bumps `refresh_token`. Changing the **date range** clears only the `realized` enrichment (windowed data); point-in-time batches (problems, autoscaler) survive.

---

## 2. KPI grid v2 — 3 grouped rows (replaces v1 §6 "10 max")

v1's 2×5 cap is lifted to **3 grouped rows (5 + 5 + 6 = 16 cards max, never a 4th row)**. Each row carries a small group caption (`st.caption` above the `st.columns`). Values derive from the *filtered* frame; the existing "filtered scope" caption and "N/A = …" legend stay.

### Row 1 — **Scale** (`st.columns(5)`)

| Card | value | delta | Cards degrade when |
|---|---|---|---|
| Organizations | `fmt_count` | none | — |
| Clusters | `fmt_count` | none | — |
| Nodes | `fmt_count` (unknown excluded) | none | — |
| vCPU provisioned | `%.0f` Σ | none | — |
| Memory provisioned | `fmt_gib` Σ | none | — |

### Row 2 — **FinOps** (`st.columns(5)`)

| Card | value | delta / color rule | Degrade rule |
|---|---|---|---|
| Monthly cost | `fmt_money_compact` (run-rate, labeled) | prev-period % when range ≥ 2× span, `inverse` | — |
| Potential savings / mo | `fmt_money_compact` over clusters where `has_positive_savings_opportunity` is true | delta `"n of m clusters with opportunity"`, `normal` (green) when n>0; when n=0: value `"No savings opportunity"`, `delta_color="off"`, **raw Σ (incl. negatives) shown only in `help=` tooltip** | — |
| **Realized savings (window)** | `fmt_money_compact` of session enrichment Σ | caption `"k/N clusters computed"` | **Pre-batch:** `value="N/A"`, `delta="run 'Compute realized savings'"`, `delta_color="off"`, help names §4 button |
| Total waste | `fmt_money_compact` (org `efficiency/summary`, window) | none | `value="N/A"` unless env flag `CASTAI_T1_EFFICIENCY=1`; help says so |
| Spot coverage | `%` weighted Σspot/Σnodes | none | pairwise-complete mask (v1 rule) |

### Row 3 — **Efficiency · Health · Data quality** (`st.columns(6)`)

| Card | value | delta / color | Degrade rule |
|---|---|---|---|
| CPU efficiency | `%` (ratio-of-sums) | vs 60% target caption | — |
| Memory efficiency | `%` | vs 60% target caption | — |
| **WA coverage (real)** | `%` workloads managed / total (from §4 autoscaler batch) | none | pre-batch: `value="N/A"`, delta `"run 'Resolve autoscaler status'"`, `off` |
| Clusters needing attention | count (critical notifications >0 ∨ OOM >0 ∨ unsched pods >0 ∨ Disconnected ∨ stale >60m) | delta lists composition `"🔴 a · 🟡 b · ⚫ c"`, `inverse` | notifications/OOM terms drop silently off the count when those flags are off; card footer names active sources |
| OOM kills (window) | count (org events query, optional Tier-1 flag) | `inverse` when >0 | `N/A` unless flag on |
| Data completeness | mean `data_completeness_pct` | delta `"oldest sync Xh ago"`, `normal` | `N/A` if column absent |

**Negative-savings rule (global):** green is rendered **only** for `has_positive_savings_opportunity`. Raw negative values never get green, never get clamped to 0 in math, and appear as text/tooltip only (§3 cell rule). Savings taxonomy labels (estimated / realized / rightsizing / scheduling) are never mixed or summed — metrics.md §C.

---

## 3. Enterprise table v2 — grouped columns, picker, ~18 default

Grouping is documentation/order-level (single header row; `st.dataframe` has no grouped headers). The **column picker** (`st.multiselect`, key `fleet_visible_cols`, options labeled `"Group · Column…"`) toggles non-identity columns; identity columns (`organization_name`, `cluster_name`, pinned) cannot be hidden. Picker renders in the table toolbar row beside the CSV button. Picker edits are pure pandas — **0 API calls (I1)**.

| Group | Columns (df keys) |
|---|---|
| Identity | `health` 🟢/🟡/🔴/⚫/⚪ chip · `organization_name`* · `cluster_name`* |
| Status & Freshness | `provider` · `region` · `status` · `agent_status` · `data_age` |
| CPU | `cpu_efficiency` (ProgressColumn) · `cpu_provisioned`† · `cpu_requested`† |
| Memory | `memory_efficiency` (Progress) · `memory_provisioned_gib`† · `memory_requested_gib`† |
| Nodes | `nodes_total` · `nodes_spot` · `nodes_unknown`† |
| FinOps | `monthly_cost` · `potential_savings_display` · `realized_savings_display`† · `report_period_cost`† · `report_cost_pct_change`† |
| Autoscaling | `workload_autoscaler_status` chip · `na_status` chip |
| Health | `problematic_display` · `unschedulable_pods`† · `oom_kills`† · `notifications_critical`† |
| Data quality | `data_completeness_pct` · `data_status`† · `reporting_state`† |

`* pinned/always visible. † hidden by default (picker toggle).`

**Default-visible = 18:** `health, organization_name, cluster_name, provider, region, status, agent_status, data_age, cpu_efficiency, memory_efficiency, nodes_total, nodes_spot, monthly_cost, potential_savings_display, workload_autoscaler_status, na_status, problematic_display, data_completeness_pct`.

Cell-render contract:

- **`data_age`** (TextColumn, pre-rendered): `<15m` → `"🟢 12m"`; 15–60 → `"🟡 47m"`; `>60m` → `"🔴 3h"`; unknown → `"⚪ n/a"`. Hidden numeric `data_age_minutes` stays in the frame for sort-sensitive users (picker option "Freshness · raw minutes").
- **Negative savings (`potential_savings_display`, TextColumn, pre-rendered; raw numeric `potential_savings` hidden-but-exportable):** positive → `"🟢 $1.2K"`; zero / `has_positive_savings_opportunity == false` → `"No savings opportunity"`; negative → `"🔻 −$1.2K (cost increase)"` — **red-neutral triangle (🔻), never the 🔴 error family, never green**; NA → `"—"`. Sort note: add picker option "FinOps · Savings/mo (numeric)" exposing the raw column for numeric sort (sort-correctness rule unchanged).
- **Health counts ("T2"-free; `problematic_display`, TextColumn):** pre-batch every cell = `"n/a — load"` (replaces the v1 `"T2"` badge); post-batch = integer string. Hidden numeric `problematic_nodes` / `problematic_workloads` available via picker for numeric sort post-batch. The string "T2" is forbidden anywhere in v2 rendering.
- **NA/WA chips (TextColumn):** WA: `🟢 running / ⚫ not installed / ⚪ unknown` (Tier-1, as v1). NA (`na_status`): `"n/a — load"` pre-batch; post-batch `🟢 enabled / ⚫ disabled / ⚪ unknown` from `policies.enabled`. Legend: blank numeric elsewhere keeps sentinel semantics (`unknown ≠ 0`, data-model §5).

CSV export includes **raw numeric columns** (negative savings raw, counts) — the display strings are presentation-only, so the export stays auditable.

---

## 4. Opt-in batch controls UX (enrichment panel; invariant I6)

Placement: `st.expander("On-demand enrichment — batched per-cluster API calls", expanded=False)` directly above the fleet table. All batches run over the **current filtered scope**, so the label itself teaches users to narrow filters first.

```
[ On-demand enrichment — batched per-cluster API calls ]  ▾
   Scope: 57 of 1,000 clusters (filtered)
   [ Compute realized savings for 57 filtered clusters (~57 calls · est ~20–40 s) ]
   [ Load problematic counts for 57 filtered clusters (~171 calls · est ~60–120 s) ]
   [ Resolve autoscaler status for 57 filtered clusters (~114 calls · est ~40–80 s) ]
   Status: realized ✓ 57/57 (2 failed) · problems — not loaded · autoscaler — not loaded
```

Interaction contract (identical for all three):

1. Button label carries the **live estimate**: `n` = current filtered row count; call estimate = n × calls-per-cluster (1 / 3 / 2 respectively); time from `max_workers`. Disabled while `st.session_state["enrichment_running"]` is set.
2. Click → synchronous batch inside that rerun: per-cluster loader is `@st.cache_data(ttl=900)`-keyed `(cluster_id, start, end, refresh_token)` (realized) / `(cluster_id, refresh_token)` (point-in-time), executed via `ThreadPoolExecutor(max_workers)`; **futures complete in the main thread** and update `st.progress(done/total, text=f"Realized savings: {done}/{n} clusters")` — no session-state access from workers (v1 threading rule).
3. Merge semantics: results land **only** in `st.session_state["enrichment"][batch] = {cluster_id: {col: value}}`. The fleet sweep is **never re-run**; render path does `merged = merge_enrichment(filtered, st.session_state["enrichment"])` (pure pandas left join on `cluster_id`). Enrichment columns (`realized_savings_display`, `problematic_display`, `na_status`, WA coverage inputs) exist from first paint, pre-filled `"—"` / `"n/a — load"`, and **appear in place** once the batch row lands. Per-cluster failures leave `"—"` and aggregate into one caption (`"2 of 57 failed — retry by re-clicking"`), never raise.
4. Cache writing = the stored session dict (above); re-clicking the same batch within TTL costs **0 calls** (per-cluster cache hit) and just re-merges. I5 Refresh and (realized-only) date-range change clear the corresponding dicts.
5. KPI cards in §2 read the same session dict, so one batch updates the card and the table in the same rerun — one funnel, no drift (v1 §4 rule extended).

---

## 5. Drill-down v2 — 11 tabs

Same mechanics as v1 §5: `st.tabs` is not lazy; Tier-1 auto-loads on selection (I2); Tier-2 renders a `Load <tab> data` button until `st.session_state[f"tab_armed_{cluster_id}_{tab}"]` is set (flags reset on selection change; I3/I4 unchanged). Header unchanged. (`st.segmented_control` remains an allowed substitution — v1 §3.)

| # | Tab | Tier | Widgets (render order) | Expected service payload (logical loader; cache key adds `cluster_id`, `refresh_token`) |
|---|---|---|---|---|
| 1 | Overview | T1 | v1 6 metrics + data-completeness chip + data-age caption + metadata caption | `load_cluster_overview` → `{available, data{...}, errors}` |
| 2 | Resources | T1 | v1 summary + usage | `load_cluster_resources` → `{summary, usage, errors}` |
| 3 | Cost | T2 | v1 trend + scalar summary (+ namespace top-10 bar when payload carries it) | `load_cluster_cost(org, cluster, start, end)` → `{data{...}}` |
| 4 | Savings | T2 | 3 metrics (estimated, realized, rightsizing — separate sections, never summed); **negative callout**: `st.warning("…increase, not savings…")` when any window raw value < 0; Plotly line when history series present | `load_cluster_savings` → `{estimated{...}, realized{summary{totalSavings,totalCost}, items[]}, rightsizing{...}, history?{items[{timestamp, optimized...}]}, errors}` |
| 5 | Workload Autoscaler | T2 | coverage metrics (managed workloads, % of total, policies in use); workloads table ≤100 rows (namespace, name, kind, policy, CPU req→rec, mem req→rec, status) | `load_cluster_wa` → `{wa_summary{managed,total,...}, workloads{items[...]}, node_autoscaler?}` |
| 6 | Node Autoscaler | T2 | 5 bool metrics (`enabled`, unsched-pods, spot, downscaler, scoped mode — from v1 WA tab) + limits scalar table | `load_cluster_na_policies` → `{policies{enabled, spotInstances{...}, nodeDownscaler{...}, clusterLimits{...}}}` (1 GET, `…/policies`) |
| 7 | Nodes | T2 | **state chips row** ("🟢 41 ready · 🟡 2 pending · 🔴 1 failed") above v1 paginated table | `load_cluster_nodes` → nodes df incl. `node_state_phase`, `lifecycle` |
| 8 | Workloads (cost) | T2 | cost-by-workload table (namespace, workload, kind, cost window, req vs rec cost) — reads WA/cost payloads; `available:false` state when endpoint absent | `load_cluster_workload_cost` → `{items[{namespace,name,kind,cost,requested,recommended}]}`, **depends: exact cost field per api-matrix §8** |
| 9 | Issues | T2 | merged severity feed (§6) | `load_cluster_issues` → `{problematic_*, unscheduled_pods, agent_components}` **+ warnings** `notifications(clusterId)` **+ OOM events** |
| 10 | History | T2 | 4 stacked mini-charts: daily cost; estimated-savings history (`current` vs optimized series); node-count history; spot share when series present. Missing series → per-chart `st.info`, siblings unaffected | `load_cluster_history` → `{cost_daily?[ts,value], savings_history?{...}, node_count_history?[ts,count], spot_history?[ts,share]}` (2–4 GETs, `node-count-history`, `estimated-savings-history`, cost range) |
| 11 | Data Quality | **no arm — 0 calls** | completeness breakdown (per-source bars), endpoint status table from fleet_row `data_status`/`data_sources`/loader `errors`, snapshot timestamps, sentinel legend (§7) | none — renders from the fleet row + `FleetResult` metadata already in memory; must make **zero** API calls (asserted by tests) |

`_TAB_IDS` becomes `("cost","savings","wa","na","nodes","workloads","issues","history")`; Overview/Resources stay Tier-1; Data Quality needs no flag.

---

## 6. Issues / needs-attention UX

**Fleet quick-filter chips** (above the table, under filters): `st.pills("Needs attention", selection_mode="multi", key="flt_attention")` with options `🔴 Critical alerts` · `🟡 OOM kills` · `🟠 Unscheduled pods` · `⚫ Disconnected` · `🐢 Stale data (>60m)` · `💰 Negative savings`. Each chip is a prebuilt mask inside `apply_filters` (pure pandas → I1-safe); options whose source flag is off render disabled with help text.

**Drill-down Issues tab — merged feed**, severity-ordered (critical notifications first, then problematic nodes, problematic workloads, unscheduled pods, OOM events, agent-component failures). One `st.dataframe` (≤100 rows, `hide_index`), columns: `severity` (emoji) · `resource` (cluster / node / workload) · `reason` · `namespace` (— when n/a) · `time (UTC)` · `source`. Hidden `severity_rank` drives the sort: critical-family (🔴) → warning (🟡) → disconnected (⚫) → info (⚪). Canonical line example: **`🔴 prod-eu-1 / payments · OOMKilled · pod api-7d9f · billing · 2026-09-21 14:03 UTC`**. Severity header chips above the feed: `🔴 n critical · 🟡 n warnings · ⚫ n down`.

---

## 7. Data Quality view (fleet level)

`st.expander("Data quality", expanded=False)` between charts and the fleet table; pure pandas over the fleet frame — **0 API calls**.

1. **Completeness distribution:** Plotly bar of `data_completeness_pct` in fixed bins (0–50 / 50–80 / 80–95 / 95–100), counts per bin; caption `"mean X% · n clusters <80%"`.
2. **Stale-cluster list:** `st.dataframe` (top 50): org, cluster, `data_age`, `data_status`, `reporting_state` — sorted by `data_age_minutes` desc.
3. **"unknown ≠ 0" legend block:** static `st.markdown` table restating data-model §5 sentinels (0 = measured zero · NA = absent · No-data · Disconnected · Unknown · Not installed · Org error) plus the v2 strings (`n/a — load`, `No savings opportunity`, `−$X (cost increase)`). Legend text is the single source UX copy for these sentinels; it also ships in the drill-down Data Quality tab.

---

## 8. Multi-page revisited — **stay single-page (confirmed)**

v2 adds History, Data Quality, richer Issues — none changes the rerun math, so the v1 decision stands:

- **Every new surface rides existing rails:** tabs use the established tab-arming gates; the Data Quality tab and fleet Data Quality block are pure pandas over already-cached frames (0 calls); enrichment batches are click-gated (I6). A page switch in `st.navigation` still fully re-executes the destination script and re-derives the filtered frame from cache — **zero rerun savings**, while filter/selection state would have to be mirrored across pages through session_state (the v1 bug surface argument, now × 3 more views).
- The growing content is absorbed by *depth* (armed tabs, collapsed expanders, column picker), not by pages: default paint adds only the collapsed enrichment panel + collapsed data-quality expander.
- **Threshold to revisit:** a genuinely independent concern — e.g. a cross-fleet "Issues explorer" with its own notification-heavy loaders and no need for the fleet filter bar — may become `pages/02_Issues.py` (the `pages/` dir already exists). Fragment-scoped drill-down content must not move there.

---

## 9. Ship delta (v2)

1. KPI cap lifted 10 → **16 in 3 grouped rows** (Scale / FinOps / Efficiency·Health·Data quality); group captions added; "no 3rd row ever" rule replaced by "no 4th row ever".
2. New invariant **I6** (enrichment batches never auto-fire); Refresh clears enrichment; date-range change clears realized-only.
3. Fleet table: column picker + 18 default columns; `"T2"` badge removed everywhere → `"n/a — load"` / numeric counts; `data_age`, `data_completeness_pct`, negative-savings display cells added.
4. `has_positive_savings_opportunity` gates all green savings rendering; negatives render as `🔻 −$X (cost increase)` / `"No savings opportunity"`; raw values only in tooltips + CSV.
5. Drill-down grows 7 → **11 tabs** (Node Autoscaler, Workloads, History, Data Quality new); Data Quality tab is the only zero-call tab.
6. `st.pills` needs-attention quick-filter row added (Streamlit ≥1.40 — pin floor moves: `streamlit>=1.40,<2`).
7. Notifications + OOM feeds behind existing optional Tier-1 env flags; cards degrade to N/A otherwise.
