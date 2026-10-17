# Chapter 5 — Complete Tuning Reference ⭐

Sources: [Available settings](https://docs.cast.ai/docs/woop-configuration-settings) · [Configuration](https://docs.cast.ai/docs/workload-autoscaling-configuration) · [Annotations reference](https://docs.cast.ai/docs/workload-autoscaler-annotations-reference) · [VPA+HPA](https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa)

**Legend:** **[Default]** = documented CAST AI product default · **[Suggested]** = this guide's starting recommendation (NOT a product default) · **`annotation.path`** = override key inside the `workloads.cast.ai/configuration` annotation.

**Precedence:** workload annotation > scaling policy > system default. Console edits per-workload vertical settings are not possible — annotations only.

## 5.0 Vertical settings big table

| Setting (console ↔ annotation) | Purpose | [Default] | Range | [Suggested] starting point | When to ↑ / ↓ | Perf risk | Cost impact |
|---|---|---|---|---|---|---|---|
| Apply type ↔ `vertical.applyType` | When/how recs apply | `immediate` | immediate/deferred | deferred for stateful+strict-PDB; immediate elsewhere | ↓choose deferred to avoid evictions; ↑immediate for fast convergence | restarts (immediate) vs. slow convergence (deferred) | deferred delays savings |
| CPU percentile ↔ `vertical.cpu.target` | Target usage percentile | `p80` | p50–max | p80; p90 critical | ↑ spikes/latency-sensitive; ↓ dev/cost | ↓ too low = throttling | direct (request ∝ percentile) |
| Memory target ↔ `vertical.memory.target` | Memory sizing fn | `max` | max/p99/rarely lower | **keep max** | ↓ only for JVM-heap-managed or tolerant work | OOMKill if lowered wrongly | high (memory is the packing constraint) |
| CPU overhead ↔ `vertical.cpu.overhead` | Buffer above recommendation | 0.10 (10%) | ≤2.5 (250%) | 0.10–0.15; 0.2–0.25 critical | ↑ spiky/latency; ↓ dev | extra throttling headroom vs waste | linear on request size |
| Memory overhead ↔ `vertical.memory.overhead` | OOM buffer | 0.10 | ≤2.5 | 0.15–0.30 | ↑ OOM history/JVM; ↓ dev | OOM protection | linear |
| Sensitivity ↔ `applyThresholdStrategy` | Min %Δ to trigger apply | 10% (fixed) or dynamic | % or dynamic formula | **dynamic** | ↓ noisy restart-loops; ↑ convergence speed | churn/restarts if too low | minor |
| Look-back ↔ `*.lookBackPeriod` | Observation window | 1 day | 3h–7d | 3–7d for weekly patterns | ↑ seasonality; ↓ fast-changing | stale vs. reactive recs | neutral–medium |
| Min/Max constraints ↔ `*.min/max` | Clamp recommendations | none | quantity | always set min floors in prod (boot needs); max caps on huge nodes | — | prevents too-small recs; caps prevent over-provision | protects both ways |
| CPU limit ↔ `vertical.cpu.limit` | Limit handling | keep/no-limit per chart config | noLimit/keepLimits/multiplier/maintainRatio + flags | keepLimits or multiplier 2.0 if org mandates limits | — | throttling if limits kept low | affects burst, not requests |
| Memory limit ↔ `vertical.memory.limit` | Limit handling | **Automatic: ≤1.5×req, floor 128Mi** | same option set | maintainRatio/keepLimits for Java; avoid removing limits under compliance | — | OOM behavior | none directly |
| Startup metrics ↔ `vertical.startup.period` + mode | Startup CPU treatment | regular | 2–60m (custom) | "Startup recommendations" on K8s 1.33+ | — | slow startups if regular on JVM/.NET | tiny over-reserve during startup |
| Confidence threshold ↔ `vertical.confidence.threshold` | Min confidence to apply | 90% (policy field) | 0–1 | keep 0.9; lower (0.5–0.8) for dev/faster value | ↓ faster time-to-value; ↑ conservative | premature recs when low | neutral |
| Stall detection ↔ `anomalyDetection.cpuPressure.*` | PSI-based upscaling | thresholds per policy (see 5.7); pod threshold 50% | 1–100% both | keep policy default; widen for batch | ↑ sensitivity for critical; ↓ noisy batch | missed contention vs. churn | upscales cost money when triggered |
| Container exclusions ↔ `excludedContainers` | Skip listed containers | none | names | exclude mesh proxies/agents | — | squeezing infra sidecars breaks pods | neutral |
| Predictive CPU ↔ `vertical.predictiveScaling.cpu.enabled` | Forecast-based CPU | off | on/off | enable for periodic non-HPA workloads | — | wrong forecasts add churn | can cut peak overprovisioning |
| HPA converter ↔ `hpaConverters[].type` | Freeze HPA % target to absolute | off | `AverageValueFromOriginalRequests` | enable when WAS does VPA only under an existing HPA | — | drift→over-scale if missing | prevents replica waste |
| Downscaling applyType ↔ `vertical.downscaling.applyType` | Downscale gating | same as applyType | immediate/deferred/**notAllowed** | `notAllowed` for fragile statefuls | — | restart avoidance | keeps some waste |
| Memory-event applyType ↔ `vertical.memoryEvent.applyType` | OOM reaction gating | immediate | immediate/deferred/**notAllowed** | keep immediate (safety) | — | unsafe to disable | none |
| ResourceQuota ↔ `vertical.resourceQuota` (policy Helm/console) | Quota-aware scaling | off | + headroom % | enable in quota-strict namespaces | — | blocked applies if quota full | prevents quota failures |
| JVM ↔ `vertical.jvm.enabled/autoInstrument` | Heap-based memory sizing | off | on/off + method | enable for all Java services | — | wrong sizing without it on Java | big on heap-heavy apps |

## 5.1 Percentiles (CPU p50–max, memory max/p99)

- **What it controls →** the percentile of historical usage the recommendation targets; computed as the **average target percentile across all pods** over the recommendation period (`max`/100% switches to the maximum observed value over the period, no averaging).
- **[Default] →** CPU `p80`, memory `max`. Range: CPU p50–max; memory typically `max` or `p99`, rarely lower.
- **[Suggested] →** CPU p80 standard web; p90 latency-critical; p60–p70 dev. Memory: leave at `max`; lower only with JVM-heap sizing or proven tolerance.
- **When to tune →** after 1–2 weeks observing throttle rate (`container_cpu_cfs_throttled_seconds_total`) and OOM events.
- **Validation →** compare `kubectl get recommendations` CR values vs `kubectl top pod`; watch 95p latency.
- **Risk/Rollback →** lower CPU percentile = throttling risk; lower memory = OOM risk. Rollback = raise percentile/overhead; eviction applies new values (immediate) on next reconcile.
- **HPA caveat →** with HPA active, **CPU percentile is ignored** — the coordination algorithm picks CPU candidates via simulation ([source](https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa#vpa-setting-availability)).

## 5.2 Overhead (CPU 10–20%, memory 10–30%)

- **What →** % buffer added to the recommendation (100m rec + 10% → 110m). **[Default]** 10%/10%; typical ranges CPU 10–20%, memory 10–30%; **max 250%**; minimum overhead **30m CPU / 100Mi memory** (applied relative to `max` targets).
- **[Suggested] →** 0.10–0.15 CPU / 0.15–0.25 memory general; 0.3 memory for OOM-history workloads.
- **Tune when →** throttling at low percentile → raise CPU overhead before raising percentile (cheaper granularity); repeated OOM at `max` → raise memory overhead and check `memoryEvent` response.
- **HPA caveat →** with HPA active, **CPU overhead is replaced by native overhead calculation** (keeps headroom below HPA threshold automatically); memory overhead stays configurable.
- **Rollback →** set back toward 0.10; veriy via recommendation CR `requests`.

## 5.3 Sensitivity / apply thresholds (`applyThresholdStrategy`)

- **What →** minimum % difference between current requests and the recommendation that triggers an apply. **[Default]** 10% fixed in console terms; annotation strategies: `defaultAdaptive` (dynamic), `percentage` (fixed), with `percentage/numerator/denominator/exponent` knobs.
- **Percentage** = same threshold for all sizes (best when a policy covers similar workloads). **Dynamic (docs: recommended)** = threshold shrinks as workload size grows (example: 0.1 CPU request → threshold ≈45%).
- **[Suggested] →** dynamic for all mixed policies; fixed 5% for critical services needing tight tracking; 15–20% for noisy batch fleets to cut churn.
- **Validation →** the policy UI ships a sensitivity simulation graph per request size; event log "Recommendation generated/applied" cadence.
- **Risk →** too low → restart churn (immediate mode); too high → stale oversized requests.

## 5.4 Look-back period (3h–7d per resource)

- **[Default]** 1 day; settable separately for CPU and memory (`*.lookBackPeriod`, e.g. `25h`, `30h`, `3d`).
- **[Suggested]** 3–7d when weekly seasonality matters (retail, B2B weekly cycles); 1d for spiky consumer traffic. Docs advise waiting **~a week before enabling WAS for all workloads** so weekdays/weekends are represented.
- **Interaction with confidence:** longer look-back ⇒ confidence builds over ~40% of the period (7d look-back ⇒ ~3 days to full confidence).

## 5.5 Constraints (min/max)

Clamp recommendations for all containers of the workload; per-container overrides at `vertical.containers.{name}.cpu/memory.min/max`. **[Suggested]** production floors sized to boot-time requirement (e.g. Java services min cpu 250–500m), max caps to prevent a single workload exceeding node allocatable fractions. `jobLikeMinCpuRequest` default **50m** floors job-like workloads. Constraints also clamp **node-allocatable-% sizing** (Ch. 8).

## 5.6 Limits management

CPU options: **Remove limits / Keep existing / Keep original ratio / Semi-automatic / Custom multiplier (≥1.0)**. Memory options: **Automatic ([Default]: 1.5×req, floor 128Mi) / Remove / Keep / Original ratio (1.5× fallback if none) / Custom multiplier**. Never lowers an existing limit below computed value. `onlyIfOriginalExist`, `onlyIfOriginalLower` flags refine when multipliers apply. CAST AI notes limits aren't recommended on WAS-managed workloads, but org compliance may mandate them → prefer `keepLimits` or `maintainRatio` so WAS never silently widens blast radius. JVM: with auto-instrumentation, heap awareness makes container `max` safe; keep limit ≈ heap + non-heap allowance.

## 5.7 Stall detection (PSI; K8s ≥1.34, exporter ≥v0.67.0)

- **What →** upscale when CPU stall time exceeds thresholds (measured per 5-minute window; 50% ⇒ >2.5 min stalled). Response: ↑percentile, shorter look-back, ↑overhead; 15‑min re-eval cooldown; visible as "CPU stall detected" event.
- **Policy defaults ([Default]):** cost-saving 30% · burstable 50% · balanced 10% · stability/resiliency 5% · pod threshold 50%, custom policies inherit balanced.
- **Activation only when:** kind ≠ DaemonSet, VPA enabled, if HPA exists it's already at max replicas, latest recommendation is on-cluster and >1 min old, thresholds exceeded, cooldown elapsed.
- **Verify:** `kubectl top pod` shows usage but stall is hidden — trust the exporter PSI signal; event log entries confirm.
- **Tune:** raise both thresholds for batch; lower pod threshold for single-pod services where one stalled pod matters.

## 5.8 Startup handling (period 2–60m; 3 modes)

Regular (include startup samples) · **Startup recommendations (docs-recommended)** — original CPU requests for the startup period, then in-place resize to optimized values (needs K8s 1.33+, WAS v0.63.1+; CPU-only; phases skipped if Δ<100m) · Ignore (legacy). **[Suggested]** startup-recommendations mode for JVM/.NET and slow-boot services; set `startup.period` to p95 boot time + margin.

## 5.9 Confidence

`confidence.required` (default false — docs advise leaving off) vs `confidence.threshold` (policy default **90%**; lower 50–80% = faster value, higher 95–100% = more conservative). Gradual scaling schedule for new clusters (<2.4h→≤10% adjust, <6h→25%, <24h→35%, then confidence-based). Manually enabled workloads (annotation/UI) **bypass** gradual scaling. ⚠️ Cluster hibernation pauses metric intake → stalls confidence building.

## 5.10 HPA converter (`hpaConverters: [{type: AverageValueFromOriginalRequests}]`)

Converts an existing HPA's percentage utilization target to a **fixed absolute target** computed from the workload's *original* requests, preventing drift when WAS rightsizes requests (example in docs: 50% of 1000m → 500m; after requests drop to 200m, scaling intent is preserved). Options: `computedValues` fallback, `minReplicas` with `preserveOriginal`. Watch for: target set too low vs actual usage → HPA scales to max; recommendation growing past converted target → scaling never triggers (check `kubectl get hpa` `averageValue` vs metrics). Use when WAS does vertical-only under your existing HPA; not needed when WAS also manages the HPA (Ch. 7).

## 5.11 Downscaling & memory-event gating

`vertical.downscaling.applyType`: `immediate | deferred | notAllowed` — choose `notAllowed` for stateful workloads where any automated downscale restart is unacceptable; upscales still flow. `vertical.memoryEvent.applyType` controls OOM-triggered memory bumps — keep `immediate`; `notAllowed` is dangerous.

## 5.12 OOM behavior (built-in, not a knob)

On OOMKill (or JVM internal OOM with heap sizing): recommendation immediately floors memory near **peak usage ×1.2**, immediate re-optimization bypasses rollout delays, anti-flapping adjusts every ≥2h; optional auto-disable after repeated OOMs in <10min interval (once every 24h), shown as "Optimization disabled" event ([Overview → Handling OOM](https://docs.cast.ai/docs/workload-autoscaling-overview#handling-oom-events)). Rollback of auto-disable: re-enable optimization on the workload.

## 5.13 Per-container & pod-level controls

`vertical.containers.{name}.*` overrides (incl. per-container `jvm`), `excludedContainers`, `vertical.pod.cpu/memory` (pod-level resources on K8s 1.34 — WAS converts pod-level specs; percent-based sidecar ops excluded), `containersGrouping` for uniform secondary containers.
