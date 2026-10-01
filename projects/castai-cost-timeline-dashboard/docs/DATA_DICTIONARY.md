# dataset2.json data dictionary

Produced by `scripts/build_dataset_v2.py` from `data/raw/**` (inventory + org + cluster snapshots).
Consumed by the web app: `public/data/dataset2.json` (index, 1.1 MB) + lazy `public/data/ts/<clusterId>.json` (13.5 MB total).
All money USD discounted basis; days are UTC calendar days.

## Bucket labeling (source of most warp in this data)

- per-cluster `/cost` & `/resource-usage` buckets are **end-labeled**: `timestamp 2026-08-01T00:00:00Z` = costs of 2026-07-31. App subtracts 1 day and drops today's partial bucket.
- org `daily-cost`, value-realization timelines, and monthly reports are **start-labeled** (timestamp = the day itself).
- org daily-cost is **authoritative & continuous** inside its coverage window: a missing cluster-day in it is IDLE $0, not a telemetry hole.

## top level

| field | note |
|---|---|
| `generatedAt` | snapshot time |
| `fee` | subscription model: `eurPerVcpuMonth=5`, frozen `fxUsdPerEur=1.10` → `usdPerVcpuMonth=5.50`, prorated by telemetried days |
| `reconcileTolerance` | 0.30 |
| `methodsCatalog[]` | id, tier 0–5, name, formula, explanation — rendered in-app & used by exports |
| `orgs[]` | id, name, parentId (129 rows) |
| `clusters[]` | one row per cluster (239) |

## clusters[] fields

| field | note |
|---|---|
| `clusterId/name/orgId/orgName/parentOrgId` | identity and rollups |
| `tier` | `B` deep (46): cost+RU+VR daily, WOOP metrics, events · `A` fleet (193): org daily-cost + monthly report + monthly VR |
| `isPhase2` | fleetile `cluster_agent.phase=phase2` or never-seen (null) |
| `switchDate/switchSource` | baseline-params periodEnd → vr first-savings-month → firstOperationAt |
| `baseline` | `from/to/days`, `pUsdPerVcpuDay`, `pCpuUsdPerVcpuDay`, `pMemUsdPerGibDay`, `cOtherUsdPerDay`, `unitPriceCV`, `ciHalfwidthPct`, `m2{a,b,c,r2,corr}|null`, `gapToSwitchDays`, `flags[]` |
| `methodsMeta` | M1{p,window,days} · TR{pCpu,pMem,cOther} · M2{a,b,c,r2} (only if gates pass) · M4{kappa0,o0} |
| `castBaselineParams` | copy of CAST AI's own baseline-params (PEER_CLUSTERS vs CLUSTER_HISTORY) |
| `policies` | enabled/spotEnabled/isScopedMode (deep tier) |
| `woop` | installedAt, currentVersion, optimizedWorkloads, totalWorkloads, $/h requested vs recommended |
| `timelineFile` | path to daily ts json |
| `monthly[]` | see below |
| `events[]` | normalized: woop-installed, rebalance-planned/rebalance, policy-enabled/change, woop-activity (deep tier) |
| `flags` | e.g. CALIBRATION_ASSUMED_X24 |

## clusters[].monthly[]

| field | note |
|---|---|
| `month, days, daysInMonth` | days = coverage days with real telemetry |
| `partial` / `idle` / `estimated` / `fromOrgReport` | month classification; estimated months carry no savings math anywhere |
| `actualCost, avgVcpu, avgRamGib` | facts |
| `feesUsd` | CAST AI subscription fee for the month: $5.50 × avgVcpu × (covered days / days-in-month) |
| `M0/M1/TR/TR30D/WMAX/TRW/REQ/M2: {adjusted,gross,fee,net}\|null` | per method; for REQ `adjusted`/`gross` are **compute-only** (actual = cpuCost+memCost) | `fee` same month fee (WMAX prorated by WOOP-covered days); null = n/a. TR30D `adjusted` = 30 × trailing ≤30-telemetried-day avg · WMAX `adjusted` = Σ WOOP-hours baseline |
| `M4: {woopDemand,nodePacking,priceEffect,gross,net}\|null` | deep tier + WOOP era only |
| `castRealizedSavings` | reference ($ projected−actual, CAST counterfactual) |
| `flags[]` | PARTIAL_MONTH · IDLE_MONTH($0) · ESTIMATED_NO_DATA · SWITCH_MONTH · CROSSCHECK_OUT_OF_BAND |

## ts files (daily arrays)

| field | note |
|---|---|
| `date` | calendar day |
| `actualCost, vcpu, ramGib, cpuCost, memCost` | merged precedence: /cost > value-realization > org daily-cost (cost only) |
| `castActual/project*/…Savings` | value-realization daily (deep tier) |
| `reqCpu / origReqCpu / usedCpu` | request cores / **organic demand** (pre-WOOP original request) / usage — sources WOOP metrics (≤60d) then cost-family resource-usage (pre-WOOP era) |
| `adjM1/adjTR/adjTR30D/adjM2, grossM0, unitPrice` | per-day method arithmetic; `adjTR30D` = trailing ≤30d average daily cost (the rolling baseline line) |
| `tr30dSplit` | `{cpu, mem, other, windowDays}` — rolling window composition, per day |
| `wmaxBaseline` / `wmax` | daily WA-aware counterfactual; `wmax` = `{refCpu, refMem, oCpu, oMem, pCpuUsed, pMemUsed, hours}` |
| `adjTRW` / `trw` | TR with WA demand floor: baseline = p_cpu×max(V, O_cpu×max(R_orig,R_cur)) + p_mem×max(RAM, O_mem×max(R_mem_orig,R_mem_cur)) + c_other; floor arms only when orig > cur×1.02; `trw` = `{vRef, mRef, refCpu, refMem, floorCpu, floorMem}`; tier-A report-grain months: TRW ≡ TR |
| `layers` | `{woopDemand, nodePacking, priceEffect, organicDemandVcpu}` — telescopes to p·o0·r_org − c ≤ $0.01/day |
| `source` | which endpoint provided cost |
| `idle` | provably $0 inside org coverage |

## Export schema

CSV and XLSX contain: README/method catalog + parameters per cluster + monthly-all-methods + daily (all method columns) + events. See `src/export.ts` — header rows define the exact column order.
