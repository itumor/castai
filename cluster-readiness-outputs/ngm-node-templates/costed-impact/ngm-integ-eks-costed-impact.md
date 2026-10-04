# ngm-integ-eks — Costed Impact Model (read-only, per-change)

**Cluster:** ngm-integ-eks `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` · EKS eu-central-1 · AWS `600442974479` · Org SI GSW CLO `07aa3c29-3e1f-44bc-ad60-ceedb878d99a`
**Denominator for all %:** fresh 30d total **$23,770.39** (`cost-30d.summary.totalCost`, deep-audit-2026-10-04 pull; CPU $14,558.85 + RAM $7,355.40 + storage $1,856.14).
**Read-only**: all numbers recomputed from local API dumps; no POST/PUT/PATCH/DELETE issued.

---

## Methodology block — bases & rules

Three price bases exist in the data. **Never blended; every figure below is labeled.**

| Basis | What it is | Where from | Used for |
|---|---|---|---|
| **Actual-bill (discounted)** | What Siemens actually paid; `/v1/cost-reports` default. Carries the ~39.97% negotiated discount (nodes-pricing.json `discounts: 0.3997`). | cost-30d.json (CPU+RAM = $21,914.25 = `totalCostOnDemand`, 100% on-demand) | Denominator; changes 1, 4, 5 dollarized against it |
| **Frozen baseline** | Brain-note frozen unit price **$1.0427/vCPU·day** (integ, 2.20× overprovisioning factor). | `brain/notes/SI GSW CLO NGM Clusters.md` | Changes 1 (vCPU framing), 2 (WOOP gross); a demand-side yardstick, not the bill |
| **Listing snapshots** | CAST AI `estimated-savings` scenarios: list prices at snapshot node counts. | estimated-savings.json (Oct-2 pull: 78 nodes, $16,947.59/mo listing; Oct-4 pull: 11 nodes, $3,398.53/mo listing) | Cross-checks ONLY, clearly flagged |

**Derived inputs (all recomputed):**

| Input | Formula | Value |
|---|---|---|
| Burst share (time-weighted) | 1 − 30·min(daily cpuProvisioned)/ΣcpuProvisioned = 1 − 30×114.9/30,615 | **88.7%** of compute is burst-shaped |
| Burst share (peak-count) | Σ(N_d−44)/ΣN_d, N = midnight node-count, B=44 = 30d min (p10≈163) | **92.6%** (16,475 burst node-days) |
| avg vCPU/node | ΣcpuCapacityMilli ÷ 78 nodes (Oct-2 12:00Z snapshot) | **9.64** (fixed tax 1.086 vCPU/node = kubeReserved 1000m + systemReserved 100m) |
| prov:req factor | avg cpuProvisioned ÷ avg cpuRequested = 1020.5 / 646.7 | **1.578** |
| req:used | 646.7 / 67.4 | 9.60 (used:prov = 6.6%) |
| Effective gp3 | storageCost ÷ avgStorageGib = $1,856.14 / 19,768.08 GiB (derived from data, ≈ gp3 list eu-central-1 $0.0952) | **$0.0939/GiB·mo** |
| Time-avg concurrent nodes | avgCpuCount 998.12 ÷ 9.64 vCPU/node | **~103.5** (midnight snapshots avg 593.2 are burst *peaks*, not the billing basis — see anomalies) |
| Spot discount | observed m6a.24xlarge −62.8% vs OD (brain note, CAST AI snapshot) | **−62.8%** |
| 90d realized context | $58,419 savings / ($64,384 cost + $58,419) | 47.6% realized, 100% from downscaling, spot $0 |

**Stacking rule:** WOOP shrinks the footprint; spot discounts the remainder. Naive sums overstate — an overlap adjustment is shown in totals. Changes 3, 6, 7 carry $0 in totals (3 and 7 by evidence/decision, 6 by design).

---

## Master table

| # | Change | Formula | Key inputs | Conservative $/mo (%) | Realistic $/mo (%) | Effort (eng-days) | Risk |
|---|---|---|---|---|---|---|---|
| 1 | **spot-batch template** (spotInstances OFF today, 0 spot nodes all 30d) | compute$21,914 × burstShare × movable × 62.8% | burst 88.7%/92.6%; movable 30%/60% | **$3,662 (15.4%)** | **$7,646 (32.2%)** | 3–5 (template + burst-job namespace rollout + fallback test) | Low–med: interruption churn on batch; spotBackups + AWSRebalance predictions already configured |
| 2 | **WOOP cron rightsizing** (enrich-analog crons) | 293.59 waste cores × 1.578 prov:req × $1.0427 × 30 × capture | capture 40%/60%; waste & factor from data | **$5,797 (24.4%)** | **$8,696 (36.6%)** | 1–2 (8 cronjob request values) | Med: under-requesting if a real run appears; 30d usage ≈ 0, keep headroom buffer |
| 3 | Evictor manage + aggressive mode + savings floor 5%→2% | *qualitative — evidence-capped* | prov−req slack $11.7k/mo context; plans fail `achievedSavingsBelowThreshold` | $0 (qualitative) | $0 (qualitative) | 2–3 (ownership decision: CAST-managed Helm) | Med: evictions during bursts; PDBs |
| 4 | maxCpu 16→32, minCpu 0→4, +AZ eu-central-1c | (1.086/9.64 − 1.086/avgNew) × cpu$14,558.85 | avgNew 12 (cons) / 19.3 (real) vCPU/node | **$323 (1.4%)** | **$821 (3.5%)** | 1–2 (+ AWS 1c subnet work) | Low: bigger nodes = wider per-node blast radius |
| 5 | Root disk 100→50 GiB + diskCpuRatio 1 | timeAvgNodes × 50 GiB × $0.0939 | nodes 62.4 (cons, 16 vCPU/node) / 103.5 (real) | **$293 (1.2%)** | **$486 (2.0%)** | 0.5 (template edit) | Low: 50 GiB ≫ AL2023/pinned-AMI footprint; imagefs eviction 10% headroom intact |
| 6a | clusterLimits maxCores 16384→8000 | $0 direct (risk cap) | — | $0 | $0 | 0.5 | None |
| 6b | drainTimeout 600→1200s (evictor nodeGracePeriodMinutes 10→20) | $0 direct | — | $0 | $0 | 0.5 | Low: slower node reclamation |
| 6c | interruption prediction type (AWSRebalanceRecommendations deprecated Jul 2026 → CAST AI predictions) | $0 direct | — | $0 | $0 | 0.5 | None |
| 6d | IMDSv2 | $0 — **already compliant** (node config `imdsV1: false`) | — | $0 | $0 | 0 | None — verified done |
| 7 | Hibernation — **keep OFF** (decision) | counterfactual only: ≤68% of compute is night-window load | see §7 | $0 | $0 | 0 (decision) | n/a — rejected: night IS the burst |
| | **TOTAL quantified (naive)** | | | **$10,075 (42.4%)** | **$17,649 (74.2%)** | ~8–14 | |
| | spot↔WOOP overlap | WOOP$ × burstShare × movable × 62.8% | | −$969 | −$3,034 | | |
| | **TOTAL, overlap-adjusted** | | | **≈$9,106 (38.3%)** | **≈$14,615 (61.5%)** | | |

---

## 1. spot-batch template — the dominant lever

**Facts:** `spotInstances.enabled=false` (policies.json); `nodeCountSpot = 0` on all 30 daily history points; 100% of compute billed on-demand ($21,914.25 = `totalCostOnDemand`). Daily node counts swing 44 → 885 (deep-audit window; sister pull peaks 1019).

**Formula (billing-bounded):** `savings = compute$ × burstShare × movableShare × spotDiscount`

- Burst share — two independent derivations agree: **88.7%** time-weighted (1 − Σ min-baseline-provisioned/Σ provisioned) and **92.6%** peak-count (Σ(N−44)/ΣN over 30d; baseline B = 30d minimum 44 nodes).
- Burst compute $/mo: conservative 0.887 × $21,914.25 = $19,438; realistic 0.926 × $21,914.25 = $20,289.
- Movable share: 30% conservative / 60% realistic of burst compute suits spot (stateless batch/test jobs; stateful `integ-fts-logging-es`, valkey, PVC-pinned `scada-dp-server` excluded — brain note confirms zone-pinned PVC blocker).
- Discount: −62.8% (observed m6a.24xlarge in CAST AI pricing snapshot, brain note).
- **Conservative: $19,438 × 0.30 × 0.628 = $3,662/mo (15.4%) · Realistic: $20,289 × 0.60 × 0.628 = $7,646/mo (32.2%).**

**Sensitivity (basis honesty):** −62.8% is a *listing-relative* spot discount; Siemens' OD bill carries a 39.97% negotiated discount. If that EDP discount does not apply to spot usage, the net relative saving vs the current discounted OD bill narrows to 1 − (1−0.628)/(1−0.3997) = **38.0%** → $2,218 (9.3%) / $4,630 (19.5%). Either branch keeps spot the #1 or #2 lever; confirm discount applicability with AWS bill data before customer sign-off.

**Cross-checks (LISTING basis, never blended):**

| Scenario | Oct-4 snapshot (11 nodes, $3,398.53/mo list) | Oct-2 snapshot (78 nodes, $16,947.59/mo list) |
|---|---|---|
| SpotInstances (mixed) | −16.3% (−$553.60/mo) | −24.8% (−$4,210.92/mo) |
| SpotOnly (all-spot ceiling) | −57.6% (−$1,956.79/mo) | −73.0% (−$12,365.42/mo) |

My realistic $7,646 (discounted-bill basis) sits below the all-spot listing ceiling $12,365 and is in the expected band between SpotInstances and SpotOnly scenarios — ordering consistent across bases. Snapshots are point-in-time (11/78 nodes vs ~104 time-avg), so they bound, not replicate, the monthly model.

## 2. WOOP — enrich-analog cron waste

**Facts (workload-efficiency.json, 10,000 workloads):** Σ requested = 309.13 cores, Σ used = 16.78, Σ waste = **293.59 cores (95.0%)**. Named set (4 tenant namespaces `it-287129-73749567 / -73837899 / -73912266 / -73919606`):
- `enrich-analog-reindexation-cron`: 26.88 + 11.43 + 10.77 + 6.58 = **55.66 cores requested, 0.000 used**
- `enrich-analog-reset-offset-cron`: 12.23 + 8.12 + 7.72 + 6.21 = **34.29 cores requested, ≈0.53 used** (largest single workloads in the waste ranking; next bucket: `integ-fts-logging-es-default` 9.69 req/0.86 used, `argocd-application-controller` 8.65/1.79).

**Formula:** `recoverable$ = wasteCores × prov:reqFactor × $1.0427 × 30 × capture` (requests → provisioned inflation at 1.578, priced at frozen baseline — demand-side yardstick).

- Gross: 293.59 × 1.578 × $1.0427 × 30 = **$14,493/mo** of provisioned capacity serving ~zero usage.
- **Conservative capture 40% = $5,797/mo (24.4%) · realistic 60% = $8,696/mo (36.6%).**
- Capture <100% because: provisioned ≠ requested one-to-one (bin-packing granularity, node tax), and a safety buffer above ~0 usage is prudent (e.g. rightsize 26.9→8 cores, not →0.1).

WOOP agent itself is installed (v1.10.4 vs latest v1.14.1, `AGENT_STATUS_RUNNING`, in-place resize enabled) — the gap is the fixed request values in the cron manifests (Siemens-owned), not the tooling.

## 3. Evictor aggressive/manage + savings floor 5%→2% — QUALITATIVE (evidence-capped)

**Facts:** evictor `enabled=true` but `status=Incompatible, allowed=false` (self-managed chart, CAST AI can't manage it), `aggressiveMode=false`. Both rebalancing schedules (`ngm-integ-castai-hourly` 20% trigger; `ngm-integ-castai-postscale` 10% trigger) already run `minNodes=1`, `aggressiveMode=false`, `executionConditions.achievedSavingsPercentage=5`. The 2026-10-04 11:00 plan **failed with `achievedSavingsBelowThreshold`** — the optimizer, with perfect knowledge, could not find ≥5% savings on its 2 targeted nodes. ("Floor 5→2" read as that 5% threshold, since `minNodes` is already 1 everywhere; no other 5-valued knob exists in the data.)

**Why not dollarized:** the theoretical pool = provisioned-not-requested slack = (1020.5 − 646.7) vCPU × $1.0427 × 30 = **$11.7k/mo context**, but it is already claimed by change 2 (WOOP shrinks requests) and change 4 (fixed node tax ≈ $1.6k/mo of it), and the remainder is headroom/scheduling slack the converged on-demand curve cannot monetize — proven by the `achievedSavingsBelowThreshold` failures. Recoverable alone is unquantifiable without double-counting; floor 5%→2% only unlocks the marginal 2–5% savings band on targeted nodes. **Marked qualitative: $0 in totals.** Do it as an enabler (it keeps nodes packed so WOOP/tax wins actually land), not as a savings line. 49 of 78 snapshot nodes are ≤8 vCPU (63%) — the packing surface exists.

## 4. maxCpu 16→32 + minCpu 4 + AZ 1c — node-tax model

**Facts:** policies `nodeConstraints maxCpuCores=16, minCpuCores=0`; node config `kubeReserved cpu=1000m, systemReserved cpu=100m` → **fixed 1.086 vCPU *per node* tax** regardless of size (verified in resources: r6a.xlarge capacity 4000m/allocatable 2900m; snapshot-78: capacity 752 → allocatable 667 vCPU = **11.26% of CPU spend locked**, ≈ $1,640/mo). Current avg node = 9.64 vCPU. Bigger allowed nodes amortize the fixed reservation.

**Formula:** `saving = (1.086/9.64 − 1.086/avgNewSize) × cpuCost$14,558.85`

- Conservative avgNew = 12 vCPU/node: (0.1127 − 0.0905) × 14,558.85 = **$323/mo (1.4%)**
- Realistic avgNew = 19.3 (2:1 consolidation, e.g. m6a.8xlarge 32 vCPU entering the mix): (0.1127 − 0.0563) × 14,558.85 = **$821/mo (3.5%)**
- Deliberately conservative: the memory tax (2,747 → 2,100 GiB allocatable = 23.55%) is NOT monetized on top (would partially double-count the vCPU-priced model).
- minCpu 0→4 = guardrail against micro-nodes (t3.medium 2 vCPU would carry a 54% tax): hygiene, $0 separately.
- **AZ eu-central-1c (add 3rd subnet; today only 1a+1b, confirmed in node-config subnetDetails):** qualitative — deepens instance inventory; directly addresses the live `InsufficientCapacity` events (c5a.4xlarge OD add failure observed 2026-10-02) and is a hard prerequisite for healthy spot pools under change 1. $0 direct.

## 5. Root disk 100→50 GiB + diskCpuRatio 1

**Facts:** node config `minDiskSize=100, diskCpuRatio=0`, gp3, custom KMS. Derived gp3 price **$0.0939/GiB·mo** (storage cost $1,856.14 ÷ 19,768 avg GiB — derived from data as instructed; close to eu-central-1 gp3 list $0.0952, list-ish basis).

**Formula:** `saving = timeAvgNodes × 50 GiB × $0.0939`. Billing is on *concurrent* nodes: avgCpuCount 998.12 ÷ 9.64 vCPU/node = **103.5 nodes** (NOT the 593-node midnight average — those are daily peaks; using 593 × 50 × 0.0939 = $2,785/mo would exceed the cluster's *entire* storage bill $1,856 — rejected, see anomalies).

- Conservative (burst mix heavier, 16 vCPU/node → 62.4 nodes): 62.4 × 50 × 0.0939 = **$293/mo (1.2%)**
- Realistic: 103.5 × 50 × 0.0939 = **$486/mo (2.0%)**
- With `diskCpuRatio=1` and `minDiskSize=50`, every node ≤32 vCPU floors at 50 GiB; node consoles show allocatable ~91–96 GiB roots today (used ~0–11 GiB) → 50 GiB holds comfortably (kubelet `imagefs.available 10%` threshold intact).

## 6. $0-direct rows (mechanism one-liners)

| Row | Mechanism |
|---|---|
| clusterLimits 16384→**8000** | Pure spend guardrail: caps a runaway burst at 8000 × $0.486/vCPU·day ≈ **$3,890/day** instead of the meaningless 16,384 ($7,966/day) — no savings on its own, bounds worst case. |
| drainTimeout 600→**1200s** | Evictor `nodeGracePeriodMinutes` 10→20: fewer drain timeouts during big burst scale-downs → fewer stranded nodes kept by `keepDrainTimeoutNodes=false` retries and less duplicate provisioning churn. |
| Prediction type → CAST AI predictions | `AWSRebalanceRecommendations` is deprecated (Jul 2026): switching preserves/extends early spot-reclaim warning for change 1; cosmetic+protective. |
| IMDSv2 | **Already done** — node config `imdsV1: false` with hop limit 2; listed only to close the audit item. $0, no action. |

## 7. Hibernation — the quantified counterfactual that REJECTS it

Compute the upper bound of a "perfect" Mon–Fri 20:00→07:00 (55 h/wk) hibernate:

- Weekday-midnight node avg = **715** (n=21) vs weekend-midnight **309** (n=9); midday weekday snapshot = **78 nodes** (Oct-2 12:04Z) — the midday trough is real; the **peaks sit in the night window** (burst runs overnight).
- Night-window share of weekday compute ≈ (715 × 11h) / (715 × 11h + 150day × 13h) = **80.1%** (day level 150 = between observed 78 and conservative 250).
- Weekday share of monthly node-days = (21 × 715) / (17,799) = 84.4%.
- **Counterfactual max ≈ 0.801 × 0.844 = 67.6% of compute = ≈$14,816/mo (62% of total bill).**

**Conclusion — keep hibernation OFF:** the 68% "savable" night load *is* the test workload; hibernating it means not running the tests, and the burst calendar is unknown/uncontrolled. Organic idling already happens unprompted (weekend collapse 715→309; troughs to 44). The same burst-shaped spend is reachable *without* any schedule knowledge by spot (change 1) + WOOP (change 2) — combined realistic ≈ $16.3k/mo — which validates spot+WOOP dominating hibernation. Hibernation would only add value on the small non-burst idle margin that the autoscaler + empty-node downscaler (90s delay) already reaps.

---

## Totals & stacking

| | Conservative | Realistic |
|---|---|---|
| Quantified sum (changes 1+2+4+5) | $10,075/mo — 42.4% | $17,649/mo — 74.2% |
| Overlap: WOOP-shrunken burst footprint no longer available for spot discount | −$969 | −$3,034 |
| **Overlap-adjusted total** | **≈$9,106/mo — 38.3%** | **≈$14,615/mo — 61.5%** |
| Memo: EDP-doesn't-cover-spot branch | ≈$7,662/mo — 32.2% | ≈$11,599/mo — 48.8% |

Changes 3, 6, 7 = $0 in totals by design/evidence. Phasing: P1 = change 1 pilot + change 2 cron fixes (largest, independent); P2 = change 4/5 template edits; change 3 as enabler alongside; 6a–c hygiene with the same maintenance window.

## Anomalies & caveats

1. **Node-count history ≠ billing basis.** Midnight snapshots (avg 593 nodes) are burst *peaks*; time-weighted concurrent average is ~103.5 nodes (998 vCPU ÷ 9.64). Any model multiplying snapshot-node-counts by per-node prices overcounts ~5.7× (the rejected $2,785 disk number). Brief's prescribed formula was retained but bounded by the actual compute bill.
2. **Bursts run at night, not during business hours** (715 weekday-midnight avg vs 78 midday snapshot) — opposite of the usual office-hours hibernation story; drives the change-7 rejection.
3. **Basis risk on the spot discount:** −62.8% is listing-relative; if Siemens' 39.97% OD discount excludes spot, change 1 roughly halves ($2.2k/$4.6k). Confirm against CUR/billing before quoting customers.
4. **Estimated-savings pulls disagree with each other** (Oct-4: 11 nodes/$3.4k; Oct-2: 78 nodes/$16.9k — SpotOnly −57.6% vs −73.0%): both are listing snapshots of a fast-moving fleet; used only as ordering checks.
5. WOOP waste (293.6 of 309.1 cores) is dominated by idle cron Pods in 4 `it-287129-*` tenant namespaces; capture depends on Siemens accepting lower manifests (or enabling WOOP apply) — effort is political as much as technical.
6. `evictor status=Incompatible` means today's evictor is self-managed; CAST-managed install is a one-time operational decision (brain note: align chart values `maxTargetNodesPerCycle=5, cycleInterval=10m` for 500+ nodes, or hand management to CAST AI).
7. Realized 90d savings already 47.6% ($58.4k saved) — this model prices *additional* available savings on top of a fleet CAST AI has already crushed from its 2.20×-overprovisioned baseline.
8. Storage figure mix: $1,856/mo includes node roots (~104 × 100 GiB ≈ 10.4 TiB ≈ $976) + PVs/attached (~9.4 TiB ≈ $880); PV governance (integ side) is out of scope here but is the other half of storage spend.
