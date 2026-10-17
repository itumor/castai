# Chapter 8 — Advanced Workload Optimization

Sources: [JVM optimization](https://docs.cast.ai/docs/woop-jvm-optimization) · [Custom metrics](https://docs.cast.ai/docs/woop-custom-metrics) · [Configuration → predictive scaling](https://docs.cast.ai/docs/workload-autoscaling-configuration#predictive-workload-scaling) · [Startup recommendations](https://docs.cast.ai/docs/woop-startup-recommendations) · [Settings → stall detection](https://docs.cast.ai/docs/woop-configuration-settings#stall-detection) · [Node-aware DaemonSet sizing](https://docs.cast.ai/docs/woop-node-aware-daemonset-sizing) · [Event log](https://docs.cast.ai/docs/event-log)

## 8.1 JVM workload optimization

**Problem:** the JVM preallocates heap at startup; Kubernetes reports preallocated heap as "used" even when mostly idle inside → over-provisioning, and internal `java.lang.OutOfMemoryError` is invisible to K8s.

**Two capabilities:** JVM memory optimization (recommendations from **actual runtime data**: heap usage, GC behavior, thread count) and **auto-instrumentation** (JMX metrics agent injected into Java containers at admission — no app changes).

### Collection methods — pick one per workload

| Method | When | Pod changes | Requires |
|---|---|---|---|
| **Auto-instrumentation** (default) | App exposes no metrics | init container + `-javaagent` flag | Java 9+, inline java options |
| **Endpoint scraping** | App already exposes Prometheus-format JVM metrics (e.g. Spring Actuator) | label + annotations only | `prometheus.io/*` pod annotations |
| **Own Prometheus** | Existing JMX pipeline | none | connected [custom metrics data source](https://docs.cast.ai/docs/woop-custom-metrics) |

**Detection is automatic** (image names for known JVM runtimes/frameworks, `JAVA_OPTS`/`JAVA_TOOL_OPTIONS`/`JDK_JAVA_OPTIONS`/`JVM_OPTS`/`_JAVA_OPTIONS`/`CATALINA_OPTS`, OTel/Datadog instrumentation annotations, explicit `workloads.cast.ai/runtime: jvm` annotation, JVM heap metrics already flowing). JVM workloads get a **JVM** badge + filter chip in console.

**Enable:** policy-level `jvm: {enabled: true, autoInstrument: true}` or per-workload annotation (per-container variant `vertical.containers.{name}.jvm`).

**Limits & troubleshooting (documented):** security policies (PSP/OPA/Gatekeeper/Kyverno) may reject the injected init container → whitelist it or switch to external pipeline. Heap metrics missing → check exporter pods/logs, Java version ≥9, that java options are inline (not via entrypoint indirection). **Interaction:** JVM heap rightsizing alongside startup recommendations can force fallback to single-phase recs (in-place not possible).

## 8.2 Predictive workload scaling

- **What:** forecasts periodic CPU demand to pre-position vertical requests ahead of predictable peaks. CPU-focused; **auto-disabled when HPA manages the workload** ([HPA doc](https://docs.cast.ai/docs/horizontal-pod-autoscaling#predictive-scaling)).
- **Eligibility:** the engine marks eligible workloads itself (sufficient history with periodic patterns); console surfaces eligibility; enable via annotation `vertical.predictiveScaling.cpu.enabled: true` or Console UI ([Configuration → Predictive](https://docs.cast.ai/docs/workload-autoscaling-configuration#predictive-workload-scaling)).
- **Tuning:** no numerical knobs; behavior relies on detected patterns + your safety overhead.
- **Validate:** event log recommendation steps; compare pre/post request curves around known peaks. **Rollback:** set `enabled: false` → next cycle returns to reactive percentile mode.
- **Do not enable** for chaotic/aperiodic traffic; the forecasting adds churn without gain.

## 8.3 Startup optimization (two-phase recommendations)

- **Mechanics:** pod starts with the workload's **original CPU requests** → after `startup.period` elapses → **in-place resize** to optimized values. CPU-only; memory constant across phases.
- **Prereqs:** WAS **v0.63.1+**, **K8s 1.33+**, startup period configured with mode "Startup recommendations" selected.
- **Generation is selective:** skipped (single-phase) when optimized CPU ≥ original, original spec lacks resources, or phases differ by **<100m**; surge adds a phase only if startup CPU exceeds post-startup by ≥100m; falls back to single-phase when in-place isn't possible.
- **Cost:** temporary over-reservation during each startup period (bin-packing headroom) — tradeoff documented; measure on clusters with frequent pod churn.

## 8.4 Resource pressure & failure signals

- **PSI stall detection** (K8s ≥1.34, exporter ≥v0.67.0): see Ch. 5.7 — thresholds, activation constraints (incl. HPA-at-max requirement), 15-minute cooldown, `vertical.anomalyDetection.cpuPressure.cpuStallThresholdPercentage / minPressuredPodPercentage` annotation overrides.
- **Startup failure detection:** exporter's system `node-probes` data source feeds probe-failure metrics (no setup needed); probe-failed pods flag risk during startup-heavy optimization.
- **OOM handling:** immediate memory flooring ~1.2× peak, immmediate re-optimization bypassing rollout delay, ≥2h anti-flapping, optional auto-disable on tight OOM loops (Ch. 5.12).

## 8.5 Node-aware DaemonSet sizing (**Early Access**)

Express requests as **% of node allocatable**, resolved per pod at admission: `request = allocatable × percent/100` per container (not a pod-level shared budget), clamped by min/max constraints, limits derived by the existing limit strategy. Fallback static request/limit (from observed usage) applies when the node can't be determined; pods are never rejected. Existing pods keep old values until recreated.

| Item | Value |
|---|---|
| Min versions | `castai-workload-autoscaler` v0.105.0, agent v0.123.1 |
| Config | **annotations only** (policy/UI later); `resourceStrategy: {type: nodeAllocatablePercentage, nodeAllocatablePercentage: {cpuPercent: X, memoryPercent: Y}}` |
| Incompatibilities | **`keepLimits` policy for that resource** → percentage strategy ignored |
| K8s 1.34 pod-level resources | converted; percent-based sidecars excluded |

**Enablement (annotations example):**
```yaml
workloads.cast.ai/configuration: |
  vertical:
    optimization: on
    resourceStrategy:
      type: nodeAllocatablePercentage
      nodeAllocatablePercentage: {cpuPercent: 2, memoryPercent: 3}
    cpu: {min: 100m, max: 500m}        # clamps the resolved %
    memory: {min: 128Mi, max: 1Gi}
```
**Validate:** schedule pods onto two different node sizes; `kubectl get pod -o jsonpath='{.spec.containers[*].resources}'` should differ per node size. **Gotchas (documented):** limits look high when min-constraint clamps upward (limit = resolved-request × multiplier); verify `keepLimits` isn't set. **Rollback:** remove `resourceStrategy` → next reconcile returns to standard recommendation.

## 8.6 Custom metrics data sources

- Purpose: connect Prometheus sources for JVM heap and other custom signals; supersedes the removed `metricSources` annotation config.
- Configure via console (**Workload Autoscaler → Custom metrics**) or API `WorkloadOptimizationAPI_CreateCustomMetricsDatasource`. Creates a CR in-cluster; exporter scrapes per config.
- **System-defined sources** (after exporter install): `node-probes` (startup failure detection) and `node-psi` (stall detection; requires K8s 1.34+). No manual setup for either.
- Our compat note: custom metrics here are **recommendation inputs**, not HPA triggers — HPA-level custom metrics stay in KEDA/HPA-land (Ch. 7).

## 8.7 Feature compatibility summary

| Feature | K8s min | WAS min | Other mins | Status |
|---|---|---|---|---|
| Core VPA | 1.18 | initial | — | GA |
| Native HPA mgmt | — | v0.44.x | agent v0.60.0 | GA |
| In-place resize | **1.33** | v0.53.0 | chart v0.1.122 | GA |
| Startup recommendations | 1.33 | v0.63.1 | in-place support | GA |
| PSI stall detection | **1.34** | — | exporter v0.67.0 | GA |
| Predictive CPU | — | see config doc | non-HPA workloads | GA |
| JVM optimization | — | — | Java 9+ (auto-instr.), exporter | GA |
| Node-aware DS sizing | — | v0.105.0 | agent v0.123.1 | **Early access** |
