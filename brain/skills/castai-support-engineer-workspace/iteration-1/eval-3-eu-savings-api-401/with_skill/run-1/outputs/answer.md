# EU savings API 401 — diagnosis and fix

## What's going on: you're calling the wrong region

CAST AI is region-pinned. There are separate regional API deployments, and an API key only exists in the region where its organization lives:

- **US region:** `https://api.cast.ai`
- **EU region:** `https://api.eu.cast.ai`
- **India region:** `https://api.india.cast.ai`

Your org (Siemens EU) lives in the **EU region**, so your org API key is registered only with the EU deployment. Your script is pointing at `https://api.cast.ai` (the US/default endpoint), which has never heard of that key — so every call returns **401**. The key is fine; the base URL is wrong.

The key "works in the console" for the same reason: the console knows your org is in the EU region and talks to the EU backend. Your script has to do the same thing explicitly.

This is a common failure mode — a perfectly valid key against the wrong region looks exactly like a bad key (401), and nothing in the error tells you it's a region problem.

## Fix: use the EU base URL

```text
https://api.eu.cast.ai
```

Also make sure you send the key in the **`X-API-Key`** header (the documented auth scheme; a Bearer JWT is the only other accepted scheme):

```bash
curl -sS "https://api.eu.cast.ai/v1/organizations" \
  -H "X-API-Key: $CASTAI_API_KEY" | jq '.organizations[] | {id, name}'
```

If that returns your org list, auth and region are both correct. Avoid `Authorization: Token <key>` — it still works in some deployments but is undocumented; standardize on `X-API-Key`.

## Per-cluster savings endpoint

```text
GET /v1/cost-reports/clusters/{clusterId}/savings
```

Full URL against your region:

```bash
curl -sS "https://api.eu.cast.ai/v1/cost-reports/clusters/<clusterId>/savings?startTime=2026-09-01T00:00:00Z&endTime=2026-10-01T00:00:00Z&stepSeconds=86400" \
  -H "X-API-Key: $CASTAI_API_KEY"
```

Parameters:

| Param | Required | Notes |
|---|---|---|
| `clusterId` | yes (path) | CAST AI cluster ID (UUID), not the cloud/EKS name. |
| `startTime` | yes | RFC 3339 date-time. |
| `endTime` | yes | RFC 3339 date-time. |
| `stepSeconds` | no | Bucket size; use `86400` for daily savings. |
| `useListingPrices` | no | Listing vs discounted price basis. |

Response: `items[]` with `{timestamp, downscalingSavings, spotSavings}` per bucket, plus `summary{totalCost, totalSavings}`. (Strings holding decimal numbers.)

## Fleet pull tips

- Get the cluster IDs first: `GET https://api.eu.cast.ai/v1/kubernetes/external-clusters` (ordinary org key: the org is implied by the key — there is no orgId path/query param on these cost-report endpoints). Then loop `…/clusters/{clusterId}/savings` per cluster.
- If you're using an **enterprise** key over child orgs, add `X-CastAI-Organization-Id: <child-org-id>` to target each org. (The header name matters — the similarly spelled `X-Organization-Id` is silently ignored.)
- Missing `startTime`/`endTime` will cost you a 400, not a 401 — if you still get 401 after switching to the EU base, re-check the header name and that the key wasn't region-scoped elsewhere.
- If you want CAST AI's newer value-realization savings model (actual vs projected, incl. workload-autoscaler savings) rather than the legacy downscaling+spot series above, use `POST /reporting/v1beta/organizations/{orgId}:runValueRealizationTimelineReport` with `start_time`/`end_time`/`step=ONE_DAY` as **URL query params**. For a straightforward fleet savings pull, the `/savings` endpoint above is the right starting point.

**Assumptions made:** your script is hitting the default `https://api.cast.ai` US endpoint (per your description); "org API key" is a standard org-scoped key (not enterprise) created in the EU console; by "savings" you mean CAST AI's realized savings time series.

### Sources

- API access guide (auth header + regional endpoints): <https://docs.cast.ai/docs/api-access>
- Savings endpoint reference: <https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport>
- OpenAPI spec (servers + security schemes): <https://api.cast.ai/v1/spec/openapi.json>
