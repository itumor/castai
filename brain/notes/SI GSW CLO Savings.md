# SI GSW CLO Savings

Durable facts from the 2026-10-02 live analysis (read-only, EU API) of the three
NGM clusters Siemens challenged in the savings review call ("do we actually save
money?"). Full analysis: `.kimchi/docs/siemens-gswclo-savings-analysis-2026-10-02.md`.
Sibling notes from same-day parallel sessions: [[SI GSW ngm Cost Case]],
[[SI GSW Savings Analysis]], [[SI GSW CLO NGM Clusters]] — read together; this
note owns the Jun–Oct frozen-price trajectory + per-month CAST-realized cross-checks.

## Org & clusters

- Org **SI GSW CLO** = `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` (enterprise key +
  `X-CastAI-Organization-Id`; the root-`.env` MCP key alone sees 0 clusters)
- `ngm-helios-eks` `419c39e4-66bf-4d61-b833-4562968a61c7` — node-AS since **2026-07-20** (matches meeting record)
- `ngm-integ-eks` ("Intec" in the meeting) `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` — since **2026-04-27**
- `ngm-kronos-eks` `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` — since **2025-11-06** (baseline era stale — discount confidence)
- All: Phase2, agents online, **0% spot**, no Karpenter. WOOP installed
  metrics-only (`optimizedCount: 0`) per the R&D recommendation-only policy.

## Fee model (corrected 2026-10-02 — important)

- SI GSW contract fee = **€5 per provisioned CPU·month** (platform fee; all org
  clusters count, incl. test). Verified: reproduces Gerolf's "billable CPUs"
  invoice math — helios 1,806 × €5 ≈ **€9.0K**, integ 876 × €5 ≈ €4.4K (Aug) —
  **this is the meeting's "€5,000/$9,000"**.
- The **5%-of-gross-savings** rate is the *CPS* account's term — never mix
  per account. Basis of the fee = avg provisioned vCPU (time-weighted), so
  **shrinking provisioned vCPU (spot, packing) shrinks the fee too**.

## Verdict (2026-10-02)

- **Optimization effect is real:** unit price vs frozen read-only baseline fell
  Helios −14%, Integ −30%, Kronos −38%. M1 gross Jun–Sep (discounted basis):
  Helios $19.6K, Integ $31.0K, Kronos $3.2K (Σ $53.8K); net@5% $50.9K.
- **Net of the €5/CPU fee:** Integ **+$1.7–3.9K/mo**, Kronos **+$0.25–0.73K/mo**,
  Helios **−$1.6 to −5.7K/mo compute-only** (fee ≈ €9K/mo ≈ its savings).
  Fee is org-wide → fair cut is org level, where other clusters' savings offset.
- **Helios proof pattern for the meeting:** Jun (pre-switch) gross −$150 → Jul
  +$3.9K → Aug +$8.2K → Sep +$7.5K **while vCPU grew 1,564→~1,800**. "Costs went
  up" = workload growth, not lost savings.
- CAST AI realized API (their counterfactual, list-price family): helios
  $18.8–24.8K/mo, integ $18.4–26.3K/mo, kronos $1.0–3.5K/mo → × d≈0.5 (their AWS
  discount, unpinned) Helios ≈ break-even to +5%, integ +23–32%, kronos small-positive.

## Frozen baselines (p = $/vCPU-day, discounted basis)

| Cluster | Window | p | Notes |
|---|---|---|---|
| Helios | 2026-05-22→07-20 | **0.9823** | n=60, CV 0.04 |
| Integ | 2026-02-27→04-27 | **1.0427** | n=60, CV 0.04 |
| Kronos | 2025-10-01→11-06 | **1.2030** | n=37, one-year-old era — re-baseline before publishing |

`CALIBRATION_FAIL` on helios/kronos eval windows = **false alarm** (verified:
Σ item×24×days = summary.totalCost exactly). Cross-check rule for this org.

## Reconciliation rules for this account

- Siemens speaks **Cloudability/SAP (EUR, paid)**; FinOps $27K ≈ CAST **CPU-only
  list** $27.9K → their RI/SP discount explains the level gap. Compare deltas and
  ER, never absolute levels, until `d` is pinned by their Cloudability export.
- CAST AI realized-savings API reads **2–3× our M1** (different counterfactual).
  Show the 3-column range (actual | frozen baseline | CAST AI realized), never blend.
- Integ halved overnight Jun 30→Jul 1 (3,728→1,266 vCPU) — workload removal, and
  the reason its June net@€5/CPU is negative (fee ∝ provisioned vCPU).

## Open follow-ups

- [ ] Spot enablement (0% today — biggest lever; modeled ≈ $27.7K/mo; also shrinks fee basis). Integ pilot first.
- [ ] Siemens Cloudability export → pin `d` (customer rate vs list) → final net table.
- [ ] Helios over-request cleanup worklist (2,277 vs 454 recommended cores; dev Helm charts; ~$28–52K/mo forfeited, no WOOP needed).
- [ ] Re-baseline Kronos on a recent window.
- [ ] Confirm fee terms per contract (€5/CPU·mo here; 5% on CPS) in writing.
- [ ] Daily per-workload originalRequested snapshots (M4 layer attribution).
