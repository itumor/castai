# cost_reporting: support case case-realized-savings-api-exact-m-e9fc98bc

- Date: 2026-09-28
- Case: case-realized-savings-api-exact-m-e9fc98bc
- Category: cost_reporting
- Topic: Realized savings API — exact methodology?

## Problem
A customer hit a cost_reporting case: "Realized savings API — exact methodology?". This note captures the generic shape of the problem so the next occurrence is handled faster; all customer-specific identifiers stay in the case ledger, not here.

## Detection signals
- [api_spec] CAST AI public API — endpoints for baseline-vs-current savings analysis Research date: <id>.
- [documentation] GET /v1/cost-reports/clusters/{id}/savings — legacy downscaling+spot realized (what the old console "savings" showed).
- [prior_ticket] Realized savings — what CAST AI actually saved in a period.
- [source_code] Source scan: 'castai-mcp-server/src/tools/index.js' matches keyword(s) "savings", "cost-report"; line 177: "get_cluster_savings: {"
- [source_code] Source scan: 'castai-terraform-1/brain/notes/castai-optimization-quality-metrics-and-notifications.md' matches keyword(s) "savings", "cost-report", "costreport", "realized"; line 67: "## 2. Savings: available vs projected vs realized"
- [source_code] Source scan: 'castai-terraform-1/brain/notes/meeting-prep-optimization-quality-metrics.md' matches keyword(s) "savings", "cost-report", "realized"; line 50: "> **Savings capture ratio = Realized savings ÷ Addressable savings**"
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/README.md' matches keyword(s) "savings", "cost-report"; line 73: "curl -sS "***REDACTED***" -H "***REDACTED***""
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/config.example.json' matches keyword(s) "savings"; line 12: ""min_savings_pct": 10"
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/mock/fixtures/savings.json' matches keyword(s) "savings"; line 6: ""savingsPercentage": "71""
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/mock/fixtures/savings_11111111-<id>.json' matches keyword(s) "savings"; line 6: ""savingsPercentage": "63""
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/mock/fixtures/savings_aaaaaaaa-<id>.json' matches keyword(s) "savings"; line 6: ""savingsPercentage": "4""
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/reports/<id>siemens-dev-live.md' matches keyword(s) "savings"; line 18: "- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute."
- [source_code] Source scan: 'castai-terraform-1/support/siemens-cps/00-action-items.md' matches keyword(s) "savings"; line 9: "| 2 | Clarify Siemens RI / Savings Plan strategy | 🟠 Siemens-side; prep talking points for follow-up | [06-follow-up-agenda.md](06-follow-…"
- [source_code] Source scan: 'castai-terraform-1/support/siemens-cps/01-t3a-investigation.md' matches keyword(s) "savings"; line 9: "- Siemens holds heavy central discounts on T-family (up to 80% RI/Savings-Plan discount), so T3a"
- [source_code] Source scan: 'castai-terraform-1/support/siemens-cps/02-support-ticket-t3a-draft.md' matches keyword(s) "savings"; line 26: "The customer's **T3a node template** (their preferred family due to centrally negotiated RI/Savings"
- [source_code] Source scan: 'castai-terraform-1/support/siemens-cps/06-follow-up-agenda.md' matches keyword(s) "savings"; line 9: "2. **Savings Plan / RI strategy deep-dive** (10 min)"
- [source_code] Source scan: 'castai-terraform-1/support/siemens-cps/07-vcpu-billing-net-gross-reconciliation-reply.md' matches keyword(s) "savings", "cost-report", "realized"; line 1: "# 07 — Reply draft: vCPU calculation, net vs gross savings, fair KPI"
- customer question: Subject: Realized savings API — exact methodology?
- customer question: What is the exact formula behind the realized savings in the cost report?
- customer question: instance types, or something else?
- customer question: reporting window?

## Resolution
- (no resolution recorded)

## Reusable checklist
- [ ] Confirm the organization id and cluster id before investigating.
- [ ] Reproduce the behavior in the lab before claiming a fix (read-only).
- [ ] Attach evidence to every claim; let the verifier gate the answer.
- [ ] Search kb notes for prior occurrences of this category.
- [ ] Draft the reply with grounded claims only; a human reviews before any send.
