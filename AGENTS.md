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

## 2. Verify AWS credentials and CAST AI API key scope

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

## 3. Run tests for each component

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

---

## 4. Canonical customer-support workflow

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

## 5. Do not do

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
