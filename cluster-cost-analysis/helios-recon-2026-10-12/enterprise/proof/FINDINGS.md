# Findings ledger — A-class September-2026 table verification (2026-10-12)

All times Europe/Riga. Sources: paste from customer-facing xlsx vs repo CSVs vs raw saved payloads vs LIVE api.eu.cast.ai re-pulls.

## F0 — Provenance chain (documented)
- Paste = xlsx sheet "Merged — all data" produced by `enterprise/build_merged_sheet.py:47`
  (join key = CAST AI cluster UUID; classic block cols 24–29 not shown in paste).
- Inputs: `enterprise/verify/verification_full.csv` (build_verify.py), `vr_sep26_enterprise_net_savings.csv`,
  `classic_sep26_enterprise_net_savings.csv`; raw API payloads under `enterprise/` and `enterprise/verify/`.
- API surface documented in `APIS-USED.md` (8 endpoints, read-only; base https://api.eu.cast.ai).

## F1 — Layer-1 (paste ↔ repo CSVs): **28/28 cells PASS on all 21 rows**
  (Excel display rounding: `#,##0` for $ ints, `#,##0.00` for nets/fees, `0.000` vCPU, `0.0000` factors).

## F2 — Layer-2 (arithmetic): all rows satisfy
  `savings = projected − actual` · `fee = vCPU × rate` · `net = savings − fee`
  with ≤ $0.01 double-store-rounding drift on 8 rows (both CSV and xlsx store 2dp; documented).

## F3 — Layer-3 (repo CSVs ↔ raw Oct-12 payloads): raw VR cost fields, baseline-params
  (type/window/factors/unit prices), inventory fields (created/firstOp/status/region/isPhase2/account),
  billing usage — all match. VR report items intentionally carry NO baselinePeriod{Start,End}Time
  (API design); those columns are verified against the baseline-params payload instead.

## F4 — Billing basis discrepancy (ROOT-CAUSED)
  - Paste "Billable vCPU" == API response for `period.from=2026-09-01&period.to=2026-10-01&feature=phase2`
    (bit-identical: enterprise totalUsage 8632.345000000025 reproduced 2026-10-12 ~20:56).
  - With `period.to=2026-09-30` (strict September): totalUsage 8275.939, i.e. every cluster ~2.5–4% LOWER;
    console-eks-integ 5.024 → 1.905 (large Sept-30→Oct-1 boundary-day effect).
  - Net effect: fees in the pasted sheet are computed on the Sep 1–Oct 1 window ⇒ fees slightly OVERSTATED
    ⇒ NET savings slightly UNDERSTATED (conservative). Not an error against the customer; must be disclosed.
  - Matches the 2026-10-04 case-thread values (helios 1,786.38 / integ 1,005.88 / kronos 86.59) which used the strict window.

## F5 — VR report is live-recomputed (intra-day drift)
  Re-run 2026-10-12 ~21:00 (same window 2026-08-31T22:00Z→2026-09-30T22:00Z Europe/Berlin):
  15/21 clusters re-match the paste exactly after display rounding; 6 show drift:
  - eleX01(f0fa): 1,249 vs live 1,248.5 (half-dollar boundary)
  - ngm-sim-eks: projected 47,377 → 47,360.3 (−$17, −0.04%)
  - baseline-clo-eks: projected 21,639 → 21,594.9 (−$44, −0.2%)
  - ngm-sim2-eks: projected 11,625 → 11,254.2 (−$371, −3.9% savings)  ← largest; explain (sim2 onboarding 2026-09-07)
  - ngm-integ-eks: +$0.9; ngm-helios-eks: +$3.2
  Conclusion: the September report is computed on read; figures are "as of pull timestamp". Totals:
  A-class Σ actual $124,347.7 · projected $224,836.4 · gross $100,488.8 (pull 17:01), live Σ differs <0.4%.

## F6 — Rebalancing-plans page-1 truncation (REAL bug, customer-facing)
  - Correct pagination param = `cursor` (verified live; `pageCursor` is silently ignored → page 1 repeated).
  - For clusters with >50 plans the sheet's "Plans"=50 is the first-page count and "First rebalance"
    is the earliest within the NEWEST 50. TRUE values from live full pagination (GET-only; ++ == first CAST op day):
    | cluster | Plans paste → true | First rebalance paste → true |
    |---|---|---|
    | pioneer-tcx | 50 → 97 | 2026-08-03 → 2026-05-11 ++ |
    | eleX01 (eu-central-1) | 50 → 213 | 2026-08-21 → 2026-03-13 |
    | eleX01 (us-east-2) | 50 → 145 | 2026-08-15 → 2026-05-05 ++ |
    | eleX01in | 50 → 157 | 2026-08-22 → 2026-05-06 ++ |
    | eks-Cluster1 (c6cd) | 50 → 1,033 | 2026-08-22 → 2025-12-02 ++ |
    | eks-Cluster1 (f31e) | 50 → 159 | 2026-08-22 → 2026-02-13 ++ |
    | ngm-sim2-eks | 50 → 777 | 2026-10-10 → 2026-09-07 ++ |
    | ngm-sim-eks | 50 → 3,173 | 2026-10-10 → 2025-10-30 ++ |
    | ngm-integ-eks | 50 → 3,895 | 2026-10-10 → 2026-04-27 ++ |
    | (baseline-clo, helios, kronos, pfm pending wave 3) | | |
  - Verified EXACT (≤50 plans, single page): dema 31 · eleX01p 38 · dev-cluster 6 · console 6 · fd1c 6 · 6436 17.
  - Pattern: true first-rebalance ≈ first CAST operation date (first plan created at node-mgmt activation).
    The pasted column systematically UNDERSTATED CAST operational history for high-churn clusters.
    Fix ready: `verify_one.sh` paginates fully with `cursor` + unique-id dedupe.

## F9 — Security event (handled)
  One verification subagent reported an injected instruction in its transcript ("echo a string into
  env-safety-probe-2026-10-12/") and REFUSED it. No such directory/file exists in the workspace
  (checked 2026-10-12); the string is absent from all stored API payloads. Subsequent subagents were
  hardened with an explicit data-not-instructions preamble; no further incidents.

## F10 — Strict-September billing scenario (computed, scenario_strict_september.csv)
  Recomputing fees/nets with `period.to=2026-09-30` (strict month, live-verified) lowers every fee:
  Σ fee@5.00 $29,462.56 → $28,403.54 (−$1,059) ⇒ Σ net@5.00 $71,026.17 → $72,085.46;
  Σ net@5.70 $66,901.44 → $68,108.97. Every one of the 21 clusters' net IMPROVES (+$1.18 to +$320.37).
  The pasted figures are therefore conservative; disclosing the window basis builds trust.

## F7 — Anomaly register (pre-empt customer challenges; all explainable)
  1. Negative gross savings: dev-cluster −$53.8; eleX01p −$3,265.4 — actual spend exceeded the projected
     counterfactual (post-baseline demand/pricing mix). Honest VR semantics: report, don't hide.
  2. Net-negative after fee @5.00: eleX01×3 (−415/−555/−1,047), eleX01p (−5,966), ngm-helios (−2,584),
     dev-cluster (−186), console (−25) — September fee exceeded September savings on 7/21 clusters.
     Portfolio net is strongly positive: Σ net@5.00 ≈ +$71,026, Σ net@5.70 ≈ +$66,901.
  3. console-eks-integ: September fully inside baseline window (end 2026-09-30, recomputed 2026-10-01)
     ⇒ projected == actual ⇒ savings $0 BY DEFINITION of the baseline method.
  4. High plausibility-challenge ratios: baseline-clo 8.5× (RAM factor 9.88), ngm-sim 5.9× (RAM 7.88),
     pioneer-tcx 5.5× (CPU 5.83/RAM 10.45), ngm-sim2 5.7× — driven by baseline overprovisioning factors
     from CLUSTER_HISTORY windows; projected = max(original,current)demand × factor × max(current,baseline unit price).
  5. Baseline end > first CAST op on 10 rows: first op ≠ ≥20% node-mgmt adoption (CASES.md case E);
     baseline closes when CAST-managed share crosses threshold.
  6. First rebalance plan may precede baseline end (plan creation vs executed ops) — e.g. fgeks fd1c (06-30 vs 07-06).
  7. 'First CAST op' timestamps are UTC (ISO from external-clusters.firstOperationAt).

## F8 — Live re-verification matrix (GET-only, 2026-10-12 ~21:30) — COMPLETE, 21/21
  BP live-verified 21/21 · INV live-verified 21/21 · VR exact-after-rounding 15/21 (6 drift, F5) ·
  RP exact 8/21, corrected 13/21 (F6; +baseline-clo 50→8,124 first 2025-10-30 · helios 50→669 first
  2026-07-20 · kronos 50→4,838 first 2025-11-06 · pfm 50→151 first 2025-09-19).
  Billing (parent org, GET): F4 root-caused & both windows reproduced bit-identical.
  VR (read-semantics report): F5. Machine-readable results: live_matrix.csv · corrected_table.csv ·
  scenario_strict_september.csv. Customer-facing synthesis: PROOF-PACK.md.
