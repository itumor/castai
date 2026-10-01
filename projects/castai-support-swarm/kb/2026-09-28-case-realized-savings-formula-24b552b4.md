# cost_reporting: support case case-realized-savings-formula-24b552b4

- Date: 2026-09-28
- Case: case-realized-savings-formula-24b552b4
- Category: cost_reporting
- Topic: realized savings formula

## Problem
A customer hit a cost_reporting case: "realized savings formula". This note captures the generic shape of the problem so the next occurrence is handled faster; all customer-specific identifiers stay in the case ledger, not here.

## Detection signals
- [documentation] # Siemens × CAST AI — Savings Calculation: Methodology & Implementation Status: v2 — methodology + live-verified data access + runnable reference implementation. Live-verified against the Siemens **C
- [prior_ticket] n an unreadable org, or renamed. Ask Arseniy for the source row. | - Realized savings (30-day, trailing, from `/v1/cost-reports/clusters/{id}/savings`): - **dema-platform-services-test**: actual
- [prior_ticket] opose them — they come from the report's own formula (`real potential = CAST AI savings − modeled fee`) applied to the exported data. Below is what CAST AI's numbers actually are, what drives them, an
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/config.example.json' matches keyword(s) "savings"; line 12: ""min_savings_pct": 10"
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/mock/fixtures/savings.json' matches keyword(s) "savings"; line 6: ""savingsPercentage": "71""
- [source_code] Source scan: 'castai-terraform-1/score-alerting-poc/mock/fixtures/savings_11111111-2222-3333-4444-555555555555.json' matches keyword(s) "savings"; line 6: ""savingsPercentage": "63""
- customer question: realized savings formula?

## Resolution
- (no resolution recorded)

## Reusable checklist
- [ ] Confirm the organization id and cluster id before investigating.
- [ ] Reproduce the behavior in the lab before claiming a fix (read-only).
- [ ] Attach evidence to every claim; let the verifier gate the answer.
- [ ] Search kb notes for prior occurrences of this category.
- [ ] Draft the reply with grounded claims only; a human reviews before any send.
