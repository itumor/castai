# Resource: Siemens CAST AI Support Workspace

Binding workspace contract for AI agents supporting the Siemens CAST AI account.

## Scope

- Repository: `/Users/eramadan/castai`
- Region: EU (`api.eu.cast.ai`)
- Default org: Siemens AG enterprise tree and its child orgs
- Transport: MCP stdio via `castai-mcp-server/src/server.js`

## Binding rules

| Rule | Enforcement |
|------|-------------|
| Read-only by default | MCP server `APPROVAL_MODE=block`; HTTP client refuses `POST/PUT/PATCH/DELETE`. |
| Least-privilege keys | CAST AI keys scoped to `organizations:read`, `kubernetes/external-clusters:read`, `cost-reports:read`, `workload-autoscaling:read`, `inventory:read`, `recommendations:read`. |
| Secrets in Vault | API keys and AWS credentials are sourced from `awskey.env` / `.env` or Granular Vault; never committed. |
| Human approval required | Prod cluster changes, IAM changes, write API calls, key rotation, customer-facing replies. |
| No `castctl cluster connect` on customer clusters without explicit approval. | Escalate if asked. |
| Org binding | When `CASTAI_ORG_ID` is set, all requests include `X-Organization-Id` and are validated against the allow-list. |
| Redaction | All tool outputs and logs are scrubbed for tokens before reaching the LLM context. |

## Workflow

1. Source env files (`awskey.env`, `.env`).
2. Verify AWS identity and CAST AI key scope.
3. For support cases: receive case → check brain → reproduce → document → human-reviewed reply.
4. Run component tests before suggesting changes.
5. Stop and escalate on any blocked write path or missing credential.

## Entry points

| Component | Path | Test command |
|-----------|------|--------------|
| MCP server | `castai-mcp-server/src/server.js` | `cd castai-mcp-server && npm test` |
| Dashboard | `dashboard/server.js` | `cd dashboard && npm test && npm start` |
| Karpenter visualizer | `projects/karpenter-visualizer/src/backend/server.ts` | `cd projects/karpenter-visualizer && npm run test` |
| Billing export | `projects/castai-billing-export/castai-billing-export.sh` | `cd projects/castai-billing-export && ./tests/run_tests.sh` |

## Escalation contacts

- Missing credentials or suspected secret exposure: stop immediately, notify human operator.
- Customer production incident: escalate to on-call human; do not attempt remediation writes.
- Scope ambiguity: confirm `CASTAI_ORG_ID` and target cluster with human before querying.
