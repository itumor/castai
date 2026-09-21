# Performance Architecture v2 — CAST AI Enterprise Dashboard

Status: **design document** (extends, does not replace, `docs/performance.md`).
Audience: implementers of the Streamlit dashboard v2 expansion.
Evidence base: v1 measured live run 2026-09-21 (126 orgs, 631 calls, ~80 s cold),
`docs/architecture.md` §3/§4, `services/cluster_service.py`, `services/castai_client.py`,
`app.py` cache layer, `docs/api-matrix.md`, OpenAPI spec (534 operations).

Scale assumption: ~130 orgs, ~1,000 clusters, ~10,000 nodes; drill-down grows 7 → 11 tabs;
opt-in per-cluster enrichment batches added.

---

## 0. Measured v1 baseline (all v2 budgets derive from this)

- Cold sweep at 126 child orgs: `1 + 5×126 = 631 calls in ~80 s` @ 8 workers ⇒
  **7.9 calls/s effective end-to-end** (includes retry backoff, TLS setup, JSON parse,
  per-org bundle serialization of 5 sequential calls inside each future).
- Implied per-call p50 ≈ **0.4–0.6 s** (bundle-internal serialization makes the naive
  8×(1/0.5) = 16 calls/s ceiling unreachable; use 7.9 calls/s for every v2 estimate).
- Zero documented `429` responses across the spec; zero observed in the live run.
- Hypothesis/limitation: 80 s cold already exceeds the v1 "<60 s p95" acceptance —
  acceptance is re-baselined in §6 instead of pretending the 60 s target was met.

---

## 1. Tier-1 v2 call budget

### 1.1 Call-count model

```
calls_tier1 = 1 (orgs discovery) + N_orgs × (5 + f_notifications + f_org_efficiency)
```

| Flags | Formula | N = 126 | Calls |
|---|---|---|---|
| base (v1 shipped) | 1 + 5N | 631 | measured ~80 s @ 8 w |
| +notifications only | 1 + 6N | 757 | |
| +efficiency only | 1 + 6N | 757 | |
| **both ON** | **1 + 7N** | **883** | §1.2 |

> The flags exist in `config/settings.py` (`enable_notifications=False`,
> `enable_org_efficiency=True`) but are **not consumed** by `cluster_service` in v1
> (bundle is hardwired to 5 calls). V2 wires them into `_BUNDLE_ENDPOINTS` and into the
> `cached_fleet` cache key. When wiring: **flip `enable_org_efficiency` default to False**
> — today's `True` default is inert; activating it as-is would silently raise cold load ~40 %.

> Org-level OOM (`GET /v1/cost-reports/organization/workload-event-metrics`,
> api-matrix §3.8 — **endpoint verified in spec**, `eventTypes[]=OOMKilled`): would be a
> third flag (+1/org ⇒ 1+8N = 1,009 @ 126). **Excluded from Tier-1** (§3.4 of this doc /
> §6 REJECT list); OOM belongs to drill-down only (cluster-level sibling, api-matrix §8.5).

### 1.2 Wall-clock estimates (rate = 7.9 calls/s measured @ 8 workers)

| Config | Calls | 8 workers | 16 workers |
|---|---|---|---|
| 1+5N (base) | 631 | ~80 s (measured) | ~42–50 s |
| 1+6N (one flag) | 757 | ~96 s | ~50–60 s |
| 1+7N (both flags) | 883 | **~112 s** | **~60–70 s** |

(16-worker figures = ideal halving ×1.2 tail/contention overhead; 16 workers also doubles
instantaneous 429 exposure — §3.)

Budget guardrail: v1 `performance.md` §1.5 hard-stops Tier-1 at >750 calls. Flags-ON (883)
crosses that line. **v2 budget assertion becomes `calls_tier1 ≤ 1 + 7×N_orgs`; hard-stop
moves to 950 calls** (refuse full load, require narrower org/date filter).

### 1.3 RECOMMENDATION: flags OFF by default

**Keep both flags OFF by default in v2.** Rationale:
1. 883 calls @ 8 workers ≈ 112 s cold — ~2× over the (already breached) 60 s target and
   ~25 s over the re-baselined §6 target even at 16 workers.
2. `notifications` page-1-per-org is low-value at enterprise scope (paginated, noisy,
   unmanaged pagination; count not total). Its information surface is per-cluster and
   already lives in drill-down (§4, Notifications tab).
3. `efficiency/summary` is a cross-check of data already fetched (org overview + summary);
   it adds a validation column, not a new KPI.
4. Flags-ON is still supported as an explicit admin/ops opt-in (env), with the ETA
   consequence printed next to it in the ops docs — the cost is then a chosen one.

---

## 2. Opt-in bounded enrichment batches (critical new piece)

### 2.1 Kind registry

Each batch *kind* declares: client calls per cluster, extracted columns, TTL class,
cluster cap override. Proposed initial kinds (1–2 calls/cluster each):

| Kind | Endpoint(s) | Calls/cluster | Cap |
|---|---|---|---|
| `na_policies` | `clusters/{id}/policies` | 1 | 400 |
| `realized_savings` | `cost-reports/clusters/{id}/savings` (windowed, long-read class) | 1 | **100** |
| `problematic_counts` | `problematic-nodes` + `problematic-workloads` | 2 | 400 |
| `wa_summary` | `workload-autoscaling/.../workloads-summary` | 1 | 400 |
| `node_states` | `external-clusters/{id}/nodes` page 1 (limit 500) | 1 | 400 |

> ⚠️ There is **no dedicated node-state endpoint** in the spec (verified); `node_states`
> reads `state.phase` off the existing nodes list. One page suffices (median nodes/cluster
> ≈ 10). *Confirm with Agent 7* that no other node-state surface was intended.

### 2.2 Runner contract (`services/enrichment_service.py`)

```
run_enrichment_batch(client, clusters: list[tuple[org_id, cluster_id]],
                     kind: str, start: str, end: str,
                     max_workers=8, progress_cb=None, cancel_token=None) -> EnrichmentBatch
```

- Input = the **filtered fleet slice** (org/cluster pairs) from the current filter bar
  session snapshot — never "all clusters".
- Task = one cluster (same failure-isolation pattern as `_org_rows`: per-cluster exception
  → sanitized error entry, never escapes its future, never aborts the batch).
- Concurrency 8, matching the Tier-1 pool; the shared client gate (§3) governs both.
- **Execution is NOT inside `st.cache_data`** — a rerun mid-batch would silently start a
  second pool. The batch runs in its arming `@st.fragment` under `st.status`.
- Results: written to `st.session_state["enrichment"][key] = {"ts": epoch, "rows": {cid: {cols}}}`
  where `key = sha256(kind | sorted(cluster-id tuple) | window)`. **TTL 15 min (900 s)
  enforced at read** — this is the 15-min cache keyed by the sorted cluster-id set,
  implemented session-locally to avoid the cache_data double-execution hazard.
- Merge: **once per batch completion**, dict→small DataFrame → left-join on
  `(organization_id, cluster_id)` against the session fleet snapshot (O(n), ~ms). New
  columns are prefixed `enr_<kind>_…`; enrichment never mutates Tier-1 columns in place.
- Progress: `progress_cb(done, total, elapsed, eta_s)` per completed cluster; ETA from
  observed in-run calls/s.
- Cancellation across reruns: cancel button bumps `st.session_state["batch_cancel_token"]`;
  the runner checks the token between cluster submissions; partial results merge on cancel.

### 2.3 Hard caps and duration estimates

Per arm: **refuse >400 clusters or >800 estimated calls** (`realized_savings`: 100).
Over cap: do not chunk silently — refuse with actionable pagination guidance:
"narrow the filter (org/provider/status) to ≤400 clusters". Chunked auto-sequencing is
REJECTED (§6) because it is an auto-fired batch in disguise.

| Scenario | Calls | Estimate @ 8 w (7.9 calls/s, +2 s overhead, ±30 % band) |
|---|---|---|
| 57 clusters × 2 | 114 | **~15–20 s** |
| 241 × 1 | 241 | **~30–40 s** |
| 241 × 2 | 482 | **~60–80 s** |
| 400 × 2 (cap) | 800 | ~100–135 s |
| 1,000 × 2 | 2,000 | ~250–330 s — **REFUSED by cap** |

Burst control: max **1 in-flight batch per session** and **2 per process**
(module-level counter); batch arming disabled while the Tier-1 cold sweep is running.

### 2.4 UX contract (hand-off to Agent 9)

The arm button label is computed before enabling:

```
Enrich {n} clusters · ~{calls} API calls · ~{lo}–{hi} s
lo  = round5(calls / 7.9 × 0.9)      hi  = round5(calls / 7.9 × 1.4 + 2)
```

- n=0 ⇒ disabled with caption "No clusters in the filtered scope".
- n>cap ⇒ disabled with caption + the cap value + filter hint (§2.3).
- While running: `st.status` with done/total, elapsed, live ETA, Cancel button; label
  makes clear data lands as extra fleet columns for 15 min.

---

## 3. Rate-limit posture — re-affirmed with one minimal upgrade

### 3.1 Facts

- Zero `429`/`Retry-After` declarations in the 534-operation spec; zero observed live.
- v1 descope (no token bucket, no 429 adaptive halving, no circuit breaker) was correct
  for a single 631-call sweep.

### 3.2 What changes in v2

Batches add a **second, overlapping burst source under the same API key**: a user can fire
an 800-call batch while another session's Tier-1 sweep is in flight (Streamlit cache is
process-shared; so is the client). Worst sustained rate ≈ 631+800 calls over ~3 min ≈
8–9 req/s average, 16 instantaneous. The unchanged-descope case ("fixed pool + backoff")
still holds, but the marginal cost of reactive insurance is now tiny.

### 3.3 Cheapest adequate design — adopt

**429-reactive permit gate on the `CastAIClient` instance (~40 LOC, zero config):**

- `self._permits` (init = `CASTAI_MAX_WORKERS`, cap 16); every `_request` acquires one
  permit before issue (a `BoundedSemaphore` wrapper) — the single existing chokepoint,
  so Tier-1 sweep, batches, and drill-down loaders all inherit the gate with no pool changes.
- `with_retry` (or `_raise_for_status`) signals on `RateLimitedError`:
  `permits = max(2, permits // 2)`, hold for 60 s, recover +1 per fully clean 60 s.
- Never preemptive: when no 429 occurs, cost is one semaphore acquire (~µs).

### 3.4 Still descoped (re-affirmed)

- Proactive token bucket (20 req/s) — unjustified with zero observed 429s.
- Circuit breaker / full-page auto-retry — batches are explicitly user-armed; aborting a
  batch mid-flight is handled by the cancel token, not a breaker.

---

## 4. Drill-down budget (11 tabs)

### 4.1 Per-tab call lists (verified against v1 loaders + spec)

| # | Tab | Load mode | Calls | Endpoints |
|---|---|---|---|---|
| 1 | Overview | auto (I2) | 1 | `clusters/{id}/overview` |
| 2 | Resources | auto (I2) | 2 | `summary`, `resource-usage` |
| 3 | Cost | armed | 1 | `cost` |
| 4 | Savings | armed | 3 | `estimated-savings`, `savings`, `rightsizing-summary` |
| 5 | Workload Autoscaler | armed | 2 | `workloads-summary`, `policies` |
| 6 | Nodes | armed | 1 +⌈nodes/500⌉−1 (≤50) | `external-clusters/{id}/nodes` paged 500, hard cap 25 k |
| 7 | Issues | armed | 4 | `problematic-nodes`, `problematic-workloads`, `unscheduled-pods`, `agent-status` |
| 8 | Node history (new) | armed | 1 | `node-count-history` — `stepSeconds` mandatory, ≤1,000 points; 60 s read class |
| 9 | Savings history (new) | armed | 1 | `estimated-savings-history`; 60 s read class |
| 10 | Notifications (new) | armed | 1/page | `notifications?filter.clusterId=` page.limit 50; "load more" = explicit next page only |
| 11 | Events / OOM (new) | armed | 1 | `clusters/{id}/workload-event-metrics`, `eventTypes[]=OOMKilled`, windowed |

**Fully-armed worst case: 18 GETs** (≤500-node cluster). Auto-load set stays ≤3 (I2 intact).
With serial in-loader fetches at p50 0.5 s ≈ 9 s + render — at the edge of the 10 s target.
Mitigation: multi-call loaders (Resources 2, Savings 3, WA 2, Issues 4) fetch internally in
parallel via the shared pool → fully-armed cold ≈ 6–8 s.

### 4.2 TTL table update (additions to `performance.md` §4.1)

| Cache entry | TTL |
|---|---|
| `node-count-history`, `estimated-savings-history` | **6 h** (immutable past; long-read) |
| `notifications` (cluster-filtered) | **5 min (300 s)** — fastest churn in drill-down |
| `workload-event-metrics` (OOM, drill-down) | **15 min** |
| Enrichment batch results (session-local, §2.2) | **15 min** |

### 4.3 Guard vs one user arming all tabs of many clusters

- Per-loader `max_entries` (128) on the `@st.cache_data` wrappers — bounds process memory
  when clicking through many clusters (armed flags already reset on cluster switch;
  *cache* entries are what accumulates).
- Armed state is per-`(cluster, tab)` and reset on selection change (v1 behavior, keep).
- Call volume is intrinsically rate-limited by manual arming (≤18 calls per cluster,
  each behind a click); the shared 429 gate (§3) covers the scripted-loop tail.

---

## 5. 1,000-cluster DataFrame

### 5.1 Memory (fleet 43 shipped cols + ~17 enrichment ⇒ ~60 cols × 1,000 rows)

| Layout | Numeric (~30) | Strings (~20) | Datetime/bool | Total live RAM |
|---|---|---|---|---|
| Default (float64 + object) | 1000×30×8 B ≈ 0.24 MB | ~1000×20×~60 B ≈ 1.2 MB | ≈ 0.05 MB | **≈ 2 MB core; 6–10 MB** with index/block/copies |
| + session enrichment dicts (1,000 clusters × ≤8 leaf fields × 5 kinds) | | | | **+1–2 MB** |

Memory is not the constraint (unchanged from v1 conclusion).

### 5.2 Render, export, filter

- Row caps unchanged: ≤25 k rows per `st.dataframe`; fleet frame (1 k) renders whole.
- **CSV export capped at 500 rows** (see §6 REJECT): 500×60 ≈ 0.3–0.5 MB text,
  `to_csv` ~50–150 ms — free. Over 500: caption "export limited to 500 rows; narrow filters".
  (v1 exports the full filtered frame; v2 caps it once enrichment columns land.)
- Filter cost: boolean masks over 1 k × 60 ≈ 2–8 ms — negligible.
- **Fragmented-update pitfall (new):** enrichment merges must NOT re-sort/re-copy the frame
  per cluster. Merge once per batch (§2.2), assign the session snapshot once, one rerun.
  Sorting happens only inside the table fragment (`ui/tables.py`), which already re-sorts on
  demand; never `sort_values` in a shared helper called by every fragment (that is an
  O(rows×cols) re-sort per fragment per rerun — at 11 fragments it is still only ~10 ms,
  but it multiplies Arrow serialization churn 11×).

---

## 6. Acceptance criteria v2

| # | Criterion | Target |
|---|---|---|
| 1 | Cold overview @ 126 orgs, 8 workers, flags OFF (631 calls) | **≤ 90 s p95** (re-baselined from v1's missed 60 s; measured 80 s) |
| 2 | Cold overview, both flags ON (883 calls) — opt-in config | ≤ 120 s p95 @ 8 w; ≤ 75 s @ 16 w |
| 3 | Warm overview (caches hot) | < 5 s p95 |
| 4 | Batch, 50 clusters × 2 calls (100 calls) | ≤ 20 s p95 |
| 5 | Batch, 200 clusters × 1 call / × 2 calls | ≤ 35 s / ≤ 60 s p95 |
| 6 | Drill-down tab arm, cold (≤4-call tabs) | ≤ 10 s p95 |
| 7 | Drill-down long-read history tabs cold | ≤ 15 s p95 |
| 8 | Fully-armed drill-down, warm (11 tabs, all cache hits) | < 5 s |
| 9 | Table interactions (sort/filter/paginate) | < 1 s, 0 API calls |
| 10 | Tier-1 call assertion | ≤ 1 + 7×N (runtime-asserted); hard-stop 950 |
| 11 | 429 rate | < 1 % of calls; gate halves within 1 s of first 429 |

**Explicitly REJECTED in v2 (in addition to v1 §8):**

1. **Auto-fired batches** — batches are only ever button-armed by a user; no auto-chaining,
   no background prefetch, no auto-sequencing of >400-cluster scopes.
2. **Per-cluster calls in Tier-1** — flags stay org-level only; 1+7N is the hard ceiling;
   org-level OOM sweep (which would make 1+8N) is rejected from Tier-1.
3. **>500-row uncapped CSV export** — cap at 500 rows of the current filtered view.
4. **Realized-savings batch on >100 clusters** — kind-level cap 100 (long-read windowed
   report endpoint; 100 calls ≈ ~15–25 s).
5. Batches executed inside `st.cache_data` (double-pool hazard; §2.2).
6. Prefix/unprefixed enrichment writes into Tier-1 columns in place (session-join only).

**Verification plan (build phase):** replay harness asserting call counters per flag
combination and per batch kind; chaos injection 5 % 429/503 verifying gate halving ≤1 s,
batch partial-merge on cancel; RSS + wall-time capture at 126 orgs/1 k clusters; assert
no API calls on sort/filter interactions.
