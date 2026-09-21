# CAST AI Enterprise Dashboard — UX / UI Design Spec

**Owner:** Streamlit UX/Dashboard workstream
**Audience:** Implementing agents (UI layer, services layer)
**Status:** Draft v1 — cross-check data claims against `docs/data-model.md` / `docs/api-matrix.md` when they land (they did not exist at authoring time; all dependencies below are annotated against `docs/openapi/castai-openapi.json`).

Scope reminder (from project brief): **read-only** Streamlit + Pandas + Plotly app, one centralized view across ALL child organizations (~120 orgs / ~1,000 clusters / ~10k nodes). No fabricated values; **"N/A"** wherever a metric has no reliable API source. No UI affordance may imply a mutation (no edit buttons, no apply/execute actions — aligned with AGENTS.md read-only posture).

---

## 1. Information architecture

### Recommendation: **ONE page with drill-down** (single script, `app.py`), NOT `st.navigation` multipage.

Justification, specific to Streamlit's rerun model at ~1k rows:

| Concern | Single page + fragments (RECOMMENDED) | Multipage (`st.navigation`, `pages/01..05`) |
|---|---|---|
| Rerun cost | Every widget interaction re-executes the script **once**, top to bottom; `@st.fragment` regions isolate the table and drill-down so row-selection/sort/tab-interactions do not re-render KPIs/charts. With all fetches behind `@st.cache_data`, a full rerun is just pandas filtering of a ~1k-row DataFrame — comfortably <100 ms. | Each page is a separate script that also fully re-executes on every interaction. **No rerun savings on a page switch** — the destination page renders from scratch, including re-deriving filtered data. |
| Shared filter state | Filter bar widget values are implicitly shared with everything below them on the same page. | Filters must be mirrored across pages through `st.session_state` hand-off; any filter edited on page A is invisible to page B unless explicitly plumbed. High bug surface × 10 filters. |
| Table/drill-down continuity | Row selection in the cluster table and the drill-down live on one screen: select a row → drill-down updates in place, scroll + selection state preserved. | Navigating to a detail page resets scroll, resets the table's selection widget state (unless persisted), and forces a "back" mental model foreign to ops dashboards. |
| URL addressability | Loses per-view URLs (mitigation: `st.query_params` for selected cluster + filters, spec'd in §4). | Gains `?page=` URLs — the one genuine advantage. Not worth it for a single-glance read-only ops view. |
| Complexity budget | One file (plus `components/` helpers), one data pipeline. | 5 pages × duplicated filter plumbing. |

The tabbed drill-down (§5) subsumes what pages 02–05 would have shown. If a second page is ever added, it should be an independent concern (e.g., a heavy "Issues explorer" across all orgs), not a fragment of the overview flow.

**Page config:** `st.set_page_config(page_title="CAST AI Enterprise Overview", page_icon="📊", layout="wide", initial_sidebar_state="collapsed")`. No sidebar in v1 — the top filter bar is the sole navigation surface; a collapsed sidebar remains available for a future debug/about panel.

---

## 2. Layout wireframe (overview page)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🟢 CAST AI Enterprise Overview                       Last refreshed: 14:32:07 UTC  [ ⟳ Refresh ]│
│   120 organizations · 1,000 clusters · data may be ≤15 min old                                 │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ FILTERS                                                                          [Reset filters]│
│ ┌─Organization ▾ (120)──┐┌─Cluster ▾──┐┌─Provider ▾┐┌─Region ▾─┐┌─Status ▾──┐                  │
│ └───────────────────────┘└────────────┘└───────────┘└──────────┘└───────────┘                 │
│ ┌─Automation ▾┐┌─WA status ▾┐┌─Node Autoscaler ▾┐┌─Date range [2026-08-24 → 2026-09-21]─┐      │
│ └─────────────┘└────────────┘└──────────────────┘└──────────────────────────────────────┘     │
│ [🔎 Search cluster name…                                          ]  ← substring, case-insens. │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ KPI ROW 1 (scale & money)                  ← @st.fragment, derived from filtered rows          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                              │
│ │Organiza- │ │ Clusters │ │  Nodes   │ │ Monthly  │ │Potential │                              │
│ │  tions   │ │          │ │          │ │  cost    │ │ savings  │                              │
│ │   120    │ │  1,000   │ │  10,214  │ │ $1.94M   │ │ $631K/mo │                              │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘                              │
│ KPI ROW 2 (quality)                                                                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                              │
│ │ Realized │ │CPU effic.│ │Mem effic.│ │Coverage  │ │Problem-  │                              │
│ │ savings  │ │          │ │          │ │spot · WA │ │ atic     │                              │
│ │ $402K/mo │ │   47%    │ │   39%    │ │ 62% · 41%│ │ 37 nodes │                              │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘                              │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CHARTS                                     ← @st.fragment                                      │
│ ┌ Monthly cost by organization (top 15 + Other) ──┐ ┌ Current vs optimized cost ────────────┐ │
│ │ org-a                ████████████████████  $412K│ │ ▓▓▓▓▓▓▓▓▓▓▓▓ Current      $1.94M       │ │
│ │ org-b           ██████████████  $287K           │ │ ░░░░░░░░░  Optimized   $1.31M        │ │
│ │ org-c        ███████████  $201K                 │ │                              −32% ▼   │ │
│ ⋮                                                 │ └───────────────────────────────────────┘ │
│ └─────────────────────────────────────────────────┘                                           │
│ ▸ Optional: Daily cost over selected range (collapsed expander, Plotly area, filtered scope)  │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CLUSTERS (1,000 of 1,000)                      ← @st.fragment            [⬇ Download CSV]      │
│ ┌─────────────────────────────────────────────────────────────────────────────────────────────┐│
│ │ Org            │ Cluster        │ Cloud │ Region │ Status │ Nodes │ CPU  │ Mem  │ …        ││
│ │ acme-eu        │ prod-eu-1  ▸   │ AWS   │ eu-w-1 │ 🟢 active│  412 │ ▓▓▓░░ │▓▓░░░ │ …        ││
│ │  (virtualized scroll, sortable headers, single-row selection, fixed height ~520px)         ││
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘│
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CLUSTER DRILL-DOWN      acme-eu / prod-eu-1        [ Jump to cluster ⌄ ] [ ✕ Clear selection ] ││
│ ← renders ONLY while a row is selected; each tab body is an @st.fragment                       │
│ ┌ Overview │ Resources │ Cost │ Savings │ Workload Autoscaler │ Nodes │ Issues ──────────────┐ │
│ │ (per-tab lazy loaders + skeleton placeholders — see §5)                                     │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
Footer: ⚠ 3 of 120 organizations failed to load — figures below exclude them [details ▸]
```

Vertical order rationale: filters → KPIs (what am I looking at?) → charts (where is the money?) → table (which clusters?) → drill-down (what about this one?). Max ~2 scrolls to the table on a 1440p window.

---

## 3. Component selection

### KPI cards — `st.metric` in `st.columns(5)` (NOT custom HTML)

- Built-in `st.metric(label, value, delta, delta_color, border=True)` gives consistent typography, tooltips via `help=…`, and accessible color semantics for free. Custom HTML cards (`st.markdown(unsafe_allow_html=True)`) were rejected: more code, reruns identically, no semantic gain, and HTML injection hygiene becomes the team's problem.
- `border=True` yields the card look. Two rows of five (10 cards max above the fold — hard cap, see §6).
- Delta policy (deltas only when a trustworthy comparison exists; otherwise no delta, never fabricated):

| Card | value format | delta | delta_color | depends on |
|---|---|---|---|---|
| Organizations | `%d` | none | — | `GET /v1/organizations` |
| Clusters | `%d` | none (or vs cached prior snapshot — optional) | normal | `GET /v1/kubernetes/external-clusters` (fanned out per org) |
| Total nodes | `%d` (sum, org-level rows only) | none | normal | cluster list `nodeCount`-style field — **depends on: node count on cluster-list/cluster-summary payload** |
| Monthly cost | `$%.2fM` (pre-formatted string) | prev-period % if date-range ≥ 2× prior span, else none | **inverse** | `GET /v1/cost-reports/organization/overview` (+ `daily-cost` for period deltas) |
| Potential savings | `$%dK`/mo (string) | none | off | `GET /v1/cost-reports/organization/cost-comparison` — **depends on: org-level "optimized/estimated" cost field** |
| Realized savings | `$%dK`/mo (string) | none | off | **depends on: org-level realized-savings field (uncertain — show "N/A" if absent in api-matrix)** |
| CPU efficiency | `%.0f%%` | vs 60% target caption | normal | `GET /v1/cost-reports/organization/efficiency` |
| Memory efficiency | `%.0f%%` | vs 60% target caption | normal | same |
| Coverage (spot · WA) | `"62% · 41%"` string | caption "spot vCPU · WA workloads" | off | **depends on: spot-usage field in org efficiency/overview; WA coverage from `GET /v1/workload-autoscaling/organizations/{orgId}/components/workload-autoscaler` (per-org fan-out — confirm cost)** |
| Problematic nodes | `%d` | clusters affected in caption | **inverse** (red when >0) | `GET /v1/kubernetes/clusters/{id}/problematic-nodes` is **per-cluster** — org-level source uncertain; **depends on: cluster-list status/problematic flags; else show "N/A"** |

### Table — `st.dataframe` (NOT `st.data_editor`, NOT AgGrid)

- `st.dataframe(df, use_container_width=True, height=520, hide_index=True, on_select="rerun", selection_mode="single-row", column_config={…})` — native row selection (Streamlit ≥1.35) turns the master table into the drill-down selector with zero extra widgets. Virtualized rendering handles 1,000+ rows; sorting/search of the viewport is client-side. **Verified caps (Performance workstream): keep every `st.dataframe` payload ≤ ~25k rows** (Arrow serialization ceiling; our worst case is the ~1k master table and ~500-row node tables — comfortably inside, but enforce in code with a guard that truncates + captions "showing first 25,000 rows") **and never wrap a frame >1k rows in a pandas `Styler`** (per-cell HTML generation dominates reruns; v1 uses **zero** Styler — status color is emoji dual-coding per §6, which also survives CSV export).
- `st.data_editor` rejected: this is a read-only app; editing affordances would violate the read-only posture even if disabled.
- AgGrid (`streamlit-aggrid`) rejected: adds a third-party pin, a custom serialization path at 1k rows × ~14 cols, theme drift from native Streamlit, and no capability we need that `st.dataframe` + `column_config` lacks. Revisit only if multi-row selection with checkboxes becomes a requirement.
- Export: `st.download_button("Download CSV", df.to_csv(index=False), …)` — satisfies auditability without AgGrid's toolbar.

### `column_config` proposal (cluster table)

| Column (df key) | Config | Notes |
|---|---|---|
| `organization` | `TextColumn("Organization", pinned=True)` | pinned left for wide scroll |
| `cluster_name` | `TextColumn("Cluster", pinned=True)` | name only; id lives in hidden df for lookups |
| `cloud_provider` | `TextColumn("Cloud")` | values mapped to `AWS`/`Azure`/`GCP`; **depends on: provider field on cluster payload** |
| `region` | `TextColumn("Region")` | — |
| `status` | `TextColumn("Status", validate=…)` | pre-rendered `🟢 active / 🟡 warning / 🔴 disconnected / ⚫ inactive` strings — emoji beats pandas-Styler coloring here (styling a 1k×14 Styler costs visible ms on every rerun; emoji are free, and survive CSV export). **depends on: cluster status enum mapping in data-model.md** |
| `automation_status` | `TextColumn("Automation")` | same emoji pattern (`🟢 enabled / ⚫ not enabled`) — **depends on: automation-onboarding flag source** |
| `wa_status` | `TextColumn("WA")` | 🟢/⚫ — **depends on: WA-status availability at list level; else per-org WA components call, else "N/A"** |
| `nas_status` | `TextColumn("Node AS")` | 🟢/⚫ — **depends on: node-autoscaler status at list level; else "N/A"** |
| `nodes` | `NumberColumn("Nodes", format="%d")` | numeric for correct sort |
| `vcpu` | `NumberColumn("vCPU", format="%d")` | — |
| `memory_gib` | `NumberColumn("Mem", format="%.0f GiB")` | store GiB numeric; unit in format string |
| `cpu_efficiency` | `ProgressColumn("CPU eff", format="%.0f%%", min_value=0, max_value=100)` | None → empty bar (reads as N/A) |
| `mem_efficiency` | `ProgressColumn("Mem eff", format="%.0f%%", min_value=0, max_value=100)` | — |
| `spot_coverage` | `ProgressColumn("Spot", format="%.0f%%", min_value=0, max_value=100)` | **depends on: spot share field at cluster-summary level** |
| `monthly_cost` | `NumberColumn("Cost/mo", format="$%d")` | raw numbers, compact only in KPI/chart labels |
| `potential_savings` | `NumberColumn("Savings/mo", format="$%d")` | **depends on: per-cluster estimated-savings at org-summary level; else drop column rather than per-cluster fan-out** |

Grade rule: **sort correctness > compact display** — table cells keep raw numerics; `$K/$M` shorthand is for KPI cards and chart annotations only.

### Tabs, fragments, caching, widgets

- **Tabs:** `st.tabs([...7 labels...])` — the mandated visual. **Verified caveat (Performance workstream): `st.tabs` is NOT lazy — every tab body executes on every rerun of its fragment/script**, so tab bodies must be treated as *always-running code*, not as lazy containers. Contract (details §4 invariants, §5 tiers): Tier-1 tabs (Overview, Resources) auto-fetch on explicit row selection; Tier-2 tabs (Cost, Savings, Workload Autoscaler, Nodes, Issues) render only a `Load <tab> data` button until clicked — the button sets a `st.session_state[f"tab_armed_{cluster_id}_{tab}"]` flag, and because the body re-executes on later reruns, the flag (not the button click itself) is what keeps the content rendered. Flags reset whenever `selected_cluster` changes. (Alternative noted for the implementer: `st.segmented_control` (≥1.40) + conditional bodies gives true lazy rendering and looks tab-adjacent; acceptable substitution, but the tier gates below remain the safety net either way.)
- **Fragments (`@st.fragment`, requires Streamlit ≥ 1.37):**
  - `fragment: cluster_table` — row selection/sorting reruns only the table + drill-down, not KPIs/charts.
  - `fragment: drilldown_overview` … per tab — tab interactions don't bounce the page.
  - KPI + charts are ordinary script body (they recompute from cached data in ms); fragmenting them is optional but harmless.
  - Fragment state contract: fragments communicate **only** through `st.session_state` (selected cluster tuple, filter widget keys) and cached function return values — never through returned UI values.
- **Caching:** every API call sits behind `@st.cache_data(ttl=900, show_spinner=False)` keyed by primitive args (`tuple(org_ids)`, `(start, end)` date range, `cluster_id`). 15-min TTL matches the "data may be ≤15 min old" caption. The 120-org fan-out runs **inside** one cached function using `concurrent.futures.ThreadPoolExecutor(max_workers=8)` (data-fetch only; no session-state access from threads). Spinners handled by a single `st.status("Syncing organizations…", expanded=False)` around the cold-load path; warm path renders instantly from cache with the `Last refreshed` timestamp from `st.session_state["fetched_at"]`.
- **Placeholders / skeletons:** each drill-down tab body starts from `st.empty()` placeholders (3 gray `st.markdown("▒ "*n)` blocks or a `st.spinner`) replaced when the tab's cached loader resolves; failures render the tab-local error state (§4) instead of crashing siblings.
- **Filter widgets:**
  - Organization: `st.multiselect` over ~120 names — multi-select composes with the table; collapse-when-selected keeps the bar compact; empty selection ≡ "all" (documented in help tooltip — avoids a confusing sentinel option).
  - Cluster: `st.multiselect` over ≤1,000 names qualified as `org / cluster`; acceptable when collapsed. If usage shows users hunting single clusters, the drill-down header `st.selectbox("Jump to cluster")` (typeahead) is the primary single-hop path.
  - Provider / Region / Status / Automation / WA / Node-AS: `st.multiselect` over small static domains (options derived from the loaded df, never hardcoded).
  - Date range: two `st.date_input` columns or single range input — applies to cost/savings KPIs, charts, and drill-down cost tabs only (cluster inventory is point-in-time); label explicitly: "Date range (cost & savings)".
  - Search: `st.text_input(placeholder="Search cluster name…")` → case-insensitive substring on `cluster_name`.

---

## 4. Interaction model

**Cluster selection (primary):** table row selection.
`event = st.dataframe(..., on_select="rerun", selection_mode="single-row")` → `event.selection.rows[0]` indexes the *displayed* (filtered, sorted) df → resolve `(org_id, cluster_id, cluster_name)` → store in `st.session_state["selected_cluster"]`. The drill-down fragment reads only that session key. A `✕ Clear selection` button deletes the key. **Secondary:** "Jump to cluster" selectbox in the drill-down header writes the same key (two writers, one key — last write wins, both re-render identically). Selection survives filter changes; if the selected cluster is filtered out, the drill-down stays (explicit user choice) but shows a caption "Cluster not in current filter scope".

**Filter composition:** all filters AND against the cached master df in one pure function `apply_filters(df, state) -> df`. KPI cards, all charts, the table, and the CSV download derive from the *same* filtered df — one funnel, no drift. KPI labels carry a caption "filtered scope: N of 1,000 clusters" whenever any filter is active, so a scoped KPI is never mistaken for global truth. `Reset filters` resets the widget keys (Streamlit ≥1.29: `st.session_state` re-assign + `st.rerun()`).

**Refresh:** `[⟳ Refresh data]` (top-right, `type="primary"` only here) → bump `st.session_state["refresh_token"]`; because every cached loader takes `refresh_token` as an (ignored) argument, one bump invalidates *all* data at a defined moment — preferable to `st.cache_data.clear()` (nukes other users' cache too if the app is ever multi-session). On success, set `fetched_at = now(UTC)`; header shows `Last refreshed: HH:MM:SS UTC`. Auto-refresh: **off by default**; optional `st.toggle("Auto-refresh every 15 min")` implemented via `st_autorefresh`… — no third-party pins: implement as `st.caption` guidance only, or a fragment `run_every=900` (native `run_every` on `@st.fragment`, ≥1.37). Recommend the fragment `run_every` variant — native, no new dependency.

**Rerun invariants (normative — verified with the Performance workstream; a code review should assert them):**

| # | User action | API-call budget | Mechanism |
|---|---|---|---|
| I1 | Sort / filter / search / paginate the cluster table | **exactly 0 API calls** | Master table df comes from org-level loaders only; all filtering/sorting is in-memory pandas inside the table fragment. No loader is keyed on filter or selection state. |
| I2 | Select a cluster row | **2 tab loaders only** (worst case ~7 GETs: cluster detail, agent status, WA component status, node-count history, resource-usage, efficiency, node-templates — fewer when the cluster-detail payload already carries status fields), then 0 on cached repeat | Only Tier-1 tab loaders (Overview, Resources — §5) run on selection; each is `@st.cache_data`-keyed by `(cluster_id, refresh_token)` so repeat selections / reruns / tab re-renders cost 0. |
| I3 | Click `Load …` in a Tier-2 tab | exactly the calls listed for that tab in §5, memoized per `(cluster_id, date_range)` | Session flag `tab_armed_{cluster_id}_{tab}` gates the body; flags reset on `selected_cluster` change. |
| I4 | Filter-widget edit while a cluster is selected | 0 API calls | Tier-2 armed flags persist for the *same* cluster but their loaders are cache-hit (same key); TTL expiry is the only exception and is bounded by `ttl=900`. |
| I5 | `⟳ Refresh` | full re-fetch | Sole path that invalidates all caches (via `refresh_token`). |

Because `st.tabs` executes all bodies on every rerun (verified non-lazy), these gates — not tab visibility — are what bound per-selection API traffic.

**Deep-linking:** mirror `selected_cluster` and active filters into `st.query_params` (lossy is fine); on first load, hydrate session state from query params. Enables sharing a link that opens a specific cluster's drill-down.

**Timeout/loading UX:** cold load shows one `st.status` step widget ("Loading organizations → Loading clusters (120/120) → Computing cost summary"); warm interactions are instantaneous from cache — no spinners allowed on pandas-only work (fake work erodes trust).

**Empty / error states (uniform grammar):**

| Situation | Surface | Treatment |
|---|---|---|
| Filters match nothing | Table region | `st.info("No clusters match the current filters.")` + `Reset filters` button in the same message area |
| Selected tab data absent (endpoint 404/422 for this cluster type) | Inside that tab only | `st.warning("Data unavailable for this cluster — the CAST AI API returned no <metric> for <cluster>.")`, gray italic styling; siblings unaffected |
| Loader raises for a few orgs in fan-out | KPI/table caption + footer banner | `st.warning("3 of 120 organizations failed to load — figures exclude them: org-x, org-y, org-z")`; all aggregates computed over the successful subset (never silently drop) |
| Total fetch failure (auth, network) | Whole page | `st.error("Could not load CAST AI data: <sanitized reason>")` + `Retry` button (bumps `refresh_token`). Never render the key; AGENTS.md hygiene |
| Metric has no API source | KPI card / table cell | `"N/A"` string (KPI) / empty cell (table numeric columns), footnote legend: *"N/A = no reliable API source at organization level; no value is estimated."* |

Per-org availability list also feeds the Organization filter: options from the *successful* orgs; failed ones listed only in the warning expander.

---

## 5. Cluster drill-down — tab specifications

Header: `**{org_name} / {cluster_name}**` · status pill · region/provider caption · `[Jump to cluster ⌄]` `[✕ Clear]`.
Each tab body = `@st.fragment` wrapping a `@st.cache_data` loader keyed `(cluster_id, date_range, refresh_token)`. **Tiering (per invariants I2/I3): Tier-1 = Overview, Resources — auto-fetch on row selection (2 loaders, ~7 GETs worst case, then fully cached). Tier-2 = Cost, Savings, Workload Autoscaler, Nodes, Issues — render a `Load <tab> data` button until armed** (`st.session_state[f"tab_armed_{cluster_id}_{tab}"]`; flags reset on selection change). Each armed tab costs exactly its listed calls, once per `(cluster_id, date_range)`, then cache-serves on every subsequent rerun — including reruns triggered by unrelated widgets, since cache keys exclude filter/selection churn.

| # | Tab | Widgets & charts (in render order) | Data dependency (candidate endpoints from `docs/openapi/castai-openapi.json`) |
|---|---|---|---|
| 1 | **Overview** ▶ (Tier-1, auto on selection) | Row of 6 `st.metric` cards: Nodes, vCPU, Memory, Agent status (🟢/🔴), Automation status, WA status. Metadata caption grid (provider, region, k8s version, created date). Mini Plotly area: node's count trend (30d) | `GET /v1/kubernetes/external-clusters/{clusterId}`; `GET /v1/kubernetes/clusters/{clusterId}/agent-status`; `GET /v1/workload-autoscaling/clusters/{clusterId}/components/workload-autoscaler`; `GET /v1/cost-reports/clusters/{clusterId}/node-count-history`. **depends on: k8s-version/created-date fields present on cluster detail** |
| 2 | **Resources** ▶ (Tier-1, auto on selection) | Plotly grouped bar: CPU requested vs provisioned; same for memory (GiB). Node-template/instance-type mix: `st.dataframe` (type, count, lifecycle). Node-count history line (shares loader with Overview) | `GET /v1/cost-reports/clusters/{clusterId}/resource-usage`; `GET /v1/cost-reports/clusters/{clusterId}/efficiency`; `GET /v1/cost-reports/clusters/{clusterId}/node-templates` — **depends on: field granularity of resource-usage; fallback = efficiency endpoint only** |
| 3 | **Cost** ⏸ (Tier-2) | 3 `st.metric`: Cost/mo (current range), previous equal-length period, Δ% (`delta_color="inverse"`). Plotly horizontal bar: cost by namespace (top 10 + Other). Plotly area: daily cost in range | `GET /v1/cost-reports/clusters/{clusterId}/cost`; `.../summary`; `POST /v1/cost-reports/clusters/{clusterId}/namespace-cost-summaries`; idle share via `GET /v1/cost-reports/idle-resources/disks` (optional, mark **depends**) |
| 4 | **Savings** ⏸ (Tier-2) | 3 `st.metric`: Potential savings $/mo, Realized savings $/mo, Savings % (potential / current cost). Plotly line: estimated-savings history. Rightsizing summary table (`st.dataframe`: workload, current req, recommended req, est. $) | `GET /v1/cost-reports/clusters/{clusterId}/savings`; `.../estimated-savings`; `.../estimated-savings-history`; `.../rightsizing-summary`. **depends on: realized-vs-potential split; if only one series exists, second card = "N/A"** |
| 5 | **Workload Autoscaler** ⏸ (Tier-2) | WA component status metric + version caption. 3 `st.metric`: workloads managed, avg CPU-request delta %, avg memory-request delta %. `st.dataframe`: workloads (namespace/name, policy, CPU req → rec, mem req → rec as ProgressColumns, last event) | `GET /v1/workload-autoscaling/clusters/{clusterId}/components/workload-autoscaler`; `.../workloads-summary`; `.../workloads`; `.../workload-events-summary`. **depends on: workloads-summary metric names (confirm in data-model.md)** |
| 6 | **Nodes** ⏸ (Tier-2) | `st.dataframe` (height 480, virtualized; up to a few hundred rows/cluster — hard-capped at the 25k Arrow ceiling in code): node name, instance type, zone, lifecycle (`spot`/`on-demand` — **depends on: lifecycle field on node payload**), vCPU, GiB, status emoji, age. Caption: `N nodes · M spot (P%)`. Node-count line omitted here (already in Resources) | `GET,POST /v1/kubernetes/external-clusters/{clusterId}/nodes`; storage addendum `GET /v1/cost-reports/clusters/{clusterId}/nodes/storage` (optional column, **depends**) |
| 7 | **Issues** ⏸ (Tier-2) | Severity summary chips (🔴 n critical · 🟡 n warnings — counts from payload). Problematic-nodes table. Events feed: `st.dataframe` of latest 50 events, server-limited (timestamp, severity emoji, object, message — message column `TextColumn(width="large")`) | `GET /v1/kubernetes/clusters/{clusterId}/problematic-nodes`; `POST /v1/kubernetes/external-clusters/{clusterId}/events`; `GET /v1/kubernetes/clusters/{clusterId}/agent-status` (reused). **depends on: events POST body schema (pagination/limit params) — confirm in api-matrix** |

Cross-tab rules: all tabs share the page's date range where the endpoint accepts one; cluster-detail fetches are **never** fanned out at the overview level (hard requirement from the brief: overview renders from org-level data only).

---

## 6. Accessibility, formatting, practicality

- **Numeric formatting helpers (single source, `components/format.py` — spec only):**
  - Money: `<$1,000 → "$937"`; `<$1M → "$12.4K"`; else `"$1.94M"`. Used for KPI values & chart tick/annotation text only.
  - Memory: store bytes→convert once to **GiB**, label axis/column `GiB` (never mixed GiB/GB on one screen).
  - Percent: `%.0f%%` everywhere; 1 decimal only in chart hover.
  - Datetimes: UTC, `HH:MM:SS UTC` / `YYYY-MM-DD` ISO everywhere — no locale-dependent rendering.
- **Color language (restrained, 5 tokens, used consistently across pills, Plotly traces, and metric deltas):**

| Token | Hex | Meaning | Used for |
|---|---|---|---|
| healthy | `#2E7D32` | active/enabled/ok | status 🟢, positive deltas |
| warning | `#F9A825` | degraded/partial | status 🟡, partial-load banner |
| critical | `#C62828` | disconnected/error | status 🔴, problematic counts (delta_color="inverse") |
| savings | `#1565C0` | money saved/savable | savings KPI values, optimized-cost trace, savings charts |
| inactive | `#9E9E9E` | not enabled/N/A | ⚫ statuses, N/A text |

  Plotly template sets these as a named `colorway` plus neutral grays for the rest; emoji pills mirror the same 4 states so color is never the sole channel (WCAG-friendly dual coding).
- **KPI budget above the fold: 10 max** (2×5). No third KPI row ever; new metrics go to tabs or charts.
- **Responsive columns:** `st.columns(5)` ×2. Below ~1100 px, Streamlit auto-collapses columns to stacked — acceptable; do not hand-build CSS breakpoints. Keep per-row ≤5 so cards never drop below ~150 px on typical 1440p windows. Charts: row of 2 via `st.columns([3,2])` (bar chart wider than comparison card).
- **Text/labels:** every metric `help=` tooltip names its API source class ("aggregated from organization-level cost endpoints, filtered scope"). Filters all get `help=` text stating AND-semantics and empty≡all.
- **Fonts/motion:** default Streamlit font stack; no animations, no autoplay, no flashing. Charts: Plotly with `displaylogo=False`, `scrollZoom=False` (prevents scroll-jacking the page).
- **Sort/pagination comfort at 1k rows:** fixed-height virtualized `st.dataframe` (height 480–560 px), pinned org/cluster columns, `NumberColumn` raw numerics for true numeric sort, CSV download for offline pivoting. No custom pagination controls (virtualization obviates them).

---

## Appendix A — Streamlit version requirements

| Feature relied upon | Min Streamlit | Hard? |
|---|---|---|
| `@st.fragment` (incl. `run_every`) | 1.37.0 | **Hard** — core perf design |
| `st.dataframe` row selection (`on_select`, `selection_mode`) | 1.35.0 | **Hard** — selection model |
| `column_config.ProgressColumn` / `NumberColumn` formats | 1.27.0 | Hard |
| `st.metric(border=)` | 1.39.0 | Soft (drop `border` if pinned lower) |
| `st.query_params` (stable API) | 1.30.0 | Soft (deep-linking only) |
| `st.segmented_control` (lazy-tab alternative) | 1.40.0 | Optional |

**Pin recommendation: `streamlit>=1.39,<2`, `pandas>=2.0`, `plotly>=5.18`.** Requirements agent should enforce `>=1.37` as the absolute floor.

## Appendix B — Open questions for sibling docs

1. Does an org-level "realized savings" measure exist separate from "estimated/potential"? (`savings` vs `estimated-savings` per-cluster semantics — needs api-matrix.)
2. Exact name/content of org-level per-cluster cost+efficiency rows: `GET /v1/cost-reports/organization/clusters/summary` vs `.../clusters/efficiency` vs `.../clusters/report` — which one carries (nodes, cost, efficiency, spot) in one payload? *Owner: data-model.md.*
3. Enterprise-level aggregation availability: `GET /v1/billing/enterprise/platform-usage-report` — if usable, KPI row 1 could skip org fan-out for money metrics. Needs scope + schema verification.
4. Cluster-list payload size at 120-org fan-out (any pagination on `GET /v1/kubernetes/external-clusters`? The spec shows no query params — confirm it returns all clusters per call).
5. WA/automation/node-autoscaler status availability **at list level** vs per-cluster components call — decides whether three table columns ship in v1 or start as "N/A".

---

## Ship delta (v1, 2026-09-21)

Where the shipped app diverges from the design above (final-review accepted):

1. **Realized-savings KPI card omitted at Tier 1** — the realized source
   (`clusters/{clusterId}/savings`) is per-cluster only; realized values appear
   in the cluster drill-down Savings tab instead (architecture.md §9.5).
2. **Date range lives in the header controls** (next to the title + Refresh
   button), not in the filter bar.
3. **Filter bar ships:** Organization, Provider, Region, Status, Agent status,
   Workload-autoscaler status multiselects + cluster-name search. The Cluster,
   Automation, and Node-autoscaler multiselects are deferred.
4. **Drill-down visualizations are the v1 bounded summaries** (metric cards +
   first-100-row tables): no WA workloads table, no savings-history chart, no
   events feed yet.
5. **Health emoji:** `non-responding` renders ⚫ (same disconnected family as
   `disconnected`/`disconnecting`/`deleted`/`terminated`/`archived`/`deleting`).

---

## Ship delta v2 (2026-09-21)

Phase-2 build COMPLETE (suite 413 green, app live) — where the shipped v2 app
lands relative to `docs/ux-v2.md` (normative v2 spec) and the v1 delta above:

1. **11 drill-down tabs (12 armed ids)** — labels: Overview, Resources, Cost,
   Savings, Workload Autoscaler, Node Autoscaler, Nodes, Workloads, Issues,
   History, Data Quality. Overview/Resources stay Tier-1 auto-load (I2, no
   flag); Data Quality renders from the fleet row with **0 API calls** (no
   flag). The 12 arm ids are `cost, pricing, savings, savings_est, wa, na,
   nodes, workloads, issues, notifications, oom, history` — ux-v2 §5's 8
   extended by the Wave-C loader families (pricing, notifications, oom) +
   `savings_est`. Arm mechanics unchanged: the session flag, not the click,
   drives rendering; flags reset on selection change (I3/I4 unchanged).
2. **Enrichment expander + invariant I6 (shipped)** —
   `st.expander("On-demand enrichment — batched per-cluster API calls")` above
   the fleet table is the ONLY call site of the four batch loaders
   (`realized` 1 call/cluster cap 100, `na_policies` cap 400, `wa_coverage`
   cap 400, `health` 3 calls/cluster cap 400; ≤ 800 estimated calls/run;
   15-min session cache; ≤ 1 in-flight batch; results merge as `enr_*`
   prefixed session columns — Tier-1 columns never mutate in place).
3. **Column picker (shipped)** — `st.multiselect` key `fleet_visible_cols`,
   `"Group · Column…"` labels, over the 70-column v2 contract; identity columns
   (organization_name, cluster_name) pinned and unhidable; picker edits are pure
   pandas (I1: 0 API calls).
4. **Ghost toggle + quarantine (shipped)** — `is_ghost`
   (`reporting_state == CLUSTER_STATE_UNSPECIFIED` exactly; 4 baseline rows) is
   excluded from filters AND masked from every KPI by default; the "Show ghost
   rows" toggle (off by default) restores visibility with a 👻 health-chip
   override (ADR v2 R5; aggregates assert ghosts never enter KPI sums).
5. **Negative-savings cells (shipped)** — `potential_savings_display`:
   positive `🟢 $X` (green ONLY when `has_positive_savings_opportunity`),
   zero `No savings opportunity`, negative `🔻 −$X (cost increase)` (red-neutral
   triangle — never the error family, never green, raw value in tooltip + CSV),
   NA `—`. Savings-tab drill-down adds the `st.warning` callout for
   `has_negative_savings` rows. Raw `potential_savings` stays a hidden numeric
   column (numeric sort via picker).
6. **Export cap + columns (shipped)** — CSV download is capped at **500 rows**
   of the current filtered view (`EXPORT_ROW_CAP`, "export limited to 500 rows;
   narrow filters" caption) and ships **raw numeric columns** (negative savings
   raw, counts) — display strings are presentation-only (perf-v2 §5.2 /
   REJECT #3).
7. **Banner rollup (shipped)** — the org-health banner groups FetchErrors per
   org into the three exact categories ("Permission denied" /
   "Temporarily unavailable" / "Partial data — failed: {ops}"), headlines from
   DISTINCT fully-failed orgs (+ partial count), and is **never suppressed
   while errors exist** (enterprise-v2-refresh GAP-A/B fixed; FetchError.kind =
   exception class at all raise sites).
8. **Pills + Automation set (shipped)** — `st.pills` needs-attention chips:
   `Has issues` · `Negative savings` · `Low WA coverage (<50%)` ·
   `Not installed WA` · `Stale data` (chips OR inside the set, AND with the
   other filters; chips whose source column has not loaded match nothing).
   The Automation filter ships the derived buckets `Automating` / `Halted` /
   `Hibernating` / `Agent disconnected` / `Connecting` / `NA`
   (autoscaler-model §5 — Tier-1 lifecycle-expected, never claims
   `enabled=true`); Data freshness filter: `fresh` / `stale` / `unknown`
   (display-layer 60-min bucket; the `data_freshness_status` column law is
   30 min — data-model.md §2.1).
9. **Realized panel convention (shipped)** — the drill-down Savings tab renders
   TWO strictly separated panels: **Realized (actual window)** —
   `…/clusters/{id}/savings` — 3 metric cards (total realized savings, window
   cost, daily buckets) + area chart, USD/window, additive; and **Estimated
   (model)** — `…/estimated-savings-history` — USD/h costPerHour lines,
   irregular cadence kept. The panels are never summed, never on one axis
   (finops rule 5 / historical-model §3.3); the fleet Realized KPI reads the
   same enrichment session dict and shows `N/A` + run instructions pre-batch.
10. **16 KPI cards (shipped)** — 3 grouped rows (Scale 5 / FinOps 5 /
    Efficiency·Health·Data-quality 6) with group captions; v1's "10 max"
    cap (§6) and "no 3rd row ever" rule are superseded by ux-v2 §2's "no 4th
    row ever". v2 replaces v1 §6 efficiency labels with utilization
    (CPU/Memory utilization — ADR v2 R8 renames).
