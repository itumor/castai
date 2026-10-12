# Savings verification package — 2026-10-12 evening
*(Prepared for the CAST AI engineering call, 2026-10-13, and the messaging alignment with Bosko before Mark)*

Scope re-check: their filter on the workbook reproduces exactly — **positive net rows only = $303,158 across 34 clusters @ $5.00**. The workbook is the reviewed dataset.

## 1. Cluster classification (mechanical, API-derived)

| Class | Rule (all from APIs) | Clusters | VR savings Σ | Fee-basis vCPU | Net @5.00 | Net @5.70 |
|---|---|---:|---:|---:|---:|---:|
| **A — standard-managed** | `isPhase2 = true` | 49 | $157,639 | 7,366.8 | **$120,805** | **$115,648** |
| **B — enterprise/Karpenter-style** | `isPhase2 = false` + billed + VR present (+ classic API 400 "read-only", baseline-params 404) | 6 | $158,738 | 1,265.5 | $152,411 | $151,525 |
| **C — unmanaged-with-VR** | `isPhase2 = false` + VR present + ~no billing | 13 | $10,630 | 0.0 | $10,630 | $10,630 |
| **D — billed, no data** | billed, no VR/classic/baseline | 1 | $0 | 0.01 | −$0 | −$0 |
| **E — ghost/disconnected** | no inventory/deleted, ~0 billing | 2 | $0 | 0.00 | $0 | $0 |

Class evidence for the headline clusters (`enterprise/verify/verification_full.csv`):

| Cluster | Class | isPhase2 | first CAST op | first rebalance | baseline window → end | VR sav. $ | Actual $ |
|---|---|---|---|---|---:|---:|---:|
| SMO Railigent `k8s` | B | false | **none** | — | **404 – no baseline params** | 158,738 | ~63,800 |
| SMO Railigent `k8s-andreas` | B | false | 2026-05-13 | — | 404 | — | — |
| ngm-sim-eks | A | true | 2025-10-30 | – | CLUSTER_HISTORY ends **2026-06-03** · factors **×3.84 CPU / ×7.88 RAM** | 39,326 | 8,051 |
| alliander-demo-eks | C | false | **none** | — | PEER_CLUSTERS · factors ×5.45 / ×10.44 (imported peer behavior) | 10,178 | 3,744 |
| ngm-data-eks | C | false | 2026-08-26 | — | CLUSTER_HISTORY ends 2026-08-27 · **extreme factors ×7.95 / ×16.57** | −327 | 1,103 |
| ngm-helios-eks (sanity) | A | true | 2026-07-20 | – | 2025-09-30 → **2026-07-20 frozen** | 6,668 | 45,121 |
| Pillar#1 `ngm-p1-*` | C | false | — | — | baseline end = in September | 0 | 8,303 |

## 2. Scenarios for the number发给 Mark (@ $5.00 / $5.70)

| Scenario | Included | Net @5.00 | Net @5.70 |
|---|---|---:|---:|
| S0 — workbook as reviewed (positives only) | 34 clusters, all classes | $303,158 | — |
| S1 — enterprise total, all rows | 71 clusters | $283,846 | $277,803 |
| **S2 — exclude B (Karpenter ES, decided in meeting)** | A+C+D+E | **$131,434** | **$126,278** |
| **S3 — S2 minus C (unmanaged-with-VR; cannot be defended either)** | **A only** | **$120,805** | **$115,648** |
| S4 — S3 minus ngm-sim-eks (demand-shift inflation) | A, conservative floor | $83,275 | $78,138 |
| GSW-only sanity vs the $38K expectation | GSW A-rows, no sim/alliander | **$33,580** | — |

Recommendation: **headline S3 = $120.8k** (defensible per-cluster evidence attached for every row; still well above the old $38K expectation, which now traces to GSW-only $33.6k). S4 is the floor if sim must also be excluded pending CAST's answer on demand-shift.

## 3. Questions for CAST AI engineers (2026-10-13)

1. **Karpenter/Enterprise-Suite VR legitimacy** — B-class clusters (SMO Railigent fleet) report $158,738 September VR savings while `isPhase2=false`, classic savings API 400s ("read-only"), baseline-params 404, and the flagship cluster has **no first CAST operation ever**. Is VR officially supported for Karpenter/ES mode? How is it computed with no baseline params and no node-autoscaler? Can we suppress these rows org-side?
2. **Projected-price basis: docs vs observed** — your docs say the projected baseline unit price is `max(current, baseline)`; observed behavior uses **current-only**: ngm-helios projected $51,789.61 reproduces exactly under current prices (baseline-price floor would give ~$59k, savings −$1,191 instead of $6,668). Doc drift or product regression?
3. **Demand-shift inflation** — ngm-sim-eks: savings $39,326 with actual $8,051 (4.9×). CLUSTER_HISTORY habit factors (fixed ×1.60/×2.17-style multipliers) applied to a workload whose demand pattern changed. Is a demand-relative cap intended? Any plan for drift-protected baselines?
4. **VR rows for never-operated clusters** — alliander-demo-eks (`firstOperationAt: none`, PEER_CLUSTERS baseline) produced $10,178 "savings". Why do unmanaged clusters enter the org VR report?
5. **Baseline recomputes** — helios baseline froze 2026-07-20 and only recomputes on the 08:00 refresh cadence (and apparently not again since). A customer-triggerable baseline refresh API + per-cluster recompute timestamp in the VR report would remove weeks of drift arguments.
6. **VR API enterprise quirk** — `runValueRealizationReport` returns HTTP 200 with **empty items unless `X-CastAI-Organization-Id` matches the path org** (verified today across 130 orgs). Undocumented; costs reporting pipelines hours. Ship as documented or fix?
7. **Fee model confirmation** — billing `phase2` totalUsage 8,632.345 vCPU incl. woop-vs-phase2 overlap: Oct 4 detail shows cluster 4fae2e7f attributed ~2,062 under phase2 and ~3,417 under woop → near-double-attribution within one pool. Confirm the single authoritative fee-basis field before contracts reference it.

## 4. Provenance
`enterprise/verify/bp_*.json` (57 baseline-params), `rp_*.json` (69 rebalancing-plans), inventory `inv_*.json` (isPhase2, managedBy, firstOperationAt), `enterprise/verify/verification_full.csv`, earlier VR/classic/billing pulls — all read-only, api.eu.cast.ai, 2026-10-12.
