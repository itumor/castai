# ngm-kronos-eks — Costed Impact Model (per change)

- **Cluster:** ngm-kronos-eks `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` · AWS eu-central-1 · org SI GSW CLO `07aa3c29-3e1f-44bc-ad60-ceedb878d99a`
- **Model author:** read-only analyst session, 2026-10-04/05. No POST/PUT/PATCH/DELETE issued; all inputs from local API dumps.
- **Anchor window:** 2026-09-05 → 2026-10-04 (30d, Oct-4 deep-audit pull). 30d bill = **$2,177.32** (CPU $1,233.28 + RAM $618.11 + EBS $325.93). All % below are vs **$2,177**.
- 30d node range: **3 – 104** (node-count-history). ~14-node snapshot fleet: 9× 4xlarge (m6a/c6a/r6a 16 vCPU) + 2× r6a.large + m7a.xl + m6a.2xl + c5a.2xl.

---

## Methodology block

1. **Two price bases, never blended.**
   - **Frozen baseline basis:** $1.2030 /vCPU·day, kronos baseline unit price frozen in `brain/notes/SI GSW CLO NGM Clusters.md`. ⚠ **LOW CONFIDENCE: n=37 baseline days** — recheck after next Savings-Report baseline refresh. Frozen baselines are discounted-historical rates used for Savings-Report projection, not today's effective price.
   - **Listing basis:** CAST AI `estimated-savings` recommendations (SpotOnly/SpotInstances/Layman) are **listing-price, point-in-time snapshot** math (fleet as of fetch hour). Kept in separate labelled rows; **not blended** into frozen-basis figures.
   - **Current-effective cross-check (derived):** 30d cost report ÷ 30d vCPU-days → CPU-only **$1,233.28 / (2,447.563 vCPU-days) = $0.5039 /vCPU-day** (= efficiency API `costPerCpuProvisioned` $0.020995/h × 24 ✓). Frozen $1.2030 is **2.39×** the current effective rate → every frozen-basis row overstates cash; each big row therefore also shows a current-basis variant.
2. **EBS gp3 rate derived from data** (not assumed): Σ `totalStorageCost` $325.93 ÷ Σ `storageGib` 104,136.98 GiB-days = $0.003130 /GiB-day → **$0.0939 /GiB-mo**, consistent with efficiency API `costPerStorageGibProvisioned` $0.000130/h ✓ (AWS gp3 eu-central-1 list ≈ $0.085–0.095; derived value used everywhere). Fallback assumption "$0.088 /GiB-mo" **not needed** — data present.
3. **Weekend identification:** daily node-count rows labelled by `timestamp 00:00Z`; Sat/Sun rows observed at the 3–5 node floor on all four complete weekends in-window (Sep 5–6, 12–13, 19–20, 26–27; confirmed by calendar). Data is **daily grain** → intra-day timing of the Friday-evening collapse cannot be resolved (see Anomaly A4).
4. **Non-additivity:** rows attack overlapping capacity (hibernation ↔ WOOP ↔ spot all shrink the same idle-standby fleet). Frozen-basis totals exceed 100% of the bill — arithmetically impossible as-realized — so treat the totals row as an **illustrative ceiling**, not a claim.
5. **Units:** vCPU·day = 1 vCPU provisioned for 24 h. Weeks/month = 365.25/7/12 = 4.3452. Effort figures are analyst T-shirt estimates, labelled.
6. SpotSavings = **$0 across all 90 days** (`savings-90d.json`); realized savings 100% downscaling ($6,400.51/90d) → spot flip is genuinely new money, not a re-measure.

---

## Summary table

*Basis code:* **F** = frozen $1.2030 · **C** = current-effective $0.5039 · **L** = listing snapshot. All rows F unless marked.

| # | Change | Formula (→ $/mo) | Inputs | Conservative $/mo (%) | Realistic $/mo (%) | Effort (eng-days, est.) | Risk |
|---|--------|------------------|--------|----------------------:|-------------------:|:--:|------|
| 1 | Weekend hibernation (Fri 20:00→Mon 07:00) | `wkndNodeH/wk × 4.3452 × vCPU/node ÷ 24 × 1.2030 − resume` | window 1,029.25 node-h/wk; 1.5217 vCPU/node; floor 3 nodes × 59 h | **$341.0 (15.7%)** — full observed window | **$282.3 (13.0%)** — above 3-node floor | 2–3 | Med (PV-pinned pods, Mon resume) |
| 2 | Spot phase-2 flip (spotInstances.enabled=true) | `81.585 vCPU × 1.2030 × 30 × movable% × 62.8%` | baseline $2,944.40/mo; movable 70/90%; −62.8% | **$1,294.4 (59.5%)** @70% | **$1,664.2 (76.4%)** @90% | 0.5–1 | Med-low (backups+predictions already on) |
| 2x | ↳ same flip, current-spend basis **(recommended claim)** | `$1,851.39 compute × movable% × 62.8%` | 30d CPU+RAM $1,851.39 | $813.9 (37.4%) | $1,046.4 (48.1%) | — | — |
| 2y | ↳ CAST AI ceiling, **listing snapshot — do not blend** | `priceBefore − priceAfter` | snapshot Fri 10-02 | SpotInstances **−$344.0 (−68.52%)** | SpotOnly **−$422.0 (−84.04%)** | — | snapshot ≠ 30d avg |
| 3 | WOOP request-rightsizing | `38 cores × (81.585/55.7) × 1.2030 × 30 × capture%` | waste 37.96 / req 40.50 cores; gross $2,009.2 | **$803.7 (36.9%)** @40% capture | **$1,205.5 (55.4%)** @60% | 3–5 | Low-med (1,558 workloads; in-place resize on) |
| 3x | ↳ cross-check: CAST AI measured waste cost-impact | Σ workload-efficiency `costImpact.onDemand` | 1,558 workloads | — | **$927.2/30d (42.6%)** | — | OD basis |
| 4 | minCpu 4 / maxCpu 24 / disk 50 / c5a-exclude | disk: `avgNodes × 50 GiB × $0.0939` | avg 53.60 nodes; minDiskSize 100→50 | **$125.8 (5.8%)** @50% first-month capture | **$251.6 (11.6%)** full fleet rotation | 0.5–1 | Low (50 GiB disk-pressure = med-low) |
| 5 | clusterLimits 1500; rebalancing floor 2%; golden AMI+AL2023; IMDSv2; prediction-type | — | guardrails/hygiene | **$0 direct** | **$0 direct** | 0.25–0.5 each | None/low |
| 6 | Shared /17 subnets with integ (IP headroom) | — | 2× /17 = 65,534 IPs | qualitative | qualitative | 0.5 (verify integ use) | watch item |
| **Σ** | **Totals (illustrative ceiling, NOT additive)** | | | **$2,564.9 (117.8%)** | **$3,403.6 (156.3%)** | ~7–11 | see §Stacking |

**Current-basis stack (recommended cash claim):** 341.0 + 813.9 + 336.6 + 125.8 = **$1,617.3/mo (74.3%)** conservative · 282.3 + 1,046.4 + 504.9 + 251.6 = **$2,085.2/mo (95.8%)** realistic — still overlap-inflated; see §Stacking. First-90-day defensible range: **$1.2–1.6k/mo (55–75%)**.

---

## 1 — Weekend hibernation (Fri 20:00 → Mon 07:00, 59 h/wk)

**Observed daily node counts** (node-count-history, 4 complete weekends):

| Weekend | Fri | Sat | Sun | Mon | Window node-h = 4·Fri + 24·Sat + 24·Sun + 7·Mon |
|---|---:|---:|---:|---:|---:|
| Sep 4–7 | 59 | 3 | 3 | 91 | 236+72+72+637 = 1,017 |
| Sep 11–14 | 99 | 3 | 3 | 94 | 396+72+72+658 = 1,198 |
| Sep 18–21 | 97 | 5 | 3 | 79 | 388+120+72+553 = 1,133 |
| Sep 25–28 | 61 | 4 | 3 | 51 | 244+96+72+357 = 769 |
| **Avg** | 79.00 | 3.75 | 3.00 | 78.75 | **1,029.25 node-h/wk** |

- vCPU/node (blended) = avg cpuProvisioned ÷ avg node count = (2,447.563/30) ÷ (1,608/30) = 81.585 ÷ 53.60 = **1.5217**.
- **Conservative (weekend nodes at observed avg — full window credit):** 1,029.25 × 4.3452 = 4,472.3 node-h/mo × 1.5217 = 6,805 vCPU-h ÷ 24 = 283.6 vCPU-days × $1.2030 = $341.1 − resume overhead **$0.15** → **$341.0/mo (15.7%)**.
- **Realistic (weekend nodes trend low ~3 — keep 3-node floor):** (1,029.25 − 3×59) = 852.25 node-h/wk × 4.3452 = 3,703.2 node-h/mo × 1.5217 ÷ 24 = 234.8 vCPU-days × $1.2030 = $282.5 − $0.15 → **$282.3/mo (13.0%)**.
- **Resume overhead:** 1× m6a.xlarge (4 vCPU) on-demand ~10 min/wk = 4 × 0.1667 h × 4.3452 = 2.90 vCPU-h/mo × $0.0501/vCPU-h = **$0.145/mo ≈ negligible** ✓ subtracted.
- **PV/EBS persists:** claimed volumes (~3.03 TiB, $325.9/mo) keep billing through hibernation — *not* part of the saving.
- Supplementary (not in headline): root volumes die with nodes → 4,472.3 (3,703.2) node-h/mo × 100 GB ÷ 730 h × $0.0939 ≈ **+$57.5 (+$47.6)/mo** more.
- Mechanism risk: zone-pinned PVC pods (scada-dp-server, valkey — see brain note) must survive as the 3-node floor; Monday 07:00 resume should pre-warm ~15 min early.

## 2 — Spot phase-2 flip

Flow: `policies.spotInstances.enabled=false` today (spotBackups ON, interruption predictions ON = AWSRebalanceRecommendations). Movable share 70% (conservative) / 90% (realistic) — dev cluster, PDB/PV-pinned stragglers capped.

- Baseline = 81.585 vCPU × $1.2030 × 30 = **$2,944.40/mo**.
- Conservative: 2,944.40 × 0.70 × 0.628 = **$1,294.4/mo (59.5%)**.
- Realistic: 2,944.40 × 0.90 × 0.628 = **$1,664.2/mo (76.4%)**.
- ⚠ −62.8% is the **m6a.24xlarge spot-vs-OD snapshot** observed in the CAST AI offering feed (brain note) — a single instance-type observation; blended kronos discount will differ (m6a/c6a/r6a mix, eu-central-1 depth). Label: observed-discount proxy.
- **Cross-checks (labelled, not blended):**
  - Current-spend basis: $1,851.39 × 0.70/0.90 × 0.628 = **$813.9 / $1,046.4 (37.4% / 48.1%)** ← recommended cash claim.
  - Listing snapshot (10-02, 67-node fleet, `priceBefore` $502.07): SpotOnly → $80.12 (**−84.04% = −$422.0/mo**); SpotInstances → $158.07 (**−68.52% = −$344.0/mo**); Layman −62.40%. Snapshot ≠ 30d-average fleet → understates against this bill.

## 3 — WOOP (workload rightsizing)

Measured (`workload-efficiency.json`, 1,558 workloads): **waste 37.96 of 40.50 requested cores** ("38/41" ✓), usage 3.28 cores, RAM waste 52.6 GiB (payload `memoryGib` is MiB-scale).

- Gross = 38 × (81.585/55.7 = **1.4651**) × $1.2030 × 30 = **$2,009.2/mo**.
- Conservative @40% capture: **$803.7/mo (36.9%)** · Realistic @60%: **$1,205.5/mo (55.4%)**.
- Cross-check: CAST AI's own Σ `costImpact.onDemand` = **$927.2/30d** — same order (ratio to my gross = 2.17 ≈ frozen/current rate ratio 2.39 ✓ internally consistent).
- Why not tiny here: requests — not usage — drive node count (prov:req 1.45); the 40.5 idle-standby requested cores are what hold 50–100 weekday nodes alive. In a 94%-idle dev cluster, request waste *is* the bill. Still a hygiene-first move: WOOP agent v1.10.4 running, in-place resize enabled, HPA supported.
- ⚠ Parent brief expected "tiny in $" — **formula contradicts; flagged as Anomaly A2**. Treat as hygiene move in manner, not in magnitude.

## 4 — minCpu 4 / maxCpu 24 / disk 50 / c5a exclude

- **disk 50 (the only $ row here):** current `minDiskSize=100` (GB) → 50. `53.60 avg nodes × 50 GiB × $0.0939/GiB-mo = $251.65/mo` full rotation (11.6%); **conservative $125.8/mo (5.8%)** at 50% first-month capture (root-disk changes only affect newly created nodes; fleet turns over via autoscaler churn). Root volume only — PVC EBS untouched. Risk: evictionHard `nodefs.available 10%` ⇒ 5 GiB trigger on 50 GB; image-heavy nodes → disk-pressure watch.
- **minCpu 4:** current constraint min 0. Excludes 2-vCPU r6a.large standbys — but those are the cheap 3-node weekend floor; near-zero $ (could marginally *raise* floor cost). Mechanism: fewer tiny sockets, better bin-packing.
- **maxCpu 24:** current max 16; raising does nothing on a fleet whose largest type is 16 vCPU. $0 — future-proofs 24/32-vCPU spot capacity.
- **c5a exclude:** exactly 1× c5a.2xlarge in fleet → near-zero $; mechanism: Zen2 vs Zen3 generation parity, predictable per-core perf.

## 5 — $0-direct rows (mechanism, one line each)

| Change | Mechanism |
|---|---|
| clusterLimits 1500 | Caps worst-case spend at 1,500 × $1.2030 × 30 = **$54.1k/mo theoretical ceiling** (vs current 16,384 ceiling) — blast-radius guardrail for runaway HPA/deploys; peak observed ≈ 176 vCPU so no operational impact. |
| Rebalancing floor 2% | kronos already skips with `achievedSavingsBelowThreshold` (benign); a 2% minimum-savings floor formalizes it: no node-replacement churn (drain time, image pulls, warm caches) for sub-2% wins. |
| Golden AMI + AL2023 | Current AMI `ami-0706179e8561145ae` already AL2023 (NodeConfig init script) with Siemens agents; standardizing keeps boot fast (less pending-time waste) and patching clean. $0 direct. |
| IMDSv2 | **Already enforced** (`imdsV1=false`, hop=2) — verify-only, security baseline, $0. |
| Prediction type | Spot interruption predictions already on (AWSRebalanceRecommendations); changing type only alters reclaim-timing behavior once spot is enabled — $0 today, revisit with flip. |

## 6 — Shared /17 subnets with integ (qualitative)

kronos templates use `10.47.0.0/17` + `10.47.128.0/17` (65,534 IPs, shared with integ per brief). Peak 104 nodes × maxPods 55 ≤ ENI caps (e.g. 4xl = 240 IPs/node) → worst-case kronos draw ≈ **25k IPs (~38%)** before integ's share and AWS's 5 reserved/subnet. Consequence: **headroom OK for hibernation/spot flips, but verify integ consumption before treating clusterLimits 1500 as usable**; consider prefix-delegation or dedicated subnets if integ grows. No dollars assigned.

---

## Stacking & overlap

1. Hibernation and WOOP attack the same idle-standby capacity (weekend floor + request waste): applying both ≠ sum.
2. Spot discount then applies to the *remaining* capacity; each earlier lever shrinks the spot row's base.
3. Frozen-basis totals (117.8%/156.3%) exceed 100% of the bill → ceiling illustration proving the frozen rate overstates cash on an already-optimized fleet.
4. Defensible first-90-day cash range: **$1.2–1.6k/mo (55–75%)**, anchored on current-basis spot ($0.8–1.0k) + hibernation ($0.28–0.34k) + WOOP partial capture at current rate ($0.34–0.50k) + disk ($0.13–0.25k), minus overlap.

## Anomalies

- **A1 — frozen rate 2.39× current effective** ($1.2030 vs $0.5039/vCPU-day) and kronos baseline n=37 days (LOW confidence): every F-basis row is an upper bound; C-basis variants supplied for the big rows.
- **A2 — WOOP is NOT tiny** (parent brief expected tiny): 40.5 requested cores drive the whole weekday fleet; formula yields the largest row. Magnitude confirmed by CAST AI costImpact $927/30d.
- **A3 — estimated-savings is a Friday-low snapshot** (priceBefore $502/mo on a 67-node/-168-vCPU moment) on listing basis vs this 30d-average model; brain note's org-level "kronos SpotOnly −$2.6k/mo" is yet another snapshot/basis → three non-comparable spot ceilings; table keeps them separate.
- **A4 — daily-grain node data** cannot resolve *when* Friday the fleet collapses; if it already collapses ~Fri 20:00 on its own, hibernation's incremental lands at/below the realistic figure (and part may already sit inside 90d downscaling savings $6.4k).
- **A5 — source windows differ by 1–2 days** (Oct-2 pull 09-02→10-01: avg cpuProv 85.83; Oct-4 pull 09-05→10-04: 81.585 — brief's "81.6"); all math anchored on the Oct-4 window matching the $2,177 bill; node-config/policies as of Oct-2 pull.
- **A6 — pricing-source divergence:** nodes-pricing API CPU $0.04484/vCPU-h vs cost-report implied $0.0206 (2.1×); trusted the cost report (realized spend); reinforces frozen-baseline anchoring.
- **A7 — CAST AI payload unit quirks:** workload-efficiency CPU fields are millicores and `memoryGib` carries MiB-scale values; `costOnDemand`/`storageCost` are hourly rates while `total*` fields are daily sums (24× relationship verified numerically).
- **A8 — 1,558 "workloads"** in efficiency payload for a dev cluster (likely controller-level expansion) — inflates WOOP review effort; capture% deliberately set 40/60.

## Data provenance

`cluster-readiness-outputs/ngm-node-templates/deep-audit-2026-10-04/kronos/` (cost-30d, node-count-history, resource-usage-30d, estimated-savings, workload-efficiency, efficiency, woop) · `cluster-cost-analysis/ngm-kronos-eks/` (node-config-688b…, policies, nodes, nodes-pricing, nodes-storage, savings-90d) · `brain/notes/SI GSW CLO NGM Clusters.md` (frozen $1.2030 n=37, −62.8% m6a.24xl, prov:req 1.45). No API writes; no secrets printed.
