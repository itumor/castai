# SI GSW CLO — NGM EKS clusters (helios / integ / kronos)

Learned 2026-10-02 from a full read-only API audit (cost, savings, config, nodes, plans, audit log). Full report: `.kimchi/docs/si-gsw-clo-ngm-cost-savings-analysis-2026-10.md`. Raw API evidence: `cluster-cost-analysis/ngm-*/` (~73 JSON files). Monthly table: `.kimchi/docs/si-gsw-clo-ngm-savings-clustermonth.csv` (regenerate with `scripts/savings/savings_report.py --org-id 07aa3c29-3e1f-44bc-ad60-ceedb878d99a --cluster 419c39e4 --cluster 1ad1a0bf --cluster 6d20eb8e`).

## Identity

- Org **SI GSW CLO** `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` (EU base). ~20 clusters, ~$161k/mo W30, **100% on-demand org-wide (spot $ = 0 on every cluster)**.
- All three NGM clusters: EKS eu-central-1, AWS account `600442974479`, onboarded 2025-09-30, `isPhase2=true`, agents online.
  - `ngm-helios-eks` `419c39e4-66bf-4d61-b833-4562968a61c7` — autoscaler live 2026-07-20; ~300 nodes; $53.4k/mo (33% of org).
  - `ngm-integ-eks` `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` — live 2026-04-27; bursts 44→838 OD nodes/day (test workload); $23.8k/mo.
  - `ngm-kronos-eks` `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` — live 2025-11-06; 14 nodes; weekend collapse to ~14 vCPU; $2.3k/mo.
- **No Karpenter** anywhere (0 `karpenter.sh` labels on 392 nodes) — CAST AI provisions ~95% of nodes itself (`addedBy: internal|autoscaler`).

## Savings proof (the "customer says no savings" rebuttal)

Three numbers, never blend, always show the range:

| Cluster | CAST AI realized (own API, ~mo) | Conservative M1 net (frozen baseline, 5% fee) | ER (current ÷ baseline unit price) |
|---|---|---|---|
| helios | $20.2k | $7.1k | 0.86 |
| integ | $19.5k | $8.9k | 0.70 |
| kronos | $2.1k | $1.1k | 0.62 |

- W90 realized Σ $125.6k, **100% downscaling, $0 spot**. Frozen prices: helios $0.9823, integ $1.0427, kronos $1.2030 $/vCPU·day (kronos n=37 baseline days → lower confidence).
- `baseline-params` (switch dates + overprovisioning factors): helios 1.60×, integ **2.20×**, kronos **5.25×** — the crushed idle-standby fleets are the realized savings.
- Customer sees "nothing" because demand grew (helios 1759→1991 vCPU MoM; integ daily swings) — absolute bill grows while unit price falls. Ship the 3-column table (actual | frozen-baseline | CAST AI realized) every review.

## Verified config findings (all three share the same DNA)

- **`spotInstances.enabled=false`** everywhere — the #1 lever. Spot backups + interruption predictions already configured; just flip. Live spot discounts observed in CAST AI snapshot: m6a.24xlarge −62.8% vs OD. Modeled offer (fallback on, integ first): S1+S2 ≈ **$27.7k/mo** (range $19–36k). CAST AI SpotOnly ceilings (listing basis): helios −$48.4k, integ −$12.4k, kronos −$2.6k /mo.
- **Evictor `status=Incompatible, allowed=false` on all three** = the documented "Evictor installed but not managed by CAST AI" self-managed detection. Fix = `managedByCASTAI=true` upgrade or align self-managed chart values (500+ nodes: `maxTargetNodesPerCycle=5`, `cycleInterval=10m`). Nightly scheduled rebalancing (`ngm-helios-castai-hourly-nightly` etc.) currently substitutes for bin-packing.
- `removal-disabled` nodes: helios 8, integ 10, kronos 1 — each freezes an instance and blocks packing.
- **Only 2 AZs** (eu-central-1a/1b subnets) → thin on-demand pools (live `InsufficientCapacity` on c5a.4xlarge add captured in integ audit 2026-10-02) + shallow spot inventory. Adding 1c is a P1.
- Node configs: gp3 ✓, IMDSv2 ✓, containerd ✓, custom KMS ✓ — but **pinned AMI `ami-0706179e8561145ae`** (no image family; ages; CLM needs AL2023), default 100 GiB roots, `clusterLimits.maxCores=16384` (meaningless ceiling; integ needs a real burst guardrail).
- Instance mix amd64-only (zero Graviton); leftover **c5a 5th-gen ≈16% of helios** — retire via family priority/blocklist. WOOP interruption-prediction type `AWSRebalanceRecommendations` deprecated (Jul 2026) — cosmetic update.
- **WOOP: installed (v1.10.4 vs latest v1.14.1) but `optimizedCount: 0`** — metrics-only, satisfies the "no workload autoscaler" constraint. Its telemetry exposes requests at **7–13× actual CPU usage** (helios 2052 requested vs 279 used cores) → refusing WOOP forfeits ~**$28–52k/mo** (priced, not pushed).
- Utilization (W30): cpuUsed/provisioned = helios 9.2%, integ 6.6%, kronos 5.8%; prov:req = 1.32/1.58/1.45 (CAST AI already packs to requests).
- Rebalancing error taxonomy: kronos `achievedSavingsBelowThreshold` = **benign** skip; integ `no instance types fit pod: persistentvolumeclaim…` (scada-dp-server, valkey) = **real** zone-pinned-PVC blocker needing a storage/topology decision.
- Helios storage $8.8k/mo: ~$2.4k node roots (300×100 GiB gp3) + **~$6.4k attached EBS/PVs (~64 TiB)** → PV governance lever $0.6–1.9k/mo.

## Method gotchas (verified live)

- `/v1/cost-reports/clusters/{id}/cost` returns avg-**hourly** items: `Σ cost×24×days = summary.totalCost` exactly (helios: 74.134192×720 = $53,376.62 ✓). Script's `CALIBRATION_FAIL` flag can be a false alarm — check this identity before doubting numbers.
- Monthly "actual" in the savings script CSV is **compute-only (CPU+RAM)**; storage sits outside the M1 math on both sides — internally consistent, quote storage separately.
- `estimated-savings` scenarios are **listing-price** counterfactuals; `/cost` defaults to discounted basis. Never mix bases on a slide.
- Multi-org reads need header `X-CastAI-Organization-Id` (plain `X-Organization-Id` silently ignored). 3 of 130 orgs 403 for this key (CAST AI EU, Siemens-test, Siemens-test-on).
- Cluster name→org scans: `GET /v1/organizations` then per-org `GET /v1/kubernetes/external-clusters` with the org header (pattern in `cluster-readiness-outputs/castai_cluster_inventory.py`).

## Open follow-ups

- [ ] Customer review with the 3-number reconciliation table (report §5/§8).
- [ ] P1: evictor ownership decision; integ spot pilot; removal-disabled review; add eu-central-1c subnets.
- [ ] P2: helios namespace-gated spot (PDB contract); c5a retirement; real clusterLimits; helios PV audit.
- [ ] Confirm 5% fee + baseline era against the Siemens contract (assumed in M1 net).
- [ ] AWS creds in repo-root `awskey.env` are expired (sts InvalidClientTokenId) — refresh before any AWS-side work.
