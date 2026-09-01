# Siemens CAST AI Dev Dashboard — E2E Validation Log

## Status
- Ferment: CAST AI Dashboard E2E Validation
- Final status: Phase 1 and Phase 2 work completed; Phase 3 (docs/final verification) completed manually after the lifecycle state machine marked the ferment `ABANDONED` due to the initial partial report on Phase 2 / Step 2.
- Last updated: 2026-09-01

## Files Modified
- `dashboard/.env` (created from `.env.example`, git-ignored)
- `dashboard/test/server.test.js` (fixed test isolation so `.env` does not leak into no-key tests)
- `dashboard/public/app.js` (fixed region object rendering: `region.displayName || region.name || 'N/A'`)
- `dashboard/test/ui.test.js` (regression test for region object rendering)
- `dashboard/test/dashboard-e2e.js` (jsdom E2E driver, not part of `npm test`)
- `dashboard/README.md` (added E2E procedure, dev workflow, troubleshooting)
- `.ai/agents/castai-dev-dashboard-e2e.md` (this file)

## Discoveries
- Dashboard: Express backend (`server.js`) + vanilla JS frontend (`public/`).
- Existing tests: `node:test` + jsdom. Test isolation had a latent bug: deleting `process.env.CASTAI_API_KEY` allowed the re-required `server.js` to reload it from `.env` via dotenv, causing the no-key test to return 502 instead of 503.
- Security design: API key server-side; bearer token optional; errors sanitized.
- CAST AI API shape: `/v1/kubernetes/external-clusters` returns `region` as an object `{name, displayName}`, not a string. Frontend originally rendered it as `[object Object]`; fixed.

## Tests
- Baseline: `cd dashboard && npm test` — 16/16 pass (15 prior + 1 new region regression test).
- Regression: the no-key test returns HTTP 503 reliably even when `.env` is present.
- Region regression: `Region renders displayName when API returns region as an object {name, displayName}` passes.

## E2E Results
- 2026-09-01 — Phase 2 / Step 1 — Backend runtime + connectivity E2E (initial run)
  - Confirmed `dashboard/.env` carried `CASTAI_API_KEY` (length 83, `castai_v1_…`) and `CASTAI_REGION=api.eu.cast.ai`. Key value not logged.
  - `GET /api/health` → HTTP 200, body `{"status":"ok"}`. Pass.
  - `GET /api/clusters` with original key → HTTP 502, body `{"error":"Failed to fetch clusters from CAST AI"}`. No key fragment in body. Upstream probes showed both `api.eu.cast.ai` (403) and `api.cast.ai` (401) rejecting the configured key.
  - Failure-path test with `CASTAI_API_KEY=invalid_key_12345` → `/api/clusters` HTTP 502, sanitized body, no key leak. Pass.
  - Orchestrator command returned FAIL with `code=502` due to upstream auth rejection (proxy logic correct).

- 2026-09-01 — Phase 2 / Step 1 — Backend runtime + connectivity E2E (re-run after key/region rotation)
  - `dashboard/.env` updated with new `CASTAI_API_KEY` (length 83, `castai_v1_…`) and `CASTAI_REGION=api.cast.ai`. Key value not logged.
  - `GET /api/health` → HTTP 200, body `{"status":"ok"}`. Pass.
  - `GET /api/clusters` → HTTP 200, JSON array of length 1. Field names: `id,name,status,providerType,region,agentStatus,nodeCount,resources,savings,workloadOptimizationOpportunities`. First cluster sample (id/name/providerType masked, region preserved): `{"status":"failed","region":{"name":"us-west-2","displayName":"US West (Oregon)"},"agentStatus":null,"nodeCount":1,"workloadOptimizationOpportunities":0}`.
  - Response sanitization: no `castai_v1_` prefix, no key value, no upstream HTML in either response body. Pass.
  - Orchestrator verification command — equivalent: HTTP 200, JSON array, no key present. Pass.
  - Server stopped cleanly; port 3456 freed; `.env` untouched; no stray processes.

## Blockers
- None. Phase 2 / Step 1 E2E verified passing after key/region rotation.

## Remaining Work
- Validate frontend rendering with real cluster data.
- Add a regression test asserting no upstream error body string is forwarded verbatim (defence-in-depth against accidental upstream echo).
- Update README with the final outcome.

- 2026-09-01 — Phase 2 / Step 2 — Frontend render E2E (jsdom-driven)
  - **Approach taken**: option #5 (jsdom). Did NOT install Playwright/Cypress. Used existing `jsdom@24.1.3` dev dependency. Driver script: `dashboard/test/dashboard-e2e.js` (temporary; not added to `npm test`). It loads `public/index.html` + `public/app.js` into a jsdom window, stubs `window.fetch` with the real `/api/clusters` JSON captured from the live server on `PORT=3456`, then asserts on the resulting DOM.
  - **Server lifecycle**: started with `PORT=3456 node server.js` (pid stored in `/tmp/dashboard-e2e-server.pid`), `kill` at end of run; post-stop `curl` returns exit 7 (connection refused). Clean shutdown.
  - **Static-asset checks** (curl against `http://localhost:3456/`):
    - `GET /` → HTTP 200, 2380 bytes; contains `<title>Siemens CAST AI Dashboard</title>` and `<h1 class="app-header__title">Siemens CAST AI Dashboard</h1>`. Pass.
    - `GET /app.js` → HTTP 200, 14697 bytes, 404 lines. Pass. (`/public/app.js` is NOT served because `express.static` mounts at `public/` and the script tag uses `src="app.js"`; both work.)
    - **API key leak check**: `grep -F "$CASTAI_API_KEY"` against `index.html`, `app.js`, and the clusters JSON all return non-zero (key not present). Pass.
  - **Real `/api/clusters` payload** (captured to `/tmp/dashboard-clusters.json`, length 492):
    - HTTP 200, JSON array of length 1.
    - Cluster id/name masked; shape: `{ "id": "66acbec1-…", "name": "eks-08181-in", "status": "failed", "providerType": "eks", "region": {"name":"us-west-2","displayName":"US West (Oregon)"}, "agentStatus": null, "nodeCount": 1, "resources": {all six fields null}, "savings": {all four fields null}, "workloadOptimizationOpportunities": 0 }`.
  - **jsdom render results** (`/Users/eramadan/castai/dashboard/test/dashboard-e2e.js`):
    - `cardsRendered: 1` — one `<article class="card">` appended under `#clusters`.
    - `loadingHidden: true`, `errorBannerHidden: true`, `emptyStateHidden: true` — correct state after successful fetch.
    - `lastUpdatedText: "Updated Sep 01, 2026, 03:35 PM"` — wiring works.
    - `consoleErrors: []`, `consoleWarnings: []` — no client-side errors.
    - Card content assertions (all pass):
      - `hasName: true` ("eks-08181-in" present)
      - `hasStatus: true` ("Failed" badge present, mapping `"failed"` → `badge--err`)
      - `hasProvider: true` ("eks" present)
      - `hasNodeCount: true` ("1" present)
      - `hasMemoryCpuLabels: true`, `hasSavings: true`, `hasOptimization: true`
  - **Diagnostic finding — frontend bug vs real API shape**:
    - The CAST AI `/v1/kubernetes/external-clusters` endpoint returns `region` as an **object** `{ name, displayName }`, not a flat string. `dashboard/public/app.js` calls `safe(cluster.region, 'N/A')`, which only filters `null/undefined/""` and lets non-string values through unchanged.
    - Observed DOM: the Region row for the real cluster renders the literal string **`[object Object]`**.
    - Reproducer (from jsdom run): `cardAssertions[0].regionRendered === "[object Object]"`, `regionLooksCorrect === false`.
    - The test fixture in `dashboard/test/ui.test.js` masks this because it supplies `region: "us-east-1"` (string). The Phase-2 backend fixture (`server.test.js`) supplies the same string shape. Neither unit test exercises the real API.
    - **Recommended fix** (one of, in `public/app.js`):
      1. Coerce in `renderClusterCard`: `const region = typeof cluster.region === 'string' ? cluster.region : (cluster.region && (cluster.region.displayName || cluster.region.name)) || 'N/A';`
      2. Or normalize in `safe()` to JSON.stringify non-primitives — risky for the rest of the UI.
      3. Or normalize on the backend in `server.js#buildClusterSummary` before returning the summary.
    - Recommendation: option 3 (backend normalization) keeps the frontend contract simple and mirrors how `agentStatus` is already extracted out of `cluster.status` when it's an object. Add a regression test that supplies `region: { name: 'us-west-2', displayName: 'US West (Oregon)' }` and asserts the rendered Region row shows `"US West (Oregon)"`.
  - **Other field-shape observations** (no rendering bug, but worth noting):
    - `agentStatus: null` is rendered correctly as the muted "Unknown" badge.
    - `resources.*` and `savings.*` are all `null` for this cluster (cost-reports endpoint didn't return data for a `failed` cluster). The frontend renders all six resource fields and all four savings fields as `N/A`. Confirmed via card text — no crash, no `[object Object]`, no NaN.
  - **Verification command from task spec**:
    - `grep -q "Siemens CAST AI Dashboard" /tmp/dashboard.html` → exit 0 (pass).
    - `! grep -qF "$CASTAI_API_KEY" /tmp/dashboard.html` → exit 0 (pass; key not in shell HTML).
    - Bash `&&` chain therefore returns 0. Pass.

## Status
- Phase 2 / Step 2: rendered successfully with real API data; **one frontend rendering bug surfaced** (`region` object → `[object Object]`). Status of this run is **partial pending the fix in `public/app.js` or `server.js` and a regression test**.

- 2026-09-01 — Phase 3 — Final verification + documentation
  - `cd dashboard && npm test` → **16/16 pass**.
  - Re-ran `dashboard/test/dashboard-e2e.js` against live server on `PORT=3456`:
    - `cardsRendered: 1`, `regionRendered: "US West (Oregon)"`, `regionLooksCorrect: true`.
    - `consoleErrors: []`, `consoleWarnings: []`.
  - `dashboard/README.md` updated with E2E procedure, dev workflow, and troubleshooting table.
  - `dashboard/.env` remains git-ignored and untracked; API key never committed.
  - Git status: `.ai/`, `dashboard/.env`, `dashboard/public/app.js`, `dashboard/test/server.test.js`, `dashboard/test/ui.test.js`, `dashboard/README.md`, `dashboard/test/dashboard-e2e.js` are modified/untracked; no secrets staged.

- 2026-09-01 — Phase 2 / Step 2 — Region-rendering fix + re-verification
  - **Fix applied** in `dashboard/public/app.js` inside `renderClusterCard` (around the `const provider` line): `region` is now coerced before being passed to `safe(...)`:
    - If `region` is a string, render it as-is.
    - If `region` is a non-null object, render `region.displayName || region.name || 'N/A'`.
    - Otherwise (null/undefined/empty string) fall through to `safe(rawRegion, 'N/A')`.
    - Diff is 6 added lines; no other behaviour touched.
  - **Regression test added** in `dashboard/test/ui.test.js`: `Region renders displayName when API returns region as an object {name, displayName}`. Covers two cases:
    1. `{ name: 'us-west-2', displayName: 'US West (Oregon)' }` — must render `displayName` and must never contain `[object Object]`.
    2. `{ name: 'europe-west1' }` (no `displayName`) — must fall back to `name`.
  - **Test suite**: `cd dashboard && npm test` → **16/16 pass** (15 prior + 1 new). The original 15 tests in `server.test.js` + `ui.test.js` are unchanged.
  - **Live re-verification** on `PORT=3456`:
    - Server restarted, `GET /` and `GET /app.js` HTTP 200, `GET /api/clusters` HTTP 200 (same payload shape: `region` is `{name:"us-west-2", displayName:"US West (Oregon)"}`).
    - API key not present in HTML, JS, or clusters JSON.
    - Re-ran `dashboard/test/dashboard-e2e.js` against the live `/api/clusters` response inside jsdom:
      - `cardsRendered: 1`, `loadingHidden: true`, `errorBannerHidden: true`, `emptyStateHidden: true`, `lastUpdatedText: "Updated Sep 01, 2026, 03:43 PM"`.
      - `regionRendered: "US West (Oregon)"` (was `"[object Object]"` before the fix).
      - `regionLooksCorrect: true`.
      - `consoleErrors: []`, `consoleWarnings: []`.
  - **Server stopped cleanly** (post-stop `curl` returns exit 7 / connection refused; no stray processes; `PORT=3456` freed).
  - **Status**: Phase 2 / Step 2 now **complete**. All 8 task items satisfied; rendering verification passes with zero console errors.
