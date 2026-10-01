# Sources consulted — eval-3 (EU savings API 401)

## Skill chain (as instructed)

1. `/Users/eramadan/castai/brain/skills/castai-support-engineer/SKILL.md` — skill instructions (answer style, honesty rules, source priority).
2. `/Users/eramadan/castai/brain/skills/castai-support-engineer/lookup/knowledge-index.json` — routing index; matched topics "savings API / cost reports / per-cluster savings" and "API keys / regions / EU vs US".

## Local references (matched by knowledge-index.json)

3. `/Users/eramadan/castai/.kimchi/docs/castai-api-savings-endpoints.md` — endpoint paths, `X-API-Key` auth, regional bases (US/EU/India), org-implied-by-key, enterprise `X-CastAI-Organization-Id` header; per-cluster savings path + params.
4. `/Users/eramadan/castai/brain/notes/API Keys & Regions.md` — Siemens data lives in EU region (`https://api.eu.cast.ai`); which key serves which purpose.
5. `/Users/eramadan/castai/.kimchi/docs/siemens-savings-methodology.md` — live-verified (2026-09-25): EU-only key 401s against `api.cast.ai`; `X-CastAI-Organization-Id` mandatory for org-scoped reads while `X-Organization-Id` is silently ignored; per-cluster `/savings` usage notes.
6. `/Users/eramadan/castai/brain/notes/Siemens Fleet.md` — Siemens enterprise tree context (org/cluster counts; EU fleet).

Also followed in-repo guidance: `AGENTS.md` workspace instructions (confirms `CASTAI_API_BASE` should be `https://api.eu.cast.ai`; read-only cost-reports scope) and `.kimchi/CLAUDE.md` (CAST AI MCP project memory; EU base default) — both surfaced automatically as context.

## Official online sources (fetched this session)

7. <https://docs.cast.ai/docs/api-access> (HTML) and <https://docs.cast.ai/docs/api-access.md> (markdown, updatedAt 2026-08-11) — confirms `X-API-Key` header auth, regional endpoints (US `api.cast.ai`, EU `api.eu.cast.ai`, India), enterprise `X-CastAI-Organization-Id` header.
8. <https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport> (HTML) and `.md` variant — confirms `GET /v1/cost-reports/clusters/{clusterId}/savings` with `startTime`/`endTime` (required), `stepSeconds`, `useListingPrices`; response items `{timestamp, downscalingSavings, spotSavings}` + `summary{totalCost, totalSavings}`; security `BearerAuth`/`ApiKeyAuth` (`X-API-Key`); servers US/EU.
9. <https://api.cast.ai/v1/spec/openapi.json> (HTTP 200) — confirms servers: US `https://api.cast.ai/`, EU `https://api.eu.cast.ai/`; global security schemes `BearerAuth` (JWT) + `ApiKeyAuth` (header `X-API-Key`); verified `/v1/cost-reports/clusters/{clusterId}/cost` and `/v1/cost-reports/...` family present.

## Notes / gaps

- `web_search` was unavailable in this environment (missing `DEEPSEEK_API_KEY`); verification was done via direct `web_fetch` of the official docs and spec above, which covered every claim in the answer.
- The `estimated-savings` reference slug guessed during verification (<https://docs.cast.ai/reference/clusterreportapi_getclusterestimatedsavingsreport.md>) returned 404; that endpoint was not needed for this answer (it's a potential-savings snapshot, not per-cluster realized savings).
- No repo files other than the two outputs in this directory were modified.
