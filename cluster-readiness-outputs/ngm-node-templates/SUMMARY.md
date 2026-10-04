# SI GSW CLO — NGM clusters: Node Templates & Node Configurations

- Org: **SI GSW CLO** (`07aa3c29-3e1f-44bc-ad60-ceedb878d99a`)
- API: `https://api.eu.cast.ai` (GET-only)
- Pulled: 2026-10-04

## Clusters

| Cluster | Cluster ID | Node configuration | Version | Created | Last updated |
|---|---|---|---|---|---|
| ngm-helios-eks | `419c39e4-66bf-4d61-b833-4562968a61c7` | `ngm-helios-castai` (`4fae2e7f-5d07-46fa-8205-927799049e9e`) | 11 | 2026-07-21 | 2026-09-25 |
| ngm-integ-eks | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` | `ngm-integ-castai` (`c653e146-d668-43bf-9f68-e9d5a3637716`) | 15 | 2026-04-27 | 2026-09-25 |
| ngm-kronos-eks | `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` | `ngm-kronos-castai` (`688b0286-b444-4ed2-84a3-3a4d74f43257`) | 31 | 2025-11-06 | 2026-09-25 |

## Node templates (identical on all 3 clusters)

- Only the built-in **`default-by-castai`** template exists; no custom templates.
- Linked to each cluster's own node configuration; `isDefault: true`, `shouldTaint: false`.
- Constraints:
  - **On-demand only** (`spot: false`, `onDemand: true`), spot fallbacks enabled (restore rate 300 s)
  - `maxCpu: 16` (helios also sets `minMemory: 16384` MiB = 16 GiB; integ/kronos have no minMemory)
  - Architectures: `amd64`; OS: `linux`; AZs: `eu-central-1a`, `eu-central-1b`
  - Burstable: DISABLED; customerSpecific: DISABLED; GPU-only: false
  - Spot-reliability / interruption-prediction flags present (`aws-rebalance-recommendations`, +20% price limit) — inactive while spot is disabled
  - Instance family include list: broad (c/c-d/c-n 5a–8i families, m/r 5–8 families, g, i, inf, p4, u, x2/x8, t8i, d, f2 …); no excludes
  - No custom labels or taints; no dedicated node affinity; no CPU limit cap

## Node configurations (per cluster)

Common across all three: AMI `ami-0706179e8561145ae`, `containerRuntime: CONTAINERD`, custom `initScript` present, `kubeletConfig` present, 2 subnets, **no security groups managed by CAST config** (inherits cluster SGs), no instance profile ARN, no EBS overrides (`volumeIops`/`volumeThroughput` null), no max-pods or eviction settings, `diskCpuRatio: 0`.

| Config | Environment tags |
|---|---|
| ngm-helios-castai | `Environment/gmas_environment: helios` |
| ngm-integ-castai | `Environment/gmas_environment: integ` |
| ngm-kronos-castai | `Environment/gmas_environment: kronos` |

Shared tags: `ProjectName/gmas_project: ngm`, `application_id: APM0022911`, `acp_rating: 211`, `owner: paul.till@siemens.com`, plus a per-env `pipeline_url` under `code.siemens.com/masglobaldevops/ngm/...`.

## Raw files (full, unfiltered API payloads)

- `ngm-helios-eks-node-templates.json`, `ngm-helios-eks-node-configurations.json`
- `ngm-integ-eks-node-templates.json`, `ngm-integ-eks-node-configurations.json`
- `ngm-kronos-eks-node-templates.json`, `ngm-kronos-eks-node-configurations.json`

API routes used: `GET /v1/kubernetes/clusters/{clusterId}/node-templates?includeDefault=true` and `GET /v1/kubernetes/clusters/{clusterId}/node-configurations` with header `X-Castai-Organization-Id: 07aa3c29-3e1f-44bc-ad60-ceedb878d99a`.
