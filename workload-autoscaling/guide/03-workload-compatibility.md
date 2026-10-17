# Chapter 3 — Supported Workloads & Compatibility

Sources: [Overview](https://docs.cast.ai/docs/workload-autoscaling-overview) · [Configuration](https://docs.cast.ai/docs/workload-autoscaling-configuration) · [In-place resizing](https://docs.cast.ai/docs/woop-in-place-resizing) · [HPA](https://docs.cast.ai/docs/horizontal-pod-autoscaling)

## 3.1 Native workload support matrix (verified)

| Workload type | Support added | VPA apply modes | HPA support | Recommended production config |
|---|---|---|---|---|
| **Deployment** | Initial release | Immediate + Deferred | ✅ (WAS v0.44.0+, agent v0.60.0+) | Policy-driven; immediate for stateless, deferred for cautious rollouts |
| **StatefulSet** | v0.13.0 | Immediate + Deferred | ✅ | Default-assigned to `resiliency` policy; keep memory conservative; consider `evictOneByOne` |
| **DaemonSet** | v0.5.0 | **Deferred only** | ❌ | Consider node-allocatable-% sizing (early access, Ch. 8) |
| **Rollout (Argo)** | v0.6.0 | Immediate (v0.21.0+) + Deferred (**default**) | ✅ (v0.21.0+) | Leave deferred; immediate optional |
| **ReplicaSet** | v0.32.0 | Immediate + Deferred | ✅ | Usually managed via a Deployment — optimize the owner |
| **CronJob** | v0.44.3 | Immediate + Deferred | ❌ | Treated as job-like unless marked continuous; min CPU floor configurable (`jobLikeMinCpuRequest`, default 50m) |
| **Job / bare Pod** | via custom workloads (v0.18.0) | Immediate for custom workloads v0.41.2+ | ❌ | Labeled-based; schedule-type `jobLike` vs `continuous` |
| **Custom controllers (CRDs)** | v0.18.0 | Deferred; Immediate v0.41.2+ | — | `workloads.cast.ai/custom-workload` label + `workloads.cast.ai/configuration` annotation |
| **Sidecar containers** | v0.56.0 | As part of the workload | — | Requires agent v0.80.0+, exporter v0.2.0+; disabled by default for Upgraded clusters on Werker image — see §3.3 |
| **JVM workloads** | JVM optimization (auto-detect) | All | ✅ | Heap-based memory sizing (Ch. 8) |

## 3.2 Version-sensitive capabilities

| Feature | Min `castai-workload-autoscaler` | Min agent | Notes |
|---|---|---|---|
| Deferred apply mode | v0.5.0 | — | |
| Immediate apply for Rollouts | v0.21.0 | — | |
| Resource-specific optimization (CPU-only or memory-only) | v0.23.1 | — | |
| HA (2 replicas) | v0.30.0 | — | |
| Zero-downtime single-replica updates | v0.35.3 | — | immutable fix, [settings prereqs](https://docs.cast.ai/docs/woop-configuration-settings) |
| Native Kubernetes HPA management | v0.44.4 (docs table also lists v0.44.0) | v0.60.0 | |
| In-place pod resizing | v0.53.0 (chart v0.1.122) | 1.33+ cluster | |
| Sidecar optimization | v0.56.0 | v0.80.0, exporter v0.2.0 | |
| 1-by-1 pod restart strategy | v0.57.0 | — | |
| AKS Admissions Enforcer handling | v0.74.1 | — | |
| Startup recommendations (2-phase) | v0.63.1 | — | K8s 1.33+ |
| Node-aware DaemonSet sizing (early access) | v0.105.0 | v0.123.1 | annotations only |
| Whitelisting mode | v0.51.0 | v0.81.0 | |

## 3.3 Sidecar & service-mesh containers

- **What counts:** native sidecar init containers with `restartPolicy: Always` (K8s 1.29+ pattern), plus any other secondary container in the pod.
- **How optimization works:** sidecars are optimized **independently of the main container**, using their own usage data. Container exclusions common for meshes: add `excludedContainers: [istio-proxy]` (or the mesh's proxy name) in the policy/annotation so mesh capacity is never squeezed.
- **Dynamically injected containers** (Istio sidecar injected by the Istio webhook at admission) — optimization applies per current reconciliation; see Configuration → "Integration with service meshes" for Istio specifics and any mesh version caveats.
- **Practical guardrail:** exclude infrastructure sidecars (proxies, log agents, vault injectors) from optimization; let human-defined requests stand.

## 3.4 Custom workloads & job-like detection

Two schedule types, auto-detected and overridable by annotation `schedule.type` ([Configuration](https://docs.cast.ai/docs/workload-autoscaling-configuration#custom-workloads)):

| Type | Auto-detected | Handling |
|---|---|---|
| `continuous` | Long-running controllers (incl. known CRDs: Rollouts v0.6.0+,DataDog, Flink v0.42.2+, GitLab Runner v0.42.2+, Strimzi Cluster Operator v0.42.2+) | Normal VPA behavior |
| `jobLike` | CronJobs, Jobs, or labeled bare pods | Optimized with job-specific logic; requests floor via `jobLikeMinCpuRequest` (default `50m`) |

Bare pods: label `workloads.cast.ai/custom-workload: <name>` + configuration annotation; groupings let one recommendation cover similar pods (`jobGrouping` with `exact`/`regex` + `maxGroups` 2–100).

## 3.5 Container grouping

`containersGrouping` (v0.33.0+): generates **one** recommendation for containers sharing the same resources shape, matched by name pattern (`contains` etc.). Use for uniform sidecars across pods to reduce CR noise and reconcile overhead.

## 3.6 In-place resize eligibility (K8s 1.33+)

Per [in-place resizing](https://docs.cast.ai/docs/woop-in-place-resizing): Linux nodes only (no Windows pods), pod keeps its original QoS class, memory limits never decrease in place, resize `Pending` fallback differs by mode (immediate → evict when stuck; deferred → wait for natural restart), removing CPU limits during the first application may require a restart. Beyond eligibility, **any** workload can still fall back to immediate/deferred.

## 3.7 Unsupported / handle-with-care patterns

| Pattern | Status | Safe alternative |
|---|---|---|
| DaemonSet immediate mode | Not supported (deferred only) | Keep deferred; or node-aware sizing (early access) |
| KEDA `ScaledJobs` | Not supported | Use `ScaledObject` with a supported workload kind |
| HPA ownership of external-metric / container-target HPAs | Not eligible for ownership | Keep customer HPA; WAS still optimizes vertically with limited coordination |
| Bare pod without label | Out of scope | Label it as a custom workload or move to a controller |
| Windows pods for in-place resize | Not supported | Standard immediate/deferred path |

## 3.8 Single-replica workloads

Zero-downtime single-replica updates (v0.35.3+) allow a surge-style replacement instead of an in-place kill — prerequisites per [settings → "Prerequisites"](https://docs.cast.ai/docs/woop-configuration-settings#prerequisites) (rollout strategy `NoDisruption`, readiness probes configured, etc.). Without those, single-replica immediate applies will interrupt the service; prefer **deferred** or `evictOneByOne` for primitives you cannot duplicate.
