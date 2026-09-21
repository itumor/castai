# Security Requirements — CAST AI Enterprise Dashboard

**Status:** Requirements phase · READ-ONLY Streamlit dashboard · Siemens environment
**Audience:** implementers and the final security reviewer
**Scope:** Python + Streamlit + httpx/requests + Pandas + Plotly app querying the CAST AI API with an enterprise API key.

Grounding facts from `docs/openapi/castai-openapi.json` (CAST AI API v1.0.0, OpenAPI 3.0.1):

- Auth scheme `ApiKeyAuth`: `type: apiKey`, `in: header`, `name: X-API-Key`. A `BearerAuth` (JWT) scheme also exists but the dashboard MUST NOT use it.
- Declared servers: `https://api.cast.ai/` (US) and `https://api.eu.cast.ai/` (EU). The India endpoint `https://api.in.cast.ai/` is a documented CAST AI regional endpoint but is **not** declared in this spec — treat its inclusion in config as operator-supplied.
- The child-org scoping header `X-CastAi-Organization-Id` (enterprise-key feature per project brief) is **not** declared in the spec; implement it as an optional header set only when an explicit org override is configured.
- `GET /v1/organizations` exists and is suitable for a startup key/scope self-check. The spec contains 151 POST paths; ~26 are read-semantics query endpoints under `/v1/cost-reports/...` (e.g. `workload-costs`, `workload-cost-summaries`) — see §4.

Normative language: **MUST** = blocking requirement; **SHOULD** = required unless a documented exception is approved; **MAY** = optional.

---

## SEC-1 · Secret management

### SEC-1.1 Supported secret sources and precedence

The dashboard MUST resolve configuration in this exact precedence order (first hit wins):

1. **Environment variables** (production / Siemens deployment): `CASTAI_API_KEY`, `CASTAI_BASE_URL`, optional `CASTAI_ENTERPRISE_ID` (org override → `X-CastAi-Organization-Id` header).
2. **Streamlit secrets** (`.streamlit/secrets.toml`, keys `castai.api_key`, `castai.base_url`, `castai.enterprise_id`): local development convenience only.

`st.secrets` MUST be accessed defensively (`st.secrets.get(...)` inside try/except); a missing secrets file MUST NOT raise a traceback that leaks paths or key material. Both sources MUST be documented in `README.md`; operators MUST NOT use both for the same key in one deployment (env wins — document this so behavior is predictable).

### SEC-1.2 Git ignore rules (blocking)

`.gitignore` MUST contain at minimum:

```gitignore
.streamlit/secrets.toml
.env
awskey.env
*.pem
*.key
*.p12
*.kubeconfig
```

A repo-level check (pre-commit or CI grep) SHOULD verify no file matching these patterns is tracked (`git ls-files | grep -E '\.env|secrets\.toml|\.pem'` must return empty).

### SEC-1.3 `.env.example` content (no real values)

The repo MUST ship `.env.example` with placeholders only:

```dotenv
# CAST AI Enterprise Dashboard — local configuration example. Copy to .env and fill in.
# Never commit the filled-in file.

# Enterprise API key (read scopes only — see security-requirements.md SEC-3). REQUIRED.
CASTAI_API_KEY=

# Base URL, pick ONE regional endpoint:
#   EU (Siemens default): https://api.eu.cast.ai
#   US:                   https://api.cast.ai
#   India:                https://api.in.cast.ai
CASTAI_BASE_URL=https://api.eu.cast.ai

# Optional: enterprise/org ID override. Sets X-CastAi-Organization-Id header
# to scope requests to a child organization. Leave empty to use the key's home org.
CASTAI_ENTERPRISE_ID=
```

### SEC-1.4 Fail-closed configuration

`config/settings.py` MUST fail closed:

- If `CASTAI_API_KEY` is absent or empty after precedence resolution → raise a dedicated `ConfigError` with a message that names the missing variable and where to set it, and **never** includes any partial key value. `app.py` MUST catch it and render `st.error("Dashboard is not configured. Contact the administrator.")` then `st.stop()`.
- `CASTAI_BASE_URL` MUST be validated: scheme `https` only, host allow-list = the three regional endpoints above; reject anything else (prevents key exfiltration to an attacker-supplied host via env manipulation). Default: `https://api.eu.cast.ai` (Siemens = EU data residency).
- There MUST be exactly one code path that reads the key (a `get_settings()` accessor). No module MAY read `os.environ["CASTAI_API_KEY"]` or `st.secrets` directly elsewhere.

---

## SEC-2 · API key handling in code

| # | Requirement | Level |
|---|-------------|-------|
| SEC-2.1 | Key material exists in exactly two places in memory: the settings object and the httpx/requests client default headers. It MUST NOT be copied into dataframes, cache payloads, Plotly figures, page state, or `st.session_state`. | MUST |
| SEC-2.2 | Logs MUST NEVER contain request/response headers. A shared redaction helper `redact(text)` MUST replace any occurrence of the configured key value (and the literal header names `X-API-Key`, `X-CastAi-Organization-Id` when followed by values) with `***` and MUST be applied to every exception message and structured-log field before emission. | MUST |
| SEC-2.3 | The key MUST NOT appear in: Streamlit UI elements, `st.exception` / `st.error` output, `@st.cache_data`/`@st.cache_resource` return values, or **cache keys** (cache-key parameters must contain resource identifiers like `cluster_id`, never credentials). | MUST |
| SEC-2.4 | TLS verification MUST always be on (`verify=True` / default `ssl.create_default_context()`). `verify=False`, `HTTPConnection`, or any InsecureRequestWarning suppression is forbidden. | MUST |
| SEC-2.5 | Every request MUST carry explicit `connect` and `read` timeouts (SHOULD: `httpx.Timeout(10.0, read=30.0)` or requests `(10, 30)` tuple). No infinite hangs. | MUST |
| SEC-2.6 | No automatic retry on `401` or `403` (credentials don't heal; retries amplify lockout/alerts). Retries MAY target `429`/`5xx`/network errors only: max 4 attempts (client default; aligned with `performance.md` §2.5 — amended at final review, was "3"), exponential backoff with jitter, total budget ≤ 30 s. | MUST |
| SEC-2.7 | `401`/`403` MUST surface as a generic user message ("API key invalid or lacks required scope") with the raw body only in the sanitized structured log (SEC-2.2). | MUST |
| SEC-2.8 | The `User-Agent` SHOULD identify the app (`castai-enterprise-dashboard/<version>`); it MUST NOT embed the key, org id, or hostname of the operator machine. | SHOULD |

---

## SEC-3 · Least privilege — API key scopes

The dashboard key MUST be provisioned with **only** these read scopes (aligned with repo `AGENTS.md` §2):

| Scope | Dashboard use |
|---|---|
| `organizations:read` | Org resolution, child-org listing, allow-list validation |
| `kubernetes/external-clusters:read` | Cluster inventory, nodes, cluster status |
| `cost-reports:read` | Cost, savings, and efficiency reports |
| `inventory:read` | Resource inventory views |
| `workload-autoscaling:read` | Autoscaler/workload status and recommendations |
| `recommendations:read` | Optimization recommendations |
| `notifications:read` | Notification/alert listing (include only if the notifications page ships; otherwise omit) |

The key MUST NOT carry: any `*:write` or `*:admin` scope, billing-management scopes, or cluster-connect/agent scopes. Provisioning documentation MUST state this as an acceptance criterion for the Siemens key.

**Startup scope self-check (SEC-3.1):** on first run (not cached across restarts; MAY be memoized per process), the client MUST issue a benign `GET /v1/organizations` before rendering data pages:

- `200` → proceed; record org id from response (sanitized log).
- `401` → `st.error("CAST AI API key rejected (401). Verify CASTAI_API_KEY with your administrator.")` + `st.stop()`.
- `403` → same pattern, message mentions missing scope.
- Network/timeout → generic "CAST AI API unreachable" message; never show raw socket errors with host internals beyond the configured base URL host.

The self-check MUST NOT log the response headers and MUST NOT include the key in any rendered output.

---

## SEC-4 · Read-only enforcement (architecture rule)

- SEC-4.1 The API client module MUST expose **GET-only** public methods. There MUST BE no generic `request(method, ...)` escape hatch reachable from UI/page code.
- SEC-4.2 HTTP method usage MUST be centralized in one private transport function containing an explicit allow-list, enforced by assertion:

  allowed methods = `{"GET"}` plus the read-semantics POST set of SEC-4.3. Any other method raises immediately.

- SEC-4.3 **Permitted non-GET exception.** Cost/reporting query endpoints are POST-with-body in the CAST AI API (the body is the query/filter, e.g. `POST /v1/cost-reports/clusters/{clusterId}/workload-costs`, `.../workload-cost-summaries`, `.../allocation-groups`, `.../gpu-*` queries). These MAY be used **only** when:
  1. the path matches an in-code whitelist constant `ALLOWED_READ_POST_PATHS` (regex set, listed in one place, code-reviewed);
  2. the endpoint is verified read-only in semantics (no resource creation/mutation — reference: `docs/api-contracts.md` from the research phase);
  3. the whitelist MUST NOT include `POST /v1/organizations`, agent/token/cluster mutation paths, or `/v1/clusters/{clusterId}/components/{component}/metrics` if review shows it has side effects (default: exclude unless justified).
- SEC-4.4 No code path MAY construct URLs from concatenated user text; path parameters MUST be validated (UUID regex for ids) before interpolation to prevent path traversal into unintended endpoints.
- SEC-4.5 `AGENTS.md` §5.5 applies absolutely: no unapproved `PUT`, `PATCH`, `DELETE`, and no POST outside SEC-4.3 — enforced by SEC-4.2, not by convention.

---

## SEC-5 · Streamlit-specific hardening

| # | Requirement | Level |
|---|-------------|-------|
| SEC-5.1 | Never print/`st.write`/`st.json` `st.secrets` or any settings object. | MUST |
| SEC-5.2 | `.streamlit/config.toml` (committed) MUST set: `[server] headless = true`, `[browser] gatherUsageStats = false` (no telemetry), `[runner] magicEnabled = false` (deterministic rendering). Debug/trace-level logging flags MUST be off in shared deployments. | MUST |
| SEC-5.3 | Error surface = two layers: (a) user-facing `st.error` with a **static generic message**; (b) structured log (stderr/file) that passes through the SEC-2.2 redactor. Raw API error bodies MUST NOT be rendered: CAST AI error payloads may echo request details and internal identifiers. | MUST |
| SEC-5.4 | `unsafe_allow_html=True` in `st.markdown`/`st.html` is forbidden by default. If a feature is ever approved to use it, all dynamic strings (org names, cluster names, namespaces, workload names) MUST be HTML-escaped (`html.escape`) first. Org/cluster/workload names are attacker-adjacent input — they originate from customer infrastructure naming and MUST be treated as untrusted for injection purposes. | MUST |
| SEC-5.5 | All untrusted strings rendered into Plotly charts/tables rely on Plotly/Pandas default escaping — do NOT pass raw API strings into raw-HTML slots, tooltips with `unsafe` flags, or `st.markdown` without escaping. | SHOULD |
| SEC-5.6 | `st.session_state` MUST NOT store the key, settings, or client headers (session state can surface in error traces/browser memory). | MUST |
| SEC-5.7 | File/CSV downloads MUST be generated in-memory; exported filenames MUST be sanitized (no unsanitized cluster/org names in Content-Disposition paths). | SHOULD |

---

## SEC-6 · Dependency security

- SEC-6.1 `requirements.txt` MUST pin exact versions (`==`) for every direct dependency: `streamlit`, `httpx` (preferred; `requests` acceptable), `pandas`, `plotly`. No open ranges, no unpinned transitive-install surprises.
- SEC-6.2 SHOULD pin with hashes (`pip install --require-hashes` / `pip-compile --generate-hashes`); exact-version pinning is the blocking minimum.
- SEC-6.3 `pip-audit` (or `pip-audit --strict`) MUST run before each release and SHOULD run in CI; any CRITICAL/HIGH CVE in a pinned dependency blocks release until bumped or a documented false-positive waiver is attached.
- SEC-6.4 Minimal dependency set: no new dependency without a one-line justification comment in `requirements.txt`. No `pyyaml` `load()` (only `safe_load`) if YAML ever appears; avoid full ORMs/template engines entirely.
- SEC-6.5 Python floor: a version still receiving security fixes (≥ 3.11 recommended); document the floor in README.

---

## SEC-7 · Data handling & privacy

- SEC-7.1 Organization names, cluster names, namespaces, and workload names are **internal/sensitive**: they MAY appear in the authenticated UI and exports, but logs MUST treat them as internal data — structured logs SHOULD carry ids rather than names where feasible, and log files are access-controlled internal artifacts.
- SEC-7.2 No telemetry: `gatherUsageStats = false` (SEC-5.2); the app MUST NOT add any analytics, error-beacon, or phone-home library.
- SEC-7.3 Caching is in-process only: `@st.cache_data` / `@st.cache_resource` with in-memory backend. No on-disk persistence of API responses, no external cache (Redis/Memcached), no temp-file dumps of API payloads.
- SEC-7.4 Exported files (CSV/PNG) are generated on demand and downloaded by the user; the app MUST NOT email, upload, or otherwise transmit them anywhere.
- SEC-7.5 Cache TTLs SHOULD be short (≤ 15 min) so revoked permissions stop surfacing data promptly after key rotation (see runbooks in `.kimchi/docs/`).
- SEC-7.6 API responses containing credentials or PII MUST NOT be shown raw anywhere (AGENTS.md §5.6); any "raw JSON" debug viewer is forbidden in shared deployments.

---

## SEC-8 · Final review checklist (PASS / FAIL)

Run every item against the finished code. All items MUST be PASS before the dashboard is shared in the Siemens environment. Each item lists its greppable/testable evidence.

### Secrets & config

- [ ] **CHK-01** — `git ls-files | grep -E '\.env$|secrets\.toml$|\.pem$|awskey\.env'` returns empty. (No secrets tracked.)
- [ ] **CHK-02** — `.gitignore` contains all entries from SEC-1.2.
- [ ] **CHK-03** — `.env.example` exists and `grep -E '=[A-Za-z0-9+/]{16,}' .env.example` (excluding the base-URL defaults) returns nothing — no real values.
- [ ] **CHK-04** — Key resolution exists in exactly one module: `grep -rn "CASTAI_API_KEY\|st.secrets" --include='*.py' .` shows only `config/settings.py` (plus tests).
- [ ] **CHK-05** — Fail-closed test: unset `CASTAI_API_KEY` and remove `secrets.toml`; app renders generic error + `st.stop()`, exit behavior sane, and the message contains no path/key fragments.
- [ ] **CHK-06** — Base URL allow-list enforced: setting `CASTAI_BASE_URL=http://evil.example` (or anything off the EU/US/IN list) is rejected.

### Key handling & transport

- [ ] **CHK-07** — `grep -rn 'verify=False\|InsecureRequestWarning\|urllib3.disable_warnings' --include='*.py' .` returns nothing.
- [ ] **CHK-08** — `grep -rn 'X-API-Key' --include='*.py' .` shows the header name used only when attaching headers in the client module — never in `print(`, `st.write`, logging calls, or f-strings that include the value.
- [ ] **CHK-09** — Redaction helper exists and is unit-tested with a sample key value; `grep -rn "logger\.\|logging\." --include='*.py' .` confirms no logging of `headers`.
- [ ] **CHK-10** — Every transport call has explicit timeouts: `grep -rn 'timeout' --include='*.py' .` covers all request sites (client centralizes it).
- [ ] **CHK-11** — Retry logic excludes 401/403: `grep -rn 'retry\|Retry\|backoff' --include='*.py' .`; manual test with a bad key shows exactly one request.
- [ ] **CHK-12** — `grep -rn "cache_data\|cache_resource" --include='*.py' .` — inspect each decorator: no credential-containing parameter participates in the cache key.

### Read-only architecture

- [ ] **CHK-13** — `grep -rniE '\.(post|put|patch|delete)\(|requests\.(post|put|patch|delete)|client\.(post|put|patch|delete)' --include='*.py' .` returns ONLY the whitelisted read-POST transport path (SEC-4.3); every non-GET call site is guarded by `ALLOWED_READ_POST_PATHS`.
- [ ] **CHK-14** — Method allow-list assertion exists in the single transport function; test: calling with `DELETE` raises.
- [ ] **CHK-15** — Path params validated: `grep -rn 're\.(compile|match|fullmatch)' --include='*.py' .` shows UUID validation before URL interpolation (or equivalent).
- [ ] **CHK-16** — Startup self-check `GET /v1/organizations` present; 401/403 produce the generic messages of SEC-3.1 and block page render.

### Streamlit hygiene

- [ ] **CHK-17** — `grep -rn 'unsafe_allow_html' --include='*.py' .` returns nothing (or every hit is paired with escaping of all dynamic values).
- [ ] **CHK-18** — `grep -rn 'st\.exception' --include='*.py' .` returns nothing; all error rendering uses static messages (CHK via `grep -rn 'st\.error\|st\.warning' --include='*.py' .` — messages contain no `{e}`/exception interpolation of raw API bodies).
- [ ] **CHK-19** — `grep -rn 'print(' --include='*.py' .` returns nothing in app code (tests exempt); structured logger used instead.
- [ ] **CHK-20** — `.streamlit/config.toml` sets `gatherUsageStats = false`, `headless = true`, no debug/trace log level.
- [ ] **CHK-21** — `grep -rn "session_state" --include='*.py' .` — no assignment of settings/client/key into session state.

### Dependencies & data

- [ ] **CHK-22** — `grep -E '^[a-zA-Z0-9_-]+==' requirements.txt` covers every line (all pinned, no bare names or `>=`); optional: hashes present.
- [ ] **CHK-23** — `pip-audit` output attached to the release notes shows no unwaived CRITICAL/HIGH findings for pinned versions.
- [ ] **CHK-24** — `grep -rniE 'analytics|segment|sentry|telemetry|mixpanel|posthog' requirements.txt --include='*.py' .` returns nothing (no telemetry deps/calls).
- [ ] **CHK-25** — No on-disk response persistence: `grep -rn 'open(.*["'"'"']w\|to_csv\|to_parquet\|pickle\.dump' --include='*.py' .` shows only in-memory/BytesIO export paths.
- [ ] **CHK-26** — Manual leak test: run with a canary key value, exercise every page and one forced API error, then search the full stderr/log output for the canary string — zero hits.
- [ ] **CHK-27** — Provisioned key's scopes verified against SEC-3 list (admin confirmation recorded in release notes).

---

## Appendix A — Regional endpoints (config allow-list)

| Region | Base URL | In OpenAPI spec |
|---|---|---|
| EU (Siemens default) | `https://api.eu.cast.ai` | yes |
| US | `https://api.cast.ai` | yes |
| India | `https://api.in.cast.ai` | no (operator-supplied; CAST AI documented region) |

## Appendix B — Normative references

- Repo `AGENTS.md`: §2 (scope table), §5 (prohibitions — esp. 5.2 commit-no-secrets, 5.5 no mutations, 5.6 no raw responses).
- `docs/openapi/castai-openapi.json`: `components.securitySchemes`, `servers`, `paths`.
- OWASP ASVS 4.0 (V2.10 service auth secrets, V14 config), Streamlit security model docs.

---

## Final review outcome (2026-09-21)

- **Checklist result: 24/27 PASS.**
- **CHK-27 — N/A (operational):** key-scope confirmation is an operator action
  recorded in the release notes, not an app-code property.
- **CHK-15 — FIXED:** path-traversal gate `_validate_path` now sits at the
  `_request` chokepoint in `services/castai_client.py` (every request path
  validated before interpolation) and is covered by `TestPathTraversalGate`
  tests in `tests/test_client.py`.
- **CHK-20 — FIXED:** `.streamlit/config.toml` with `headless = true` is
  committed (alongside `gatherUsageStats = false`, no debug/trace logging).
- **SEC-2.6 — amended:** retry budget is **4 attempts** total (1 + 3 retries;
  client default), 401/403 never retried.
- **pip-audit clean:** `uvx pip-audit --strict` reports no known
  vulnerabilities for the pinned dependency set.
