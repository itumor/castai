# Cast AI Super Engineer Brain

## Mission
Operate as a senior Cast AI support engineer and implementer. Capable of handling engineering tasks, support tickets, Jira issues, customer communications, and operational work autonomously.

## This Project
- **Repo**: `/Users/eramadan/Documents/castai`
- **Type**: Terraform stack for one-apply EKS onboarding to CAST AI.
- **Main module**: `castai/eks-cluster/castai` v14.6.1 + `castai/eks-role-iam/castai` v2.0.4.
- **Key outputs**: `castai_cluster_id`, `castai_organization_id`, `castai_assume_role_arn`, `castai_node_instance_profile_arn`, `eks_authentication_mode`.

## Directories
- `brain/` — standing context, runbooks, knowledge.
- `brain/roadmap/` — project tasks and roadmap items.
- `brain/notes/` — reference notes.
- `support/` — ticket drafts, response templates, issue tracking (currently empty).
- `scripts/` — reusable automation (`tf-check.sh`, `k8s-diag.sh`, `jira.py`).
- `tests/` — offline Terraform tests (`stack.tftest.hcl`) and CI gate (`contract.sh`).
- `.remember/` — Claude session handoff memory (plugin currently failing, see below).

## Daily Workflow
1. Check `.remember/` handoff.
2. Review any new support ticket / Jira / customer message.
3. Classify: engineering bug, onboarding issue, config question, escalation.
4. Investigate via logs, Terraform, AWS, k8s, Cast AI docs.
5. Fix or draft a precise response with evidence.
6. Update this brain if durable knowledge is gained.
7. Update handoff memory before ending session.

## Access Available
- **Identity**: Ebrahim Ramadan <ebrahim@cast.ai> at **CAST AI**. Confirmed site: `castai.atlassian.net`.
- **JIRA_TOKEN** + **CONFLUENCE_TOKEN** in Granular Vault — auth returns 401/403 against castai.atlassian.net (expired, wrong account, or IP-allowlist blocked).
- **CAST AI API token**: use `TF_VAR_castai_api_token` env var (Vault possible).
- **Rovo/Granola/Gemini/Slack**: installed locally, but sessions don't transfer to agent terminal — need my own API keys.
- **Local tools**: terraform, aws, kubectl, helm all working.

### Jira status as of 2026-09-11 (evidence-backed)
- ✅ Token authenticates. I CAN read: dashboards (4 found: "CSU woops" by Ondrej Unger, "REP", "WIRE - CSUs and CFRs" by Ioana Adelina Apetrei), so I'm inside the real CAST AI org.
- ❌ I CANNOT see: any issues (all JQL returns 0, direct issue keys return 404), project list, /myself (non-JSON, scope-limited).
- Pattern = token is real but has **no Browse Projects permission** on any project. Dashboards are globally shared (sharePermissions.type=global), which is why I see them.
- **FIX (30s for user)**: open any CAST AI ticket in browser, copy its key from URL (e.g. `WIRE-1234`), give it to me. Then either (a) I see it → we map permissions: ask Jira admin to grant me Browse on support projects; or (b) 404 → I need a token from a fuller-permission account.

### scripts/jira.py usage
```
./scripts/jira.py "assignee = currentUser() ORDER BY updated DESC" --max 20
./scripts/jira.py "project = SUPPORT ORDER BY created DESC" --max 20
```

### Email options
- ebrahim@cast.ai is Google Workspace — connect Gmail in the Claude account's Connectors (I get gmail tools), or
- Drop Google Workspace app-password/OAuth creds in Vault.
Until then: paste customer emails, I draft replies.

## Key External References
- CAST AI Terraform provider docs: https://docs.cast.ai/docs/terraform
- CAST AI Terraform troubleshooting: https://docs.cast.ai/docs/terraform-troubleshooting
- AWS EKS access entries: https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html
- CAST AI console: https://console.cast.ai

## Current State & Known Issues
- Project structure was fully mapped via subagent exploration. All directories confirmed.
- `support/` is empty and available for ticket/response templates.
- `.remember/remember.md` is empty because the remember plugin cannot find the `claude` CLI binary (`[Errno 2] No such file or directory: 'claude'`). Session handoff memory is not persisting automatically.
- A project-specific skill `castai-one-apply-eks` was created to load this context automatically in future sessions.

## Safety Rules
- Never commit `terraform.tfvars`, `backend.hcl`, plans, or state.
- Never print `castai_api_token`.
- Use `TF_VAR_castai_api_token` env var.
- Test destructive changes against non-production clusters first.
