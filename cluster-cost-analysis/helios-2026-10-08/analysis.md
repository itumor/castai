# Helios (ngm-helios-eks) FY26 cost investigation — 2026-10-08
Cluster 419c39e4-66bf-4d61-b833-4562968a61c7, org SI GSW CLO 07aa3c29-3e1f-44bc-ad60-ceedb878d99a. Raw JSON in this dir.

## Monthly table (USD, API summary window totals, 86400 step)
costD_OD = default-basis totalCostOnDemand (compute only CPU+RAM+GPU) | costD_tot = + storage | costL_OD = listing-price totalCostOnDemand | savCost = savings-endpoint totalCost | savings = savings-endpoint totalSavings

| month | costD_OD | costD_tot(+storage) | costL_OD | savCost | savings |
|---|---|---|---|---|---|
| Oct 25 | 32,755 | 40,775 (st 8,021) | 41,507 | 32,841 | 19,617 |
| Nov 25 | 32,388 | 39,768 (st 7,380) | 43,207 | 32,393 | 17,185 |
| Dec 25 | 35,193 | 42,791 (st 7,598) | 46,948 | 35,193 | 17,137 |
| Jan 26 | 36,993 | 44,729 (st 7,736) | 49,349 | 36,993 | 16,166 |
| Feb 26 | 35,705 | 42,838 (st 7,134) | 47,631 | 35,705 | 17,678 |
| Mar 26 | 42,274 | 49,983 (st 7,709) | 56,393 | 42,274 | 13,774 |
| Apr 26 | 44,705 | 52,395 (st 7,690) | 59,636 | 44,705 | 15,512 |
| May 26 | 46,789 | 55,134 (st 8,345) | 62,419 | 46,789 | 18,372 |
| Jun 26 | 46,499 | 54,948 (st 8,449) | 62,036 | 46,499 | 22,815 |
| Jul 26 | 50,702 | 59,738 (st 9,036) | 72,709 | 51,047 | 24,844 |
| Aug 26 | 46,453 | 55,726 (st 9,272) | 74,020 | 46,453 | 19,610 |
| Sep 26 | 45,095 | 53,908 (st 8,812) | 72,155 | 45,095 | 18,878 |
| **FY26** | **495,551** | | **688,010** | | **221,587** |

All months: totalCostSpot = 0 (both bases). Savings: spotSavings = 0 every day; 100% downscalingSavings.

## PDF window verification (2026-09-02→2026-10-02)
- cost (default basis) summary.totalCostOnDemand = **44,588.13** ≈ PDF "actual compute cost" 44,587.18 ✓
- savings summary.totalSavings = **18,803.17** ≈ PDF "API-realized savings" 18,804.12 ✓
- savings summary.totalCost = 44,588.13 (identical to cost totalCostOnDemand — savings are computed against this OD-equivalent baseline)
- (parent: useListingPrices=true same window totalCost = 80,269)

## Baseline params
- baselineType = CLUSTER_HISTORY; baselinePeriodStartTime = 2025-09-30T09:54:26Z (≈ cluster creation); baselinePeriodEndTime = 2026-07-20T00:00:00Z; updateTime = 2026-07-21T08:00:50Z
- cpuOverprovisioningFactor = 1.6035; memoryOverprovisioningFactor = 2.1697
- costPerCpuCoreHourly = 0.0252182; costPerMemoryGibHourly = 0.0034194

## First-operation audit evidence
- Audit 2026-07-01→07-20: **0 events**.
- Earliest event: **2026-07-21T23:07:13Z nodeAdded by internal|rebalancer** (burst: rebalancingNodeOperationFinished ×50, nodeDrained/Deleted ×19/19, autoscalerExecuted ×5). First autoscaler-driven activity seen by 2026-07-31. Baseline window closed 7/20, params recomputed 7/21 08:00 → onboarding/first actuation = **2026-07-20/21** (matches stated 2026-07-20).
- Savings endpoint nevertheless reports positive daily downscalingSavings for every day Jul 1–20 and every month Oct 2025→Jun 2026 → savings are a retrospective CLUSTER_HISTORY-baseline MODEL, not linked to actual CAST operations. Of FY26 $221,587 total, only ~Jul 21+ (≈$10.1k Jul remainder + Aug 19,610 + Sep 18,878 ≈ $48.6k) post-dates CAST's first action.

## Nodes (snapshot 2026-10-07/08, single page, 55 items)
- 55 nodes, all ready, all AWS eu-central-1, role=worker
- **Spot: 0/55 (100% on-demand)** — spotConfig.isSpot=false on all; cost API cpuCountSpot=0 all FY26 months; spotSavings=0 daily
- addedBy: 17 internal|autoscaler, 35 internal|rebalancer, 3 untagged (all CAST-provisioned)
- earliest surviving nodes: rebalancer 2026-08-06, autoscaler 2026-09-03
- types: 17 m6a.4xlarge, 11 m6a.2xlarge, 11 c5a.4xlarge, 7 r6a.4xlarge, 3 x8i.4xlarge, 2 r6a.xlarge, 2 m7a.xlarge, 2 c5a.2xlarge

## Sep resource-usage (daily items, 86400)
avg cpuProvisioned=1786, cpuRequested=1350, cpuUsed=165 → used = 9% of provisioned, 12% of requested. Massive headroom = why baseline overprovisioning factors are 1.60×/2.17× and why rebalancing is recommended.

## Estimated savings (listing-price basis, updated 2026-10-07T21:22Z)
- isRebalancingRecommended = **true**
- Layman & SpotInstances: monthly 21,193.19 → 12,803.75 (39.59%); ARM variant → 11,381.05 (hourly 29.03 → 17.54)
- SpotOnly: monthly 21,193.19 → 5,342.78 (74.79%); ARM variant → 5,319.42
- Current config = 55 all-on-demand nodes @ $21.2k/mo listing. Spot adoption = +$8.4k/mo potential; spot-only +$15.9k/mo.

## Why CAST's "actual cost" ($44.6k/30d) is ~2x Siemens' billed EC2 (~$22.3k/mo)
CAST's PDF "actual compute cost" is the API cost endpoint's summary.totalCostOnDemand on CAST's default price sheet — the **on-demand-equivalent value of every provisioned vCPU/RAM-hour** in the window (compute-only; storage and network excluded). It is a pre-savings baseline, not a bill. Siemens' Cloudability EC2 figure is actual paid spend, which already reflects (a) CAST's own downscaling effect — the exact $18.8k the PDF lists as savings (44,588 − 18,803 = 25,785 ≈ Siemens' EC2+EBS billed 26,402 for Sep, and Jul/Aug similar within ~1-3%), and (b) Siemens' negotiated AWS discounts (~15-17%) that CAST's price sheet does not model. Three independent sources (cost summary totalCostSpot=0, savings spotSavings=0 daily, node inventory 0/55 spot) show the cluster never ran a single spot node: all savings are downscaling/rebalancing against a CLUSTER_HISTORY baseline (1.60× CPU / 2.17× RAM overprovisioning factors from pre-onboarding history), not amortized spot discounting. So the 2x is purely a basis artifact: on-demand-equivalent list-ish valuation vs discounted actual billing — not a scope issue (compute-only vs EC2-only is apples-to-apples-ish), not an hourly-vs-daily unit error (window summaries are proper totals; only the per-day items are avg-hourly, a foot-gun CAST's own example script calibrates ×24).
