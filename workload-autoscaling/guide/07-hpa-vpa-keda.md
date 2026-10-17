# Chapter 7 — VPA, HPA & KEDA Interaction

Sources: [HPA](https://docs.cast.ai/docs/horizontal-pod-autoscaling) · [VPA+HPA coordination](https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa) · [KEDA compatibility](https://docs.cast.ai/docs/woop-hpa-third-party-support) · [HPA converter](https://docs.cast.ai/docs/woop-configuration-settings#hpa-converter) · [Legacy migration](https://docs.cast.ai/docs/woop-hpa-how-to-migrate) · HPA configure/policies how-tos (index-level)

## 7.1 The core problem

HPA utilization targets are **percentages of requests**: 50% of a 1000m request = 500m. If WAS cuts the request to 200m, the same HPA now targets 100m — the workload scales out to max for no real reason. Any WAS+HPA setup must handle this interaction one of three ways:

1. **WAS manages the HPA** (native autoscaling/v2 objects reconciled by WAS) — full coordination.
2. **Your HPA + WAS vertical-only + HPA converter** — freezes scaling intent into absolute targets.
3. **Third-party controller (KEDA)** — WAS vertically optimizes with strategy depending on metric types.

## 7.2 WAS-managed native HPA

- Min versions: `castai-workload-autoscaler` **v0.44.x+**, agent **v0.60.0+**. Kinds: Deployment, StatefulSet, ReplicaSet, Rollout.
- Config at **policy** (recommended) or **workload** level via console/API/annotations. WAS reconciles real `HorizontalPodAutoscaler` objects → fully visible in `kubectl get hpa`.
- Workload-level change = **full-object override** (unlike field-level vertical overrides); overrides persist across policy moves; reset via `ResetSystemOverrides`.
- **Take ownership** of pre-existing native HPAs: eligible only when NOT managed by a third-party controller and triggers are CPU and/or memory utilization (external metrics or container-level targets are **not eligible** in current release). On ownership transfer, WAS replaces the HPA spec with policy/workload config — that config becomes the single source of truth. Revert = delete the WAS-managed config / move policy without ownership; recreate your HPA manifest (GitOps).

## 7.3 Automatic VPA+HPA coordination (always on, no toggle)

For workloads scaled in both dimensions, WAS runs a **simulation** per recommendation cycle: replays observed load against candidate CPUs, scoring resource cost, CPU delay, saturation risk, scaling churn ("stable scalability"), snowball-replica risk, and node overhead; then **calibrates** away from the raw percentile when a nearby candidate scores better (event-log JSON view: step `"Calibrating for HPA"` with `statsCalibrated` vs `statsOriginal`/`statsLowestCost`).

Memory side: after vertical memory changes, WAS automatically adjusts memory requests to keep typical usage **below the HPA memory threshold** (stacks on top of configured memory overhead).

**Consequences (documented):** with HPA active — CPU **percentile** and CPU **overhead** user settings are **ignored** (automatic native overhead keeps headroom below the HPA threshold); memory settings stay configurable. With custom-metric-only horizontal scaling, CPU overhead is still auto-managed and overrides your setting.

Also note: **predictive scaling is auto-disabled** for HPA-managed workloads.

## 7.4 KEDA strategies (ScaledObjects ✓ / ScaledJobs ✗)

| ScaledObject triggers | WAS behavior |
|---|---|
| CPU and/or memory only | **Full** simulation-based coordination, calibration allowed |
| CPU/memory **+ custom metrics** | Simulation runs; **limited** calibration distance from detected percentile; KEDA scaling decisions respected |
| Custom metrics only | Vertical optimization continues; **no** coordination algorithms |

KEDA-generated HPAs are treated as third-party-owned → not eligible for WAS ownership; workloads with KEDA HPAs keep their scaling config in the ScaledObject.

## 7.5 HPA converter (vertical-only under your own HPA)

```yaml
workloads.cast.ai/configuration: |
  hpaConverters:
    - type: AverageValueFromOriginalRequests
      # optional: computedValues fallback, minReplicas: {mode: preserveOriginal}
```
Converts % targets into absolute `averageValue`s computed from original requests. Failure modes (documented): converted target **below** current usage → scales to max; recommendation **above** converted target → scaling never triggers. Verify with `kubectl get hpa` (target column) vs `kubectl top pod`.

## 7.6 Anti-oscillation tuning

- Use HPA `behavior`: scale-down `stabilizationWindowSeconds` 300–600s, scale-up short (0–60s); per-direction `tolerance` is supported in WAS-managed HPAs.
- Sensitivity (Ch. 5.3) high enough to avoid VPA churn fighting HPA churn.
- Startup: choose "startup recommendations" so boot spikes don't push HPA to max (snowball effect is explicitly modeled as a cost/instability factor by the simulator).
- For memory-HPA workloads keep memory overhead ≥0.15 so side-effect corrections are rare.

## 7.7 Legacy horizontal scaling → native HPA migration

Migration preserves `minReplicas`/`maxReplicas` and creates native HPA objects. Readiness states reported by `GetHpaV2MigrationEligibility`: `Full` (all API-managed → automated), `Partial` (annotation-managed need manual re-annotation), `Blocked` (all annotation-managed), `None`. Console/API paths documented in the [migration guide](https://docs.cast.ai/docs/woop-hpa-how-to-migrate) (+ `MigrateClusterToHpaV2` API). Plan: snapshot current legacy configs → migrate a dev cluster → validate `kubectl get hpa` + behavior under load → proceed per environment.

## 7.8 Verification snippets

```shell
kubectl get hpa -A                                  # WAS-managed HPAs are ordinary objects
kubectl describe hpa <name> -n <ns>                 # behavior, targets, events
kubectl get recommendations.autoscaling.cast.ai -n <ns> <wl> -o yaml | yq '.spec'
# Event log → "Recommendation generated" → JSON view → "Calibrating for HPA" step
```
