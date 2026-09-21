# CAST AI Enterprise Dashboard

One read-only Streamlit dashboard across an entire CAST AI Enterprise: the
Enterprise root organization, every child organization, and every cluster — in
a single filterable table with per-cluster drill-down. Read-only by
construction: the HTTP client is GET-only plus a small in-code whitelist of
read-semantics cost-report POST queries; no mutating call exists in the
codebase. Verified live against the EU enterprise: ~130 orgs / ~1,000
clusters / ~10,000 nodes (docs/architecture.md §1).

> **Status:** **v2 shipped (2026-09-21)** — phase-2 "Fleet Intelligence" build
> complete: **413 tests green, app live** (34 + 34 + 2 = 70-column fleet table,
> 16 KPI cards, 4 opt-in enrichment batches, 11 drill-down tabs). The
> authoritative spec is `docs/architecture.md` (FINAL v1 + ADR v2 R1–R10); the
> original brief was superseded — see **Design notes** below and **Known gaps
> documented** for what still awaits live validation.

## What it does

- Resolves the Enterprise root and all its child organizations, fans out
  across them with bounded concurrency, and renders one fleet-wide view:
  orgs, clusters, nodes, cost, savings potential, utilization, coverage.
- Drill down from any row into an **11-tab** per-cluster detail view
  (12 armed tab ids), fetched lazily. (v1 wording "7-tab" — superseded
  2026-09-21, see docs/ux-v2.md §5.)
- Never writes. Missing data renders as explicit sentinels (`N/A`, `n/a — load`,
  `Disconnected`, …) — never as a fabricated `0`.

## Architecture & data flow

Mirrors `docs/architecture.md` §2:

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
                                        6-call default bundle per org (ADR v2 R2:
                                        clusters/efficiency = 6th Tier-1 call
                                        -> waste_*_usd columns)
        |
        |              services/enrichment_service.py  (ADR v2 R3)
        |                run_enrichment(kind...) — user-armed batches only
        |                (realized / na_policies / wa_coverage / health;
        |                caps 100/400, <=800 calls/run, 15-min session
        |                cache; invariant I6: never auto-fired)
        v                                       v
 data/normalizers.py  (wire JSON -> typed rows; units: cores, GiB, USD/hr;
        |              34 FLEET + 34 EXTRA + 2 REPORT = 70 columns (v2);
        |              proto3 string numerics parsed defensively; pd.NA)
        v
 data/aggregators.py  (ratio-of-sums KPIs, org rollups, weighted percentages)
        |
        v
 app.py (single page, layout="wide")
   filter bar -> 16 KPI cards (3 grouped rows) -> charts -> ENTERPRISE CLUSTER
   TABLE (column picker; CSV export capped 500 rows)
   -> row-select drill-down (11 tabs, 12 armed ids; Tier-2 tabs button-armed)
 ui/{cards,charts,filters,tables}.py  +  st.fragment isolation
```

## Features

_(v1 feature list superseded 2026-09-21 — see ADR v2 R1–R10 and docs/ux-v2.md §9;
the bullet set below is the shipped v2 surface, test count 413 green.)_

- **KPI cards** — **16 `st.metric(border=True)` cards in 3 grouped rows**
  (Scale 5 / FinOps 5 / Efficiency·Health·Data-quality 6): organizations,
  clusters, nodes, spot + workload-autoscaler coverage; monthly run rate,
  **potential-savings trio (net / gross opportunity / over-optimized headroom)**,
  total waste (window); CPU & memory utilization, problematic nodes,
  unschedulable pods, OOM kills (window, flag-gated), data coverage. All KPIs
  are ratio-of-sums over the filtered scope (never mean-of-percentages);
  missing values are masked out pairwise, never coerced to 0.
- **Opt-in enrichment batches (4, call-capped)** — an expander offers realized
  savings (1 call/cluster, cap 100), NA status (`na_policies`, cap 400), WA
  coverage (cap 400), and cluster health (problematic counts, 3 calls/cluster,
  cap 400); ≤ 800 estimated calls per run, 15-min session cache, per-cluster
  failure isolation. Invariant **I6: batches never auto-fire** (docs/ux-v2.md §4).
- **11 drill-down tabs (12 armed ids)** — Overview & Resources auto-load on row
  selection (I2); Cost, Savings, Workload Autoscaler, Node Autoscaler, Nodes,
  Workloads, Issues, History arm on their `Load …` button; **Data Quality**
  renders with **0 API calls**. (v1 shipped 7 tabs — superseded 2026-09-21.)
- **Ghost-row quarantine** — the 4 `CLUSTER_STATE_UNSPECIFIED` rows are excluded
  from filters and every KPI by default (`is_ghost`); a "Show ghost rows"
  toggle un-quarantines them with a 👻 marker (ADR v2 R5).
- **Negative-savings handling** — raw `potential_savings` is never clamped:
  the net KPI includes negatives, gross/headroom companions carry the split,
  cells render 🔻 `−$X (cost increase)` (never green, never the error family),
  and the Savings tab shows an explanatory warning (finops-model §2, ADR R5).
- **Freshness layer** — `latest_sync_time` / `snapshot_age_minutes` /
  `data_freshness_status` columns (fresh < 30 min ≥ stale ≥ unknown) plus the
  derived 7-value `agent_health` column — all at +0 API calls.
- **Waste (window)** — `waste_cpu/ram/storage/total_usd` per-cluster columns
  from the 6th Tier-1 call per org (`organization/clusters/efficiency`, default
  ON); strictly a third lens — never summed with spend or savings.
- **Fleet spot trend** — spot-CPU-share daily series on an opt-in History
  expander button (+1 call/org via `organization/efficiency`, never auto-fired).
- **Filter bar (v2)** — organization, provider, region, status, agent status,
  WA status, Automation (derived buckets), Data freshness, case-insensitive
  cluster-name search, cost/savings date range (default: last 30 days), plus a
  **st.pills needs-attention chip row** (Has issues · Negative savings · Low WA
  coverage <50 % · Not installed WA · Stale data) and the ghost toggle.
  All filters AND (chips OR among themselves); every figure derives from the
  same filtered frame — **0 API calls on any filter edit (I1/I4)**.
- **Master cluster table** — virtualized `st.dataframe` with single-row
  selection (the drill-down selector), true numeric sorting, pinned org/cluster
  columns, emoji status pills, **column picker** over the 70-column contract,
  CSV download of raw columns **capped at 500 rows** (perf-v2 §5.2). Payloads
  are hard-capped at 25k rows per frame.
- **Cost & savings charts** — monthly cost by organization (top 15 + Other),
  current-vs-optimized comparison, daily trend over the selected range.
- **N/A policy** — `0 ≠ pd.NA ≠ "No data" ≠ "Disconnected" ≠ "Unknown" ≠
  "Not installed" ≠ "n/a — load"` (batch/Tier-2-only metric; v1's `"T2"` cell
  sentinel is rendered out by this string — superseded 2026-09-21, see ADR
  v2). If a metric has no reliable API source at that grain, the UI says so
  instead of estimating.
- **Partial-failure resilience** — one failing org never blanks the dashboard;
  its rows are marked unavailable, excluded from totals, and surfaced in a
  warning banner (grouped Permission-denied / Temporarily-unavailable /
  Partial-data rollup, ADR v2 R5) with a Refresh path.
- **Rate-limit gate** — 429-reactive permit gate on the single client
  chokepoint (halve to floor 2, 60-s cooldown — ADR v2 R9); token bucket and
  circuit breaker remain descoped.
- **Test posture** — **413 tests green** without real credentials (respx-mocked),
  including the v2 normalizer/aggregator/UI/enrichment/rate-gate suites.

## Requirements

- Python **≥ 3.11** (3.12+ recommended — still receiving security fixes,
  security-requirements.md SEC-6.5).
- Pinned direct dependencies — see `requirements.txt` (exact `==` pins, no
  open ranges): streamlit, pandas, plotly, httpx, pydantic, python-dotenv,
  pytest, respx.
- Network egress to one CAST AI regional API (see below).

## CAST AI API key requirements

You need an **Enterprise API key with read-only scopes**. Provision it in the
CAST AI console for your enterprise (or via your CAST AI organization
administrator). Required scopes (security-requirements.md SEC-3):

| Scope | Dashboard use |
|---|---|
| `organizations:read` | Org resolution, child-org discovery |
| `kubernetes/external-clusters:read` | Cluster inventory, nodes, status |
| `cost-reports:read` | Cost, savings, efficiency reports |
| `inventory:read` | Resource inventory views |
| `workload-autoscaling:read` | Autoscaler status and recommendations |
| `recommendations:read` | Optimization recommendations |
| `notifications:read` | Only if `CASTAI_ENABLE_NOTIFICATIONS=true`; otherwise omit |

The key **must not** carry any `*:write` / `*:admin` scope, billing-management
scopes, or cluster-connect/agent scopes.

Regional base URLs (allow-listed in config; anything else is rejected):

| Region | Base URL |
|---|---|
| EU (default) | `https://api.eu.cast.ai` |
| US | `https://api.cast.ai` |
| India | `https://api.in.cast.ai` |

On startup the app self-checks the key with a benign `GET /v1/organizations`
and fails closed with a generic message on 401/403 (SEC-3.1).

## How Enterprise child-org access works

Details: `docs/enterprise-hierarchy.md` (verified live).

1. Every request carries `X-API-Key: <enterprise key>`. Every org-scoped call
   additionally carries `X-CastAi-Organization-Id: <org id>` — this header
   selects which organization the request runs against (undocumented in the
   OpenAPI spec but load-bearing; without it, calls resolve to the key's home
   org and return empty results).
2. Discovery: `GET /v1/organizations` (one call) → resolve the Enterprise
   root via `CASTAI_ENTERPRISE_ID` override or the unique
   `ORGANIZATION_TYPE_ENTERPRISE` heuristic → include every org with
   `type == ORGANIZATION_TYPE_CHILD` **and** `parentId == <root id>`.
   `ORGANIZATION_TYPE_DEFAULT` standalone orgs are excluded. The hierarchy is
   re-discovered on every refresh — nothing is hard-coded.
3. Every cluster record is stamped with the **request-scope** org id.
   Cluster names are not unique (verified); the identity composite key
   everywhere — cache, dedup, UI selection — is `(organization_id, cluster_id)`.
4. Per-org failures (including HTTP 500 from an invalid scoping id) are
   isolated and collected as `FetchError`s — only the initial
   `GET /v1/organizations` is fatal-on-failure.

## Configuration

Environment variables are the production source; `.streamlit/secrets.toml`
(keys under `[castai]`) is the local-only fallback. Environment wins when both
are set — do not use both for the same key.

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `CASTAI_API_KEY` | yes | — | Read-only Enterprise API key (fail-closed if absent) |
| `CASTAI_BASE_URL` | no | `https://api.eu.cast.ai` | Regional endpoint; https + allow-list validated |
| `CASTAI_ENTERPRISE_ID` | no | auto | Enterprise root org ID override → root resolution |
| `CASTAI_MAX_WORKERS` | no | `8` | Tier-1 fan-out concurrency (4–16, hard cap 32) |
| `CASTAI_ENABLE_NOTIFICATIONS` | no | `false` | +3 exact-count reads/org (`page.limit=1`): unacked / critical+error / warning counts; loader wired & cached, no v2 KPI card consumes it yet (app.py) (v1 line read "+1 call/org: notifications" — superseded 2026-09-21, see ADR v2) |
| `CASTAI_ENABLE_ORG_EFFICIENCY` | no | `true` | 6th Tier-1 call/org (`organization/clusters/efficiency`, ADR v2 R2): per-cluster `waste_*_usd` columns; set `false` to restore the 1 + 5×N v1 sweep (v1 line read "efficiency waste cross-check" — superseded 2026-09-21) |
| `CASTAI_ENABLE_ACTIVE_PROBE` | no | `false` | +1 whitelisted read-POST: active-clusters oracle |
| `CASTAI_ENABLE_CLUSTER_HISTORY` | no | `false` | +1 call/org (`organization/workload-event-metrics`, OOMKilled): fleet "OOM kills (window)" KPI — org totals only, no cluster attribution at this grain; per-cluster OOM stays Tier-2. Env-fallback flag (no `Settings` field — exactly as consumed in `app.py`) |

See `.env.example` for a copy-ready template. `secrets.toml` equivalents are
`castai.api_key`, `castai.base_url`, `castai.enterprise_id`. v2 batch caps /
TTLs / export caps are **not** env-exposed — they are code constants
(`services/enrichment_service.py`, `ui/tables.py EXPORT_ROW_CAP`, `app.py`).

## Run locally

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                # fill in CASTAI_API_KEY
set -a; . ./.env; set +a            # export the variables (or use .streamlit/secrets.toml)
.venv/bin/streamlit run app.py
```

## Testing

```bash
.venv/bin/python -m pytest tests/ -q
```

No credentials needed — the suites are fully mocked (respx intercepts the
httpx transport). Acceptance requires pytest green without real credentials
(architecture.md §10). **v2 ship: 413 tests collected & green (2026-09-21).**

## Performance & scale

Two-tier retrieval (architecture.md §3, performance.md, performance-v2.md):

- **Tier 1 (page load):** one org-discovery call + a bundle per org — **6 calls
  by default** (the 5-call v1 bundle + `organization/clusters/efficiency` for
  the waste columns, ADR v2 R2; notifications flag adds 3/org, OOM flag +1/org),
  fanned out over a ThreadPoolExecutor (8 workers): 1 + 5×N measured **631 calls
  / ~80 s cold** at 126 orgs; **< 5 s warm** (15–30 min `@st.cache_data` TTLs).
  v2 runtime assertion: Tier-1 calls ≤ 1 + 7×N_orgs (hard-stop 950).
  (v1 line read "≤ 2 + 5×N_orgs ... ~20–35 s cold" — superseded 2026-09-21,
  see ADR v2 R2 and performance-v2.md §6.)
- **Tier 2 (drill-down):** lazy, per tab, per `(cluster_id, date_range)`,
  cached 15 min (histories 6 h, notifications 5 min); Tier-2 tabs fetch only
  after their Load button arms them (12 armed ids over 11 tabs).
- **Enrichment batches** (user-armed only, I6): ≤ 800 calls/run; realized ≤ 100
  clusters, other kinds ≤ 400; ≤ 60–80 s for a 241×2 run at 8 workers.
- Timeouts 5 s connect / 30 s read (60 s historical); 4 attempts with
  exponential backoff + full jitter, honoring `Retry-After`; never retry
  401/403; **v2: 429-reactive permit gate** at the single client chokepoint
  (halve to floor 2, 60-s cooldown, +1 per clean 60 s — ADR v2 R9).
  (v1 line read "circuit breaker after 5 consecutive per-org 429/5xx;
  process-wide 20 req/s token bucket" — both descoped; superseded 2026-09-21,
  see ADR v2 R9.)

Acceptance budgets (architecture.md §10): cold overview < 60 s p95; warm < 5 s;
drill-down tab < 10 s cold / < 2 s warm; table interaction < 1 s with exactly
0 API calls; 429 rate < 1 %; ≤ 25k rows per dataframe.

## Troubleshooting

| Symptom | Meaning / remedy |
|---|---|
| `API key rejected (401)` | Key invalid/expired. Verify `CASTAI_API_KEY` with your administrator. Never auto-retried (SEC-2.6). |
| `403 — missing scope` | Key valid but under-scoped. Re-provision with the SEC-3 read scopes above. |
| `429` bursts / throttling banner | The client backs off with jitter and honors `Retry-After`; the circuit breaker trips after 5 consecutive per-org failures and renders partial data. Refresh after a minute; consider lowering `CASTAI_MAX_WORKERS`. |
| `CAST AI API unreachable` / 5xx | Outage or network path issue; 5xx is retried 4× with backoff. One org returning 500 (e.g. invalid scoping id) is a per-org failure, not fatal. |
| Org shows "Data unavailable" | That org's bundle failed — see the warning banner for the FetchError detail. Its rows are excluded from totals. Use Refresh to retry; only the org-list call is fatal-on-failure. |
| Table is completely empty | The key is most likely **org-scoped, not Enterprise-scoped** — or no ENTERPRISE org is visible to it. Provision an Enterprise key, or set `CASTAI_ENTERPRISE_ID` explicitly (enterprise-hierarchy.md §4). |

## Security notes

- Read-only posture, enforced in code: GET-only transport + one
  `ALLOWED_READ_POST_PATHS` whitelist (read-semantics cost-report queries);
  any other method raises (SEC-4).
- The API key lives in exactly two places (settings object, client default
  headers); it never appears in logs, UI, cache keys, dataframes, or
  `st.session_state`. Logs pass through a shared redactor and never contain
  request/response headers (SEC-2).
- `CASTAI_BASE_URL` is validated: https only, host must be one of the three
  regional endpoints — blocks key exfiltration to an attacker-supplied host.
  TLS verification is always on; explicit timeouts on every request.
- Fail-closed config: missing key → generic error + `st.stop()`; raw API error
  bodies are never rendered. `unsafe_allow_html` is forbidden; no telemetry
  (`gatherUsageStats = false`); in-process caching only.
- `requirements.txt` pins exact versions. Run **`pip-audit --strict`** before
  each release — any CRITICAL/HIGH CVE blocks release until bumped or waived
  with documentation (SEC-6.3).
- Full gate: the 27-item checklist in `docs/security-requirements.md` §SEC-8
  must be PASS before the dashboard is shared.

## Design notes — intentional deviations from the original brief

Per `docs/architecture.md` §9:

1. Single-page app instead of `pages/01..05` — multipage loses filter and
   selection state across page switches; `pages/` is kept for a future trends
   page.
2. Allocation-group endpoints are not used for the master table (wrong
   grain) — replaced by a per-org fan-out of 5 calls per org.
3. Enterprise billing endpoints are not a money source (feature usage only).
4. Node-autoscaler status and problematic-node/workload counts are
   Tier-2-only; the fleet table shows `T2` badges instead of fan-out-fetched
   or fabricated values.
5. The Enterprise "Realized Savings" KPI renders N/A at Tier-1 (only a
   per-cluster source exists); realized savings appear in the cluster
   drill-down.
6. Default date window for report-based KPIs/charts is the last 30 days
   (selectable), not the whole month-to-date span implied by the brief.

## Known gaps documented (v2 ship, 2026-09-21)

Intentional non-goals and open validations — each is written down in the
phase-2 docs, none is silent:

- **ADR v2 rejections** (`docs/architecture.md`, ADR v2 R1–R10): realized
  savings as a default Tier-1 KPI (per-cluster source only ⇒ 1-batch);
  per-cluster OOM at Tier-1 (org response has no `clusterId`); token bucket /
  circuit breaker; `potential − realized` "remaining" metric (rule-5
  violation); `namespace-cost-summaries` POST at Tier-1 (read-only posture).
- **Pending live validations** (`docs/finops-model.md` §9): `summary.totalCost`
  framing of `/savings`; idle-disks enterprise-key scoping; allocation-group
  ungrouped coverage; `overprovisionedPercent` denominators;
  `clusters/report` "average" basis vs `daily-cost`.
- **Open unknowns** (`docs/historical-model.md` §7): no documented max window
  on history endpoints; `stepSeconds` enum absent on several; estimated-history
  cadence is empirical; retention horizon empirical.
- **Audit dispositions** (`docs/current-data-audit.md` §8 + Disposition lines):
  the 10,672-unschedulable-pods outlier on 8-node `csx-georgi-vnv` is flagged
  for a live probe (artifact vs real saturation) — not "fixed" in data.
- **Not answerable from the API at all**: optimization-coverage-over-time
  (no endpoint — local daily snapshot persistence is the named candidate);
  per-workload "used" resources in the WA workloads list (docs/autoscaler-
  model.md §4 ⇒ N/A column, never fabricated).
- **Wired but unconsumed**: the notifications summary loader is cached and
  ready but no v2 KPI card reads it yet (app.py note — cost is 0 until used).
- **Residual descopes** (`docs/performance-v2.md` §3.4): proactive token
  bucket, circuit breaker, auto-fired/chunked batches.

## Documentation map

| File | Content |
|---|---|
| `docs/architecture.md` | **Final** reconciled architecture (this README reflects it) |
| `docs/api-matrix.md` | Endpoint inventory: per-tier call lists for every surface |
| `docs/data-model.md` | Wire schemas → normalized rows; sentinels; FLEET_COLUMNS |
| `docs/metrics.md` | Every KPI's documented source and formula |
| `docs/ux-design.md` | Layout, components, interaction invariants I1–I5 (+ Ship delta v2) |
| `docs/performance.md` | Request budgets, concurrency, caching, acceptance criteria |
| `docs/security-requirements.md` | SEC-1…SEC-8 + the 27-item release checklist |
| `docs/enterprise-hierarchy.md` | Verified discovery algorithm and scoping-header behavior |
| `docs/openapi/castai-openapi.json` | Pinned OpenAPI reference snapshot (~2.2 MB, committed intentionally for reproducibility — re-fetch on spec refresh; not git-ignored) |
| **Phase-2 (v2) docs, 2026-09-21** | |
| `docs/architecture.md` — ADR v2 | Decision record R1–R10 (cost bases, waste Tier-1, enrichment batches, history, P0 correctness pack, autoscaler, reliability, renames, rate gate, pins/TTLs) |
| `docs/current-data-audit.md` | v1 baseline audit (241 clusters × 42 cols) + v2 Disposition lines per finding |
| `docs/api-delta-v2.md` | v2 expansion endpoint family matrix (31 GETs) + v1 revalidation |
| `docs/enterprise-v2-refresh.md` | 129-org re-verification + failure-matrix (GAP-A/B banner fixes) |
| `docs/finops-model.md` | Savings/waste/realized model adopted into docs/metrics.md |
| `docs/resource-metrics.md` | Rename set + request-efficiency + storage trap + GPU/TPU |
| `docs/autoscaler-model.md` | NA/WA status model (wa_display, na_coverage, batches) |
| `docs/reliability-model.md` | Node-state/OOM/notifications/agent-health model |
| `docs/historical-model.md` | History analytics (0-call fleet trend, spot trend options) |
| `docs/performance-v2.md` | v2 call budgets, batch caps, rate gate, acceptance v2 |
| `docs/ux-v2.md` | v2 UX spec (16 KPI grid, I6, enrichment panel, 11 tabs, pills, quarantine) |
