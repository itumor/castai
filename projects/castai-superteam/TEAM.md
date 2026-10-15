# CAST AI Superteam — Team Manifest

The supervisor-led agent team for Siemens CAST AI operations. One mission in,
one merged report out.

```
human
  └─ Lead (DSH session)            spawns the team, human liaison, reassigns tasks
       └─ supervisor               decomposes missions, dispatches, merges, escalates
            ├─ cost-analyst        cost, savings, recommendations, ROI
            ├─ cluster-health      nodes, events, autoscaler, rebalancing, readiness
            ├─ support-triage      ticket triage via the 13-agent swarm (offline), draft replies
            ├─ docs-keeper         brain/ + .kimchi/docs memory and runbooks
            └─ mcp-ops             the ONLY role touching live CAST AI/AWS APIs (read-only)
```

## Charter

1. One mission from the human → the supervisor decomposes it into bounded
   specialist tasks on the shared task board → specialists execute read-only
   and return compact blocks (≤15 lines each) → the supervisor merges them
   into ONE report for the human. Never relay N raw dumps.
2. Speed comes from the AGENTS.md §2 fan-out law: N clusters = N parallel
   units, dispatched in one wave (cap ~8 per wave). The supervisor enforces
   this by tasking specialists per-unit; specialists may in turn spawn
   subagents per the `cluster-fanout` skill.
3. Safety multiplies with the fan-out, never risk: every member inherits
   AGENTS.md §6 prohibitions, and every dispatch prompt restates the
   read-only rule.

## Roster

| Teammate | Role file | Mission | Skills | Write scope |
|---|---|---|---|---|
| `supervisor` | agents/supervisor.md | Decompose, dispatch, merge, escalate | cluster-fanout | `status/team-reports/` |
| `cost-analyst` | agents/cost-savings-analyst.md | Cost, savings, recommendations, ROI | cast-ai-savings-calculations, castai-available-savings, castai-realized-savings-calculator, castai-savings-reconciliation | `cluster-cost-analysis/`, `cluster-readiness-outputs/` |
| `cluster-health` | agents/cluster-health.md | Nodes, events, autoscaler, rebalancer, onboarding readiness | castai-node-autoscaling, castai-workload-autoscaling, castai-rebalancing, castai-cluster-onboarding | `cluster-readiness-outputs/` |
| `support-triage` | agents/support-triage.md | Customer-thread triage + draft replies via the offline swarm | castai-support-swarm, castai-case-triage, castai-support-engineer-v2, castai-customer-communication | `outbox/` |
| `docs-keeper` | agents/docs-memory-keeper.md | Team memory: brain/, .kimchi/docs, runbooks | repo memory conventions (brain/BRAIN.md) | `brain/`, `.kimchi/docs/`, `labs/` notes |
| `mcp-ops` | agents/mcp-api-ops-runner.md | Read-only CAST AI API + MCP server execution | castai-api-investigation | none — returns data in messages |

## Routing rules (supervisor)

| Mission smells like | Route to |
|---|---|
| cost, savings, ROI, recommendations, "how much can we save" | cost-analyst (data via mcp-ops) |
| nodes, events, autoscaler, rebalancer, readiness, "is cluster X healthy" | cluster-health (data via mcp-ops) |
| customer thread, ticket, "draft a reply", support case | support-triage |
| "what do we know about", precedents, runbooks, record this finding | docs-keeper |
| live API data, cluster list/ids, smoke test, endpoint check | mcp-ops |
| multi-cluster anything | supervisor fans out across units, one task per cluster |
| ambiguous scope, write request, preflight failure | STOP → escalate to lead/human |

## Protocols

### Task board
- The supervisor creates shared tasks (`team_task_create`) with the target's
  write scope recorded; specialists claim → work → complete. The lead and the
  human see the same board at any time.

### Messaging
- Specialists report to `supervisor`; the supervisor reports to `lead`.
- Compact blocks only: status line, key numbers with units, one anomalies
  line. No raw JSON, no secrets, no PII.

### Live data
- Only `mcp-ops` touches live CAST AI/AWS APIs, and only after the AGENTS.md
  §1 preflight (region `https://api.eu.cast.ai`, org id, key scopes, AWS
  identity). Every mcp-ops answer carries a one-line preflight confirmation.
- Other specialists never call live APIs directly; they request data from
  mcp-ops. (`kubectl get/describe` against the karpenter-lab dev cluster by
  cluster-health is the single exception.)

### Escalation
Any member stops and escalates to the supervisor (who escalates to the lead)
immediately on: preflight failure, a mutation/write request, ambiguous
org/cluster/account ids, credential exposure, or a P1/customer-outage signal.
