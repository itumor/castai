# Cast AI Billing Export — Project Memory

## Purpose
Working project for the CAST AI Enterprise billing export flow that replaces the deprecated `/v1/billing/usage-report` endpoint.

## Live API shape (learned the hard way)

### Enterprise child-org listing
`GET /v1/billing/enterprise/platform-usage-detail?period.from=YYYY-MM-DD&period.to=YYYY-MM-DD&feature=<feature>`

Response:
```json
{
  "detail": {
    "entities": [
      {
        "entityId": "org-111",
        "entityName": "Customer A",
        "usage": 123.45
      }
    ]
  }
}
```

**Critical:** fields are `entityId` / `entityName`, not `organizationId` / `organizationName` or `id` / `name`.

### Per-child-org cluster usage
`GET /v1/billing/platform-usage-detail?period.from=...&period.to=...&feature=...`
Headers: `X-API-Key`, `X-CastAI-Organization-Id: <child_org_id>`

Response uses the same `detail.entities[]` shape, with each entity being a cluster (`entityId` = cluster ID, `entityName` = cluster name).

### Cluster metadata → cloud account
`GET /v1/kubernetes/external-clusters`
Headers: `X-API-Key`, `X-CastAI-Organization-Id: <child_org_id>`

Cloud account resolution precedence:
1. `providerNamespaceId`
2. `eks.accountId`
3. `gke.projectId`
4. `aks.subscriptionId`
5. `UNKNOWN`

## Query parameter gotcha
The endpoint expects `period.from` and `period.to`, not `from` / `to`. A missing or wrong parameter name returns `400 Bad Request` from the live API.

## Key files
- `castai-billing-export.sh` — main bash export script
- `README.md` — usage and environment variables
- `tests/` — Python mock server + unittest suite

## Commands

Run against production:
```bash
export CASTAI_API_KEY="your-enterprise-api-key"
./castai-billing-export.sh > billing.csv
```

Run offline tests:
```bash
./tests/run_tests.sh
```

## Environment variables
- `CASTAI_API_KEY` — required
- `BASE_URL` — default `https://api.eu.cast.ai`
- `FROM` / `TO` — billing period, default `2026-08-01` / `2026-08-31`
- `FEATURE` — default `phase2`

## Output CSV columns
```
organization_id,organization_name,cluster_id,cluster_name,provider,cloud_account,usage,unit
```

## Common issues
- 404 on `/v1/billing/usage-report` — endpoint removed; use the three-step flow above.
- 400 on enterprise endpoint — check query params are `period.from` / `period.to`.
- 0 child organizations found — verify jq mapping uses `entityId` / `entityName`.
- Missing cloud account — check external-clusters payload has one of the provider-specific fields.
