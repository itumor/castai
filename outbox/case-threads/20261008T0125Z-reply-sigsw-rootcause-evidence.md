# DRAFT REPLY — SI GSW savings credibility (root cause + evidence pack)

**Status:** draft for human review. Attach the snapshots from `outbox/savings-sigsw-snapshots-20261008/` when sending. Every console snapshot below is paired with the API call that produces the same number, so the customer can re-verify either path.

---

Subject: Re: SI GSW — CAST AI savings vs Cloudability: root cause found, corrected numbers

Hi all,

Thank you for the detailed feedback — you were right to challenge these numbers, and your specific comparisons (helios $44,587 vs $22,304; "saved $530k vs paid $470k") were the decisive clues. We reproduced every figure in our report against the CAST AI API and found **three distinct defects** that stacked into the $530k. Below: what we found, the evidence for each point, corrected numbers based on what you actually pay, and what we change going forward.

## TL;DR

1. **68% of the $530k was never real.** Our FY26 report summed CAST's legacy per-cluster savings endpoint across all 12 months. That endpoint is a mechanical "frozen-baseline minus actual" model and — against CAST's own documented methodology — it books "savings" also for the months when CAST was only connected in read-only, before managing anything. For helios, 78% of the claimed savings predate CAST's first action on the cluster (first real operation: 2026-07-21, audit log evidence). CAST's own current console model (value realization) reports **$184k**, not $527k, for the same 3 clusters and period.
2. **The remaining ~$184k is computed on CAST's price sheet, which is ~2× your real costs.** Your adjusted amortized Cloudability figures are ≈ 50% of CAST's modeled prices (helios Sep: CAST $44,588 compute vs your billed EC2 $22,304 = 0.5002; integ Sep: 0.503). Every cost AND saving figure we showed scaled with this inflated basis — including the "actual cost" columns. On your billed basis, the defensible FY26 gross saving is ≈ **$92k**, and the current monthly run-rate ≈ **$20.4k gross**.
3. **Your K8s-scheduler optimization is real, and part of "our" integ savings is actually yours.** Integ's frozen baseline was locked 2026-04-27, *before* your May/June scheduler change. Your change cut provisioned capacity ~46% (Jun→Jul); because the baseline is never re-measured, the model keeps attributing ~$18.5–26.3k/month of that improvement to CAST. We cannot cleanly split CAST's marginal contribution from yours on integ without a controlled measurement.
4. **Fees:** €14,394.26/month (September; €5 × 3,400.815 provisioned vCPU from the billing API — matches your ~$14.5k) must be and now is deducted. After fees, the current net is **≈ +$4.6k/month** at your billed rates — not +$24.9k as our report stated.
5. You are also right on process: **workload autoscaling and spot stop being recommended** (your on-prem parity and interruption-tolerance constraints are documented facts for us), and no list-price or CAST-model figure will be sent to your management again.

## Evidence pack (console snapshot ⇄ API call)

All snapshots captured 2026-10-08 ~01:25–01:32 (console.eu.cast.ai, org SI GSW CLO; fleet state at capture: helios dev cluster at night-low — 51 nodes, all on-demand). Every console view is paired with the API call that produces the same underlying numbers, so each claim is verifiable on either side.

| # | Claim | Console evidence | API evidence (anyone with a read-only key can reproduce) |
|---|---|---|---|
| S1 | Helios savings before CAST acted: none | SNAP-02 helios dashboard — "CONNECTED: a year ago" (2025-09-30); nodes & live utilization | Audit: **zero events 2026-07-01→07-20**; first `nodeAdded` 2026-07-21T23:07Z by `internal|rebalancer` (`GET /v1/audit?clusterId=419c39e4…&fromDate=2026-07-01&toDate=2026-07-21`). Legacy endpoint nonetheless reports $18–24k/month "savings" for Oct 2025–Jun 2026 — impossible attribution. |
| S2 | Console-model FY26 realized savings | (console per-cluster realized-savings view; cumulative) | `POST /reporting/v1beta/organizations/07aa3c29…/clusters:runValueRealizationReport`, 2025-10-01→2026-10-01: helios **$33,323.01**, integ **$91,523.11**, kronos **$59,188.15** (Σ **$184,034.27**). This is the number the console model stands behind — not $526,923. |
| S3 | Where $526,923 came from | (our PDF, withdrawn) | = Σ `GET /v1/cost-reports/clusters/{id}/savings` Oct 2025→Sep 2026 for the 3 clusters: $220,834 + $289,245 + $16,844 = $526,923. Pre-go-live share: helios $171,894, integ $183,251, kronos $2,431 = **$357,576 (68%)**. |
| S4 | CAST price sheet ≈ 2× your bill | SNAP-06/07 cluster cost monitoring — CAST-modeled current month spend on CAST's price sheet | Helios Sep 2→Oct 2: `totalCostOnDemand $44,588.13` vs Cloudability EC2 $22,303.58 (0.5002). Integ Sep: $22,047 compute + $1,786 storage vs billed EC2 $11,096.67 + EBS $1,807.33 (0.503). CAST's sheet holds no EDP/private-discount curve for your account. |
| S5 | Integ baseline frozen before your scheduler change | SNAP-11 integ efficiency (current overprovisioning 55.31% — very different from frozen 2.196×=120%) | `GET /reporting/v1beta/organizations/…/clusters/1ad1a0bf…/baseline-params`: `baselinePeriodEndTime 2026-04-27T00:00:00Z`, `cpuOverprovisioningFactor 2.196`, `baselineType CLUSTER_HISTORY`. Your −46% provisioned-vCPU drop landed Jun→Jul 2026, after the freeze. |
| S6 | Kronos baseline stale 11 months | SNAP-12 kronos efficiency (14 CPU provisioned / 6.04 requested / **0.38 used**) | Same endpoint: kronos `baselinePeriodEndTime 2025-11-06`, `updateTime 2025-12-03` — never refreshed; frozen factors 5.25× CPU / 11× RAM vs today's workload shape. The console value-model even claims $59.2k savings on $21.6k FY26 actual — artifact. |
| S7 | Fee basis | SNAP-01 org cluster list (provisioned CPU per cluster) | `GET /v1/billing/platform-usage-detail?feature=phase2&period.from=2026-09-01&period.to=2026-09-30`: org **3,400.815** vCPU (helios 1,786.383 / integ 1,005.878 / kronos 86.591) × €5 = **€14,394.26**. |
| S8 | "Projected" is not independent | SNAP-06/07 | Integ Sep window: actual $22,388.83 + savings $18,415.69 = **$40,804.52** — exactly the "API-implied projected cost" in the report. Projected = actual + savings by construction (frozen-baseline-implied), not a separate measurement. |
| S9 | Even the "remaining opportunity" was overstated | SNAP-03/04/05 Available savings (2026-10-08): helios **$6,374/mo** total (rightsizing $5,009), integ **$17,991/mo** (rightsizing $1,707), kronos **$292.88/mo** (rightsizing $59.24) | Report claimed helios rightsizing $17,387/mo, integ $2,590/mo, kronos $2,941.82/mo. Console's own current view is lower (fleet also changed since Oct 2) — another reason scenario numbers must be labeled "modeled, at capture time, CAST price sheet". |

## Corrected, defensible figures (your billed basis ≈ 50% of CAST's sheet)

| Metric | As reported | Corrected |
|---|---|---|
| FY26 realized savings, 3 clusters (gross) | $526,923 | **≈ $184k API-basis → ≈ $92k billed-basis** |
| September gross savings (API-basis $40,696) | — | **≈ $20.4k billed-basis** |
| September net after CAST fee | +$24,872 | **≈ +$4.6k/month** (fee €14,394) |
| FY26 net after fees (≈ €52k) | $357,284 | **≈ +$34.5k** |

Cast AI is still net-positive for you at real rates — but ~15× below what we reported. Even the ≈ +$4.6k/month is conservative: it excludes any rightsizing upside you already captured yourselves, and integ's figure still contains the un-separable share of your own scheduler change.

## Answers to your specific points

- **"$530k savings vs $470k paid / $195k during the CAST window"** — Correct observation; the $530k is void (Defect 1: 68% pre-go-live phantom; Defect 2: inflated price sheet). The figure exists only inside CAST's legacy savings model, never in anything you were billed. We withdraw the report.
- **"May→June drop was our K8s scheduler change, nothing to do with CAST"** — Agreed and credited (Defect 3). The baseline froze 2026-04-27, weeks before your change; the model cannot tell your improvement from CAST's actions. On helios this is provable: CAST's first action there was Jul 21, so nothing before that date can be CAST's.
- **"List prices must never reach management"** — Agreed. Note on precision: the report used CAST's **default price sheet** (not AWS public list — but ~2× your EDP-adjusted bills). Future reporting will carry an explicit price-basis column and converge to your Cloudability-adjusted amortized basis. We would like to align the exact ratio with your FinOps team once (0.5002 / 0.503 observed) and then apply it as a fixed conversion until CAST supports customer-specific discounts.
- **"Fee not shown"** — It was included in the fee table but not in the headline; corrected above (net ≈ +$4.6k/month current).
- **"No possibility to verify"** — Every number above is reproducible: console views (snapshots attached) and read-only API calls (exact endpoints in the evidence table). We will also provide the frozen-baseline methodology doc if you want the full math.
- **Workload autoscaling / Spot** — Understood and accepted: WOOP stays disabled (on-prem/offline parity), spot stays disabled (interruption tolerance). We will not re-propose them; the remaining on-demand rightsizing opportunity (rebalancing) stays on the table only as an opt-in, controlled pilot when and if you choose.
- **"On a year basis it is impossible to verify"** — The honest annual statement is the corrected table above. If you want month-by-month verification, we will provide a per-cluster × per-month CSV (actual | frozen-baseline adjusted | console-realized) on the billed basis.

## What we change immediately

1. The $526,923 figure and both ROI PDFs are **withdrawn**.
2. Our reporting switches to the console value-realization model (zeroes pre-go-live months), converted to your billed basis, fees deducted, price basis labeled on every figure.
3. We request a **baseline refresh for kronos** (frozen since 2025-12-03) and review of integ's baseline given your scheduler change — both need CAST-side action; we will confirm dates before the next review.
4. Internal product tickets filed: legacy `/savings` endpoint must not report savings before `firstOperationAt`; support customer-discount price basis in cost reporting.

Happy to walk through the evidence live in our next call — including re-running any of the API reads against your screen share.

Best regards,
Ebrahim (CAST AI)

---

### Internal notes (do not send)

- Attach: SNAP-01..SNAP-12 PNGs from `outbox/savings-sigsw-snapshots-20261008/` (each `.txt` twin = the page's text content for quick verification before sending). Captured 2026-10-08 ~01:25–01:32 (night; dev fleets at low load — say so if the customer compares to their daytime view).
- If the customer themselves opens the console org savings view they may see **≈ $767k FY26** (org-wide, includes ngm-sim-eks $162k, sim2 $9.6k, data $3.1k, cilium $0.8k — not just the 3 NGM clusters; same phantom-baseline and price-basis defects apply). Be ready to explain this number too.
- ngm-sim-eks shows console savings $162,099.68 FY26 — also worth a credibility review before it reaches any management deck (same model caveats).
- FX used: €1 ≈ $1.0993. Fee €5/vCPU — if contractual rate is €5.70, September fee = €16,409.45 (net remains ≈ +$2.6k–4.6k/month).
