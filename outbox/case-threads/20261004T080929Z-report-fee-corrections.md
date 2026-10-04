# Report Corrections — CAST AI Fees and Net Savings sections
# Supersedes the fee tables in "Siemens CAST AI Savings Report — Helios, Integ and Kronos" (2026-10-02)
# Reason: fee basis was a metric mix-up (provisioned for Helios, requested for Integ/Kronos).
# Correct basis (verified via CAST AI billing API, feature=phase2, SI GSW CLO, Sep-2026):
# billable vCPUs = average provisioned (node-capacity) vCPUs.
#   ngm-helios-eks 1,786.383 | ngm-integ-eks 1,005.878 | ngm-kronos-eks 86.591 | Sum 2,878.852

## REPLACE the section "CAST AI Fees and Net Savings View" (Executive Summary) with:

CAST AI Fees and Net Savings View

CAST AI platform fees are included in the financial view using the supplied rate of €5 per billable vCPU per month. Billable vCPUs are the average provisioned (node-capacity) vCPUs, as confirmed by the CAST AI billing API (September 2026): Helios 1,786.38, Integ 1,005.88, Kronos 86.59 (combined 2,878.85). The fee is deducted from API-reported gross realized savings to show the management net position. Finance should confirm the contractual unit rate (€5 vs €5.70 per vCPU) and the EUR/USD exchange rate.

| Cluster | Gross realized savings (API, 30 days) | vCPU fee basis | Estimated CAST AI fee | Net savings after fees | Management interpretation |
|---|---:|---:|---:|---:|---|
| Helios | $18,804.12 | 1,786.38 average provisioned/billable vCPUs | −€8,931.92/month (approximately −$9,818.85/month) | +$8,985.27/month | Net-positive today after platform fees. Billing-API-billable basis confirmed. |
| Integ | $18,416.84 | 1,005.88 average provisioned/billable vCPUs | −€5,029.39/month (approximately −$5,528.81/month) | +$12,888.03/month | Strong net savings. Rightsizing toward ~106.8 cores reduces required provisioned capacity and therefore also reduces future fee exposure, since billing follows provisioned vCPUs. |
| Kronos | $3,474.88 | 86.59 average provisioned/billable vCPUs | −€432.95/month (approximately −$475.95/month) | +$2,998.93/month | Net-positive today. Kronos has the largest relative remaining optimization opportunity because current requested CPU is much higher than actual usage. |
| Combined portfolio | $40,695.84 | 2,878.85 average provisioned/billable vCPUs | −€14,394.26/month (approximately −$15,823.61/month) | +$24,872.23/month | Portfolio remains clearly cash-flow positive after CAST AI fees. At the alternative €5.70/vCPU rate the fee is −€16,409.45/month (approximately −$18,038.91/month) and net is +$22,656.93/month. |

## REPLACE the table in section "CAST AI Fees and Net Savings" with:

CAST AI platform fees should be deducted from gross savings to show the complete financial picture. The fee basis is €5 per billable vCPU per month, where billable vCPUs equal the average provisioned (node-capacity) vCPUs confirmed by the CAST AI billing API. Finance should confirm the contractual unit rate (€5 vs €5.70) and the EUR/USD exchange rate before publishing audited net figures.

| Cluster / item | Gross API savings | vCPU basis | Estimated fee | Net savings after fee |
|---|---:|---:|---:|---:|
| Helios | $18,804.12 | 1,786.38 billable vCPUs | −€8,931.92/month (approximately −$9,818.85/month) | +$8,985.27/month |
| Integ | $18,416.84 | 1,005.88 billable vCPUs | −€5,029.39/month (approximately −$5,528.81/month) | +$12,888.03/month |
| Kronos | $3,474.88 | 86.59 billable vCPUs | −€432.95/month (approximately −$475.95/month) | +$2,998.93/month |
| Combined | $40,695.84 | 2,878.85 billable vCPUs | −€14,394.26/month (approximately −$15,823.61/month) | +$24,872.23/month |

Addendum (org-wide invoice view): CAST AI bills per organization; the full SI GSW CLO org totals 3,400.82 billable vCPUs for September 2026, including baseline-clo-eks (109.91), ngm-sim-eks (347.67) and ngm-sim2-eks (64.38) — an estimated org-wide fee of €17,004.09/month at €5/vCPU (€19,384.66 at €5.70).

Do not present a final net-savings amount until Finance confirms the contractual unit rate, currency conversion, and the treatment of the 30-day reporting period. Report gross API savings and verified net savings separately.
