# Enterprise Model — v2 Validation Refresh (2026-09-21)

> Focused re-validation of `docs/enterprise-hierarchy.md` v1 (same-day v1
> verification), plus failure-matrix gap closure. **NOT a rewrite** — the v1
> model stands. All probes were read-only GETs (3 of the allowed 5 used; no
> POST/PUT/PATCH/DELETE; the API key was never printed). Temp probe payloads
> were deleted after analysis.

---

## 1. Live re-verification (3 GETs)

| Probe | Result | Delta vs v1 record |
|---|---|---|
| G1 `GET /v1/organizations` | HTTP 200, **129 orgs**: 1 `ORGANIZATION_TYPE_ENTERPRISE` + **125** `ORGANIZATION_TYPE_CHILD` + 3 `ORGANIZATION_TYPE_DEFAULT` | **0 delta** (129/125 as recorded; the 122 figure was an earlier historical probe) |
| G2 `GET /v1/kubernetes/external-clusters` + `X-CastAi-Organization-Id: 43b8288a-…` (child "Siemens Dev") | HTTP 200, **7 clusters**; echoed `organizationId` == header | unchanged — header still load-bearing, count stable |
| G3 same endpoint, **no header** | HTTP 200, **0 clusters** | unchanged — key has no implicit all-orgs view |

- Enterprise root unchanged: `Siemens AG`, `8b69b8da-00d6-47e6-8af0-a36ab02b9847`,
  `parentId` absent. All 125 CHILD orgs parent to it; 0 CHILD orgs with
  null/foreign parent. DEFAULT orgs still `CAST AI EU`, `Siemens-test`,
  `Siemens-test-on`.
- **New wire observation:** proto3 JSON **omits null/default fields** — the
  first org object arrives without the `parentId`/`childOrderId` keys at all
  (v2 sample keys: `blockEscalatedPrivilege, createdAt, id, internal, name,
  organizationMember, type`). v1's "superset" key list is not guaranteed per
  object. Code is already tolerant (`raw.get("parentId") or None`,
  `raw.get("childOrderId")` unused) — **confirmed compatible**; state this in
  the hierarchy doc's assumptions.

**Membership-delta handling:** child count and names are expected to drift;
discovery re-runs on every cache miss/refresh (TTL 15 min + Refresh bump).
Nothing in code assumes 125/129.

## 2. Failure-matrix validation (code-verified)

Pipeline: `castai_client._request` → typed error (`_raise_for_status`,
`utils/errors.py`) → `with_retry` (4 attempts, exp backoff + full jitter,
Retry-After clamped 1–30 s) → `cluster_service._fetch_bundle` per-endpoint
try/except → `FetchError(org_id, org_name, operation, sanitized_message)` +
payload `None` → `_org_rows` (union of ids; zero rows only when all 5
payloads are `None`) → `build_fleet_dataframe` (belt-and-braces future-level
catch, `operation="org_bundle"`) → `render_org_health_banner`.

| Status | Typed error | Retried? | Per-org outcome | UI surface today |
|---|---|---|---|---|
| 401 | `AuthError` | **no** (fail fast) | per-endpoint FetchError; org zero-rows if all 5 fail | hard error only when it hits the orgs call (fatal); else banner detail line |
| 403 | `PermissionDeniedError` | **no** | **isolated per endpoint** — a 403 on e.g. `report` only does not kill the org's other 4 payloads | banner detail line |
| 404 | `NotFoundError` | **no** | same per-endpoint isolation | banner detail line |
| 429 | `RateLimitedError` (+`retry_after`) | **yes**, 4 attempts, honors Retry-After | FetchError only after exhaustion | banner detail line |
| 5xx | `ServerError` | **yes** | idem | banner detail line |
| timeout | `ApiTimeoutError` | **yes** (connect 5 s/read 30 s, 60 s heavy) | FetchError after exhaustion | banner detail line |
| network/DNS | `ServerError` ("connection failed") | **yes** | FetchError | banner detail line |

**Confirmed:** per-endpoint isolation works as documented; one org's exception
never escapes its future; org zero-rows exactly when all 5 bundle calls fail;
only `GET /v1/organizations` is fatal (hard error + Retry button, sane).
Message strings **are** distinguishable per class ("key rejected (401)" /
"lacks the required scope (403)" / "not found (404)" / "rate limit hit (429)"
/ "upstream error (5xx)" / "timed out"), so 'Permission denied' vs
'Temporarily unavailable' is separable in detail lines.

### Gaps flagged

- **GAP-A — banner suppression (moderate):** `render_org_health_banner` takes
  the headline count from `kpis['orgs_unavailable']` when a kpis dict is
  passed (app.py always passes one). `orgs_unavailable` counts orgs with at
  least one `data_status=="unavailable"` **row**. Two failure shapes are
  thereby invisible: (1) a **fully-failed org** contributes zero rows → not
  counted; (2) an org with a **partial endpoint failure** (e.g. only `woa`
  500'd) has all rows `ok`/`partial` → not counted. When
  `orgs_unavailable == 0` the banner is **not rendered at all** even with a
  non-empty error list. Existing FetchErrors never reach the UI.
- **GAP-B — no per-org category:** the banner emits one raw line per (org,
  endpoint) — up to 5 lines per fully-failed org — with no deterministic
  label. `FetchError` has **no** `http_status`/`kind` field, so the UI would
  have to regex the message to classify (fragile).
- Minor: no circuit breaker / token bucket (documented v1 descope — OK at
  current rates; the retry budget is per-org-bundle, worst case ~30 s per
  org under sustained 429/5xx).

### Recommended per-org display mapping (exact conditions)

Group `all_errors` by `organization_id`; let `org_rows(id)` = fleet rows for
that org; let `has_auth(id)` = any error of that org with kind 401/403.

| Category | Condition | Label |
|---|---|---|
| Permission denied | `org_rows == 0` ∧ `has_auth` | "**{org}**: Permission denied — API key lacks scope on this organization; excluded from figures" |
| Temporarily unavailable | `org_rows == 0` ∧ ¬`has_auth` | "**{org}**: Temporarily unavailable (rate limit/server error/timeout) — excluded from figures; retry on refresh" |
| Partial data | `org_rows > 0` ∧ ≥1 error | "**{org}**: Partial data — failed: `{ops}`; other figures shown" |

Headline: "`X of N organizations failed to load** — figures exclude them"
where **X = distinct fully-failed orgs**; append "(+Y partially loaded)".
Never suppress the banner when `errors` is non-empty.

## 3. Auto-discovery — no hard-coding (verified)

- `grep 8b69b8da|266bd590|43b8288a|"Siemens AG"` over the repo: hits only in
  `docs/*` and `tests/fixtures_api.py` (synthetic fixture **name** `Siemens
  AG`; **no real UUIDs** in fixtures or code).
- `CASTAI_ENTERPRISE_ID` override: verified end-to-end —
  `config/settings.py` (`_ENV_ENTERPRISE_ID`, env > st.secrets),
  `.env.example` ships it **empty**, README documents it,
  `organization_service._resolve_root` honors it first with fail-fast
  validation (id must be visible AND type ENTERPRISE).
- Heuristic path: unique ENTERPRISE-type org → root; 0 or >1 → clear
  `CastAIError` naming candidates and demanding the override.

## 4. Multi-enterprise edge (">1 ENTERPRISE visible")

Current: `CastAIError` listing all candidate names+ids, demanding
`CASTAI_ENTERPRISE_ID`; fatal at discovery → UI hard error with sanitized
detail + Retry. **Assessment: correct v2 behavior.** Silently picking one
tree risks rendering the wrong enterprise's data — strictly worse than a
clear hard error, and the key holder must make an explicit choice.
Improvements only: (a) sort candidates by name for a deterministic message;
(b) keep the orgs-call failure path's distinct copy (config vs API) as-is.
No multi-tree aggregation for v2 — out of scope, would change KPI semantics.

## 5. Identity & cache-key audit (traced)

- **Tier-1** `_org_rows` → `build_fleet_row(organization_id=…)` stamps org
  identity from the **REQUEST scope** (discovery `Organization`), never from
  the echoed `organizationId`. Rows key on `(organization_id, cluster_id)`;
  `cluster_id` hole-fill never overwrites.
- **Selection/drill-down:** `ui/tables.render_fleet_table` returns
  `(organization_id, cluster_id)` from a positional parallel-id list →
  `cached_drilldown_*` loaders → every `optimization_service.load_*` passes
  `org_id` to the client → `X-CastAi-Organization-Id` header on **every**
  drill-down call (incl. nodes pagination). Loader payloads echo `org_id`.
- **Cache keys:** `cached_hierarchy(base_url, enterprise_id, refresh)`,
  `cached_fleet(base_url, enterprise_id, start, end, workers, refresh)`,
  `cached_drilldown_*(base_url, org_id, cluster_id, start, end, refresh)`,
  `build_client(base_url)` — **no API key in any cache key** (key is read
  inside cached functions via `load_settings()`); org UUIDs are identifiers,
  not secrets. Key scrubbing: `utils/errors.register_secret` +
  `utils/logging.configure_secret_scrub` at settings load; `sanitize_message`
  strips key + Authorization-shaped header values from every FetchError;
  logger drops `headers` extras defensively.

## 6. Implementation changes (small, targeted)

1. `organization_service.FetchError`: add `kind: str = ""` (populated at
   raise sites from `type(exc).__name__` — `AuthError`, `PermissionDeniedError`,
   `NotFoundError`, `RateLimitedError`, `ServerError`, `ApiTimeoutError`,
   `CastAIError`, `NonDictPayload`, `BundlePanic`). Cheap, structured, no
   message regexing.
2. Populate `kind` in `cluster_service._fetch_bundle`,
   `_org_rows` guard, `build_fleet_dataframe` future-catch, `build_org_reports`.
3. `ui/cards.render_org_health_banner`: implement §2 mapping — group errors by
   org, compute (X fully failed, Y partial), headline from distinct orgs
   (fall back to `orgs_unavailable` only when errors carry no org id), keep
   the expander with one categorized line per org.
4. `organization_service._resolve_root`: sort multi-Enterprise candidates by
   name before composing the error (deterministic UX).
5. `docs/enterprise-hierarchy.md`: add the proto3 "null fields omitted" note.

## 7. Test requirements

- Unit: `FetchError.kind` populated for each typed exception (parameterized
  401/403/404/429/500/timeout/non-dict/panic).
- Service: fully-failed org → zero rows + 5 errors with kinds; partial org
  (1 of 5 fails) → rows + 1 error; mixed-auth org → category "Permission
  denied"; multi-Enterprise error message lists sorted candidates.
- UI-level (banner mapping, pure function): X/Y counts for the fixture mix
  (ORG_FAIL + partial org + healthy orgs); banner never suppressed with
  non-empty errors; `orgs_unavailable`==0 + errors → banner still renders.
- Regression: existing suites must stay green (`pytest`, no real creds):
  data_status matrix, retry/timeout tests, security redaction tests.

## 8. Assumptions / unknowns / risks

- 401/403 were NOT live-probed (credentials hygiene) — behavior inferred from
  client code + v1 notes; 500-for-bad-orgid remains the only live-observed
  failure mode.
- `X-CastAi-Organization-Id` remains undocumented in the pinned OpenAPI spec
  — re-check on every spec refresh; keep the single `ORG_HEADER` constant.
- Rate limits not observed; if 429s appear, implement the descoped circuit
  breaker / adaptive halving (architecture.md §4).
- Whether DEFAULT orgs bear clusters for this key: still unknown and out of
  scope by decision (§4.3 of the hierarchy doc).
