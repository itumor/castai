# ngm-helios-eks — complete data sheet (2026-10-12)

**Cluster:** `ngm-helios-eks` · id `419c39e4-66bf-4d61-b833-4562968a61c7` · org SI GSW CLO `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` · AWS eu-central-1 · EKS, 55 worker nodes (snapshot 2026-10-07/08), **all on-demand** (0 spot ever), CAST Node Autoscaler adopted (`autoscalerAdopted: true`), Workload Autoscaler NOT adopted (`woopAdopted: false`). CAST first operation: **2026-07-20/21**.
("ngm-gelios-eks" in the email = typo; no such cluster.)

---

## 1) September 2026 — the meeting month (all values live-verified 2026-10-12, re-run 15:45 identical)

| Metric | Value | Source |
|---|---:|---|
| **Actual spend (CAST basis, compute CPU+RAM)** | **$45,121.35** | VR report `cost.actualCost` (Berlin); UTC variant 45,093.48; classic `totalCost` 45,095.38 — three pipelines agree within $28 |
| **Baseline / projected (frozen pre-CAST shape)** | **$51,789.61** | VR `cost.projectedCost` (UTC 51,761.31) |
| **Realized savings (console KPI)** | **$6,668.27** (12.9% of projected) | VR `cost.totalSavings`; = projected − actual; workloadAutoscalerSavings = 0 |
| **Gross savings (mechanism view)** | **$18,877.78** | classic `/savings` `summary.totalSavings` — 100% downscaling, spotSavings = 0 |
| **Net savings after platform fee** | **≈ $8,606** | 18,878 − fee; see §3 |
| **Bill cross-check (Siemens actual, discounted)** | **≈ $26.2k** | 45,095 − 18,878 = 26,217 ≈ invoice-verified ~$26–27k/mo (Gerolf, Aug) |
| Cost endpoint, default basis: compute only | $45,095 | `GET …/cost` summary.totalCostOnDemand |
| Cost endpoint, default basis: + storage | $53,908 | storage $8,812 |
| Cost endpoint, **listing** basis: compute only | **$72,154.92** | ⚠ the "Cloudability 72k" coincidence trap — a valuation basis, not a bill |
| Cost endpoint, listing basis: + storage | $80,967.38 | |
| Provisioned vCPU (avg) | 1,786 (billing-billable: 1,786.38) | VR `cpu.provisionedCores` / billing API |
| Provisioned RAM (avg) | 8,295 GiB | VR `memory.provisionedGib` |
| Requested vCPU / RAM (avg) | 1,350 / 4,023 | VR `cpu/memory.requestedCores/Gib` |
| CPU actually used | ~165 vCPU ≈ **9% of provisioned** | Sep resource-usage (2026-10-08 pull) — why rebalancing is recommended |

**Sep VR detail (Berlin):** CPU actual 26,719.15 / projected 32,353.61 → CPU savings 5,634.46; RAM actual 18,402.19 / projected 19,436.00 → RAM savings 1,033.81.

**Same call, documented param variants (live 2026-10-12 ~16:10):**

| Variant | actual | projected | savings | Read |
|---|---:|---:|---:|---|
| Default (discounted, timeZone=Europe/Berlin) | 45,121 | 51,793 | **6,671** | = console KPI |
| useListingPrices=true | **72,190** | 82,926 | **10,736** | list-price basis; Sep actual alone ≈ 72k |
| managedOnly=true | 44,753 | 51,262 | **6,509** | −2.4% → fleet effectively fully CAST-managed |

## 2) The baseline (the counterfactual CAST froze)

| Param | Value |
|---|---|
| Type | CLUSTER_HISTORY (from cluster's own pre-CAST history) |
| Window | 2025-09-30T09:54:26Z → **2026-07-20T00:00:00Z** (recomputed 2026-07-21T08:00:50Z) |
| CPU overprovisioning factor | ×1.6035 |
| RAM overprovisioning factor | ×2.1697 |
| CPU unit cost | $0.0252182 / core-h |
| RAM unit cost | $0.0034194 / GiB-h |
| Accrual start | Savings count only from 2026-07-21 |
| Observed pricing | VR prices projected at ~current effective rates (≈$0.0208/core-h, $0.0031/GiB-h) — **no baseline price floor applied** → structurally conservative; with the documented max(current, baseline) floor, Sep savings would be ≈$15.7k |

## 3) Platform fee → net savings

| Item | Value |
|---|---|
| Billable basis | average provisioned vCPU, verified via CAST billing API (feature=phase2): **1,786.38** |
| Rate | €5 / billable vCPU / month (**€5.70 alternative — Finance to confirm**) |
| Fee | **€8,931.92 /mo** ≈ $10,272 @ FX 1.15 (≈$9,819 @ 1.10) |
| **Net savings** | 18,878 − 10,272 = **$8,606** @1.15 (range $8.6k–$9.9k depending on FX/rate) |
| Source | `outbox/case-threads/20261004T080929Z-report-fee-corrections.md` (supersedes 2026-10-02 fee tables) |
| **Fee is NOT in any savings API** | Savings endpoints = infrastructure counterfactual only; the fee lives exclusively in the billing API (`GET /v1/billing/platform-usage-detail?feature=phase2`, unit=CPU) |
| Billable basis — live 2026-10-12 billing pull | **1,850.51 vCPU** (Sep, phase2) → fee €9,252.56 ≈ $10,640 @1.15 — ⚠ +3.6% vs the 10-04 verification (1,786.38 → €8,931.92 ≈ $10,272); reconcile with Finance (billing close / period boundary) |
| **Net, live fee basis** | classic gross 18,878 − 10,640 = **+$8,238** · console VR 6,668 − 10,640 = **−$3,972** ⚠ negative — never quote Helios net on the VR basis in isolation; portfolio stays positive on both bases |

## 4) FY26 trajectory (Oct 2025 → Sep 2026, classic monthly basis, 2026-10-08 pull)

| Month | Compute (default) | Compute (listing) | Classic savings |
|---|---:|---:|---:|
| Oct 25 | 32,755 | 41,507 | 19,617 |
| Nov 25 | 32,388 | 43,207 | 17,185 |
| Dec 25 | 35,193 | 46,948 | 17,137 |
| Jan 26 | 36,993 | 49,349 | 16,166 |
| Feb 26 | 35,705 | 47,631 | 17,678 |
| Mar 26 | 42,274 | 56,393 | 13,774 |
| Apr 26 | 44,705 | 59,636 | 15,512 |
| May 26 | 46,789 | 62,419 | 18,372 |
| Jun 26 | 46,499 | 62,036 | 22,815 |
| Jul 26 | 50,702 | 72,709 | 24,844 |
| Aug 26 | 46,453 | 74,020 | 19,610 |
| **Sep 26** | **45,095** | **72,155** | **18,878** |
| FY26 Σ | 495,551 | 688,010 | 221,587 |

⚠ Retrospective-model caveat: the classic savings model back-fills months before CAST's first operation (2026-07-20/21). Of the FY26 $221.6k, only ≈$48.6k (Jul 21+ … Sep) post-dates real CAST operations; earlier months are baseline-model, not operational history. **Console-model (VR) FY26 cumulative for helios: $33,323.01** (2025-10-01→2026-10-01, pulled 2026-10-08).

## 5) Remaining optimization potential (estimated-savings API, snapshot 2026-10-07, listing basis)

- Current: 55 × on-demand nodes ≈ **$21.2k/mo listing**
- `isRebalancingRecommended: true` (usage ≈ 9% of provisioned)
- Rebalancing + Spot: **$21,193 → $12,804/mo (−39.6%)**; ARM variant → $11,381
- Spot-only: → **$5,343/mo (−74.8%)**; ARM variant → $5,319

## 6) Cloudability mapping (external, invoice basis)

- Link scope: `adjusted_cost`, **2026-07-01 → 2026-09-30** (last_quarter), all services, filter `container_cluster_name == ngm-helios-eks` (same cluster).
- **72k most likely = the quarter total (~$24k/mo)** on invoice-adjusted basis — consistent with ~$26–27k/mo invoice-verified actuals. Single-month 72k is impossible (provisioned vCPU flat Aug→Sep).
- Never compare Cloudability **levels** with CAST's $45k (OD-sheet compute valuation) — different basis; compare **deltas** only. Meeting checks: Sep column vs quarter? all services vs EC2 row (~$26–27k)? adjusted vs list?

## 7) Org context (Sep, Berlin, per-cluster report = month-window basis)

| | actual | projected | savings |
|---|---:|---:|---:|
| ngm-helios-eks | 45,121 (52% of org) | 51,790 | 6,668 (**6.8% of org**) |
| Org Σ (8 clusters) | 86,578 | 185,196 | 98,618 |

⚠ Quote org September savings as **$98.6k**. The FY26-timeline's Sep row ($123.3k) is the price-floor variant (+$24.6k) — do not mix. Helios' low share (14.8% savings rate vs 114% org-wide on frozen baselines) is the frozen-baseline capping effect → baseline-refresh ask to CAST AI (Marko/Ahmed).

## 8) Provenance (all read-only, api.eu.cast.ai)

| Data | Endpoint | File (helios-recon-2026-10-12/ unless noted) |
|---|---|---|
| VR per-cluster item (§1) | POST `…/clusters:runValueRealizationReport?…` | `vr_sep26_berlin_helios_full.json`, `vr_sep26_berlin.json` |
| VR all clusters + org Σ (§7) | same, empty body | `vr_sep26_berlin_all_clusters.json` |
| Classic savings (§1) | GET `/v1/cost-reports/clusters/{id}/savings?stepSeconds=86400` | `classic_savings_sep26_live.json` |
| Cost listing/default (§1) | GET `…/cost?useListingPrices=true` | `cost_sep26_list_live.json` |
| Baseline (§2) | GET `…/baseline-params` | `baseline_params_live.json` |
| Timeline reconciliation (§7 note) | POST `…:runValueRealizationTimelineReport` | session log 2026-10-12 ~15:57 |
| FY26 series, nodes, usage, potential (§4–5) | 2026-10-08 pulls | `../helios-2026-10-08/analysis.md` |
| Fee basis (§3) | CAST billing API verification 2026-10-04 | `outbox/case-threads/20261004T080929Z-report-fee-corrections.md` |

**Reporting rule:** one methodology per chart — VR for the leadership KPI, classic as mechanism footnote, Cloudability as invoice footnote.
