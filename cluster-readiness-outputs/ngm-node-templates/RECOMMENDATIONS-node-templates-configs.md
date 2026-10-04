# NGM clusters — Node Template & Node Configuration tuning for cost + networking safety

Org **SI GSW CLO** (`07aa3c29-…`) · clusters helios / integ / kronos · data pulled live 2026-10-04 (read-only), cross-checked with the 2026-10-02 full audit.

---

## 1. The maxPods finding (the "network capacity" issue is real — but inverted)

### What is configured today

All 3 node configurations carry a **static kubelet `maxPods: 55`**:

```json
"kubeletConfig": { "maxPods": 55, "kubeReserved": {"cpu": "1000m", "memory": "4000Mi", "ephemeral-storage": "5Gi"}, … }
```

CAST AI docs explicitly recommend **not** setting a static maxPods with the AWS VPC CNI ("The same node configuration is usually used for different instance types, and the max pods differ per instance type"). Source: [node-configuration — Maximum Pods formula](https://docs.cast.ai/docs/node-configuration#maximum-pods-formula).

### The formula (per instance type, no prefix delegation)

```
maxPods = NUM_MAX_NET_INTERFACES × (NUM_IP_PER_INTERFACE − 1) + 2
```

Applied to the instance sizes actually running in your fleet (pull from `nodes.json`, 2026-10-02):

| Size | vCPU | ENIs | IPs/ENI | EKS maxPods | Nodes under a static 55 | Fleet count (helios / integ / kronos) |
|---|---|---|---|---|---|---|
| large | 2 | 3 | 10 | **29** | **kubelet promises 55, CNI can only give 29 → pods stuck `ContainerCreating` / IP exhaustion events** | 8 / 0 / 2 |
| xlarge | 4 | 4 | 15 | **58** | fits, 3 slots headroom | 99 / 26 / 1 |
| 2xlarge | 8 | 4 | 15 | **58** | fits, 3 slots headroom | 77 / 23 / 2 |
| 4xlarge | 16 | 8 | 30 | **234** | wastes 179 IP slots/node (cosmetic today) | 116 / 29 / 9 |
| 8xlarge (blocked by `maxCpu:16`) | 32 | 8 | 30 | 234 | — | 0 today |
| 16xlarge+ (blocked) | 64 | 15 | 50 | 737 | — | 0 today |

Two opposite problems at once:

1. **Ten `r6a.large` nodes (helios 8, kronos 2)** advertise 55 pod slots to the scheduler but can only wire 29 IPs. Kubernetes keeps placing pods there → aws-node `AssignIpAddresses` failures. This is exactly the "max pods causes network capacity issues" symptom, at the *node* level.
2. On the 154 4xlarge nodes (40% of the fleet) the static 55 silently throws away the pod density that bigger nodes are good for — while CAST AI's autoscaler *plans* with that 55, so it sometimes provisions an extra node where one dense 4xlarge would do.

### Subnet/IP headroom (from live `subnetDetails`)

| Cluster | Subnets | CIDRs | Usable IPs (approx) |
|---|---|---|---|
| helios | `subnet-0b37…` (1b), `subnet-029a…` (1a) | 2 × /18 | ~32.7k |
| integ | `subnet-0dac…` (1b), `subnet-0a1f…` (1a) | 2 × /17 | ~65.5k — **shared with kronos** |
| kronos | same two subnets as integ | 2 × /17 | same pool |

No near-term subnet exhaustion (helios at 55×300 ≈ 16.5k of 32.7k IPs), so the fix is per-node correctness + a growth story, not an emergency.

### Recommended change

1. **Remove `maxPods: 55` from `kubeletConfig`** → bootstrap computes the per-instance-type ENI value (helm/bootstrap default). OR
2. Set the node configuration **Max pods formula** field explicitly (API/Terraform), e.g. the EKS preset: `NUM_MAX_NET_INTERFACES * (NUM_IP_PER_INTERFACE - 1) + 2`. CAST AI then *plans* with the same number the kubelet enforces.
3. If you want a hard cap for stability, cap inside the formula: `math.least(NUM_MAX_NET_INTERFACES * (NUM_IP_PER_INTERFACE - 1) + 2, 110)` — dynamic per size, with a ceiling.
4. Future-proof: if you raise `maxCpu` (see §2.1) or approach subnet limits, enable **VPC CNI prefix delegation** and use the preset `math.least((N_ENI-1) * (IP_PER_ENI-1) * 16 + 2, 300)`. Prefix delegation multiplies per-ENI IP slots ×16 with /28 prefixes; CAST AI auto-detects it for subnet-capacity planning. Requires Nitro instances only (all your current 6th/7th/8th-gen families qualify; c5a also Nitro, OK).

---

## 2. Node template improvements (cost levers, data-backed)

Current template = the single `default-by-castai` on each cluster: on-demand-only, `maxCpu 16`, amd64, 2 AZs, everything allowed, no minima. Verified fleet/cost context (2026-10-02 audit): helios ~300 nodes $53.4k/mo, integ bursts 44→838 nodes/day $23.8k/mo, kronos 14 nodes $2.3k/mo.

### 2.1 Raise `maxCpu` 16 → 32 (bin-packing density)

- Largest node today = 16 vCPU (4xlarge). Median helios node ≈ 6.6 vCPU provisioned (1991 vCPU / 300 nodes).
- Per-node fixed tax you pay on every node: kubelet+containerd+aws-node etc. ≈ 0.4–1 vCPU + 1–4 GiB → at 6.6 vCPU/node that's **~10–15% of provisioned CPU burned on overhead**. Allowing 8xlarge (32 vCPU, *same* 234-pod ENI cap as 4xlarge) lets rebalancing pack 2–4 mid nodes into one.
- Sequence: fix maxPods first (§1), then raise in steps 16 → 24 → 32 while watching PDB/eviction behavior. Kept on-demand, zero spot risk.
- If node-size blast radius worries you (many pods per node), cap maxPods via formula (§1.3) to keep per-node pod counts bounded.

### 2.2 Add a floor: `minCpu 4` (or minMemory 16384 like helios already has — extend to integ/kronos)

- Kronos runs `r6a.large` (2 vCPU) nodes: 29-IP ceiling, full system/pod overhead on a 2-core box, `burstable` already disabled.
- Also removes the §1 "29-IP nodes under maxPods 55" mismatch entirely (no `large` instances allowed).

### 2.3 Spot: separate template, pilot on integ (biggest $ lever)

- Org-wide `spot: false` while integ's daily 44→838-node burst is the perfect elastic-batch fit. Spot fallbacks + interruption predictions are already configured in the template payload — flipping `spot: true` on a **new** template (`scheduling.cast.ai/node-template` selector on tolerant workloads) doesn't touch the default.
- Priced already (audit): S1+S2 ≈ **$27.7k/mo** (range $19–36k); CAST AI SpotOnly ceilings on listing basis: helios −$48.4k, integ −$12.4k, kronos −$2.6k/mo. Spot discount observed in CAST AI snapshot: m6a.24xlarge −62.8% vs OD.

### 2.4 AZs: add eu-central-1c subnets (capacity + IP space)

- Templates pin `azs: [1a, 1b]`; live `InsufficientCapacity` on `c5a.4xlarge` was captured in the integ audit. A third AZ doubles on-demand pool breadth and adds a fresh subnet CIDR (the §1 growth story).

### 2.5 ARM (Graviton) template for multi-arch workloads

- Fleet is 100% amd64. A dedicated `arm64` template (families `m8g, m7g, r8g, c7g, c8g`, `shouldTaint: true`) for workloads with multi-arch images buys **~20%** better price/performance. Don't widen the default template — an amd64 pod must never land on ARM.

### 2.6 Family hygiene & priority

- helios still runs **46 × c5a (5th gen, ~15%)**. Add `m8a, m7a, m8i, m7g` to a **customPriority** tier above m6a/r6a and move c5a/c5ad to the bottom tier (or exclude) — nodes roll over naturally at rebalance; prioritization also respects commitments (put Savings-Plan-covered families high).

### 2.7 CPU-limit guardrail for integ

- Template `resourceLimits.cpuLimitEnabled: false`. Integ burst history (838 nodes/day) deserves a **template CPU limit** (e.g. 8,000 cores) as an economic circuit-breaker; clusterLimits.maxCores=16384 today is a meaningless ceiling (per the earlier audit).

---

## 3. Node configuration improvements

| Setting | Today | Recommendation | Why (data) |
|---|---|---|---|
| `kubeletConfig.maxPods` | static **55** | remove, or formula (§1) | wrong on 10 large nodes; under-plans 154 4xl nodes |
| Max pods formula | unset | set preset EKS formula (or capped) | autoscaler plans with real ENI math |
| `image` | **pinned** ID `ami-0706179e8561145ae` | keep the golden/custom AMI, referenced by **name search string** (`<ami-name>-{k8s_version}-v*`) + set `eks.imageFamily: FAMILY_AL2023` explicitly | pinned IDs age silently; name patterns auto-resolve the newest golden build per k8s version (arch-filtered); explicit imageFamily required for custom AMI names so userdata is generated correctly; rebuild the golden line on AL2023 — on AL2 `kubeReserved`/`evictionHard` are silently ignored and CLM is impossible (Bottlerocket = Nitro-only, no CLM) |
| `minDiskSize` / `diskCpuRatio` | 100 GiB flat, ratio 0 | `diskCpuRatio: 1` with e.g. 20 GiB floor | 300 × 100 GiB gp3 ≈ **$2.4k/mo** of helios root disks mostly idle; ratio scales disk with node size and shrinks the small node tax |
| `imdsVersion` / `imdsV1` | unset | `imdsV1: false` (IMDSv2-only) | consistent hardening everywhere (audit noted IMDSv2 already intended) |
| `kubeReserved` | 1 vCPU + 4 Gi + 5 Gi/node | keep, but pair with §2.1 | only meaningful with bigger nodes (tax amortizes) — and only applied once on AL2023 |
| `drainTimeoutSec` | unset | set 1200 (20 min) explicitly | makes rebalancing behavior deterministic vs. the hidden default |

---

## 4. Suggested rollout order

1. **P0 — remove static `maxPods: 55`** (fixes the live 29-vs-55 mismatch on 10 nodes; zero cost risk). Add formula.
2. **P1 — integ changes first** (test cluster bursting daily): add 1c subnets, spot template pilot, template CPU limit.
3. **P2 — fleet-wide**: `maxCpu` 16 → 24 → 32, `minCpu 4`, imageFamily AL2023 (drives AMI un-pinning + kubeReserved actually applying), diskCpuRatio.
4. **P3 — structural**: ARM template for multi-arch services, c5a retirement via priorities, Graviton/8th-gen preference tiers.

Every settings change only lands on **new** nodes — pair each with a partial rebalance (nightly rebalancing schedules already exist on these clusters) to roll the fleet without touching running workloads. Note the known blockers from the audit before scheduling helios-wide rebalances: evictor self-managed/incompatible on all three clusters and zone-pinned PVCs (`scada-dp-server`, `valkey` on integ).

---

## Data appendix

- Live configs/templates: `ngm-helios-eks-*`, `ngm-integ-eks-*`, `ngm-kronos-eks-*.json` (this folder)
- Fleet mix: `cluster-cost-analysis/ngm-*/nodes.json` (helios 300, integ 78, kronos 14 nodes)
- Cost model: `.kimchi/docs/si-gsw-clo-ngm-cost-savings-analysis-2026-10.md`
- Docs: [Node templates](https://docs.cast.ai/docs/node-templates), [Node configuration](https://docs.cast.ai/docs/node-configuration)
