# Siemens CAST AI — AI Agent Contracts

Binding rules for any AI agent operating in the Siemens CAST AI project.
Human operators own production state; agents provide read-only assistance unless explicitly approved.

---

## 1. Roles & boundaries

| Actor | Scope | Authority |
|-------|-------|-----------|
| Human operator | Owns AWS accounts, CAST AI orgs, IAM policies, cluster lifecycle, secrets, and customer communication. | Full write access with change-control approval. |
| AI agent | Reads inventory, cost, recommendations, logs, and docs; drafts replies and runbooks; runs local tests and static analysis. | Read-only by default. Write actions require human approval per §3. |
| CI / automation | Executes committed, reviewed scripts in controlled environments. | Only what the pipeline is explicitly granted. |

Agent may **never**:
- Present itself as a human or send outbound customer replies without human review.
- Hold long-lived write-class credentials.
- Run a generic shell REPL or execute arbitrary commands outside a documented script.

---

## 2. Secret handling rules

| Rule | Status |
|------|--------|
| CAST AI API keys, AWS credentials, kubeconfig, and Terraform state live in Granular Vault / env, never in repo. | Mandatory |
| `.env`, `awskey.env`, `*.pem`, `*.key`, `id_*`, `.tfstate`, and `kubeconfig*` are git-ignored. | Mandatory |
| Committed `.env` files must be example templates with placeholder values only. | Mandatory |
| Keys are rotated every 90 days; rotation is a human-only task. | Mandatory |
| Vault is the default secret store; local `.env` is a temporary dev convenience only. | Recommended |
| If a secret is accidentally echoed in chat, terminal, or a file, stop and escalate immediately. | Mandatory |

---

## 3. Change rules — what requires human approval

The agent must stop and ask a human before any of the following:

| Change class | Examples |
|--------------|----------|
| Production cluster mutation | `castctl cluster connect`, `castctl cluster disconnect`, deleting a CAST AI cluster, changing NodePools on a customer cluster. |
| IAM / permission changes | AWS IAM policies, CAST AI API key scopes, RBAC rules, Terraform `castai-eks-role-iam` module changes. |
| Write API calls | Any `POST`, `PUT`, `PATCH`, `DELETE` to `api.eu.cast.ai` or Kubernetes API on a live cluster. |
| API key rotation | Creating, deleting, or re-scoping CAST AI keys; AWS access-key rotation. |
| Terraform apply | `terraform apply`, `terraform destroy`, state migration, backend changes. |
| Customer-facing output | Sending email/Slack/ticket replies, sharing logs or cost data externally. |

The local MCP server enforces read-only access by default (`APPROVAL_MODE=block`). Write calls are rejected unless the server is explicitly started with `APPROVAL_MODE=approve` and a valid approval token is supplied.

---

## 4. Supported read paths vs blocked write paths

### 4.1 Supported read paths

| System | Allowed operations |
|--------|-------------------|
| CAST AI EU API (`api.eu.cast.ai`) | `GET` on registered MCP tools: clusters, nodes, cost, savings, utilization, workload recommendations, optimization actions. |
| CAST AI dashboard backend | `GET /api/health`, `GET /api/clusters` with server-side read-only key. |
| Karpenter visualizer | `get/list/watch` on Karpenter CRDs, Nodes, Pods, Events via backend proxy. |
| Billing export | `GET /v1/billing/...` and `GET /v1/kubernetes/external-clusters`. |
| Local filesystem | Read docs, configs, source code, test fixtures, and generated reports. |
| Git | Read history, status, diff. |

### 4.2 Blocked write paths

| System | Blocked operations |
|--------|-------------------|
| CAST AI API | `POST`, `PUT`, `PATCH`, `DELETE` unless explicit approval token + write-scoped key. |
| Kubernetes | Any mutating verb (`create`, `update`, `patch`, `delete`, `exec`, `port-forward`) on customer clusters. |
| AWS | `aws iam ...`, `aws eks ...` mutations, CloudFormation/Terraform applies. |
| Terraform | `apply`, `destroy`, `state push/rm`, `init -migrate-state`. |
| Git | `git push --force`, rewriting shared history, committing secrets, deleting `.tfstate`. |

---

## 5. Escalation triggers — stop and ask

Stop work and escalate to a human when:

- [ ] Any required secret is missing, expired, or its scope is unclear.
- [ ] The target environment is production or a customer cluster and the action is not purely read-only.
- [ ] A command would modify IAM, RBAC, network policy, or secrets.
- [ ] A CAST AI API call returns `403`, `401`, or `429` repeatedly.
- [ ] A secret appears in terminal output, a diff, a log, or a suggested commit.
- [ ] Terraform drift is detected and reconciliation requires `terraform apply`.
- [ ] A customer asks the agent to run `castctl cluster connect` or similar on their cluster.
- [ ] The requested action is not covered by this contract or by `AGENTS.md`.

Escalation format:

```text
STOP: [trigger]
Impact: [what could go wrong]
What I need: [specific human decision]
```
