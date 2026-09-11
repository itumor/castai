# Siemens CAST AI Support — Brain

Project mission: serve Siemens AG as a world-class CAST AI customer success
and engineering support operation.

## How to use this brain

- Start every session by reading this file and following the relevant
  wikilinks.
- Update notes when durable facts change (fleet size, key scope, case
  status).
- Keep secrets out of brain notes — reference env files by path only.
- Every non-trivial support case should leave a lab note under `labs/` and
  a link from [[CreateTags Case]] or a new note here.

## Current priorities

1. [[CreateTags Case]] — TKT-20260817-b640: account 238720913587 blocked on
   `ec2:CreateTags explicitDeny`. Awaiting full SCP JSON from Siemens CSO.
2. Fleet dashboard / MCP server key scoping — the MCP key currently binds to
   the default empty org; decide whether to swap it for the enterprise key.
3. Keep fleet inventory (`cluster-readiness-outputs/castai_cluster_inventory.xlsx`)
   current for engagement reporting.

## Project map

| Area | Path | Purpose |
|---|---|---|
| MCP server | `castai-mcp-server/` | Read-only CAST AI tools for LLM agents |
| Dashboard | `dashboard/` | Read-only Siemens CAST AI cluster dashboard |
| Fleet inventory | `cluster-readiness-outputs/` | Excel inventory + readiness reports |
| Billing export | `projects/castai-billing-export/` | Enterprise billing CSV across child orgs |
| Karpenter visualizer | `projects/karpenter-visualizer/` | Read-only Karpenter object graph UI |
| Terraform | `terraform/` | EKS onboarding modules (readonly, full, platform, org) |
| Karpenter lab | root + `karpenter-production/` | Repro lab for Karpenter + CAST AI coexistence |
| Labs / cases | `labs/` | Case-specific reproductions and replies |
| Contracts | `CONTRACTS.md`, `AGENTS.md` | Binding agent rules |
| Harness | `.granular/harness.json` | Granular workspace descriptor |
| Skills | `brain/skills/` | Agent skills and runbooks |

## Key knowledge notes

- [[Siemens Fleet]] — live fleet facts, top orgs, agent health
- [[API Keys & Regions]] — which key sees what, where they live
- [[CreateTags Case]] — full case file for the active CreateTags blocker
- [[Karpenter + CAST AI Coexistence]] — supported models, conflicts, migration
- [[Reusable Components]] — one-liner reference for each project component
