# ngm-helios-eks — Costed per-change impact model

Cluster: `ngm-helios-eks` (`419c39e4-66bf-4d61-b833-4562968a61c7`), org SI GSW CLO, EKS eu-central-1, 100 % on-demand.
Basis date: fresh 30 d window **2026-09-05 → 2026-10-04** (`deep-audit-2026-10-04` + `cluster-cost-analysis` pulls).

**Denominator for all % = fresh 30 d total $51,650.08** = CPU $25,608.49 + RAM $17,295.58 + storage $8,746.02 (`cost-30d.json`; storage included). Oct-2 window total was $53,376.62 — movement is demand, not unit price.

## Methodology block

**Frozen vs listing vs bill basis — three bases, never blended:**

| Basis | Definition here | Used for |
|---|---|---|
| **Frozen** | $0.9823/vCPU·day baseline unit price (org convention, brain note `SI GSW CLO NGM Clusters.md`) | CPU-provisioned rows (M2, M5) — value-of-resource framing, as instructed |
| **Bill** | Actual discounted prices derived from this cluster's own `cost-30d` / `nodes-pricing` (`totalPrice`); live CPU unit derived = **$0.4973/vCPU·day** (= $25,608.49 ÷ 1716.59 avg provisioned vCPU ÷ 30 d) → frozen×**0.5062** | Storage $, instance $/hr deltas, spot-share scenario, sequential totals |
| **Listing** | CAST AI `estimated-savings` counterfactuals (Layman / SpotInstances / SpotOnly) | Ceilings only. Never added to actuals |

Rules applied:
1. Every formula's inputs are taken from the local data files (paths in §Sources). No invented coefficients; assumptions are labelled **[ASSUMPTION]**.
2. Bill-level equivalence of any frozen-priced CPU row ≈ ×0.5062. Both are shown so the row is usable in either frame; totals are composed on the bill basis.
3. CAST AI `estimated-savings` numbers are counterfactual snapshots on listing prices (Oct-2 snapshot = 300-node fleet, Oct-4 = 27-node weekend fleet); used only as labelled ceilings.
4. Overlaps: spot savings apply to the pool *after* WOOP/packing shrink it. Per-change rows are **standalone vs today's baseline, not additive**; the totals row uses sequential composition (see bottom).

**Derived storage unit price (task-mandated):** $8,746.02 ÷ 93,146 GiB avg provisioned = **$0.0939/GiB·mo** (used). Cross-checks: brain derivation 8,800 ÷ (64+30)×1024 GiB = **$0.0914**; Oct-2 window 8,788.49 ÷ 93,598 = $0.0939 (identical); brain root-only sub-line ($2.4k ÷ 30,720 GiB) = $0.080 ≈ gp3-only list. Blend sits slightly above bare gp3 → consistent with attached PVs mixing volume types. Consv = $0.0914, realistic = $0.0939.

## Impact table

| # | Change | Formula | Inputs (verified from data) | Consv $/mo (%) | Realistic $/mo (%) | Effort (eng-days) | Risk |
|---|---|---|---|---|---|---|---|
| 1 | Root disk `minDiskSize` 100→50 + `diskCpuRatio=1` | N̄ × GiB¬saved/node × $/GiB·mo; GiB¬saved/node = f<sub><16</sub>×50 + f<sub>≥16</sub>×36 | N̄ = **361.67** avg OD nodes (fresh 30 d; Oct-2 window 375.87); mix from 300-node snapshot: 184/300 <16 vCPU, 116/300 ≥16 → GiB/node = 44.59; 16,126 GiB avg; price 0.0914/0.0939 $/GiB·mo | **$1,474** (2.9 %) | **$1,514** (2.9 %) | 0.5 d | Low — new nodes only (churn-driven rollout); snapshot mix biases ≥16 share up ⇒ underestimated on collapsed days (conservative direction) |
| 2 | `maxCpu` 16→24/32 + `minCpu` 4 (packing / node-tax) | ΔvCPU = N<sub>model</sub> × tax × r; $ = ΔvCPU × 0.9823 × 30. N<sub>model</sub> = req ÷ (S̄ − tax) | tax = **1.1 vCPU** (292/300 live nodes = exactly 1100m; r6a.xlarge 4000−2900 ✓); req = 1297.28; S̄ = 1716.59/361.67 = 4.747 → N<sub>model</sub> = 355.8 (observed 361.7 ✓); tax-model slack 391 vCPU vs observed 419 ⇒ 93 % of slack is node tax, 7 % fragment (**held constant = conservative**); r = node-count reduction **[ASSUMPTION: 25 % consv / 50 % realist]**; hard ceiling r at S=32 → −345 vCPU ≈ $10.2 k frozen | **$2,883** frozen (5.6 %); bill-eq **≈$1,460** (2.8 %) | **$5,766** frozen (11.2 %); bill-eq **≈$2,919** (5.7 %) | 0.5 d | Low-Med — pure constraint change; realised r depends on evictor/rebalancing convergence (#4) and pod-size distribution (long tail of small pods keeps S̄ low); minCpu=4 effect negligible (8 × 2-vCPU nodes) |
| 3 | Exclude c5a/c5ad + newest-gen priority | Σ (price<sub>new</sub>−price<sub>c5a</sub>)/hr × 720 h × count | Live counts: 32×c5a.4xlarge + 14×c5a.2xlarge (+1 c5ad.4xl, excluded — local NVMe). Discounted $/hr (`totalPrice`): c5a.4xl 0.4178 → c6a.4xl 0.4193 = **+$0.0015**; c5a.2xl 0.2089 → c6a.2xl 0.2096 = **+$0.0007**. Listing (`basePrice`): 0.6960→0.6984, 0.3480→0.3492 | **$0** (0 %) bound | **+$42/mo cost** (+0.08 %) [+$67 listing] — i.e. bound **0 → +$42** | 0.5 d | Low. **Honest caveat: c6a is NOT cheaper on unit price (+0.4 %); benefit is price/perf (newer silicon) and OD/spot pool depth (c5a.4xlarge capacity exhaustion observed in sibling cluster's audit). c5a→m6a is NOT a swap — m6a doubles RAM: would ADD $2,226/mo; size-matched replacement is c6a** |
| 4 | Evictor → CAST-managed + 10 min/5-targets + rebalancing `evictGracefully` | — (enabling lever) | Current: evictor `status=Incompatible, allowed=false` (self-managed detection); nightly schedule `ngm-helios-castai-hourly-nightly` 22:00–03:59 London, 50 targets, `evictGracefully=false`, 20 % savings trigger; jobs: 2 finished/1 skipped (Oct-3/4). Layman consolidation ceiling exists: −19.3 %(Oct-4) / −20.4 %(Oct-2) **on listing basis** — basis caveat, shared with #2, **not counted here** | $0 (enabling) | $0 (enabling) | 2 d | Medium — eviction safety on prod; enables capture of #2 and weekends' idle packing; PDB semantics unchanged |
| 5 | WOOP / rightsizing (currently metrics-only, `optimizedCount=0`) | waste × prov:req × 0.9823 × 30 × capture | waste = **875.2 of 938.6** requested cores (7,899 workloads, `workload-efficiency.json`); prov:req = 1.3232; 100 % = 875.2×1.3232×0.9823×30 = **$34,127**/mo frozen; capture **[instructed: 40 % / 60 %]** — CAST AI retains headroom; `resourceQuotasAffectingOptimization=true` gates some workloads | **$13,651** frozen (26.4 %); bill-eq **≈$6,911** (13.4 %) | **$20,476** frozen (39.6 %); bill-eq **≈$10,366** (20.1 %) | 5–10 d | Medium — per-namespace opt-in, request drops must not starve bursts; RAM waste (≈1,667 GiB of 2,782 GiB req, milli-unit field) is additional and NOT priced here. Cross-check: CAST AI's own costImpact total = $23,456/mo (their live basis, CPU+RAM). Named example: `argo/argocd-repo-server` 24.2 cores req vs 0.19 used → formula $944/mo frozen @100 % (bill-eq $478; CAST AI $602.86/mo) |
| 6 | Spot namespace pilot (Phase-3 gated) | share × 62.8 % × compute$; ceilings from estimated-savings | Compute (bill) = $42,904.06/fresh 30 d; observed discount 62.8 % (m6a.24xlarge spot vs OD, brain note); movable share **[ASSUMPTION: 20–30 %]**. **Ceilings, listing basis, never blended:** SpotOnly **−$48,360/mo (−70.7 %)** and SpotInstances **−$16,601/mo (−24.3 %)** (Oct-2 300-node snapshot; Oct-4 weekend snapshot −64.3 % / SpotOnly) | **$5,389** (10.4 %) bill basis | **$8,083** (15.6 %) bill basis | 3–5 d | High-ish — prod namespaces, needs PDB contract + fallback (spotBackups already on); today spotInstances.enabled=false org-wide |
| 7 | maxPods formula, IMDSv2, AZ 1c, clusterLimits, drainTimeout, prediction type | — | maxPods 55 → ENI-formula: removes pod-density cap on big nodes (unlocks #2); IMDSv2 already on (`imdsV1=false`) — no-op; +eu-central-1c: resilience + future spot depth (template currently 2 subnets 1a/1b); clusterLimits 16384→real guardrail: burst-cost control, $0 direct; drainTimeout 600s→~90 s: faster churn, pairs with #4; interruption-prediction type AWSRebalanceRecommendations deprecated: cosmetic | $0 | $0 | 1 d | Low |

### Totals

Per-change rows are standalone; adding them double-counts (spot % applies to the post-WOOP pool; packing tax ∝ post-WOOP requests). **Sequential composition (bill basis)** — order: WOOP → packing → spot, + storage:

| Scenario | Steps | Total $/mo | % of $51,650 |
|---|---|---|---|
| **Conservative** | $42,904.06 − WOOP(40 %, bill-eq $6,911) − packing(r=25 %, bill ≈$1,460, recomputed on post-WOOP requests 947.3 cores) − spot 20 %×62.8 % on remainder ($31,533×0.1256 = $3,960…) → compute $30,541 → savings $12,363 + storage $1,474 | **≈$13.8 k/mo** | **26.8 %** |
| **Realistic** | − WOOP(60 %, $10,366) − packing(r=50 %, ≈$2,236 on post-WOOP 772.2 cores) − spot 30 %×62.8 % on remainder ($29,970×0.1884 = $5,646) → compute $24,998 → savings $17,906 + storage $1,514 | **≈$19.4 k/mo** | **37.6 %** |

Naive frozen-basis sum (ROW values added, overlaps included, frozen overstates CPU $ ≈2×): consv $23.4 k (45.3 %), realist $35.8 k (69.4 %) — **upper-value framing only; do not quote as bill impact.**

## Sources

- `cluster-cost-analysis/ngm-helios-eks/`: cost-30d.json, resource-usage-30d.json, node-count-history-30d.json, nodes.json (300 ready nodes), nodes-pricing.json, nodes-storage.json, node-config-4fae….json (minDiskSize 100, diskCpuRatio 0, kubeReserved 1000m/4 Gi, systemReserved 100m/0.5 Gi, maxPods 55, drain 600 s, gp3, 2 subnets)
- `cluster-readiness-outputs/ngm-node-templates/deep-audit-2026-10-04/helios/`: cost-30d.json (fresh), resource-usage-30d.json, node-count-history.json, workload-efficiency.json, estimated-savings.json, policies.json, woop.json (v1.10.4, optimizedCount=0), rebalancing-jobs.json, sched-*.json
- `brain/notes/SI GSW CLO NGM Clusters.md`: frozen $0.9823/vCPU·day, 1.60× overprovisioning, realized-savings context, 62.8 % spot observation, storage note

*Read-only analysis; no API mutations performed.*
