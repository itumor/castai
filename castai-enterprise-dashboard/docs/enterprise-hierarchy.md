# CAST AI Enterprise Hierarchy — Discovery Algorithm & Normalized Model

> Scope: read-only Streamlit dashboard aggregating **all clusters of all child
> organizations** of a CAST AI Enterprise org, via the public API
> (`https://api.eu.cast.ai`). Verified against the live EU API on 2025-09-21
> (all probes were read-only `GET`s) and against the pinned OpenAPI spec at
> `docs/openapi/castai-openapi.json` (OpenAPI 3.0.1, title "CAST.AI API documentation").
>
> **Posture: read-only.** All requests below are `GET` with one auth header
> (`X-API-Key`) plus one scoping header. Never print the API key; never issue
> POST/PUT/PATCH/DELETE from the dashboard.

---

## 1. Verified live facts (EU API, 2025-09-21)

`GET /v1/organizations` → HTTP 200, **129 organizations** visible to this key:

| Type (enum value) | Count | parentId | Role for the dashboard |
|---|---|---|---|
| `ORGANIZATION_TYPE_ENTERPRISE` | 1 | `null` | The Enterprise root: name `Siemens AG`, id `8b69b8da-00d6-47e6-8af0-a36ab02b9847` |
| `ORGANIZATION_TYPE_CHILD` | 125 | `…02b9847` (the Enterprise id) | All children belong to the one Enterprise tree |
| `ORGANIZATION_TYPE_DEFAULT` | 3 | `null` | Standalone orgs (`CAST AI EU`, `Siemens-test`, `Siemens-test-on`) — same key, **not** part of the Enterprise hierarchy → **excluded** |

- The child count is **dynamic** (122 at an earlier probe, 125 now) — discovery
  must never hard-code counts or ids.
- Sample `UserOrganization` keys actually returned (superset of spec minimum):
  `blockEscalatedPrivilege, childOrderId, createdAt, id, internal, name,
  organizationMember, parentId, type`.

## 2. Authoritative spec schemas

### 2.1 `GET /v1/organizations`

- OperationId `UsersAPI_ListOrganizations`. No parameters. **No header
  parameters declared in the spec.**
- Response 200: `castai.users.v1beta1.ListOrganizationsResponse`
  - `organizations: UserOrganization[]` (**required** — note: top-level key is
    `organizations`, not `items`).
- `castai.users.v1beta1.UserOrganization`:
  - `id` (string, readOnly)
  - `name` (string, required)
  - `createdAt` (date-time, readOnly)
  - `parentId` (string, **nullable**, readOnly — "beta feature not available
    for all organizations")
  - `type` → `castai.users.v1beta1.OrganizationType`, enum:
    `ORGANIZATION_TYPE_DEFAULT` | `ORGANIZATION_TYPE_ENTERPRISE` |
    `ORGANIZATION_TYPE_CHILD` (default `ORGANIZATION_TYPE_DEFAULT`)
  - `childOrderId` (int32, nullable — order of child within enterprise)
  - `organizationMember` (bool), `internal` (bool),
    `blockEscalatedPrivilege` (bool), `role` (**deprecated** — do not use)

### 2.2 `GET /v1/kubernetes/external-clusters`

- OperationId `ExternalClusterAPI_ListClusters` — "Lists clusters for current
  user's organization." No parameters declared.
- Response 200: `externalcluster.v1.ListClustersResponse`
  - `items: externalcluster.v1.Cluster[]` (note: key is `items` here).
- `externalcluster.v1.Cluster` (the fields the model needs — actual wire names):
  - `id` — cluster UUID
  - `name` — display name (**not unique**, even within one org — observed
    3 clusters literally named `dev-vlab-cluster` inside a single child org)
  - `organizationId` — owning org UUID (echoed by the server; matches the
    scoping header — validated live)
  - `providerType` — string, e.g. `eks`, `gke`, `aks`
  - `region` — object `{ name, displayName }`, e.g.
    `{ "name": "eu-central-1", "displayName": "EU (Frankfurt)" }`; use
    `region.name` as the canonical value
  - `status` — **plain string** lifecycle enum: `connecting`, `ready`,
    `warning`, `failed`, `deleting`, `deleted`, `hibernating`, `hibernated`,
    `resuming` (represent as lowercase string; pass unknown values through
    unchanged)
  - `agentStatus` — separate connectivity enum: `waiting-connection`, `online`,
    `non-responding`, `disconnected`, `disconnecting` (useful extra column)
  - Also present: `credentialsId`, `createdAt`, `deletedAt` (nullable),
    `clusterNameId` ("user friendly unique cluster identifier"),
    `providerNamespaceId` (AWS account / GCP project), `kubernetesVersion`
    (nullable), `managedBy`, `isPhase2`, `tags`, `reconcileError` (nullable),
    `agentSnapshotReceivedAt`.

## 3. The scoping header — `X-CastAi-Organization-Id` (exact casing)

**Not documented anywhere in the OpenAPI spec.** The spec declares *zero*
header parameters across all operations, so this header is an undocumented
(but functioning and load-bearing) API behavior. Live verification:

| # | Probe (all GET `/v1/kubernetes/external-clusters`) | Result |
|---|---|---|
| 1 | Header `X-CastAi-Organization-Id: 266bd590-…f74b` (child "DI IT DEX CLD") | HTTP 200 → **1 cluster**: `gspkafka-k8s-dev` (eks, `failed`, agent `non-responding`, region `eu-central-1`). `organizationId` in the body matches the header. |
| 2 | **No header** | HTTP 200 → **0 clusters**. The key has no implicit "all-orgs" view; without the header the call resolves to an org context that owns no clusters. |
| 3 | Header with child "Siemens Dev" (`43b8288a-…`) | HTTP 200 → **7 clusters** (all eks; 3× duplicate name `dev-vlab-cluster`). |
| 4 | Header with the **Enterprise parent** id (`8b69b8da-…`) | HTTP 200 → **0 clusters**. In this tenant clusters live in child orgs only. (Query it anyway — do not assume zero universally.) |
| 5 | **Intentional bad-header probe** (bogus UUID `00000000-…`) | HTTP **500** `{"message":"Internal Server Error","fieldViolations":[]}` — an unknown/inaccessible org id yields 500, *not* 401/403. |

Conclusions:

- The header `X-CastAi-Organization-Id` (exact casing; HTTP headers are
  case-insensitive on the wire, but send this canonical form) **selects which
  organization a request runs against**. It applies to org-scoped endpoints
  such as `/v1/kubernetes/external-clusters` and must be set on **every**
  per-org call.
- 401/403 were **not** observed: a *valid* key with a *bad* org id returns 500.
  A *bad key* was not probed (credentials hygiene). Error handling must treat
  any non-200 per-org response (4xx or 5xx) as a per-org failure to skip, never
  as fatal for the whole discovery run.

## 4. Filtering rule — which orgs belong in the dashboard

Include exactly the Enterprise tree:

1. **The Enterprise root itself** (`type == ORGANIZATION_TYPE_ENTERPRISE`) —
   keep it as the hierarchy root even though its own cluster list is empty.
2. **Every CHILD org** with `type == ORGANIZATION_TYPE_CHILD` **and**
   `parentId == <enterprise root id>` (do not include CHILD orgs parented
   elsewhere; currently all 125 are parented to the one Enterprise).
3. **Exclude** `ORGANIZATION_TYPE_DEFAULT` orgs — standalone key-level orgs,
   not part of the Enterprise hierarchy.

### Finding the Enterprise root (multi-tree safety)

The key can see multiple trees, so resolution must be explicit:

1. **Config override first** — `CASTAI_ENTERPRISE_ID`. If set, the root is the
   org with that id; fail fast with a clear error if it is not visible or is
   not type ENTERPRISE.
2. **Auto-detect heuristic** when unset — candidates = orgs with
   `type == ORGANIZATION_TYPE_ENTERPRISE` (expect `parentId is null` too).
   - exactly 1 candidate → use it;
   - 0 candidates → error: "no Enterprise organization visible to this key;
     set CASTAI_ENTERPRISE_ID or use a different key";
   - >1 candidates → error listing the candidate ids/names and demanding
     `CASTAI_ENTERPRISE_ID`.
3. **Never hard-code** the Siemens id (`8b69b8da-…`) in application code. It
   appears only here and in a config example, e.g.
   `CASTAI_ENTERPRISE_ID=8b69b8da-00d6-47e6-8af0-a36ab02b9847  # Siemens AG (example)`.

## 5. Discovery algorithm (supported, verified)

```text
1. GET /v1/organizations                         (1 call, no scoping header)
2. root  = resolve_enterprise(orgs, config)      (§4)
3. scope = [root] + [o for o in orgs
            if o.type == CHILD and o.parent_id == root.id]
4. for org in scope:                             (1 call per org, ~126 total)
       clusters[org] = GET /v1/kubernetes/external-clusters
                        with header X-CastAi-Organization-Id: org.organization_id
       on non-200 or network error → record FetchError(org, status, message),
       continue with the next org (partial results are kept)
5. normalize every cluster → Cluster record stamped with the *requested*
   organization_id and organization_name (do not rely solely on the echoed
   `organizationId` field)
```

- ~126 sequential GETs ≈ 1–2 minutes; acceptable for a read-only dashboard
  refresh. Optional: bounded concurrency (≤5) with 429 backoff; never hammer.
- Cache per run; on rerun, repeat from step 1 (hierarchy is dynamic).

## 6. Normalized model (real wire field names → model fields)

```python
@dataclass(frozen=True)
class Enterprise:
    id: str          # UserOrganization.id
    name: str        # UserOrganization.name

@dataclass(frozen=True)
class Organization:
    organization_id: str        # UserOrganization.id
    organization_name: str      # UserOrganization.name
    parent_id: str | None       # UserOrganization.parentId (nullable!)
    organization_type: str      # UserOrganization.type (ORGANIZATION_TYPE_* enum string)

@dataclass(frozen=True)
class Cluster:
    organization_id: str   # scoping header used for the request (== echoed Cluster.organizationId)
    organization_name: str # stamped from the owning Organization record
    cluster_id: str        # Cluster.id
    cluster_name: str      # Cluster.name (NOT unique)
    provider: str          # Cluster.providerType (e.g. "eks")
    region: str            # Cluster.region.name
    status: str            # Cluster.status (lowercase lifecycle enum string)
```

Optional extra fields to keep when available: `agent_status ← Cluster.agentStatus`,
`kubernetes_version ← Cluster.kubernetesVersion`,
`provider_namespace_id ← Cluster.providerNamespaceId`, `created_at`.

## 7. Identity & composite key

- `organization_id` **must be preserved on every Cluster record** — cluster
  names are not globally unique (verified: 3× `dev-vlab-cluster` in one org).
- Composite key for any cache/dedup/UI selection state:
  **`(organization_id, cluster_id)`**. Never key on `cluster_name` alone.

## 8. Empty-org and partial-failure behavior

- An org with zero clusters is a **normal** result (`HTTP 200, items: []`) —
  render it as "0 clusters", not as an error. The Enterprise root is currently
  such an org.
- One failing child org must **not** break discovery of the others: each per-org
  fetch is isolated in try/except; failures are collected into
  `DiscoveryResult.errors: list[FetchError]` with
  `(organization_id, organization_name, http_status | None, message)` and
  surfaced in the UI as a warning banner while all successful orgs render
  normally. Observed failure mode: HTTP 500 for an invalid org id.
- Only step 1 (`GET /v1/organizations`) is fatal-on-failure (nothing can be
  discovered without it) → then show a hard error.

## 9. Recommended discovery module (signatures only, no implementation)

```python
# discovery.py — read-only CAST AI Enterprise discovery

HEADER_ORGANIZATION_ID = "X-CastAi-Organization-Id"  # exact canonical casing

@dataclass(frozen=True)
class DiscoveryConfig:
    api_base_url: str          # e.g. "https://api.eu.cast.ai" (env CASTAI_API_BASE)
    api_key: str               # env CASTAI_API_KEY — never logged
    enterprise_id: str | None  # env CASTAI_ENTERPRISE_ID (optional override, §4)
    request_timeout_s: float = 30.0
    max_concurrency: int = 5   # 1 = strictly sequential

@dataclass(frozen=True)
class FetchError:
    organization_id: str
    organization_name: str
    http_status: int | None    # None for network/timeout errors
    message: str

@dataclass(frozen=True)
class DiscoveryResult:
    enterprise: Enterprise
    organizations: list[Organization]   # root + included children, in API order
    clusters: list[Cluster]             # flat list, key (organization_id, cluster_id)
    errors: list[FetchError]            # per-org partial failures
    fetched_at: datetime

class CastAiReadOnlyClient:
    """Thin GET-only HTTP client. Sends X-API-Key on every call and
    X-CastAi-Organization-Id on every org-scoped call. GET only."""
    def list_organizations(self) -> list[Organization]: ...
    def list_clusters(self, organization_id: str) -> list[Cluster]: ...
    # raises OrganizationFetchError(http_status, message) on non-200

def resolve_enterprise(
    organizations: list[Organization],
    configured_id: str | None,
) -> Enterprise: ...
    # §4 rules: config override → unique-ENTERPRISE heuristic → clear errors

def select_child_organizations(
    organizations: list[Organization],
    enterprise: Enterprise,
) -> list[Organization]: ...
    # type == ORGANIZATION_TYPE_CHILD and parent_id == enterprise.id

def discover_enterprise_hierarchy(
    client: CastAiReadOnlyClient,
    config: DiscoveryConfig,
) -> DiscoveryResult: ...
    # §5 algorithm; per-org isolation; partial results + errors list
```

**Shipped v1 (2026-09-21) — the sketch above is SUPERSEDED where it diverges:**

- `DiscoveryResult` holds `enterprise` + `organizations` (+ `errors`) ONLY — no
  `clusters` list. The per-org fleet fan-out lives in
  `services/cluster_service` (`build_fleet_dataframe` → `FleetResult`), not in
  discovery (`services/organization_service`).
- `FetchError` ships as `(organization_id, organization_name, operation,
  message)` — there is NO `http_status` field; the failed operation name is
  carried instead, and `message` is sanitized (headers/secrets stripped).

## 10. Assumptions, risks, unknowns

- **Undocumented header risk (medium):** `X-CastAi-Organization-Id` is absent
  from the OpenAPI spec. It is required in practice (no header ⇒ empty result).
  Re-verify on each spec refresh; keep the header name a single constant.
- **500-for-bad-org:** invalid scoping ids return HTTP 500, not 401/403 —
  dashboards must not treat 5xx from one org as total failure. (Auth-key
  failures — 401 — were intentionally not probed.)
- **Dynamic hierarchy:** child count changed between probes (122 → 125 and
  129 orgs total). Re-discover on every refresh; no static lists anywhere.
- **`parentId` is beta / nullable per spec:** guard against `parentId` missing
  on CHILD orgs (treat missing parent as "not in scope" and log a warning).
- **`organizations` vs `items`:** the two list endpoints use different envelope
  keys — do not share an envelope parser.
- **Sorting:** the spec says `/v1/organizations` is sorted by caller join date
  (first = caller's default org). We classify by `type`/`parentId`, never by
  position.
- **Rate limits:** none observed at ≤6 rapid GETs; keep concurrency ≤5 and add
  429 backoff before any larger fan-out.
- **Cluster `status` is free-form string in the schema** (enum only in the
  description) — tolerate unknown values; do not `Enum(…)`-crash on them.
- Unknown: whether DEFAULT standalone orgs are cluster-bearing for this key
  (out of dashboard scope by decision §4.3 regardless), and whether the
  Enterprise root in other tenants can own clusters directly (query it anyway).
