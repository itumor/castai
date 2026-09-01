# CAST AI MCP Server — Kimchi/Claude Project Memory

## Project

- Local Node.js MCP server: `castai-mcp-server/`
- Region: EU (`https://api.eu.cast.ai`)
- Audience: Siemens org read-only cluster/cost/workload visibility

## Current state (completed)

- All 10 read-only tools use CAST AI OpenAPI-validated endpoints.
- `CastaiClient` hardened: 30s timeout, exponential backoff, 429 `Retry-After` handling, 3 retries.
- Unit + E2E test suite: `npm test` → 92 passing, 0 failing.
- Real API smoke test passes (key authenticates; 0 clusters currently visible).
- Docs updated: `castai-mcp-server/README.md`, `.kimchi/docs/castai-mcp-architecture.md`, `.kimchi/docs/castai-mcp-security.md`.
- Code committed and pushed to `origin/main`.

## Validated endpoint mappings

| Tool | Path |
|---|---|
| `list_clusters` | `GET /v1/kubernetes/external-clusters` |
| `get_cluster_details` | `GET /v1/kubernetes/external-clusters/{clusterId}` |
| `get_cluster_savings` | `GET /v1/cost-reports/clusters/{clusterId}/savings` |
| `get_cluster_cost` | `GET /v1/cost-reports/clusters/{clusterId}/cost` |
| `get_cluster_nodes` | `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` |
| `get_cluster_utilization` | `GET /v1/cost-reports/clusters/{clusterId}/overview` |
| `get_workload_recommendations` | `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary` |
| `get_workload_autoscaler_status` | `GET /v1/workload-autoscaling/clusters/{clusterId}/components/workload-autoscaler` |
| `get_available_savings` | `GET /v1/cost-reports/organization/clusters/summary` |
| `get_recent_optimization_actions` | `GET /v1/kubernetes/clusters/{clusterId}/actions` |

## Key commands

```sh
cd castai-mcp-server
npm test                              # 92 passing
node scripts/real-castai-smoke.js     # live API smoke test
```

## Environment

- Credentials live in `castai-mcp-server/.env` (gitignored).
- Auth header: `Authorization: Token <CASTAI_API_KEY>`.
- Optional org scoping: `CASTAI_ORG_ID` → `X-Organization-Id` header.
- `APPROVAL_MODE=block` by default; mutating tools require `approve` mode + token.

## Pitfalls

- Do not use `/v1/kubernetes/clusters`; it does not exist.
- Do not use `/v1/cost-management` or `/v1/savings`; use `/v1/cost-reports`.
- Zero clusters returned from `list_clusters` is a valid success response.
- `get_recent_optimization_actions` requires `clusterId`.

## Skill

See `.kimchi/skills/castai-mcp-integration/SKILL.md` for full integration playbook.
