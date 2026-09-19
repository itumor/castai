# Siemens CPS — Meeting Action Items (Ebrahim)

Meeting: Siemens CPS (Kubernetes-as-a-Service) — cluster `5dc3bf31-a263-4c6b-88bb-e95b6403aa51`,
org `5e413e89-eb67-48fb-b81c-6172baa988ed` (console.eu.cast.ai).

| # | Action item (owner) | Status | Deliverable |
|---|---|---|---|
| 1 | Investigate why T3a node template shows 0 available instances; open support ticket, CC Siemens (Ebrahim) | 🟡 Root-cause hypotheses ready; live API diags scripted, needs EU API token to execute this session | [01-t3a-investigation.md](01-t3a-investigation.md), [02-support-ticket-t3a-draft.md](02-support-ticket-t3a-draft.md), [../../scripts/siemens-t3a-diag.sh](../../scripts/siemens-t3a-diag.sh) |
| 2 | Clarify Siemens RI / Savings Plan strategy | 🟠 Siemens-side; prep talking points for follow-up | [06-follow-up-agenda.md](06-follow-up-agenda.md) |
| 3 | Demo container live migration + rebalancing on a test cluster (Ebrahim) | ✅ Runbook ready for the test cluster | [04-clm-rebalancing-demo-runbook.md](04-clm-rebalancing-demo-runbook.md) |
| 4 | Check if Database Optimizer is in Siemens' contract (Ebrahim) | 🟠 Platform facts gathered; contract check list prepared (internal action) | [05-dbo-contract-check.md](05-dbo-contract-check.md) |
| 5 | Share spot label/annotation documentation with Siemens (Ebrahim) | ✅ Document compiled — **note: the label is `scheduling.cast.ai/spot`** (meeting notes said `schedule.cast.ai/spot`) | [03-spot-workload-configuration.md](03-spot-workload-configuration.md) |
| 6 | Schedule follow-up next week | 🟠 Agenda drafted, ready for invite | [06-follow-up-agenda.md](06-follow-up-agenda.md) |

## Prepped-extra items surfaced while working

- The workload-autoscaler "infinite restart" fix discussed in the meeting (requests > limits)
  has a documented path: keep-limits policy + multiplier, or automated limits mode —
  folded into the follow-up agenda for the cluster-wide opt-out rollout.
- Network Intelligence feedback (undocumented filter field names, no validation errors) —
  flagged in the follow-up agenda as product feedback to relay internally.
