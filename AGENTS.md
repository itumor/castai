# Siemens CAST AI — Agent Operating Instructions

How AI agents work this repository safely and consistently.

---

## 1. Required preflight checks before acting

Before running code, querying APIs, or suggesting changes:

| # | Check | How |
|---|-------|-----|
| 1 | Working directory | Must be the project root or a component subdirectory. |
| 2 | Env files sourced | Source `awskey.env` and `.env` if they exist at repo root. Verify vars with `printenv \| grep -E '^(AWS_|CASTAI_)'` without printing values. |
| 3 | Region & org | Confirm `CASTAI_API_BASE` is `https://api.eu.cast.ai` and `CASTAI_ORG_ID` matches the intended Siemens org. |
| 4 | AWS identity | Run `aws sts get-caller-identity` to confirm account and role. |
| 5 | Intent scope | Confirm whether the target is dev lab (`karpenter-lab`) or a customer/production cluster. |
| 6 | Read-only posture | Ensure MCP server `APPROVAL_MODE=block` and dashboard key has read-only scopes. |

Do not proceed if any required credential is missing or if the target environment is unclear.

---

## 2. Subagent-first parallelization policy (hook)

This section is always in context and acts as the session's enforcement hook —
DSH has no executable hook runtime, so this policy plus the auto-discovered
`cluster-fanout` skill **is** the hook. Every session in this repo follows it.

**Core law: N clusters = N subagents.** Any task touching 2 or more CAST AI
clusters (cost, savings, inventory, nodes, events, recommendations, autoscaler
status, audits, readiness checks) spawns exactly one background subagent per
cluster, all launched in a single assistant message so they run concurrently.
Serial cluster loops in the main session are a policy violation: they cost N×
the wall-clock time and flood the main context with raw API payloads that only
need to be summaries.

**Generalize the fan-out.** Any work with independent units — multi-file
audits, multi-endpoint pulls, multi-source research, repetitive transforms —
fans out the same way: one subagent per unit, one message, background mode.
When speed or efficiency is requested, delegation is the default, not the
exception. Only single-cluster single lookups and dependent step chains stay
inline.

| Rule | Detail |
|------|--------|
| 1. Load the skill first | Load the `cluster-fanout` skill before multi-cluster or parallel work; follow its per-cluster prompt template and aggregation format. |
| 2. One message, N calls | Spawn all subagents in one assistant message with background mode; never drip them one per turn. |
| 3. Self-contained prompts | Subagents see no conversation history; each prompt carries its cluster id/name, org context, exact data to collect, and the read-only constraint. |
| 4. Enumerate before spawning | Resolve the exact cluster list first (read-only inventory call or user-provided list); never guess ids (§6.10). |
| 5. Safety is inherited, still restated | Subagents inherit this file's prohibitions — and every subagent prompt still restates the read-only rule, because fan-out must multiply speed, never risk. |
| 6. Merge, don't dump | The main session aggregates subagent results into one report (one row per cluster, anomalies flagged, errored clusters listed) instead of relaying N raw dumps. |
| 7. Wave cap | More than ~8 units → fan out in waves of 8 to respect concurrency limits. |

Preflight (§1) still gates everything: no fan-out before credentials, region,
org, and target scope are confirmed.

---

## 3. Verify AWS credentials and CAST AI API key scope

### AWS credentials

```bash
aws sts get-caller-identity
aws configure list
```

Expected:
- Account ID and role match the intended Siemens environment.
- No long-term access keys are active in `~/.aws/credentials` for this work.

### CAST AI API key scope

```bash
# With CASTAI_API_KEY and CASTAI_API_BASE exported
curl -sS -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Accept: application/json" \
  "$CASTAI_API_BASE/v1/organizations" \| jq '.organizations[] \| {id, name}'
```

Read-only scopes required:

| Scope | Purpose |
|-------|---------|
| `organizations:read` | Org resolution and allow-list validation. |
| `kubernetes/external-clusters:read` | Cluster inventory and nodes. |
| `cost-reports:read` | Savings and cost data. |
| `workload-autoscaling:read` | Workload recommendations and autoscaler status. |
| `inventory:read` | Resource inventory. |
| `recommendations:read` | Optimization recommendations. |

Never use a key with `*:write`, `*:admin`, billing, or cluster-connect scopes unless a human explicitly approves a one-time approved operation.

---

## 4. Run tests for each component

### Root repo utilities

```bash
npm test
```

### castai-mcp-server

```bash
cd castai-mcp-server
npm install
npm test
```

Smoke test against live API (redacted):

```bash
cd castai-mcp-server
node scripts/real-castai-smoke.js
```

### Dashboard

```bash
cd dashboard
npm install
npm test
PORT=3456 npm start      # http://localhost:3456
```

### castai-support-swarm

```bash
cd castai-support-swarm
npm install
npm test
```

### Karpenter visualizer

```bash
cd projects/karpenter-visualizer
npm install
npm run test             # backend + frontend unit tests
MOCK_K8S=true npm run dev # http://localhost:5173, backend :3001
```

### Billing export

```bash
cd projects/castai-billing-export
./tests/run_tests.sh
```

### Support swarm (13-agent support pilot)

```bash
cd projects/castai-support-swarm
npm test            # node --test, offline, no credentials needed
npm run eval        # 7-case evaluation, writes evals/EVALUATION.md
npm run demo        # offline answer to fixtures/thread-pdb-scaledown.md
```

Drafts are written to `outbox/` and are draft-only; a human sends. The CAST AI
client inside is GET-only; keep `--live` mode (LLM provider + real read-only API
client) behind the same preflight checks as section 1.

Inside the DeepSeek Harness the swarm runs as the agent preset
**CAST AI Support Swarm**; install it with
`cd projects/castai-support-swarm && npm run install:dsh` (idempotent; writes
`$DSH_HOME/.agent-presets/castai-support-swarm/`):
select it when starting a session, then paste a customer thread — the session
calls `support_swarm_answer` (offline engine: verdict, confidence, draft reply)
or `support_swarm_eval`. In-session runs are offline only; `--live` stays a
CLI decision. The workplace skill `.agents/skills/castai-support-swarm/`
routes any pasted customer thread through the swarm in ANY session whose
preset discovers workspace skills: load it before answering.

---

## 5. Canonical customer-support workflow

```text
receive case → check brain → reproduce → document → reply
```

| Step | Action | Exit criteria |
|------|--------|---------------|
| 1. Receive case | Read ticket / Slack / email. Extract cluster id, org id, symptom, urgency, and customer contact. | Case metadata recorded in working notes. |
| 2. Check brain | Read `brain/` notes and `.kimchi/docs/` for similar incidents, runbooks, and org-specific context. | Relevant precedents linked. |
| 3. Reproduce | Use read-only MCP tools or dashboard backend. Query cluster status, nodes, events, cost, and recommendations. | Evidence collected without mutating state. |
| 4. Document | Write findings to `.kimchi/docs/` or ticket notes: symptom, data observed, hypothesis, next steps, risks. | Another agent or human can continue from the notes. |
| 5. Reply | Draft a response; human reviews and sends. For P1/outages, escalate to on-call human immediately. | No unsupervised customer-facing send. |

If reproduction requires a write action, stop after step 3 and escalate.

---

## 6. Do not do

| # | Prohibition | Why |
|---|-------------|-----|
| 1 | Never run `castctl cluster connect` against a customer cluster without explicit human approval. | Connects modify customer infrastructure and permissions. |
| 2 | Never commit API keys, tokens, passwords, kubeconfig, or `.tfstate`. | These are git-ignored and must stay in Vault. |
| 3 | Never delete or rewrite `.tfstate` files. | State loss can corrupt infrastructure. |
| 4 | Never run `terraform apply` or `terraform destroy`. | Infrastructure changes require human review. |
| 5 | Never issue `POST`, `PUT`, `PATCH`, `DELETE` against CAST AI or Kubernetes unless approved. | Mutations require approval token + write-scoped credentials. |
| 6 | Never forward raw CAST AI responses containing credentials or PII to a customer. | Responses must be sanitized by a human. |
| 7 | Never run commands as `root` or with `sudo` unless the task explicitly requires it. | Least privilege. |
| 8 | Never leave a long-running server or port-forward open after a session ends. | Clean up background processes. |
| 9 | Never disable the MCP redactor or set `APPROVAL_MODE=approve` by default. | Weakens defense-in-depth. |
| 10 | Never guess an org id, account id, or cluster id when scope is ambiguous. | Confirm before acting. |

---

## 7. Known runbooks

When a case involves CAST AI cluster token rotation or `401 Authorization Required` after rotation, load the project skill `castai-token-rotation` and read the runbooks in `.kimchi/docs/`:

- `token-rotation-e2e-status.md` — what was tested and the key findings.
- `reply-glejn-token-rotation.md` — reviewed customer reply template.
- `rotate-token-manual-commands.md` — manual rotation commands per install topology.

Key facts:

- The cluster token endpoint is `POST /v1/kubernetes/external-clusters/{clusterId}/token`; there is no public revoke endpoint.
- The previous token stays valid for an extended period (observed ≥60 minutes).
- Update every secret used by the topology, then restart every component.
- Organization API keys are for management-API automation only, not as a replacement for the cluster token.
