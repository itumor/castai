# ngm-integ-eks (1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f) — cost/savings/baseline pull, 2026-10-08

Org: SI GSW CLO (07aa3c29-3e1f-44bc-ad60-ceedb878d99a), api.eu.cast.ai, read-only GETs.

## FY26 monthly series (USD, compute basis; CAST-modeled, not Cloudability)

| Month | Compute actual (default) | Compute (listing) | Storage | Reported savings |
|---|---:|---:|---:|---:|
| 2025-10 | 29,894.97 | 37,612.11 | 2,249.36 | 39,953.33 |
| 2025-11 | 19,958.97 | 26,633.40 | 1,490.38 | 23,217.67 |
| 2025-12 | 24,934.13 | 33,272.63 | 1,828.51 | 27,762.37 |
| 2026-01 | 27,184.52 | 36,274.50 | 2,172.96 | 23,911.92 |
| 2026-02 | 33,681.55 | 44,944.80 | 2,391.93 | 20,644.67 |
| 2026-03 | 40,650.38 | 54,244.42 | 2,996.19 | 25,945.70 |
| 2026-04 | 51,734.25 | 69,022.69 | 4,358.26 | 26,545.83 |
| 2026-05 | 47,864.69 | 63,855.94 | 3,512.97 | 15,894.36 |
| 2026-06 | 48,959.09 | 65,286.09 | 5,719.67 | 26,267.92 |
| 2026-07 | 24,775.96 | 36,632.94 | 3,283.54 | 20,517.37 |
| 2026-08 | 19,673.10 | 32,777.79 | 3,119.78 | 20,734.53 |
| 2026-09 | 22,047.12 | 36,734.53 | 1,785.99 | 18,512.46 |

FY26 totals: compute default **$391,358.74**, compute listing **$537,291.85**, reported savings **$289,908.13**.

avg vCPU/mo: 930.7, 660.9, 784.5, 837.3, 1162.6, 1272.3, 1653.8 (Apr peak), 1661.2, 1827.6 (Jun max), 983.6 (Jul −46%), 876.0, 1005.3.

Important: cost endpoint daily items are hourly snapshots; `summary` fields carry correct period totals (used above). CAST-modeled "actual" ≈ 2× Cloudability billed EC2 (Sep: CAST $22,047 compute vs billed $11,096.67; storage CAST $1,786 vs billed $1,807.33 matches well). Savings item timestamps run from day-2 to next-month-day-1 (24h-window end labels); monthly sums shifted ≤1 day.

## Baseline params (verbatim, GET /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params)

```json
{"cpuOverprovisioningFactor":2.1959564377971414, "memoryOverprovisioningFactor":3.4741782137820203, "costPerCpuCoreHourly":0.02666254024744202, "costPerMemoryGibHourly":0.003731482624618688, "baselinePeriodStartTime":"2025-09-30T09:54:43Z", "baselinePeriodEndTime":"2026-04-27T00:00:00Z", "baselineType":"CLUSTER_HISTORY", "updateTime":"2026-04-28T08:00:37Z"}
```

Baseline window **2025-09-30T09:54:43Z → 2026-04-27T00:00:00Z** = exactly CAST go-live date (firstOperationAt 2026-04-27). Frozen BEFORE Siemens' May/June 2026 scheduler change.

## PDF $40,804.52 verification

Window 2026-09-02T00:00:00Z → 2026-10-02T00:00:00Z (30d): actual compute (default) $22,388.83 + savings $18,415.69 = **$40,804.52 EXACT** (PDF: $22,387.68 + $18,416.84; Δ≈$1.15 boundary rounding). "API-implied projected cost" = actual + savings = frozen-baseline-implied cost, not an independent projection.

Savings endpoint reports "downscaling savings" even for Oct 2025–Mar 2026 (BEFORE go-live): $20.6k–40k/mo — proves savings = mechanical baseline-implied minus actual, not causal attribution.

## Node-count history Sep 2026 (step 86400, agent source)

min **44**, max **1,019**, avg **637** nodes/day; 100% on-demand, 0 spot. Burst pattern: weekday peaks 700–1019, weekend troughs 44–330 (Sep 26–27: 163/44).

## Nodes now (GET .../nodes, single page, 193)

Total **193**, all AWS on-demand workers, all Ready, 0 spot. addedBy: autoscaler 152, rebalancer 23, empty (not CAST-added) 18 → CAST-managed ~175/193 (~91%). Top types: m6a.xlarge 75, m6a.2xlarge 50, m6a.4xlarge 23, c5a.2xlarge 14, c5a.4xlarge 9.

## Estimated savings (GET .../estimated-savings, lastUpdatedAt 2026-10-07T21:22Z)

Current config: 193 on-demand nodes, modeled $34,616/mo.
- Layman (on-demand rightsizing): → $15,239.49/mo (−55.98%), 11 nodes
- SpotInstances: → $14,984.40/mo (−56.71%), 12 nodes
- SpotOnly: → $4,567.62/mo (−86.80%), 11 nodes
- **isRebalancingRecommended: true**

## Not done

POST :runValueRealizationTimelineReport — accepted startTime/endTime via query params but every `step` format tried (86400, 86400s, 24h, PT24H, STEP_* enums…) was rejected; PDF numbers already verified exactly via cost+savings endpoints, so this remained a dead end.
