# Notes — eval-1-token-rotation-validity (with_skill)

## Sources consulted

### Local files
- `brain/skills/castai-support-engineer/SKILL.md` — skill instructions (ground facts in sources, check knowledge index, honesty rules).
- `brain/skills/castai-support-engineer/lookup/knowledge-index.json` — topic routing; matched "cluster token rotation / 401 after rotation / revoke token / old token validity".
- `.kimchi/docs/token-rotation-e2e-status.md` — E2E-verified facts (2026-09-16): old token valid >= 60 min after rotation (observed, not documented TTL); no public revoke endpoint; only cluster-token op is `POST /v1/kubernetes/external-clusters/{clusterId}/token`; org API keys are a separate credential; cluster disconnect/delete guarantees invalidation.
- `.kimchi/docs/reply-glejn-token-rotation.md` — human-reviewed reply template for this exact customer thread (tone/structure reused).
- `.kimchi/docs/rotate-token-manual-commands.md` — rotation procedure + token lifecycle notes (commands adapted into the draft).
- `castai-terraform-1/support/draft-response-token-rotation.md` — reply exemplar (customer-facing draft style) from the knowledge index.

### Official web sources (fetched 2026-09-25, live verification)
- https://api.cast.ai/v1/spec/openapi.json — downloaded (2.2 MB) and queried with `jq`. Confirmed:
  - Token-related paths are exactly: `/v1/auth/tokens`, `/v1/auth/tokens/{id}`, `/v1/kubernetes/external-clusters/{clusterId}/token`, plus partner-token paths.
  - Zero occurrences of "revoke" in any path or operation summary.
  - `POST /v1/kubernetes/external-clusters/{clusterId}/token` is the only cluster-token method (summary: "Returns cluster token that is used for agent and cluster controller"; operationId `ExternalClusterAPI_CreateClusterToken`).
  - `DELETE /v1/auth/tokens/{id}` exists for org API keys (`AuthTokenAPI_DeleteAuthToken`) — different credential.
  - `DELETE /v1/kubernetes/external-clusters/{clusterId}` exists (`ExternalClusterAPI_DeleteCluster`: "Deletes the cluster from CAST console") — supports the guaranteed-invalidation statement.
- https://docs.cast.ai/reference/externalclusterapi_createclustertoken — API reference page for the cluster token endpoint (200 OK; summary matches spec). Cited in the reply.
- https://docs.cast.ai/docs/api-access — API access keys guide (page shell confirms API key management topic; cited for org API keys).
- https://docs.cast.ai/docs/cluster-onboarding-troubleshooting — fetched for a documented token-TTL statement; none found (page body is JS-rendered; serves as confirmation no public TTL doc was located).

### Tooling notes
- `web_search` was unavailable in this environment (missing DeepSeek search API key); verification of currency was done by fetching the live OpenAPI spec and docs pages directly with curl/`web_fetch` instead.
- Downloaded spec saved to `/tmp/castai-openapi.json` (outside repo; no repo files touched).

## Assumptions made
1. Sender persona: draft is from CAST AI support (Ebrahim) replying to Glejn, continuing the existing `ngm-sim2-eks` thread — per the reviewed template in `.kimchi/docs`.
2. Topology: assumed the per-component secrets layout (five secrets) established in the prior thread; the draft tells the customer to adjust if their layout differs and gives a generic verify command.
3. Old-token lifetime stated as "at least 60 minutes, observed in our testing" and explicitly flagged as not a documented/guaranteed TTL (skill honesty rule — distinguish documented vs observed behavior).
4. "Zero downtime" answered at two levels: no auth gap if secrets are updated before restarts; and CAST AI component auth failures do not affect running workloads.
