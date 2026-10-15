---
name: castai-superteam
description: Launch or reuse the CAST AI Superteam — a supervisor-led agent team for Siemens CAST AI operations (cost & savings, cluster health, support triage, docs/memory, MCP/API ops). Use whenever a mission is substantial or cross-cutting: multi-cluster cost/savings/health reporting, "give me a fleet report", support-case work that also needs live data or memory updates, any request that names "the team" or asks for coordinated CAST AI ops. The supervisor decomposes the mission onto the shared task board, specialists execute read-only, and the human gets ONE merged report. Single quick lookups do NOT need the team — answer inline.
---

# CAST AI Superteam — routing skill

Source of truth: `projects/castai-superteam/` (manifest `TEAM.md`, role
files `agents/*.md`). The team contract = AGENTS.md: read-only posture,
cluster-fanout parallelism, drafts-only customer comms.

## When to use the team

| Mission | Use team? |
|---|---|
| Fleet-wide cost/savings/inventory/health/reporting | YES — supervisor fans out, one unit per cluster |
| Support case needing live data + precedent search + memory update | YES — support-triage + mcp-ops + docs-keeper |
| Multi-role mission ("report + draft the customer update + record findings") | YES |
| One cluster, one quick fact | NO — inline |
| Preflight/scope unclear | NO — clarify with the human first (AGENTS.md §1) |

## How to launch (DSH Agent Teams session)

1. Spawn six background teammates in ONE message; each spawn prompt tells the
   teammate to read its role file under `projects/castai-superteam/agents/`
   plus `AGENTS.md` before its first mission. Names: `supervisor`,
   `cost-analyst`, `cluster-health`, `support-triage`, `docs-keeper`,
   `mcp-ops`. Every spawn restates the read-only rule and the working
   directory `/Users/eramadan/castai`.
2. Hand the mission to `supervisor` (never directly to specialists). The
   supervisor creates shared tasks with write scopes, dispatches, and merges.
3. Receive ONE merged report from `supervisor`; relay to the human.
4. Keep the team alive across the session; reuse it for follow-up missions
   instead of respawning.

## How to launch (preset session)

Sessions created with the **CAST AI Superteam** preset (install once:
`cd projects/castai-superteam && npm run install:dsh`) are the supervisor:
spawn the five specialists per `projects/castai-superteam/README.md` and
follow `TEAM.md`.

## Hard rules (restated — binding on every member)

- Read-only: GET-only CAST AI/AWS calls, kubectl reads on karpenter-lab
  only, no terraform, no customer-facing sends (`outbox/` drafts only).
- Live API calls are made ONLY by `mcp-ops`, only after AGENTS.md §1
  preflight (`api.eu.cast.ai`, org id, read-only key scopes, AWS identity).
- Never guess org/cluster/account ids. Anything needing an approval token
  escalates to the human instead of executing.
- Merge, don't dump: compact blocks in, one merged report out.
