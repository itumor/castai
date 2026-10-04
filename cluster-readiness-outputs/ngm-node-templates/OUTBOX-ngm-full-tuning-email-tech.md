# DRAFT EMAIL — to NGM platform/engineering (draft only; human reviews & sends)

**To:** NGM platform team
**Cc:** Paul Till
**Subject:** CAST AI tuning recommendations for ngm-helios / integ / kronos — full change list, per cluster, P0 first actions

---

Hi team,

following our cost review of the three NGM EKS clusters (live CAST AI data as of 2026-10-04), here are the recommended changes — what changes, why, and why those values. Everything applies to **newly provisioned nodes only** and rolls out with your existing nightly/partial rebalancings. Two fixes (marked P0 below) come first because they correct a real pod-networking bug.

## The core bug we want closed first (all 3 clusters)

Your node configurations force a **static kubelet `maxPods: 55`** on every node, but the AWS VPC CNI limits pods per node by network interfaces: `maxPods = ENIs × (IPs_per_ENI − 1) + 2`. Your ten `r6a.large` nodes (helios 8, kronos 2) can only wire **29** IPs, while kubelet promises 55 — pods can be scheduled that never get an IP address. Conversely your 154 4xl nodes (ceiling 234) get capped at 55. Current density is only ~14 pods/node, so this is a latent race, not an active incident — but it's one bad day away.

**Fix:** remove `maxPods` from kubeletConfig; set `eks.maxPodsPerNodeFormula = math.least(NUM_MAX_NET_INTERFACES * (NUM_IP_PER_INTERFACE - 1) + 2, 110)`. Cap 110 ≈ 8× observed density (AWS's own stability ceiling is 250). Longer term, prefix delegation (`…*NUM_IP_PER_PREFIX…, 300`) is the growth story; subnet utilization today is only ~13% (helios) / ~2% (integ+kronos, shared /17s).

## Change table — per cluster

### ngm-helios-eks (production, $53.4k/mo, ~300 nodes, 40–574 range in 30d)

| Change | Why / evidence |
|---|---|
| `maxCpu: 16 → 24` (32 after a week of observation) | per-node system tax ≈ 15% of provisioned CPU at ~6.6 vCPU/node; bigger nodes amortize it, same 234-pod ENI ceiling until 16xl |
| `minCpu: unset → 4` | retires the 29-IP `r6a.large` class (the maxPods mismatch above) |
| maxPods 55 → formula (see P0) + `minDiskSize 100→50`, `diskCpuRatio 1` | 300×100 GiB gp3 ≈ $2.4k/mo mostly idle → **~$1.1k/mo** saved; 16 vCPU node keeps 64 GiB via ratio |
| AMI pinned ID `ami-0706179e…` → **keep your golden AMI**, referenced by **name search string** (e.g. `<your-ami-name>-{k8s_version}-v*`) + set `eks.imageFamily: FAMILY_AL2023` explicitly | pinned IDs age silently; a name pattern makes CAST AI resolve the **newest golden build per k8s version** (arch-filtered) at every provisioning. Explicit imageFamily is required for custom AMI names so userdata/bootstrapping is generated correctly. If the golden line is still AL2-based, note your kubeReserved/evictionHard are **silently ignored on AL2** — rebuild on AL2023 (also unlocks Container Live Migration); Bottlerocket is the alternative (Nitro-only, no CLM). Validate the custom initScript on the new base (test on integ first) |
| AZs + eu-central-1c (new subnet required on our side) | live `InsufficientCapacity` on c5a.4xlarge captured under the 2-AZ squeeze; also more pod-IP space |
| Exclude `c5a/c5ad`, newest-gen priority tier | 46 of 300 nodes are 5th gen; they roll out naturally at rebalances |
| `clusterLimits.maxCores: 16384 → 6000` | 16384 never trips; 6000 ≈ 3× observed peak request (2,052 vCPU) — real runaway brakes |
| Evictor → **CAST-managed** (`managedByCASTAI=true`), `cycleInterval 1m→10m`, `maxTargetNodesPerCycle 20→5` | "Incompatible" status blocks all console tuning; 574-node peaks belong to CAST AI's 500+ sizing row |
| Rebalancing: `evictGracefully: true`, keep 5% floor | cordon-then-keep instead of forced drains on prod |
| Spot: **hold** | prod + PDB audit not done + evictor not yet managed; modelled ceiling −64.3% waits for the later namespace pilot |
| Hibernation: never (production) | — |
| WOOP: upgrade v1.10.4→v1.14.1; unblock `resourceQuotasAffectingOptimization`; accept recommendations on top workloads | 875 of 939 requested cores wasted (93%); `argocd-repo-server` reserves 24.2 cores, uses 0.2 → ≈ **$10–15k/mo** idle compute |

### ngm-integ-eks (burst test, $23.8k/mo, 44→885 nodes in 30d)

| Change | Why / evidence |
|---|---|
| `maxCpu: 16 → 32`, `minCpu → 4`, +AZ 1c, AMI/disk/maxPods formula as above | daily bursts are where density pays; subnets **shared with kronos** (2×/17) — 1c relieves both |
| Evictor `aggressiveMode: true` (acceptable in test) — or scoped `disposable` selectors on `it-*` batch namespaces | single-replica test pods are the packing blockers |
| Rebalancing min savings `5% → 2%` | plans currently **fail** with `achievedSavingsBelowThreshold` (the 11:00 run on 2026-10-04, and regularly) — 5% drops real micro-wins here |
| **NEW node template `spot-batch`**: `spot: true, onDemand: true, useSpotFallbacks: true, fallbackRestoreRateSeconds: 300, enableSpotReliability: true (+20%), spotInterruptionPredictionsEnabled (CAST AI model), shouldTaint: true, maxCpu 32, minCpu 4, cpuLimitMaxCores 6000`, AZs a/b/c | 44→885 daily burst = textbook spot profile; our own snapshot: m6a.24xlarge **−62.8%** vs on-demand; SpotOnly ceiling −57.6%. Workloads opt in via `nodeSelector scheduling.cast.ai/node-template: spot-batch` + toleration; default template untouched |
| `clusterLimits.maxCores: 16384 → 8000` | ≈ 1.15× worst observed burst |
| Hibernation: **off** (revisit only with a test calendar) | unscheduled overnight runs would be killed |
| WOOP on top offenders: `enrich-analog-reindexation-cron` (up to 26.9 cores reserved, 0 used) | 294/309 cores wasted (95%) → ≈ **$5–8k/mo** |
| Housekeeping: bump `drainTimeoutSec 600 → 1200`; replace deprecated prediction type `aws-rebalance-recommendations` → CAST AI model | drain timeout is 600 today (confirmed live); prediction signal deprecated Jul 2026 |

### ngm-kronos-eks (dev, $2.3k/mo, 3–104 nodes in 30d)

| Change | Why / evidence |
|---|---|
| `minCpu: unset → 4` | **this one value retires the two 29-IP r6a.large nodes** |
| `maxCpu: 16 → 24`, AMI/disk/maxPods formula, exclude c5a, `clusterLimits → 1500` | 1500 ≈ 2× worst observed burst |
| Evictor: keep 1m / 20 (default) | 104-node peak < 200 — docs sizing says defaults are right |
| Rebalancing floor `5% → 2%` | threshold skips are eating all plans (`achievedSavingsBelowThreshold`) |
| **Weekend hibernation pilot**: pause `0 20 * * FRI`, resume `0 7 * * MON` Europe/Berlin; resume node `m6a.xlarge`, on-demand, eu-central-1a | live Sunday data: 3 nodes / ~14 vCPU — weekends already ~idle; ≈ 59 h/wk ≈ 35% of compute ≈ **~$0.7k/mo**. Prerequisites (cluster onboarded 2025-09-30): re-run Phase-2 onboarding or TF provider ≥ v7.74.0 for hibernation IAM permissions; set `eks.nodeGroupArn` on the default node configuration **if** node auth is aws-auth; verify `CriticalAddonsOnly` tolerations; PVs keep billing during hibernation |
| Spot Phase-2: default template `spot: true` + fallbacks | highest tolerance of the three; SpotOnly ceiling **−84%** |
| Confirm weekend idleness with the team before enabling hibernation | — |

### All three (shared)

| Change | Why |
|---|---|
| `imdsV1: false` | IMDSv2-only hardening (already the stated intent) |
| Import Savings Plans/RIs/ODCRs into CAST AI (please confirm with FinOps) | reservations are empty in CAST AI → packing is blind to your discounted inventory |
| Upgrade cast-agent v0.161.1 + WOOP v1.14.1 on the normal train | — |

## Suggested sequence

1. **P0 (all 3):** maxPods formula fix — integ first, kronos, helios one rebalance cycle apart.
2. **P1 (integ):** AL2023 + init-script validation, evictor ownership decision, `spot-batch` template, 2% rebalancing floor.
3. **P1 (kronos):** hibernation prerequisites, then one pilot weekend.
4. **P2 (all):** maxCpu/minCpu/AZ/family changes; helios last after a week of integ data.
5. **P3:** helios spot namespace pilot (after PDB audit), ARM template for multi-arch services, commitments import.

Known constraints we designed around: evictor currently self-managed on all three; removal-disabled nodes (helios 2, integ 1, kronos 1) exclude themselves from rebalances; zone-pinned PVCs (`scada-dp-server`, `valkey`, integ) block specific nodes until a storage topology decision.

Happy to jump on a call to walk through the spot-batch pilot sizing or turn any of these into Terraform.

Best regards,
[CSM / CAST AI]

---

*Appendices available: raw per-cluster JSON payloads, live audit data (17 endpoints × 3 clusters, 2026-10-04), and per-cluster PDF dossiers.*
