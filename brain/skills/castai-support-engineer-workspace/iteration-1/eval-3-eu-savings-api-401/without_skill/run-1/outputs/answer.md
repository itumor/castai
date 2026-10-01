# Savings-script 401s against `api.cast.ai` — diagnosis and fix

## What's going on

Your key is fine — **you're calling the wrong regional API endpoint.**

CAST AI's API is regional. Each region is a separate control plane with its own
organization and key store:

| Region | Base URL |
|--------|----------|
| US (global) | `https://api.cast.ai` |
| EU | `https://api.eu.cast.ai` |
| India | `https://api.in.cast.ai` |

API keys are scoped to the region whose console issued them. Your key belongs to
the **Siemens EU org**, so it exists only in the EU control plane. When your
script sends it to `https://api.cast.ai` (the US endpoint), that endpoint has no
record of the key and rejects every call with **`401 Authorization Required`** —
even though the key is valid. That is exactly why the same key works in the EU
console but 401s from your script. (This is a known failure mode: our own
token-rotation runbook lists "wrong endpoint — using the US endpoint against an
EU cluster produces 401 even with a fresh/valid credential" as a standard
troubleshooting step.)

## Which base URL to use

Use the EU endpoint for everything Siemens:

```
https://api.eu.cast.ai
```

A quick key/region health check — this should return your org list with HTTP 200:

```bash
curl -sS -H "X-API-Key: $CASTAI_API_KEY" \
     -H "Accept: application/json" \
     https://api.eu.cast.ai/v1/organizations | jq '.organizations[] | {id, name}'
```

Make sure the key carries the `cost-reports:read` scope (plus
`kubernetes/external-clusters:read` if you need to enumerate cluster IDs).

## Endpoint path for per-cluster savings

**Realized savings** (downscaling + spot savings actually achieved):

```
GET /v1/cost-reports/clusters/{clusterId}/savings
```

- OperationId: `ClusterReportAPI_GetClusterSavingsReport` (ClusterReportAPI)
- Required query params: `startTime`, `endTime` (RFC 3339 date-times)
- Optional: `stepSeconds` (aggregation step, int32), `useListingPrices` (bool —
  listing vs discounted prices)
- Auth: `X-API-Key` header (or Bearer JWT)
- Response: `{ clusterId, items[{ timestamp, downscalingSavings, spotSavings }], summary{ totalCost, totalSavings } }`
  — `summary.totalSavings` is the combined realized savings over the window.

Example (last 30 days, daily steps):

```bash
curl -sS -G "https://api.eu.cast.ai/v1/cost-reports/clusters/${CLUSTER_ID}/savings" \
  -H "X-API-Key: ${CASTAI_API_KEY}" \
  -H "Accept: application/json" \
  --data-urlencode "startTime=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "stepSeconds=86400"
```

Related endpoints you may also want for a fleet pull:

- `GET /v1/kubernetes/external-clusters` — list cluster IDs to fan out over.
- `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings` — **available**
  (potential) savings recommendations, i.e. `priceBefore`/`priceAfter`, not
  realized savings. Label it "estimated/potential" in your report; don't mix the
  two numbers.
- `GET /v1/cost-reports/organization/clusters/summary` — one call per org for a
  per-cluster rollup if you don't need per-cluster time series.

If your key is **enterprise-scoped across multiple child orgs**, pin the org
context per call with the header `X-Castai-Organization-Id: <org-id>` (verified
against the EU API; note it is *not* `X-Organization-Id` — that header is
silently ignored).

## Assumptions

- "EU console" means the Siemens org provisioned in CAST AI's EU region
  (`console.cast.ai` bound to the EU control plane).
- "Per-cluster savings" means realized savings; use `estimated-savings` for the
  "savings still available" number.
- Read-only API key with at least `cost-reports:read`.

## Sources

- Official CAST AI OpenAPI spec (local snapshot):
  `castai-enterprise-dashboard/docs/openapi/castai-openapi.json` — declares both
  servers (`https://api.cast.ai/` US, `https://api.eu.cast.ai/ EU`) and the full
  `GET /v1/cost-reports/clusters/{clusterId}/savings` contract.
- Official API reference (live):
  <https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport> —
  "Gets cluster savings report."
- Repo notes: `brain/notes/API Keys & Regions.md`,
  `e2e/token-rotation/README.md` (wrong-region ⇒ 401),
  `castai-enterprise-dashboard/docs/api-matrix.md` (§5.1 savings; §11 realized
  vs estimated), `castai-terraform-1/score-alerting-poc/castai_client.py`
  (org-switch header verification),
  `granular-resources/siemens-castai-support/RESOURCE.md` (Siemens = EU region,
  required read-only scopes).
