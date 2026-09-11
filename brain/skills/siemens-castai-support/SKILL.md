# Siemens CAST AI Support — Agent Skill

Use whenever working the Siemens CAST AI support project at
`/Users/eramadan/castai`.

## Mission

Serve Siemens AG as a world-class CAST AI customer success and engineering
support operation. Every action should move a customer request toward
resolution safely and verifiably.

## Required preflight

Before touching code, clusters, or APIs:

1. Read `brain/BRAIN.md` for current context, priorities, and links.
2. Source the correct AWS credentials for the task:
   - Lab work: `source /Users/eramadan/castai/awskey.env` (account 050451381948)
   - Customer cluster work: NEVER use these credentials; require explicit
     customer kubeconfig / role assumption.
3. Determine which CAST AI key you need:
   - Fleet-wide read-only inventory → key from
     `projects/castai-billing-export/.env` (enterprise key, EU region).
   - MCP server / dashboard → key configured in those `.env` files (currently
     default-org key; see [[API Keys & Regions]]).
4. Confirm region and org: Siemens data lives in EU (`api.eu.cast.ai`). The
   dashboard `.env` currently points to US (`api.cast.ai`) — change it for
   Siemens work.

## Standard customer-case workflow

```
Receive case
   │
   ▼
Check brain/BRAIN.md and [[CreateTags Case]] for related history
   │
   ▼
Reproduce locally if possible (use labs/, scripts, or simulate_* tools)
   │
   ▼
Document findings in labs/<case-id>/CASE-....md and update brain notes
   │
   ▼
Draft reply in labs/<case-id>/REPLY-to-customer.md
   │
   ▼
Commit work; present reply to human for send
```

## Hard boundaries

Do NOT do any of the following without explicit human approval:

- Run `castctl cluster connect` against a customer-owned AWS account or
  cluster.
- Create, modify, or delete AWS IAM roles/policies in a customer account.
- Run Helm/Terraform apply against a customer cluster.
- Rotate or expose a CAST AI API key.
- Delete `.tfstate`, `.env`, or support-bundle files.
- Commit plaintext secrets.

## Read vs write posture

| Activity | Default | Approval needed when |
|---|---|---|
| Read CAST AI API / list clusters | OK | enterprise key in billing-export .env |
| Run fleet inventory / billing export | OK | same key |
| Read customer cluster (kubectl get) | OK with customer-provided kubeconfig | n/a |
| castctl cluster connect | BLOCKED | customer explicitly approves |
| Terraform/Helm apply to customer | BLOCKED | customer + CAST AI TAM approve |
| Write to customer AWS IAM | BLOCKED | customer security team approves |

## Verification checklist

Before declaring a case done:

- [ ] Reproduction is written and rerunnable (script or lab file).
- [ ] Findings are documented in a CASE file and linked from brain notes.
- [ ] Reply drafted and reviewed by human.
- [ ] No secrets committed; `git status` checked.
- [ ] Lab AWS resources cleaned up.

## Escalation triggers

Stop and ask the human when:

- A customer asks for write access or key rotation.
- You discover a potential security incident (leaked key, unauthorized
  cluster access).
- The fix requires changes to the `castai-mcp-server` security model or
  approval gate.
- You are unsure which AWS account or API key is in scope.
