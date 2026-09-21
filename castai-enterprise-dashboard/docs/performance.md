# Performance Architecture — CAST AI Enterprise Dashboard

Status: **design document** (no app code here).
Audience: implementers of the Streamlit dashboard.

Scale assumption (hard requirement):

- ~120 child organizations, ~1,000 clusters, ~10,000 nodes, thousands of workloads.
- Streamlit re-executes the whole script on every interaction unless caching/fragments isolate work.
- The app must **never** fan out to ~1,000 clusters × ~10 endpoints ≈ 10,000 API calls to render a page.

Evidence base: `docs/openapi/castai-openapi.json` (OpenAPI 3.0.1, 423 paths, auth = `X-API-Key` header or Bearer JWT).
Cross-refs: `docs/api-matrix.md`, `docs/data-model.md`, `docs/ux-design.md` (sibling design docs; read when available).

---

## 1. Request budget model

### 1.1 Endpoint classes (from the spec)

| Class | Endpoints | Used at |
|---|---|---|
| Discovery (1 call each) | `GET /v1/organizations` (returns all orgs incl. `parentId` → child-org tree), `GET /v1/kubernetes/external-clusters` (all clusters, `items[]`) | Tier 1 |
| Org-level aggregates | `GET /v1/cost-reports/allocation-group-summaries`, `GET /v1/cost-reports/allocation-group-totals` (`startTime`, `endTime`, optional `clusterIds[]` filter), `GET /pricing/v1/organizations/{organizationId}/clusters/prices` (paginated), `POST /v1/cost-reports/clusters/active` (batch "which clusters have metrics") | Tier 1 |
| Per-cluster detail | `GET /v1/cost-reports/clusters/{clusterId}/{summary,efficiency,cost,savings,overview,node-count-history,...}`, `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` | Tier 2 (lazy, after cluster selection) |

### 1.2 Tier 1 call-count model

```
calls_tier1 = 2 (discovery) + N_orgs × k
k = 3..5 org-level endpoints per org (allocation summary, totals, prices, active-check, optional reservations/balance)
```

| N=120 orgs | k=3 | k=4 | k=5 |
|---|---|---|---|
| **Total calls** | **362** | **482** | **602** |

### 1.3 Projected wall-clock (p50 = 300 ms/call)

Ideal model: `waves = ceil(calls / workers)`, `t = waves × 0.3 s`.
Realistic model adds a ×1.2–1.3 overhead factor (p95 tail, TLS setup, JSON parse, retry jitter).

| Workers | k=3 (362) | k=4 (482) | k=5 (602) |
|---|---|---|---|
| 1 (naive sequential) | 108.6 s | 144.6 s | 180.6 s |
| 8 | 13.8 s → **~17 s** | 18.3 s → **~22 s** | 22.8 s → **~28 s** |
| 16 | 6.9 s → **~9 s** | 9.3 s → **~11 s** | 11.4 s → **~14 s** |
| 32 | 3.6 s → **~5 s** | 4.8 s → **~6 s** | 5.7 s → **~7 s** |

Plus ~2–4 s for transform + render ⇒ **cold overview ≈ 20–35 s at 8 workers**, comfortably inside the 60 s acceptance target even with retries. Concurrency 16 halves that but raises rate-limit risk (§3); **8 is the default**.

### 1.4 Contrast with the naive per-cluster design

1,000 clusters × 10 endpoints = **10,000 calls**:

| Workers | Wall-clock | Verdict |
|---|---|---|
| 1 | 50 min | unusable |
| 8 | ~6.3 min (ideal) | unusable + near-certain 429 throttling |
| 16 | ~3.1 min (ideal), ~4 min realistic | still unusable |
| 32 | ~1.6 min ideal | unusable at p95 tails; rate-limit storm |

The per-cluster design also fails catastrophically on any 429 (see §3) and transfers 27× more data than needed for a summary page. **Rejected** — see §8.

### 1.5 Degradation ladder if scale grows

| Trigger | Action |
|---|---|
| N_orgs > 150 | Drop per-org loop for cost; use `allocation-group-totals` / `-summaries` with `clusterIds[]` batching (aggregated, few calls) and fetch per-org values only on drill-down. |
| N_orgs > 300 | Overview shows Top-N orgs by cost (N≤20) + "Other" rollup; full table paginated server-side. |
| calls_tier1 > 750 | Hard-stop: refuse full load, require a narrower org/date filter. Enforced by a call-budget counter (§7). |

---

## 2. Concurrency design

### 2.1 Recommendation: `ThreadPoolExecutor` + synchronous client (requests or `httpx.Client`)

**Chosen:** thread pool with one sync client per worker thread (`threading.local`), orchestrated with `as_completed`.

**Why not `httpx.AsyncClient`/asyncio:** viable in theory, but in Streamlit it is the worse default:

1. Streamlit's script runs synchronously on a ScriptRunner thread; every async fan-out must be wrapped in `asyncio.run()` per rerun, which creates/destroys an event loop per run and composes poorly with `st.cache_data` pickling, progress callbacks (`st.progress`), and exception surfacing. Threading is transparent to Streamlit and tested by the whole ecosystem.
2. Failures: with threads, per-org exceptions are ordinary Python exceptions captured from futures; with asyncio inside Streamlit, exception/traceback plumbing through `asyncio.run` obscures per-org partial-failure reporting.
3. The workload is strictly IO-bound over HTTPS (TLS handled in C); the GIL is irrelevant here. 8–16 threads fully saturate the achievable client-side parallelism for 300 ms remote calls.
4. A future background-fetch service could switch to asyncio internally with no UI change — the API boundary (`fetch_org_bundle(org_id) -> DataFrame`) stays identical.

### 2.2 Worker limits

- **Default `max_workers=8`**, env-tunable `CASTAI_MAX_WORKERS` (shipped name), clamped to **4..32**.
- 8 workers × ~300 ms p50 ≈ sustained ~20–25 req/s worst case — already aggressive; anything beyond 16 buys little (see §1.3, 16→32 gains ~4 s) and multiplies 429 exposure.

### 2.3 Task granularity and failure isolation

- Task = **one org bundle**: `fetch_org_bundle(org_id, date_range) -> dict[endpoint, payload | error]`, executed as a single future per org. This bounds per-future latency (k sequential calls within the task, k×0.3 s ≈ 1–1.5 s), keeps per-org context for logging, and makes the unit of retry/abort an org.
- Futures are collected with `as_completed` into a progress bar + a partial-failure registry: `results: dict[org_id, OrgResult]` where `OrgResult.errors` lists endpoint/status/attempts. **One org's failure never aborts the page** — it renders with a ⚠️ badge and its data excluded from totals, with the exclusion counted in the UI.

### 2.4 Timeout policy

| Phase | Connect | Read | Total ceiling per task (incl. retries) |
|---|---|---|---|
| Org aggregates (Tier 1) | 5 s | 30 s | 120 s |
| Cluster detail (Tier 2) | 5 s | 30 s | 90 s |
| Historical 90-day series | 5 s | 60 s | 180 s |

Rationale: cost-report queries are server-aggregated and can be slow on first touch; the read timeout must tolerate that, while the total ceiling prevents one wedged org from stalling the thread pool.

### 2.5 Retry policy

- **Retriable:** `429`, `500`, `502`, `503`, `504`. Network connect/read errors: retriable. **Shipped v1:** `408` is treated as a non-retryable error (mapped to `CastAIError`); WARN-level divergence from this doc's original plan ("408 retry once"), accepted at final review (2026-09-21).
- **Never retried:** `401`/`403` (credential/scope problem — fail fast, raise a prominent UI banner naming the org and required scope), and all other 4xx (client bug).
- **Shape:** attempts = 4 total (1 + 3 retries); backoff = `min(0.5 × 2^n + full_jitter(0–1 s), 15 s)`; **honor `Retry-After`** when present (seconds or HTTP-date), clamped to [1 s, 30 s] — clamp-recorded in logs.
- Retry counter is part of instrumentation (§7); a cluster of retries across many orgs trips the circuit breaker (§3.3).

---

## 3. Rate-limit posture

### 3.1 Spec evidence

Exhaustive scan of the 423-path spec:

- **Zero operations declare a `429` response; zero `Retry-After` mentions.** The only "rate limit" strings in the file belong to an unrelated product surface (`RateLimitConfig` for AI model configs, requests-per-minute for a model) — they do not govern the REST management API.
- Conclusion: **rate limits are undocumented.** We must assume they exist, assume they are strict, and make our stance configurable.

### 3.2 Proposed limiter (defense in depth, both cheap to implement)

1. **Fixed-concurrency limiter (primary).** The thread pool itself is the limiter: at 8 workers and ~300 ms calls the theoretical ceiling is ~26 req/s, the observed rate closer to 15–20 req/s. We additionally pace task submission with a minimum inter-launch delay (`pace = 0.05 s`) to avoid 8-burst starts.
2. **Token bucket (secondary, global across reruns).** A process-wide bucket, refill **20 tokens/s, capacity 40**, stored outside session state (module-level, not per-user). This caps burst behavior when several browser sessions refresh simultaneously (Streamlit cache is process-shared; the bucket must be too). *(v1 descoped — see architecture.md §4)*

### 3.3 Adaptive degradation on 429 *(both mechanisms v1 descoped — see architecture.md §4)*

- On any 429: halve effective concurrency (floor 2) for 60 s; recover +2 workers per clean minute back to the configured value. *(v1 descoped — see architecture.md §4)*
- **Circuit breaker:** 5 consecutive org-bundle failures dominated by 429/5xx ⇒ abort remaining futures, render partial data with a clear banner ("CAST AI is throttling/degraded; N of 120 orgs loaded — Refresh to retry"), and stop issuing calls for 60 s. Never auto-retry a full-page load. *(v1 descoped — see architecture.md §4)*

---

## 4. Streamlit caching plan

### 4.1 TTL table (`@st.cache_data`)

| Cache entry | Endpoint(s) | TTL | Notes |
|---|---|---|---|
| Org + cluster inventory | `GET /v1/organizations`, `GET /v1/kubernetes/external-clusters` | **15 min** (900 s) | membership changes rarely; manual Refresh overrides |
| Active-clusters batch check | `POST /v1/cost-reports/clusters/active` | **15 min** | used to skip metric-less clusters in Tier 2 lists |
| Org cost summaries/totals (default 30 d) | `allocation-group-summaries`, `allocation-group-totals` | **30 min** (1800 s) | provider billing data lags hours anyway |
| Org cluster unit prices | `pricing/.../clusters/prices` | **6 h** | prices are quasi-static |
| Cluster detail bundle | `clusters/{id}/summary`, `/efficiency`, `/overview`, `/savings` | **15 min** (900 s) | Tier 2, keyed per cluster+range |
| Cluster nodes | `external-clusters/{id}/nodes` | **10 min** (600 s) | nodes churn fastest |
| Historical daily series (≤90 d, per cluster) | `clusters/{id}/cost`, `node-count-history` | **6 h** (21600 s) | past data immutable → long TTL safe |
| Dimension data (org metadata, roles) | various `/v1/organizations/...` | **24 h** | |

### 4.2 Cache-key design and the secret-exclusion problem

**Problem.** `st.cache_data` hashes *all function arguments* into the cache entry key and pickles them into the on-disk cache store. If `api_key` were a function argument, the secret would be (a) serialized in plaintext into local cache artifacts, (b) echoed in tracebacks/logs that include call args, and (c) easy to exfiltrate with any cache dump. **The API key must never be an argument to a cached function.**

**Solution.**

- Build the HTTP client **inside** the cached function body: read `CASTAI_API_KEY` / `st.secrets` there, construct the authenticated client locally, and return only data plus non-secret metadata.
- Key = `(base_url, tuple(sorted(org_ids)), start_date, end_date, flags...)` — all non-secret. For multi-credential safety add `cred_fingerprint = sha256(api_key)[:12]` (a hash, not the secret; changes if the key rotates, so stale entries can't be served under a different credential).
- All key args must be plain hashable values: no DataFrames, no client objects, no sets (use sorted tuples).

### 4.3 Manual invalidation

- Sidebar **"Refresh data"** button → call the per-function `.clear()` for Tier-1/Tier-2 fetch functions (scoped clearing), **not** a blanket `st.cache_data.clear()` in normal use; full clear reserved for a "Hard reset" esc/action.
- Every badge that shows partial failure links to refresh; a stale-data indicator shows cache age ("data as of HH:MM, refreshed every 30 min").

### 4.4 Fragments and rerun cost

- **Critical pitfall:** `st.tabs` renders *all* tab bodies on every run — tabs are visual, not lazy. Tier-2 tab content must be gated behind explicit user choice (selected cluster in session state + per-tab Load button or fragment), or per-tab fetches will execute on every rerun. Recommended: each Tier-2 tab body is a `@st.fragment` that only executes when its controls change, and its fetch functions flip through the §4.1 caches.
- Table widgets (sort selectbox, filter inputs, page selectors, column toggles) live inside `@st.fragment`-wrapped components so interacting with them reruns only the fragment — **zero API calls, zero rehash**.

### 4.5 Overview-page rerun cost budget

| Rerun type | API calls | Work | Target |
|---|---|---|---|
| Cold (first load / after TTL or Refresh) | ≤ 602 (§1.2) | fetch 14–28 s + transform 1–2 s + Arrow render 1–2 s | **< 60 s** |
| Warm (any top-level widget outside fragments) | 0 | all cache hits; CPU ~100–300 ms; Arrow serialize ~100–300 ms | **< 5 s** |
| Fragment interaction (sort/filter/paginate) | 0 | fragment-only rerun | **< 1 s** |

---

## 5. DataFrame memory / CPU

### 5.1 Memory estimates

**Cluster table: 1,000 rows × ~35 cols** (~18 numeric, ~10 string [status, provider, org, region, name…], ~5 datetime, 2 bool):

| Layout | Numeric | Strings | Datetime/bool | Total live RAM |
|---|---|---|---|---|
| Default (float64 + object) | 1000×18×8 B ≈ 0.14 MB | ~1000 × 10 × ~80 B ≈ 0.8 MB | ≈ 0.05 MB | **≈ 1 MB core; 3–6 MB with index/block/copies overhead** |
| Optimized (float32 + `category` for ≤50-distinct cols) | ≈ 0.07 MB | ≈ 0.02 MB codes + small category sets | same | **≈ 0.5–2 MB** |

**Node table: 10,000 rows × ~20 cols** (~10 numeric, ~6 string [node name is high-cardinality ~10k distinct; instance type, zone, provider, status, cluster are low-cardinality], 2 datetime, 2 bool):

| Layout | Numeric | Strings | Total live RAM |
|---|---|---|---|
| Default | 10k×10×8 B ≈ 0.8 MB | object ≈ 4.5–5 MB | **≈ 6–9 MB** |
| Optimized (float32; category for the 5 low-cardinality strings) | ≈ 0.4 MB | ≈ 1 MB (node names stay object) | **≈ 2–4 MB** |

Rules: parse numeric cost columns as float32 only after confirming precision needs (float32 has ~7 significant digits — fine for €/$ costs to a cent below ~16.7 M; use float64 for any cumulative/absolute totals that can exceed that, or store cents as int64 for exactness); casting everything blindly to float32 is rejected. Default conclusion: **both tables fit comfortably under ~10 MB; memory is not the constraint — serialization and rendering are.**

### 5.2 CPU and rendering

- Vectorized sort of 10k × 20 ≈ 5–15 ms; boolean-mask filters ≈ 1–5 ms; Top-N groupby ≈ 10 ms. Negligible.
- Cost is the Arrow serialization + browser render: 10k × 20 ≈ 1–2 MB Arrow payload, ~50–150 ms to serialize. `st.dataframe` (glide-data-grid) virtualizes rows client-side and handles 10k rows well; **~25k+ rows per payload is the danger zone** (serialization grows linearly and browser memory suffers).
- Policy: render at most **25k rows** per `st.dataframe`; above that aggregate or slice. Pagination via a fragment-local page selector slicing the cached frame (50–100 rows/page) for the node table; the 1k-row cluster table renders whole. Do not use `st.data_editor` for read-only views; avoid Styler on >1k-row frames (Python-side per-cell HTML generation, the classic Streamlit perf trap).

---

## 6. Historical / time-series handling

- Per-cluster daily cost series ≈ 90 points × ~50 B ≈ **≤ 5 KB raw JSON per cluster** — but × 1,000 clusters ⇒ 5 MB JSON / 10–30 MB with API envelope overhead, and 1,000 calls. **Per-cluster history is therefore Tier 2/3 only, never Tier 1.**
- **Tier 1 hard bounds:**
  - Single date range per load; **default last-30-days, maximum 31 days** for org-level summaries (90 d selectable only on dedicated report views, not the overview).
  - Only *aggregated* history at load: `allocation-group-summaries` with the org's `clusterIds[]` — one response per org, server-side rolled up.
  - Chart series at Tier 1 are org-level or Top-N-cluster-level (N ≤ 10–20 selected on already-fetched aggregates); never a line per cluster.
- Tier 2 (one selected cluster): daily series up to **90 d**, cached 6 h; `node-count-history` requests must pass `stepSeconds` so buckets ≤ ~1,000 points (server-side down-sample, never client-side).
- Degradation triggers: if a Top-N chart payload > ~1 MB Arrow, raise step/reduce N; if 90 d selected at Tier 2 show expected-fetch time hint.

---

## 7. Instrumentation

- **Per-request structured log** (JSON line to stderr, scrapable): `{ts, level, event:"api_call", tier, endpoint_class, org_id, status, latency_ms, attempt, retried, cache:"hit|miss|bypass", bytes}` — never log the API key or response bodies.
- **Aggregates in `st.session_state["metrics"]`** (per session) plus a process-level registry: `calls_total`, `failures_total{status}`, `retry_total`, latency p50/p95/p99 per endpoint class, cache hit ratio, last refresh wall duration per tier.
- **UI surface:** sidebar/expander "Data freshness & performance": last refresh duration, calls made, failures, cache-age badges, 429 count. Cold loads show `st.progress` across org futures with `(done/total, elapsed, ETA)`; the ETA uses observed p50.
- **Call-budget guard:** a module-level counter asserts `calls_this_refresh ≤ budget` (§1.5); exceeding budget logs an error and is caught by tests/alerts.

---

## 8. Performance acceptance criteria

| # | Criterion | Target |
|---|---|---|
| 1 | Cold overview @ 120 orgs (empty cache) | **< 60 s p95** (design point 20–35 s @ 8 workers) |
| 2 | Warm overview (all caches hot, any widget rerun) | **< 5 s p95** |
| 3 | Cluster drill-down tab, cold | **< 10 s p95** (5–8 calls) |
| 4 | Cluster drill-down tab, warm | **< 2 s** |
| 5 | Table interactions (sort/filter/paginate) | **< 1 s, exactly 0 API calls** |
| 6 | Tier-1 call budget | ≤ `2 + N_orgs × 5` (≤ 602 @ 120 orgs), asserted at runtime |
| 7 | 429 rate | < 1% of calls; zero full-page auto-retries |
| 8 | Peak frontend payload | ≤ 25k rows per dataframe; ≤ ~5 MB Arrow per rerun |

**Designs explicitly REJECTED:**

1. Per-cluster fan-out at page load (10,000-call design, §1.4) — violates every criterion above.
2. Unbounded/thread-per-org pools (`max_workers=N_orgs`) or any pattern without a concurrency cap — multiplies 429 risk and memory.
3. Cache keys containing the API key or any client/credential object (§4.2) — secrets leak into pickled cache artifacts and tracebacks.
4. Refetching on widget interaction (no fragments, fetch calls in top-level script flow) — turns every slider into an API storm.
5. Blind float32 downcast of monetary totals — precision loss; use float64/int64-cents where magnitudes warrant (§5.1).
6. `st.tabs` assumed to be lazy — it is not; ungated per-tab fetches re-execute on every rerun (§4.4).
7. Sequential per-org fetching loop (`for org in orgs: requests.get(...)`) — 108–181 s floor at p50=300 ms (§1.3).
8. Auto-retrying the full page after circuit-breaker trip — converts an API outage into a self-inflicted DoS.

**Verification plan (for the build phase):** transport-level mock harness replaying recorded responses; assert call counter ≤ budget per scenario; chaos runs injecting 5% 429/503 (verify backoff, circuit breaker, partial render); load snapshot at 120 orgs × 1 k clusters × 10 k nodes with RSS and wall-time capture for criteria 1–8.
