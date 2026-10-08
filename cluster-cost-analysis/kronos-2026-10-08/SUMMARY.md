# Kronos (ngm-kronos-eks) — monthly cost/savings summary, pulled 2026-10-08

Cluster 6d20eb8e-a1e5-4411-b4c8-5346ac3291b0, org SI GSW CLO 07aa3c29-3e1f-44bc-ad60-ceedb878d99a, live 2025-11-06.
Cost-API daily items are hourly-rate snapshots → monthly $ = raw daily-sum × 24 (validated: Sep compute $1,939.2 ≈ PDF $1,929.80; Sep savings $3,501.32 ≈ PDF $3,474.88; rate 64.35% ≈ PDF 64.3%).
Savings items are daily totals (no ×24). Compute = cpu+ram+gpu node cost; Storage reported separately.

| Month | Compute$ default | Compute$ listing | Storage$ default | Total$ default | Total$ listing | Savings$ | Rate vs compute |
|---|---|---|---|---|---|---|---|
| 2025-11 | 1,476.96 | 1,970.40 | 550.08 | 2,027.04 | 2,520.48 | 1,091.39 | 42.5% |
| 2025-12 | 1,062.00 | 1,416.48 | 570.48 | 1,632.48 | 1,986.72 | 816.36 | 43.5% |
| 2026-01 | 971.52 | 1,296.00 | 557.76 | 1,529.52 | 1,853.76 | 864.96 | 47.1% |
| 2026-02 | 939.84 | 1,253.28 | 527.04 | 1,466.64 | 1,780.32 | 860.00 | 47.8% |
| 2026-03 | 1,227.60 | 1,637.04 | 612.24 | 1,839.84 | 2,249.28 | 1,112.37 | 47.5% |
| 2026-04 | 1,146.96 | 1,529.52 | 574.32 | 1,721.28 | 2,103.84 | 940.96 | 45.1% |
| 2026-05 | 2,125.20 | 2,833.68 | 473.52 | 2,598.72 | 3,307.20 | 1,417.12 | 40.0% |
| 2026-06 | 1,834.80 | 2,446.56 | 506.40 | 2,341.20 | 2,953.20 | 1,190.38 | 39.3% |
| 2026-07 | 946.56 | 1,377.84 | 153.36 | 1,099.92 | 1,530.96 | 1,048.25 | 52.6% |
| 2026-08 | 1,365.60 | 2,274.00 | 215.76 | 1,581.36 | 2,490.00 | 1,843.92 | 57.5% |
| 2026-09 | 1,939.20 | 3,230.88 | 326.88 | 2,266.08 | 3,557.76 | 3,501.32 | 64.4% |

Rate = savings / (savings + compute default). spotSavings = $0.00 in every month; costSpot = $0 in every month (cluster 100% on-demand, zero spot nodes ever).

FY26 (Nov25–Sep26): compute default $15,036.11; compute listing $21,265.68; totalSavings $14,687.03 (100% downscaling).

baseline-params VERBATIM (fetched 2026-10-08):
{"cpuOverprovisioningFactor":5.246809904878697, "memoryOverprovisioningFactor":11.001476926214519, "costPerCpuCoreHourly":0.029858324153609752, "costPerMemoryGibHourly":0.004142068114367069, "baselinePeriodStartTime":"2025-09-30T09:54:27Z", "baselinePeriodEndTime":"2025-11-06T00:00:00Z", "baselineType":"CLUSTER_HISTORY", "updateTime":"2025-12-03T08:00:06Z"}

Sep-2026 resource-usage 30d avg: cpuProvisioned 86.58, cpuRequested 59.86, cpuUsed 4.97 (req/use 12.0×); ramProvisioned 311.25 GiB, ramRequested 116.49, ramUsed 48.01 (req/use 2.43×).

Nodes (snapshot 2026-10-08): 3 total — 0 spot, 3 on-demand; 2 Linux CAST-managed (m6a.2xlarge, r6a.large), 1 Windows m7a.xlarge NOT CAST-managed (no provisioner.cast.ai/* labels; $0.27717/hr ≈ $202/mo, 45% of current $443.70/mo infra).

Estimated-savings (fresh 2026-10-07T21:22Z): current 3 nodes $443.70/mo; Layman → $188.79/mo (57.45%); SpotInstances → $150.82 (66.01%); SpotOnly → $76.92 (82.66%); rebalancing recommended. Note: Sep avg provisioned 86.58 vCPU vs 14 vCPU now — cluster shrank ~6× after Sep.

VERDICT: see agent report.
