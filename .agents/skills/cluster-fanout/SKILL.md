---
name: cluster-fanout
description: Mandatory parallel subagent fan-out for CAST AI work. The core law — N clusters = N subagents — applies whenever a task touches 2 or more CAST AI clusters (cost, savings, inventory, nodes, events, recommendations, autoscaler status, audits, health checks, onboarding verification), whether the user says "all clusters", "each cluster", "every cluster", "our EKS fleet", lists cluster names/ids, or the task implicitly spans the org's fleet. ALSO use whenever any work is parallelizable and speed matters — multi-file audits, multi-endpoint API pulls, multi-document research, repetitive transforms, "get this fast", "be efficient". One background subagent per independent unit, all spawned in a single message. Skipping the fan-out and looping clusters serially in the main session is the failure mode this skill exists to prevent.
---

# Cluster Fan-Out — N Clusters = N Subagents

Speed and efficiency come from parallelism. A session that loops over 10 clusters
one API call at a time takes 10× longer than spawning 10 subagents at once, and
it bloats the main context with raw API responses that only need to be summaries.
This skill turns that into a rule, not a preference.

## The core law

**N clusters = N subagents.** Not one subagent for all clusters, not a serial
loop in the main session — exactly one subagent per cluster, all launched in
**one assistant message** so they run concurrently.

The same law generalizes: N files to audit = N subagents, N documents to
research = N subagents, N independent API datasets = N subagents. Any work with
independent units gets fanned out.

## When to fan out

| Trigger | Fan-out unit |
|---------|--------------|
| Cost / savings / inventory / recommendations across clusters | 1 subagent per cluster |
| Health, node, event, or autoscaler checks on several clusters | 1 subagent per cluster |
| Onboarding / readiness verification for multiple clusters | 1 subagent per cluster |
| Audit or migration across many files | 1 subagent per file group |
| Research across multiple docs / sources / APIs | 1 subagent per source |
| User says "fast", "efficient", "all", "each", "every" about multi-unit work | 1 subagent per unit |

## When NOT to fan out

- Single cluster, single quick lookup — do it inline, spawning overhead buys nothing.
- Preflight fails (missing credentials, ambiguous org/cluster scope) — stop and
  confirm with the human first (AGENTS.md section 1), never fan out on a guess.
- Units are dependent (step 2 needs step 1's output) — that is a pipeline, not a
  fan-out; run units sequentially or pipeline them.

## How to fan out

1. **Enumerate the units first.** Resolve the exact cluster list (ids + names)
   with one read-only call to the cluster inventory, or take the list the user
   gave. Never guess a cluster id, org id, or account id (AGENTS.md §5.10).
2. **Spawn all subagents in ONE message.** Use the `subagent` tool once per
   cluster, default `run_in_background: true`. One message, N calls — this is
   what makes them concurrent.
3. **Each subagent gets a fully self-contained prompt.** Subagents do not see
   this conversation. Every prompt must carry: the specific cluster id + name,
   the org context, the exact data to collect, the read-only constraint, and
   the preflight steps.
4. **Cap batch size.** For more than ~8 units, fan out in waves of 8 so
   concurrency limits are respected; start the next wave as results land.

## Per-cluster subagent prompt template

Adapt this skeleton; keep it self-contained:

```text
You are a read-only CAST AI data collector for ONE cluster in the Siemens org.

Cluster: <cluster-id> (<cluster-name>). Working dir: /Users/eramadan/castai.

Preflight (AGENTS.md section 1 — mandatory):
1. `source awskey.env` and `source .env` at repo root if present.
2. Confirm CASTAI_API_BASE is https://api.eu.cast.ai and CASTAI_ORG_ID is set
   (verify with `printenv | grep -E '^(AWS_|CASTAI_)'` — never print values).

Collect, for this cluster only, using GET requests against $CASTAI_API_BASE
with header `X-API-Key: $CASTAI_API_KEY`:
<exact list — e.g. cluster status, node count, current cost, estimated savings,
recommendations, autoscaler status>

HARD RULES:
- Read-only. No POST, PUT, PATCH, DELETE. No `castctl` mutations. No terraform.
- Never echo credentials, tokens, or PII into your output.
- If the API returns 401/403, report the status code — do not retry with other keys.

Return ONE compact result block:
## <cluster-name> (<cluster-id>)
- status: ok | error <code>
- <metric>: <value>
- anomalies: <one line, or "none">
Keep it under 15 lines. Raw JSON stays out of your final answer.
```

## Aggregate, don't dump

When the subagents settle, the main session merges their compact blocks into a
single table — one row per cluster, columns for the metrics, an anomalies
column. Call out errored clusters explicitly instead of silently dropping them.
The human reads one merged report, not N separate answer dumps; raw per-cluster
payloads stay inside the subagents' context.

## Safety inheritance

Subagents inherit this workspace's AGENTS.md, so every prohibition in §5
applies inside each subagent too: no writes to CAST AI or Kubernetes, no
credential commits, no org/cluster id guessing. Fan-out multiplies speed — it
must never multiply risk, which is why the read-only constraint is stated in
every subagent prompt even though AGENTS.md already says it.
