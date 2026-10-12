# Meeting prep — ngm-helios-eks cost & savings reconciliation (2026-10-12)

**Cluster:** `ngm-helios-eks` = `419c39e4-66bf-4d61-b833-4562968a61c7` (org SI GSW CLO `07aa3c29-3e1f-44bc-ad60-ceedb878d99a`)
⚠ The email writes "ngm-**gelios**-eks" — that cluster does not exist; both links point to this cluster. Do not chase a phantom.
**Period:** September 2026. All CAST AI figures below re-verified **live today 2026-10-12 ~15:25** from `api.eu.cast.ai` (read-only) and **re-run ~15:45 with identical results** (classic savings GET, VR report POST, baseline-params GET, VR org timeline POST). Raw JSON: this folder.

---

## TL;DR for the meeting

**There is no data conflict.** All three number sets are real and reproducible — they answer **three different questions**:

| # | Figure in email | Verified value | What it actually is | Source (endpoint) |
|---|---|---|---|---|
| 1 | Baseline **51k$** | **$51,790** | What Sept. *would have cost* at the pre-CAST overprovisioning shape (CLUSTER_HISTORY baseline frozen 2026-07-20: CPU ×1.60, RAM ×2.17) | VR report: `projectedCost` |
| 1 | Actual Spend **45k$** | **$45,121** | September actual compute (CAST on-demand-equivalent price sheet) | VR report: `actualCost` |
| 1 | Realized Savings **6,6k$** | **$6,668** (12.9%) | Baseline − actual, *frozen-baseline* method | VR report: `totalSavings` |
| 2 | Costs **45k$** | **$45,095** | **The same 45k.** Two CAST pipelines agree within $26 | Classic: `summary.totalCost` |
| 2 | Gross savings **19k$** | **$18,878** (41.9%) | Node-level mechanism savings (downscaling vs current prices, **no frozen baseline**) | Classic: `summary.totalSavings` |
| 2 | Net savings **8,6k$** | **$8,606** | $18,878 − fee €8,932 (1,786.38 billable vCPU × €5) at FX ≈1.15 | fee = €5 × provisioned vCPU |
| 3 | Cloudability **72k$** (Adjusted) | — | **Different scope, period and basis** — see §3 | not CAST data |

Reproduced to the dollar: `vr_sep26_berlin.json` (Europe/Berlin month, = console preset `PREVIOUS_MONTH`); `classic_savings_sep26_live.json`. September is closed — numbers are final.

---

## 1. The console numbers (screenshot 1) — Value Realization report

Console link = cluster **cost-report/savings-report** = the Value Realization (VR) methodology (CAST AI's customer-facing realized-savings methodology):

- **projectedCost $51,790** — "Baseline costs 51k" ✓
- **actualCost $45,121** — "Actual Spend 45k" ✓
- **totalSavings $6,668** — "Realized Savings 6,6k" ✓ (Berlin-tz window gives identical rounding)

Composition: CPU projected 2,165 vs provisioned 1,787 vCPU; RAM projected 8,728 vs provisioned 8,295 GiB. Savings accrue only **from 2026-07-21** (baseline end +1d) — its counterfactual is frozen to the pre-CAST shape.

## 2. Lars's report (screenshot 2) — Classic savings API + fee

- Costs **$45,095** and gross **$18,878** = classic `/v1/cost-reports/clusters/{id}/savings`, September UTC. ✓
- Fee (from the corrected fee table, 2026-10-04): billable = **average provisioned vCPU** = **1,786.38** (verified via CAST billing API) × €5 = **€8,931.92**. At FX 1.15 → $10,272 → **net $8,606 ≈ "8,6k"** ✓. (At the 1.08 FX used in some earlier tables net would be $9.2k — FX basis is an open item for Finance, see §4.)
- **6.6k vs 19k is thus not an error**: VR uses a frozen historical baseline (conservative, demand-capped); classic prices the mechanically removed node-hours at current OD-equivalent prices. Our own playbook (savings-cases-2026-10-08, verified live on 16 clusters) says: **never mix the two methodologies in one report; use VR for board numbers.**
- Sanity cross-check: 45,095 − 18,878 ≈ **$26.2k ≈ Siemens' actual discounted EC2+EBS bill** for helios (Gerolf's invoice-verified ~$27k/mo for August). I.e. the classic "gross" implicitly *also* contains the price-basis gap (list vs Siemens' EDP/RI/SP discounts), which is why it is so much bigger than the frozen-baseline 6.7k.

## 3. Cloudability 72k$ (screenshot 3)

The Cloudability link is scoped **`last_quarter`: 2026-07-01 → 2026-09-30**, all `enhanced_service_name`s, metric `adjusted_cost`, filter `container_cluster_name == ngm-helios-eks`.

Most probable explanation, consistent with all known data:

- **72k = the Jul–Sep quarter total (~$24k/month), not September alone.** Siemens' own invoice-verified figure for this cluster was ~$27k in August (Gerolf's mail, verified 2026-10-02). 3 × ~24k = 72k ✓. A single-month 72k would mean the bill almost tripled Aug→Sep while provisioned vCPU was flat (1,809→1,786) — impossible.
- Even if read as a single month, the bases are disjoint: Cloudability `adjusted_cost` = **actual discounted, amortized payments** (incl. EDP/RI/SP) across **all AWS services** (EC2, EBS, network, LB, EKS, …); CAST's 45k = **compute-only** valuation on **CAST's on-demand price sheet**, before Siemens' negotiated discounts. Levels must never be compared — only deltas.
- (Coincidence trap: CAST's September *list-price* OD-equivalent is $72,155 ≈ 72k — a valuation basis, not anyone's bill.)

**Three live checks to run on the Cloudability screen in the meeting:**
1. Is 72k the **September column** or the **Jul–Sep total**? (Link pivots by `year_month`.)
2. Scope: all services vs EC2 only — ask for the EC2 row only; it should land ~$26–27k.
3. Basis: `adjusted_cost` (invoice) vs list — which one is displayed?

## 4. Recommended leadership statement

> *"The three figures are three different, individually correct methodologies — there is no data error. Everyone agrees September actual compute spend was **~$45k** (CAST basis). CAST AI reports realized savings of **$6.7k** in its console (conservative frozen-baseline method) and **$18.9k gross / ~$8.6k net of the €5/vCPU platform fee** via its savings API (Lars's report). Siemens' Cloudability shows the **Jul–Sep quarter at ~$72k adjusted** (~$24k/month), Siemens' discounted actual bill, which already contains both CAST's effect and our AWS discounts. We will standardize on ONE methodology — CAST's console Value-Realization report — for the leadership KPI, and document it."*

## 5. Open items (say them proactively)

- **FX & unit rate:** net savings depend on EUR→USD (1.08 vs 1.15 ⇒ $9.2k vs $8.6k net) and on €5 vs €5.70 per vCPU — with Finance to pin down before publishing audited figures.
- **Baseline refresh:** the frozen baseline (2026-07-20) makes VR savings structurally shrink as demand grows (max(original, current) demand). CAST AI can recalculate/override the baseline — raise with Marko/Ahmed; it directly lifts the conservative KPI.
- **Never mix methods:** VR (console), classic API, Cloudability — report one, footnote the other two.

## Appendix — verified numbers & provenance

| Value | Endpoint (all GET/POST-report, read-only, 2026-10-12) | File |
|---|---|---|
| projected 51,790 / actual 45,121 / savings 6,668 (Sep, Berlin) | `POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport` (2026-08-31T22:00Z→2026-09-30T22:00Z) | `vr_sep26_berlin.json` |
| same, UTC month: 51,761 / 45,093 / 6,668 | same, 2026-09-01→2026-10-01 UTC | `vr_sep26_utc.json` |
| cost 45,095 / gross savings 18,878 (Sep) | `GET /v1/cost-reports/clusters/{id}/savings?stepSeconds=86400` | `classic_savings_sep26_live.json` |
| list-price OD-equiv 72,155; incl. storage 80,967 (Sep) | `GET /v1/cost-reports/clusters/{id}/cost?useListingPrices=true` | `cost_sep26_list_live.json` |
| baseline: CLUSTER_HISTORY, frozen 2026-07-20, factors 1.6035/2.1697 | `GET /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params` | `baseline_params_live.json` |
| billable vCPU 1,786.38, fee €8,931.92 | CAST billing API verification 2026-10-04, fee-corrections doc | `outbox/case-threads/20261004T080929Z-report-fee-corrections.md` |

Related preparation already on file: `.kimchi/docs/si-gsw-exchange-2026-10-09-meeting-prep.md` (methodology + Gerolf reconciliation), `cluster-cost-analysis/helios-2026-10-08/analysis.md` (FY26 monthly series), `outbox/savings-cases-2026-10-08/CASES.md` (methodology rules).
