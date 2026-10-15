# Siemens – CAST AI cluster & savings summary — independent sanity review
**Prepared:** 2026-10-15, ~17:10 EEST · all data pulled live from `https://api.eu.cast.ai` (read-only) within the hour
**Scope:** Aleksy's sheet (267 clusters, 7 categories, combined $66,425 for 2026-09-01T00:00:00Z→2026-10-01T00:00:00Z)

## Method
- Full org + cluster census: `GET /v1/organizations` (131 orgs seen), `GET /v1/kubernetes/external-clusters` per org (128 readable; CAST AI EU, Siemens-test, Siemens-test-on → 403, not Siemens AG children — correctly out of scope).
- Sept-2026 UTC value-realization (VR) report per org — 58 orgs holding clusters, 8 parallel read-only collectors, raw JSON in `scratch/siemens-review/raw/vr-v2/` (68 cluster rows).
- Sept enterprise billing: `GET /v1/billing/platform-usage-detail?period.from=2026-09-01&period.to=2026-09-30&feature=phase2` at Siemens AG parent.
- Cross-basis checks per cluster: classic savings API (`GET /v1/cost-reports/clusters/{id}/savings`), `baseline-params`.
- Prior-art comparison: Oct-12 enterprise scan (`cluster-cost-analysis/helios-recon-2026-10-12/`) and Oct-14 over-provisioning audit (`cluster-cost-analysis/op-factor-audit-2026-10-14/`).

## Verified ✓
1. **Census 267** — correct at sheet time. Today the inventory is 268: `aks-eco-db-weu-dev-cluster` (org FT D AA IN SGI EA ECO) was created **today 2026-10-15T10:38Z**, after the sheet.
2. **Top-level split** — 56 connected (`isPhase2=true`) = sheet's 19+8+12+17 ✓; 212 read-only vs sheet read-only-side 211 (197+6+8) — the −1 is explained by `cloudcore02` (IT IPS, phase2=true but `waiting-connection` since Oct-7) sitting on the boundary; immaterial.
3. **KENT with WOOP = $8,477 — reproduces EXACTLY**: the 8 KENT-eligible clusters in SMO Railigent X (7× `k8s`/`staging` + `k8s-andreas`), Σ workloadAutoscalerSavings = **$8,476.96**.
4. **Read-only with WOOP ≈ $888**: 6 read-only WOOP clusters (4× Pillar#1 + `k8s`(Railigent 560.86) + gw-eks-integ), Σ WAS = **$888.26** — matches to the dollar.

## The September numbers were RESTATED (Oct-12 → today)
Σ cluster totalSavings for Sept: **$320,348.65 → $86,106.22 (−$234,242.43)**, 36 clusters changed, incl:

| cluster | Oct-12 | today | basis note |
|---|---:|---:|---|
| k8s-andreas | 158,738.12 | 444.49 | INDUSTRY_AVERAGE→CLUSTER_HISTORY (I16 case) |
| ngm-sim-eks | 39,309.19 | 11,476.95 | OVERRIDDEN_DATA (manual override) |
| eks (HAFAS 953f87e7) | 20,833.43 | 12,060.00 | OVERRIDDEN_DATA, 1-day baseline, overridden TODAY 09:26Z |
| baseline-clo-eks | 19,052.43 | 3,731.76 | silent recompute TODAY 07:02Z (factors 5.66/9.88→1.48/1.54) |
| fgeks (SI B SW ×4) | 15,320.41 | 2,651.36 | silent corrections |
| ngm-sim2-eks | 9,207.41 | 1,967.31 | silent recompute |
| ngm-kronos-eks | 5,390.64 | 2,551.78 | silent recompute |
| pioneer-tcx | 2,965.94 | 4,422.66 | UP — new additive hibernationSavings component |
| eks-Cluster1 | 3,797.25 | 1,881.01 | CLUSTER_HISTORY→(peer one OVERRIDDEN) |

**Consequence:** any Siemens-savings numbers pulled earlier this week (incl. the Oct-12 "$327K gross" enterprise doc) are stale; the sheet's WOOP tabs match TODAY'S data, so the sheet was built post-correction. The corrections continued to land TODAY (eks-HAFAS override at 09:26Z) — re-pull before sending.

## Classification caveats proven
- `alliander-demo-eks` — verified genuinely READ-ONLY (isPhase2=false, firstOperationAt=null, classic API 400 "cluster is read-only"). Its $10,092.38 is PEER-baseline modeling only (exclusion from Connected tabs = CORRECT).
- VR flags ≠ management truth: `woopAdopted`/`autoscalerAdopted` are reporting-attribution flags (≥~20% threshold per docs); e.g., `ngm-integ-eks` woopAdopted=true while 0 workloads are actually managed (open bug, draft report in outbox).

## VR model vs classic measured savings (Sept 2026)
The two CAST AI savings APIs disagree per cluster; totals: VR Σ $92,336.50 fleet ($80,816.49 connected) vs classic Σ $59,991.01. Verified per-cluster by live re-pull:

| cluster | VR totalSavings $ | classic $ | ratio | verifier verdict |
|---|---:|---:|---:|---|
| eks (HAFAS 953f87e7) | 12,060.00 | 215.32 | 56× | contradicted — OVERRIDDEN 1-day baseline (overridden today 09:26Z) |
| dema-platform-services | 11,689.75 | 1,249.10 | 9.4× | inflated — frozen PEER baseline (Jul-22, 1.65/4.11 factors) |
| ngm-sim-eks | 11,476.95 | 442.39 | 26× | inflated ~2.1× even after today's override (1.5/2.0 vs live 1.07/1.33) |
| pioneer-tcx | 4,422.66 | 300.68 | 14.7× | includes NEW hibernationSavings $3,566.70 (351h, real but VR-only) |
| baseline-clo-eks | 3,731.76 | 1,350.90 | 2.8× | SOUND — factors recomputed to 1.48/1.54 today |
| eks-Cluster1 ×2 (+org) | 4,728.99 | 7,604.71 | 0.6× | ties exactly; conditional on old/override windows |
| alliander-demo-eks | 10,092.38 | n/a (400) | ∞ | READ-ONLY cluster — model-only number; exclusion correct |
| ngm-helios-eks | 6,667.82 | 18,877.78 | 0.35× | classic ≫ VR (VR conservatively factors-down) |
| ngm-integ-eks | 8,705.41 | 18,512.46 | 0.47× | classic ≫ VR |
| ngm-kronos-eks | 2,551.78 | 3,501.32 | 0.73× | classic > VR |

## Remaining verifier verdicts
- **ngm-kronos-eks** $2,551.78 — SOUND (baseline re-frozen today 07:01Z, ratios == stored factors; stale-but-sanctioned mem factor 6.87).
- **ngm-sim2-eks** $1,967.31 — arithmetic ties but **residual OP inflation** (CPU projection ~2× above its own sanctioned factor; factor-capped estimate ≈ $0.6–1.2k) — needs true-up.

## Completeness anomalies
- **Connected (phase2) cluster with NO September VR row:** `dev-sec` (IT IPS, eu-west-1, created 2025-12-02, agent online, firstOperationAt=null). Its September actual cost is unmeasured by the report; savings $0 is defensible (never optimized) but "no data" ≠ "$0". (`mof`, `mof-staging`, `cloudcore02` explain themselves: created Oct-7, after September.)
- 166 read-only monitoring clusters have no VR row: guide §5.1 says report **N/A, not $0**.
- 2× `fgeks-blue-eks-cluster` clones in SI B SW are failed/non-responding with frozen wild baselines (17.4/25.2 and 11.7/14.3) — "sleeping time bombs": if restarted, September-style inflated savings reappear (per Oct-14 audit).
- `ngm-integ-eks` shows woopAdopted=true while 0/4,566 workloads are actually managed (open attribution bug — outbox draft, today).

## Fee / ROI basis
- Sept billable phase2 vCPU (parent aggregate): **8,275.94 vCPU** (was 8,632.35 on Oct-12 — billing itself recomputed −4.1%).
- Sheet's implied ROI: 66,425 / 26,408 = **2.52×** (gross). "Roughly 2×" is conservative-true.
- Caveats: $26,408 = $20,000 committed + $6,408 "average overages ÷3" — estimate over a quarterly 15,000-CPU bucket, not an invoice line; effective $3.19/vCPU.

## What could NOT be reproduced (needs Aleksy's tab rows)
- "Connected, Node Autoscaler only: 12 clusters, **$33,824**" and "Connected, Node Autoscaler and WOOP: 17 clusters, **$23,387**" — no consistent API basis lands on these splits (VR connected $77,249.79 · VR fleet $88,254.85 · classic fleet $59,991.01). The $57,212 total sits just under the classic realized number ($59,991; Δ$2,779 ≈ fgeks-classic $2,649.81 + eks-tpslive $117.30 ⇒ $57,223.90, within $12): strongly suggests the NA tabs are classic/realized-basis with ~2 clusters excluded. Get the tab export to adjudicate line-by-line.
- "Connected, WOOP only: 8 clusters, **−$152**" — negative WAS exists (dema −$80.91, dema-test −$8.89, aks-dios-weu-test −$91.17, wiz −$1.50, fgeks −$1.21…): real upsizing effects. Exact −$152 composition needs the tab rows.
