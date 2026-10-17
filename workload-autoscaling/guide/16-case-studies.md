# Chapter 16 — Real-World Engineering Examples

All numbers below are **hypothetical illustrations with explicit assumptions** — product mechanics cited are documented; savings math follows Ch. 13 (modeled unless nodes consolidate). [Suggested] values are starting points, not CAST AI defaults.

## Case 1 — CPU-overprovisioned stateless API
- **Before:** Deployment `checkout-api`, 8 replicas, req `cpu: 1000m / mem: 1Gi`, no limits, no HPA. Observed: p80 CPU 180m, max 340m; memory max 620Mi.
- **Policy:** custom `standard-web`: optimization on, immediate, `rolloutBehavior {NoDisruption, preferOneByOne, delaySeconds:120}`, excluded `istio-proxy`; CPU p80 + overhead 0.15 [Suggested]; memory `max` + 0.15 [Suggested]; look-back 3d; constraints cpu 100m–2000m / mem 256Mi–2Gi; sensitivity dynamic.
- **Expected requests:** CPU ≈ 180m×1.15 ≈ **207m** (p80 across pods, average-based) → ~79% CPU request cut; memory ≈ 620Mi×1.15 ≈ **713Mi**.
- **Safeguards:** min floor covers boot; eviction delay between pod re-creates; PDB `maxUnavailable: 1` verified.
- **Savings (modeled):** 8×(1000−207)m ≈ 6.3 CPU × 730h ≈ 4,627 CPU-h × $0.031 ≈ **$143/mo** on requests; realized only after consolidation.
- **Monitor/rollback:** throttle ratio + p95 latency; abort = policy automation off.

## Case 2 — Memory-sensitive JVM service
- **Before:** `pricing-service`, 4 replicas, req `cpu: 500m / mem: 3Gi`, `-Xmx2g`; container working set shows ~2.8Gi (heap preallocation), repeated `java.lang.OutOfMemoryError` in logs, zero K8s OOM events.
- **Policy:** `jvm-services`: `jvm.enabled + autoInstrument` (Java 17, inline JAVA_OPTS — eligible); memory from **heap** data; memory overhead 0.2 [Suggested]; CPU p85 + 0.15; startup metrics = **startup recommendations**, `startup.period: 7m` (measured p95 boot); K8s 1.33+ cluster.
- **Expected:** container request ≈ heap-need + non-heap allowance (e.g. ~2.3–2.6Gi with overhead vs 3Gi original), memory-informed OOM flooring on JVM internal OOM (Ch. 5.12).
- **Watch:** Gatekeeper/Kyverno must allow the JMX init container; verify JVM badge in console; if startup+JVM conflict → falls back to single-phase (documented).

## Case 3 — HPA-managed variable-traffic microservice
- **Before:** `search-api`, HPA v2: min 4 / max 30, target CPU 70% (utilization), req `cpu: 800m`. After enabling WAS vertical-only, pods started scaling to max — classic drift: 70% of a rightsized 250m request now means 175m.
- **Fix:** add converter:
  ```yaml
  workloads.cast.ai/configuration: |
    hpaConverters: [{type: AverageValueFromOriginalRequests}]
  ```
  → target frozen at **560m** absolute (70%×800m) regardless of request changes. Later, optionally move to WAS-managed HPA (ownership takeover: CPU-triggered native HPA = eligible), letting simulation calibrate CPU (CPU percentile/overhead then auto-managed — by design).
- **Validate:** `kubectl get hpa search-api` shows `averageValue: 560m`; event log shows "Calibrating for HPA".

## Case 4 — StatefulSet with strict availability
- **Before:** `kafka`, 5 brokers, req `cpu: 2 / mem: 8Gi`, limits kept, PDB `maxUnavailable: 1`, readiness probes OK.
- **Policy:** `resiliency`-based: **deferred** apply; `downscaling.applyType: notAllowed` [Suggested]; memory `max` overhead 0.3 [Suggested]; CPU p90 + 0.2 [Suggested]; limits `keepLimits`; look-back 7d.
- **Behavior:** recommendations accumulate; applied on rolling restarts (operator/maintenance) — zero WAS-initiated disruption; upscales can go immediate-only via per-direction config if an incident demands it.
- **Note:** if immediate is mandated later, verify PDB allows evictions and use `preferOneByOne` + `delaySeconds: 300`.

## Case 5 — Low-traffic dev workload
- **Before:** `reports-svc` (dev), 2 replicas, req `cpu: 500m / mem: 512Mi`; p80 CPU 15m, memory max 140Mi.
- **Policy:** `cost-savings` + automation on; CPU p60 + overhead 0.05 [Suggested]; memory `max` + 0.10; constraints cpu 25m–500m.
- **Expected requests:** ≈25m floor CPU / ~154Mi mem → **~95% CPU request cut**; acceptance: occasional throttling during dev builds tolerable.
- **Gotcha:** if this workload runs monthly batch days with no metrics in the trailing 7 days, WAS stops regenerating recs — keep an annotated floor or accept it.

## Cross-case rollup (illustrative math)

| Case | CPU req saved (cluster) | Mem req saved | Modeled $/mo (assumed $0.031/cpu-h, $0.004/GiB-h) |
|---|---|---|---|
| 1 | ~6.3 cores | ~2.3 GiB | ~$150 |
| 2 | ~0.4 cores | ~1.6 GiB | ~$14 |
| 3 | ~2.2 cores (avg over replicas) | — | ~$50 |
| 4 | 0 (deferred/notAllowed) | 0 | $0 (by design) |
| 5 | ~1 core | ~0.7 GiB | ~$25 |

**Report as "available/potential" until node capacity shrinks; only consolidation converts modeled → realized (Ch. 13.1/13.4).**
