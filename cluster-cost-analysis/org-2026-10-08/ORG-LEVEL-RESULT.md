# Org-level CAST AI reconciliation — SI GSW CLO (07aa3c29-3e1f-44bc-ad60-ceedb878d99a)
Date: 2026-10-08. Base https://api.eu.cast.ai. All calls GET except the two read-style value-realization POSTs.

## A. FY26 monthly org value-realization (POST :runValueRealizationTimelineReport, step=ONE_MONTH, 2025-10-01→2026-10-01)
All 12 months returned populated (no aggregate gaps at MONTH step for this org). totalSavings == autoscalerSavings every month (WOOP is netted inside projected-vs-actual model; woop column shown for info).

| Month | actualCost | projectedCost | autoscalerSavings | workloadAutoscalerSavings | totalSavings (default) | totalSavings (listing) |
|---|---|---|---|---|---|---|
| 2025-10 | 79,258.33 | 81,749.86 | 2,491.53 | 6.58 | 2,491.53 | 2,363.05 |
| 2025-11 | 58,499.76 | 84,993.37 | 26,493.61 | 591.29 | 26,493.61 | 26,006.45 |
| 2025-12 | 66,417.58 | 96,177.98 | 29,760.40 | 702.88 | 29,760.40 | 29,234.71 |
| 2026-01 | 70,294.78 | 96,433.24 | 26,138.46 | 877.86 | 26,138.46 | 25,634.88 |
| 2026-02 | 73,623.51 | 87,402.76 | 13,779.24 | 68.11 | 13,779.24 | 13,760.28 |
| 2026-03 | 90,591.07 | 124,494.83 | 33,903.75 | 34.18 | 33,903.75 | 38,899.62 |
| 2026-04 | 109,306.56 | 167,349.92 | 58,043.36 | 20.15 | 58,043.36 | 68,666.10 |
| 2026-05 | 111,154.68 | 180,001.18 | 68,846.50 | 16.20 | 68,846.50 | 74,895.10 |
| 2026-06 | 111,399.41 | 202,617.03 | 91,217.62 | 788.08 | 91,217.62 | 97,279.03 |
| 2026-07 | 90,551.05 | 203,772.88 | 113,221.82 | −311.45 | 113,221.82 | 112,955.13 |
| 2026-08 | 87,489.52 | 248,309.03 | 160,819.50 | 250.79 | 160,819.50 | 153,659.33 |
| 2026-09 | 86,561.85 | 228,776.58 | 142,214.73 | 1,873.76 | 142,214.73 | 134,539.25 |
| **FY26 sum** | **1,035,148.12** | **1,802,078.66** | **766,930.54** | **4,918.43** | **766,930.54** | **777,892.93** |

summary.cost of the report equals the sums above exactly (actual 1,035,148.12, projected 1,802,078.66, autoscaler 766,930.54, woop 4,918.43). Listing basis: actual 1,436,261.25, total 777,892.93.

## B. Per-cluster FY26 value realization (POST :runValueRealizationReport, 10 clusters with data)
default basis (actualCost / totalSavings): baseline-clo 40,162.03 / 261,812.10; ngm-sim 39,599.78 / 162,099.68; alliander-demo 37,944.66 / 145,460.15; **ngm-integ 391,329.65 / 91,523.11; ngm-kronos 21,599.77 / 59,188.15; ngm-helios 495,536.93 / 33,323.01**; ngm-sim2 2,161.88 / 9,607.54; ngm-data 6,136.82 / 3,064.11; ngm-cilium 250.40 / 802.85; clo-dev 426.19 / 49.84.
Σ all clusters default = **766,930.54** — exactly equals the org timeline (perfect reconciliation). Σ actual default = 1,035,148.12 = timeline.
listing basis totalSavings: baseline-clo 248,351.70; alliander-demo 191,868.19; ngm-sim 148,242.77; ngm-integ 84,845.57; ngm-kronos 64,677.02; ngm-helios 20,136.48; ngm-sim2 14,960.87; ngm-data 3,966.86; ngm-cilium 788.26; clo-dev 55.21. Σ = 777,892.93.
**ngm-3 FY26 savings: default $184,034.27 (helios 33,323.01 + integ 91,523.11 + kronos 59,188.15); listing $169,659.07 (helios 20,136.48 + integ 84,845.57 + kronos 64,677.02).**

## C. Org clusters cost report /v1/cost-reports/organization/clusters/report
Full-year window returns EMPTY (retention/range cap ~92d: 183d → 0 clusters, 92d OK). Pulled 4 contiguous ≤92d chunks (files org_clusters_report_chunk{1..4}_listing_{false,true}.json):
- chunk1 2025-10-01→2025-12-31: totalCost 481,627.99 / 573,437.11 (listing)
- chunk2 2025-12-31→2026-03-31: 506,054.50 / 654,791.38
- chunk3 2026-03-31→2026-07-01: 649,699.57 / 843,138.42
- chunk4 2026-07-01→2026-10-01: 548,108.66 / 820,852.36
- **FY26 org totalCost (ALL clusters, incl. non-phase2, 18–23/chunk incl. deleted): default $2,185,490.72, listing $2,892,219.28** (listing/default cost ratio 1.32x).
Note: this totalCost is not the same scope as the value-realization actualCost (1,035,148 default): VR covers only the 10 optimized clusters.
ngm-3 per-chunk totalCost (default): helios 122,043.22 / 136,166.59 / 164,039.13 / 169,557.56 (Σ 591,806.50); integ 79,420.27 / 105,638.17 / 165,955.06 / 74,823.74 (Σ 425,837.24); kronos 11,706.73 / 4,760.39 / 6,759.27 / 4,910.28 (Σ 28,136.67).
Jul–Sep (chunk4) default costs: helios 169,557.56, integ 74,823.74, kronos 4,910.28 — vs Cloudability EC2-only paid helios $67.8k, integ $32.8k.

## D. Billing vCPU cross-check (GET /v1/billing/platform-usage-detail, feature=phase2, 2026-09-01→2026-09-30)
detail.totalUsage = **3,400.815 CPU** vs PDF org 3,400.82 — EXACT match.
Per cluster: helios 1,786.383 ✓, integ 1,005.878 ✓, kronos 86.591 ✓ (PDF identical). Also: ngm-sim 347.673, baseline-clo 109.907, ngm-sim2 64.383. feature=woop: 3,291.036 CPU.
(Feature param values are "phase2"/"woop", required; date format YYYY-MM-DD.)

## E. Where "$530k FY26" most plausibly comes from
- FY26 full-year API truth: **$766,930.54 default / $777,892.93 listing** — NOT $530k (org API reality is ~1.45x above the claim). No pricing basis gives $530k for the full FY26.
- No cluster subset sums to ~$530k in either basis (checked all 10 combinations logically; closest: baseline+sim+integ default = 515.4k; baseline+sim+integ+kronos listing = 546.1k).
- Most plausible: **snapshot timing**. Cumulative default-basis savings 2025-10-01→2026-07-31 = $463.9k; August alone = $160.8k (≈$5.2k/day). "$530k" = the console dashboard cumulative figure as of **~2026-08-13** (≈463.9k + 13×5.19k). If the customer's number was quoted before mid-August, it is simply a stale FY-to-date reading.
- Second candidate: a net-of-fee savings figure (767k × 0.69 ≈ 530k would imply ~31% fee share; CAST fee here is flat per-vCPU so this is unlikely to land exactly).
- Not "cost" mixup: org FY26 cost is $2.19M (default) — unrelated; helios+integ+kronos FY26 savings = 184k — unrelated.

## F. Retention / quirks hit
- Org clusters/report + overview: range cap ~92 days (must chunk FY26). cost-comparison ok at rangeDays=30 (Platform Impact: savingsPerProvisionedCpuCore $0.2029/core-day, savedPerProvisionedCpu 60.7%, clusterCostGrowthRate −13.57%).
- Value-realization endpoints have NO range cap for this org; month-step complete over FY26. Params must be snake_case query (start_time/end_time/step/useListingPrices); JSON body clusterIds ignored (org-aggregated).
- Inventory: 20 active clusters; savings/VR data exists for 10 (incl. deleted ngm-cilium-f6b56668, clo-dev-93f55435 absent from active inventory).
