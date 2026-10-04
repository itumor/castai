# DRAFT EMAIL — NGM EKS clusters: Node Template & Node Configuration tuning (per cluster)

> Draft only — a human reviews and sends. All field values verified against CAST AI live API (2026-10-04), CAST AI docs ([node-templates](https://docs.cast.ai/docs/node-templates), [node-configuration](https://docs.cast.ai/docs/node-configuration)) and the OpenAPI spec (`eks.maxPodsPerNodeFormula`).

**To:** NGM platform team (owner: paul.till@siemens.com)
**Subject:** CAST AI node template & node configuration tuning for ngm-helios/integ/kronos — maxPods fix, density, spot pilot

---

Hi Paul, team,

we reviewed the node templates and node configurations of the three NGM clusters (ngm-helios-eks, ngm-integ-eks, ngm-kronos-eks) against the CAST AI autoscaler docs and your live fleet. Two concrete findings plus a full set of recommended values per cluster below. Everything applies to **newly provisioned nodes only**, so the rollout is low-risk and pairs with your existing nightly rebalancing windows.

## Finding 1 — static `maxPods: 55` in kubeletConfig (all 3 clusters)

With the AWS VPC CNI, the true per-node pod ceiling is interface-bound:

```
maxPods = NUM_MAX_NET_INTERFACES × (NUM_IP_PER_INTERFACE − 1) + 2
```

CAST AI explicitly recommends **not** setting a static value, because the same node configuration spans many instance types. Your fleet today:

| Node size | vCPU | ENI formula ceiling | Effect of static 55 | Nodes (helios/integ/kronos) |
|---|---|---|---|---|
| large (r6a.large) | 2 | **29** | kubelet advertises 55 → scheduler can place pods that never get an IP | 8 / 0 / 2 |
| xlarge | 4 | 58 | ok, 3 slots headroom | 99 / 26 / 1 |
| 2xlarge | 8 | 58 | ok, 3 slots headroom | 77 / 23 / 2 |
| 4xlarge | 16 | **234** | 179 unused slots; autoscaler plans with 55 and adds avoidable nodes | 116 / 29 / 9 |

Measured pod reality (CAST AI workloads API + daemonset arithmetic, 2026-10-04):

| Cluster | App replicas* | DaemonSets × nodes | **Est. total pods** | Pods/node | Subnet IPs used (approx) |
|---|---|---|---|---|---|
| helios (300 nodes) | 466 | 12 × 300 | **~4,070** | ~14 | ~4.4k of 32.7k (13%) |
| integ (78 nodes) | 239 | 10 × 78 | **~1,020** | ~13 | ~1.1k of 65.5k** (2%) |
| kronos (14 nodes) | 57 | 10 × 14 | **~200** | ~14 | ~0.2k of 65.5k** (<1%) |

\* API caps replicas at 25 per workload, so application counts are a floor. \** integ and kronos **share** subnets `10.47.0.0/17` + `10.47.128.0/17`.

Read: pods are not your binding constraint today (~14/node, mostly daemonsets; ~2.2 vCPU per pod on helios — CPU is). But the 29-vs-55 gap on the ten r6a.large nodes is a real latent incident, and the 55-cap neuters the 4xlarge bin-packing you pay for.

**Fix (all clusters):** delete `maxPods` from `kubeletConfig`; set the node configuration formula field instead, with a stability ceiling (~8× above your observed density):

```
eks.maxPodsPerNodeFormula = "math.least(NUM_MAX_NET_INTERFACES * (NUM_IP_PER_INTERFACE - 1) + 2, 110)"
```

If subnet IP space ever becomes tight, enable VPC CNI prefix delegation and switch to `math.least((NUM_MAX_NET_INTERFACES - 1) * (NUM_IP_PER_INTERFACE - 1) * NUM_IP_PER_PREFIX + 2, 300)` (CAST AI preset; 300 mirrors AWS's own stability cap). Not required at current 13% subnet utilization.

## Finding 2 — density ceiling and fleet-age drag

- `maxCpu: 16` pins you to ≤16 vCPU nodes. Helios provisions ~1,991 vCPU across 300 nodes (~6.6/node) — with ~1 vCPU + 4 GiB reserved per node by kubelet/system/DaemonSets, **~15% of provisioned CPU is node tax**. 8xlarge nodes (32 vCPU) carry the *same* 234-pod ENI cap as 4xlarge, so raising the cap is IP-neutral.
- Helios still runs 46 × **c5a/c5ad (5th gen ≈ 15%)**; AMI `ami-0706179e8561145ae` is pinned (golden/custom AMI), so security/k8s patch drift is manual, and if the golden line is AL2-based `kubeReserved`/`evictionHard` are silently **ignored on AL2** (CAST AI doc caveat).

---

## Recommended values — per cluster

### A. Shared change — node configuration (all three, P0)

Apply to `ngm-helios-castai` (v11), `ngm-integ-castai` (v15), `ngm-kronos-castai` (v31). Unchanged fields omitted.

```json
{
  "diskCpuRatio": 1,
  "minDiskSize": 50,
  "image": "<golden-AMI name search string, e.g. ngm-eks-node-al2023-*-{k8s_version}-v* — replaces the pinned AMI ID>",
  "containerRuntime": "CONTAINERD",
  "drainTimeoutSec": 1200,
  "eks": {
    "imageFamily": "FAMILY_AL2023",
    "maxPodsPerNodeFormula": "math.least(NUM_MAX_NET_INTERFACES * (NUM_IP_PER_INTERFACE - 1) + 2, 110)",
    "imdsV1": false,
    "volumeType": "gp3"
  },
  "kubeletConfig": {
    "evictionHard": {
      "imagefs.available": "10%", "imagefs.inodesFree": "10%",
      "memory.available": "4Gi",
      "nodefs.available": "10%", "nodefs.inodesFree": "10%",
      "pid.available": "10%"
    },
    "kubeReserved": { "cpu": "1000m", "ephemeral-storage": "5Gi", "memory": "4000Mi" },
    "systemReserved": { "cpu": "100m", "ephemeral-storage": "100Mi", "memory": "500Mi" }
  },
  "initScript": "<keep current — unchanged>",
  "tags": "<keep current — unchanged>"
}
```

Notes:
- **`maxPods` removed** (replaced by the formula; see Finding 1).
- `image: <name search string>` + explicit `eks.imageFamily: FAMILY_AL2023` = CAST AI resolves the **newest golden build per k8s version** (arch-filtered) instead of an aging pinned AMI ID; explicit family is required for custom AMI names so userdata is generated correctly. Rebuild the golden line on AL2023 — kubeReserved/evictionHard only apply there, and it unlocks Container Live Migration later. **Validate on integ first** (your custom initScript must be AL2023-safe).
- `minDiskSize: 50` + `diskCpuRatio: 1` shrinks root volumes on small/mid nodes (16 vCPU → 64 GiB). Helios saves ≈ 300 nodes × ~45 GiB gp3 ≈ **$1.1k/mo**; large-node sizing unchanged.
- Keep `kubeReserved` 1000m/4000Mi as-is: once `maxCpu` grows (below) its *relative* tax halves automatically; shrink it separately if needed.
- `drainTimeoutSec: 1200` makes rebalancing drains explicit (20 min platform default).

### B. ngm-helios-eks (production — conservative)

**Template `default-by-castai` — full proposed constraints:**

```json
{
  "spot": false,
  "onDemand": true,
  "useSpotFallbacks": true,
  "fallbackRestoreRateSeconds": 300,
  "enableSpotReliability": true,
  "spotReliabilityPriceIncreaseLimitPercent": 20,
  "enableSpotDiversity": false,
  "spotDiversityPriceIncreaseLimitPercent": 0,
  "spotInterruptionPredictionsEnabled": true,
  "spotInterruptionPredictionsType": "castai-predictions",
  "isGpuOnly": false,
  "architectures": ["amd64"],
  "os": ["linux"],
  "azs": ["eu-central-1a", "eu-central-1b", "eu-central-1c"],
  "maxCpu": 24,
  "minCpu": 4,
  "minMemory": 16384,
  "burstable": "DISABLED",
  "customerSpecific": "DISABLED",
  "cpuManufacturers": [],
  "architecturePriority": [],
  "instanceFamilies": {
    "include": ["<keep current broad include list>"],
    "exclude": ["c5a", "c5ad"]
  },
  "customPriority": [
    { "families": ["m8a", "m8azn", "m8i", "m8i-flex", "m8id", "r8a", "r8i", "r8i-flex", "r8ib", "r8id", "r8idb", "r8idn", "r8in", "c8a", "c8i", "c8i-flex", "c8id", "c8in", "c8ine", "m7a", "m7i", "m7i-flex", "r7a", "r7i", "r7iz", "c7a", "c7i", "c7i-flex"] }
  ],
  "dedicatedNodeAffinity": [],
  "resourceLimits": { "cpuLimitEnabled": true, "cpuLimitMaxCores": 6000 },
  "lifecycleTaintsDisabled": false,
  "maxPricePerCpu": 0
}
```

Why: `maxCpu 16→24` (step toward 32 after observation), `minCpu 4` removes 29-IP/`burstable-adjacent` small nodes, 3rd AZ widens on-demand pools (you hit live `InsufficientCapacity` on c5a.4xlarge), c5a excluded and newest-gen families prioritized (roll-out at normal rebalances; 46 legacy nodes drift out), CPU limit 6000 = ~3× your 2,052 vCPU peak request — a runaway-burst circuit breaker that never fires in normal operation. Spot stays off until the evictor ownership issue is resolved.

### C. ngm-integ-eks (burst test cluster — pilot everything here first)

**Default template** — same as helios but `maxCpu: 32`, `minMemory: 0`, `resourceLimits.cpuLimitMaxCores: 8000` (today's ceiling of 16384 matched nothing; your bursts hit 838 nodes/day ≈ 5–7k vCPU).

**NEW template `spot-batch` (P1 pilot):**

```json
{
  "name": "spot-batch",
  "configurationName": "ngm-integ-castai",
  "isEnabled": true,
  "shouldTaint": true,
  "customLabels": { "ngm.siemens.com/capacity": "spot-batch" },
  "constraints": {
    "spot": true,
    "onDemand": true,
    "useSpotFallbacks": true,
    "fallbackRestoreRateSeconds": 300,
    "enableSpotReliability": true,
    "spotReliabilityPriceIncreaseLimitPercent": 20,
    "spotInterruptionPredictionsEnabled": true,
    "spotInterruptionPredictionsType": "castai-predictions",
    "enableSpotDiversity": false,
    "isGpuOnly": false,
    "architectures": ["amd64"],
    "os": ["linux"],
    "azs": ["eu-central-1a", "eu-central-1b", "eu-central-1c"],
    "maxCpu": 32, "minCpu": 4,
    "burstable": "DISABLED", "customerSpecific": "DISABLED",
    "cpuManufacturers": [], "architecturePriority": [],
    "customPriority": [], "dedicatedNodeAffinity": [],
    "instanceFamilies": { "include": ["<same include list as default>"], "exclude": [] },
    "resourceLimits": { "cpuLimitEnabled": true, "cpuLimitMaxCores": 6000 },
    "lifecycleTaintsDisabled": false, "maxPricePerCpu": 0
  }
}
```

Workloads opt in with `nodeSelector: scheduling.cast.ai/node-template: spot-batch` + toleration. Your daily 44→838-node test bursts are the ideal spot profile (observed spot discount in your own org snapshot: −62.8% on m6a.24xlarge). Guardrails: fallback to on-demand is on; reliability ML +20% cap; separate CPU limit.

Also worth knowing: the deprecated interruption-prediction type `aws-rebalance-recommendations` currently set on your templates should move to the CAST AI prediction model (confirm the exact enum in console — the AWS rebalance signal is deprecated as of Jul 2026).

### D. ngm-kronos-eks (small, collapses to ~14 vCPU on weekends)

**Default template** — same core changes: `maxCpu: 24`, `minCpu: 4` (**this alone retires the two r6a.large nodes**, whose 29-IP ENI ceiling sits below your static 55), `minMemory: 16384`, azs + 1c, exclude `["c5a","c5ad"]`, newest-gen `customPriority` as helios, `resourceLimits: { cpuLimitEnabled: true, cpuLimitMaxCores: 1500 }`. Peak observed demand is small — kronos rebalancing skips (`achievedSavingsBelowThreshold`) are benign and will continue.

---

## Rollout & blockers

1. **P0 (all 3):** maxPods formula change (Finding 1). Integ first, then kronos, then helios — one rebalance cycle apart.
2. **P1 (integ):** AL2023 golden-AMI + init-script validation, spot-batch template, 3rd-AZ subnets (new `subnet-…` in eu-central-1c added to node configs on all clusters — integ and kronos share a VPC, plan CIDRs once).
3. **P2 (all 3):** `maxCpu`/`minCpu`/family priorities; helios last after a week of integ data.
4. Known blockers to expect during rebalances (from the Oct 2 audit): **evictor is self-managed/incompatible on all 3 clusters** (nightly scheduled rebalancing is your current bin-pack path — keep using it), **removal-disabled nodes** (helios 8, integ 10, kronos 1) will not roll, and **zone-pinned PVCs** (scada-dp-server, valkey on integ) block specific nodes until a storage topology decision is made.

Happy to walk through the spot pilot sizing for integ or turn any of these payloads into Terraform.

Best regards,
CAST AI CSM team

---

### Appendix — subnet IDs referenced

| Cluster | a (eu-central-1a) | b (eu-central-1b) | c (eu-central-1c) |
|---|---|---|---|
| helios `10.46.0.0/16` | `subnet-029ae276a3f935b25` /18 | `subnet-0b37ef8168875909e` /18 | *to be created* |
| integ & kronos `10.47.0.0/16` (shared) | `subnet-0a1fe78d4bc69f2ac` /17 | `subnet-0dacd9b4f9407e0ab` /17 | *to be created* |
