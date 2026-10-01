# 07 — Reply draft: vCPU calculation, net vs gross savings, fair KPI

**Status: DRAFT — human reviews and sends (no unsupervised customer send).**
Target: Siemens CPS platform team. Date: 2026-09-21.
Internal backing notes: `.kimchi/docs/siemens-cps-vcpu-billing-net-savings-reconciliation.md`
and `.kimchi/docs/castai-vcpu-and-net-gross-savings-research.md`.

---

Hi team,

following up on your question about how CAST AI counts vCPUs, so the
net-vs-gross savings reconciliation and your KPI are built on the same basis.
Here is the calculation, with your September figures as the worked example.

### 1. The vCPU basis (billing side)

CAST AI meters usage in **billable CPUs**: one billable CPU is one
**provisioned** vCPU running continuously for the full month, sampled at
regular intervals and time-pro-rated (15 of 30 days = 0.5 billable CPU).
Provisioned means node capacity — not pod requests, not actual utilization.

Your org's live **Platform usage** report (Sept 1–21) shows exactly this:

| Cluster | Billable CPU (month-to-date) | ≈ Avg provisioned vCPU |
|---|---|---|
| dema-platform-services | 345.76 | ~500 |
| dema-platform-services-test | 10.88 | ~16 |
| **Org total** | **356.63** | — |

Each feature — **Node Autoscaler** and **Workload Autoscaler** — reports the
same 356.63 CPU; both are priced per vCPU in this model. At the current pace
the September billable total lands at ≈ 510 vCPU per feature. Any credits or
free-of-charge periods from your contract are deducted from this figure
(currently none are applied on your account).

Two things that often trip people up:
- The count includes **all connected clusters** of the org — including the test
  cluster — and on-demand and spot nodes count the same.
- The fee scales with provisioned vCPU **regardless of per-workload
  autoscaling opt-in** (as discussed in our workshop).

### 2. Gross vs net (savings side)

| Figure | What it is | Your Sept MTD (1–21) |
|---|---|---|
| Realized (gross) savings | downscaling + spot savings reported by CAST AI for the window | **$932.68** on $12,278.99 actual spend (main $895.84, test $36.84) |
| Net savings | gross − CAST AI fee = gross − (billable CPU × your contract rate, minus credits) | rate is contract-specific — see §3 |
| Estimated/potential savings | "if all recommendations were applied" headline (e.g. 43% in the console) | **not realized** — please don't use it for the KPI |

So the reconciliation is per calendar month:

```
net savings = (downscalingSavings + spotSavings) − (billable CPU × contracted rate per feature) 
```

For a fair KPI, make sure both sides use the same month window and the same
cluster scope. With the numbers above, the fee breaks even against realized
savings at roughly **$2.6–2.7 per billable vCPU** per feature at the current
pace; anything below that rate yields positive net savings this month.

### 3. Contract points to confirm with us / your account representative

- The contracted **per-vCPU rate** for each feature, and whether Workload
  Autoscaler vCPUs are charged separately or bundled/credited when both
  features are active.
- Whether any **minimum charge, credits, or free-of-charge onboarding window**
  applies to your org.
- If a CAST AI-provided report you received shows fields like `grossSavings`,
  `netSavings`, or `castaiCost`: those field names are not part of the public
  API — we'll obtain CAST AI's data dictionary for that report so your KPI and
  the invoice reconcile field-by-field.

Happy to walk through the numbers on a short call.

Best regards,
[Name]

---

#### Reviewer notes (internal, remove before sending)
- Numbers pulled live from EU API on 2026-09-21, read-only:
  `/v1/billing/platform-usage-report`, `…/platform-usage-detail`,
  `/v1/cost-reports/clusters/{id}/savings` (window Sep 1→now), org clusters summary.
- Do NOT quote the $2.6–2.7 break-even rate as "the price" — it is derived
  arithmetic from their own realized savings, not a CAST AI list price.
- If the customer asks why the legacy "Usage report" (`/v1/report/usage/*`)
  shows zero: it's deprecated and superseded by the new billing system
  (Platform usage) — total is carried by `platform-usage-report`.
