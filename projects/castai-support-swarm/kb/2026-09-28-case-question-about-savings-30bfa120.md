# billing: support case case-question-about-savings-30bfa120

- Date: 2026-09-28
- Case: case-question-about-savings-30bfa120
- Category: billing
- Topic: question about savings

## Problem
A customer hit a billing case: "question about savings". This note captures the generic shape of the problem so the next occurrence is handled faster; all customer-specific identifiers stay in the case ledger, not here.

## Detection signals
- [documentation] # Siemens × CAST AI — Savings Calculation: Methodology & Implementation Status: v2 — methodology + live-verified data access + runnable reference implementation. Live-verified against the Siemens **C
- [documentation] # CAST AI — vCPU billing & NET vs GROSS savings (docs research) Researched for a Siemens customer-support case: reconciling NET vs GROSS savings and understanding the vCPU basis of CAST AI's subscrip
- [prior_ticket] n an unreadable org, or renamed. Ask Arseniy for the source row. | - Realized savings (30-day, trailing, from `/v1/cost-reports/clusters/{id}/savings`): - **dema-platform-services-test**: actual
- [api_spec] # CAST AI public API — endpoints for baseline-vs-current savings analysis Research date: 2026-09-25. Companion to [castai-vcpu-and-net-gross-savings-research.md](./castai-vcpu-and-net-gross-savings-r
- customer question: savings?

## Resolution
- (no resolution recorded)

## Reusable checklist
- [ ] Confirm the organization id and cluster id before investigating.
- [ ] Reproduce the behavior in the lab before claiming a fix (read-only).
- [ ] Attach evidence to every claim; let the verifier gate the answer.
- [ ] Search kb notes for prior occurrences of this category.
- [ ] Draft the reply with grounded claims only; a human reviews before any send.
