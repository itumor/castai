# Chapter 13 — Savings Measurement & FinOps

Sources: [Savings calculations (baseline methodology)](https://docs.cast.ai/docs/savings-baseline) · [Realized savings](https://docs.cast.ai/docs/savings-report) · [Available savings](https://docs.cast.ai/docs/available-savings)

## 13.1 The value chain (and where it breaks)

```
smaller requests  →  less schedulable demand  →  node consolidation  →  lower cloud bill
   (WAS, certain)      (WAS, certain)            (needs Node Autoscaler      (actual invoice)
                                                  or manual bin-packing)
```
**WAS alone does not reduce your invoice.** Its savings show in the report as *modeled* numbers unless node capacity actually shrinks. Per the savings report: *"Workload autoscaler savings come from rightsizing... These are modeled estimates. If the node autoscaler is enabled, they are already included in realized savings. Otherwise, they are potential savings not reflected in actual spend."*

## 13.2 Key definitions (report semantics)

| Term | Meaning |
|---|---|
| **Requested** | What workloads request now (after rightsizing) |
| **Original requested** | What workloads requested before rightsizing — the Δ is the rightsizing effect |
| **Provisioned** | Actual node capacity (all lifecycles combined: on-demand/spot/fallback) |
| **Modeled WAS savings** | Estimated savings from rightsizing (double-count risk → see below) |
| **Realized savings** | Total measured savings of Cast AI-managed capacity vs baseline |
| **Available/potential savings** | What's still on the table if you act (report) |

## 13.3 Baseline methodology (how the numbers are built)

Baseline = 4 parameters over a baseline window + re-application to current demand: **CPU overprovisioning factor, RAM overprovisioning factor, CPU unit cost ($/core-h), RAM unit cost ($/GiB-h)**. Ratios/rates are used (not old bills) so comparisons stay fair as clusters grow.

**Baseline selection (per cluster, daily, first with enough data wins):**
1. **Cluster history** — needs ≥7 days between cluster connect and >20% of nodes becoming Cast-AI-managed.
2. **Peer clusters** — average of org clusters that have their own Cluster history baseline.
3. **Industry average** — fleet-wide average on the day active management started (least specific; manual baseline review possible via Cast AI).

**Eligibility:** cluster ≥14 days old **and** actively managed; otherwise it is **absent** from the report (not zero). Manual baseline adjustments exist for known mismatches. Current model does NOT split on-demand/spot/fallback pricing.

## 13.4 Anti-double-counting rule

If the **Node Autoscaler is enabled**, WAS savings are already inside realized savings — report them once. If it isn't, WAS savings are **potential** until capacity actually shrinks. In stakeholder reporting, map exactly one line to each: `Realized (incl. WAS effect) + Available (remaining)`.

## 13.5 Worked, hypothetical example (assumptions explicit)

*Hypothetical cluster: 40 workloads; original requested 400 CPU / 800 GiB; after WAS: 260 CPU / 560 GiB; baseline factors CPU×1.8, RAM×1.4; unit costs $0.031/core-h, $0.004/GiB-h; 730h month.*

- Demand reduction: 140 CPU + 240 GiB monthly request-hours ≈ 102,200 CPU-h + 175,200 GiB-h.
- Modeled WAS savings ≈ 102,200×$0.031 + 175,200×$0.004 ≈ $3,168 + $701 ≈ **$3,869/mo (modeled)**.
- Realized only if nodes shrink: e.g. consolidation frees 3 × (16 CPU / 64 GiB) nodes ≈ $1,700–$2,600/mo depending on instance price → **report the actual node reduction as realized; the rest stays "available".**
- Baseline reconstruction (no-Cast-AI cost) uses the factors on today's demand — do not just compare bills MoM.

## 13.6 Validation checklist (finance + engineering)

- [ ] Cluster older than 14 days, actively managed → appears in the Savings Report
- [ ] Baseline type known (cluster history / peer / industry) and reasonable
- [ ] Node consolidation verified (node count/provisioned CPU RAM trend) before claiming realized savings
- [ ] "Requested" vs "Original requested" trend matches engineering rollout timeline
- [ ] No double counting: WAS modeled savings excluded from realized when NAS off; included once when on
- [ ] Timezone/reporting window agreed (report windows documented in savings-report)
- [ ] CAST AI fees/line items reconciled via billing APIs against net savings
- [ ] Anomalies (big deploys, load tests) annotated for reviewers

## 13.7 Practical attribution patterns

- **Per-workload proof:** Workload costs report (original vs current requests) + console workload view.
- **Per-cluster:** Realized savings report + provisioned capacity curve.
- **Org:** Organization cost report + available savings for the backlog.
