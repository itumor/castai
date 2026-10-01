# Notes — eval-3-eu-savings-api-401 (without_skill)

Sources consulted while answering the 401 / savings-endpoint question.

## Local files

- `/Users/eramadan/castai/castai-enterprise-dashboard/docs/openapi/castai-openapi.json`
  — Official CAST AI OpenAPI snapshot. `servers[]` = `https://api.cast.ai/` (US),
  `https://api.eu.cast.ai/` (EU). Path `GET /v1/cost-reports/clusters/{clusterId}/savings`
  → `ClusterReportAPI_GetClusterSavingsReport`, required `startTime`/`endTime`,
  optional `stepSeconds`/`useListingPrices`, `ApiKeyAuth` = `X-API-Key` header;
  response schema `costreport.v1beta1.GetClusterSavingsReportResponse`
  (`clusterId`, `items[]`, `summary`). Also `estimated-savings` /
  `estimated-savings-history` paths.
- `/Users/eramadan/castai/brain/notes/API Keys & Regions.md` — Siemens data lives
  in EU (`api.eu.cast.ai`); records a prior incident where a `.env` pointed at
  US `api.cast.ai` and was flagged as a wrong-region mismatch.
- `/Users/eramadan/castai/e2e/token-rotation/README.md` (Troubleshooting §2,
  ~line 258) — wrong endpoint ⇒ `401 Authorization Required` for EU clusters even
  with a valid credential; must use `https://api.eu.cast.ai`.
- `/Users/eramadan/castai/castai-enterprise-dashboard/docs/api-matrix.md` — §5.1
  savings-endpoint field-level contract (realized savings: `items[].downscalingSavings`,
  `spotSavings`, `summary.totalSavings`); §11(a) realized-vs-estimated distinction.
- `/Users/eramadan/castai/castai-enterprise-dashboard/docs/security-requirements.md`
  — declared regional servers; base-URL host allow-list guidance.
- `/Users/eramadan/castai/brain/skills/siemens-castai-support/SKILL.md` — preflight:
  confirm region/org; Siemens = EU (`api.eu.cast.ai`).
- `/Users/eramadan/castai/granular-resources/siemens-castai-support/RESOURCE.md` —
  Region: EU (`api.eu.cast.ai`); least-privilege scopes incl. `cost-reports:read`.
- `/Users/eramadan/castai/castai-terraform-1/score-alerting-poc/castai_client.py`
  (lines 124–136) — org-switch header verified live against `api.eu.cast.ai`:
  `X-Castai-Organization-Id` (not `X-Organization-Id`).
- `/Users/eramadan/castai/docs/castai/terraform-e2e.md` (line ~165) —
  `https://api.cast.ai` = US/global, `https://api.eu.cast.ai` = EU.
- `/Users/eramadan/castai/scripts/savings/savings_report.py` — working script
  defaulting base to `https://api.eu.cast.ai` and calling
  `/v1/cost-reports/clusters/{cid}/savings` and `.../cost`.
- `/Users/eramadan/castai/cluster-readiness-outputs/run_readiness_lite.py` — uses
  `https://api.eu.cast.ai` and `/v1/cost-reports/clusters/{id}/savings|overview`.
- `/Users/eramadan/castai/castai-mcp-server/src/tools/index.js` — MCP tool maps
  to `/v1/cost-reports/clusters/{clusterId}/savings` and
  `/v1/cost-reports/organization/clusters/summary`.
- `/Users/eramadan/castai/AGENTS.md` — preflight requires `CASTAI_API_BASE =
  https://api.eu.cast.ai` and the read-only scope list.

## URLs

- https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport
  (HTTP 200 — official "Gets cluster savings report" API reference page for
  `ClusterReportAPI_GetClusterSavingsReport`).

## Notes

- Web search was unavailable in this session (missing search API key); the local
  OpenAPI snapshot + official docs-page fetch + repo runbooks were sufficient.
- No live calls to the CAST AI API were made (read-only posture; not needed).
