# Chapter 4 — Scaling Policies: Complete Engineering Guide

Sources: [Scaling policies](https://docs.cast.ai/docs/woop-scaling-policies) · [Create](https://docs.cast.ai/docs/woop-scaling-policies-create) · [Manage](https://docs.cast.ai/docs/woop-scaling-policies-manage) (verified at index level) · [OpsPilot policies](https://docs.cast.ai/docs/woop-scaling-policies-opspilot) (index level)

## 4.1 What a policy is

A scaling policy is the **central unit of WAS configuration**: vertical settings (percentile targets, overhead, thresholds, constraints, look-back, startup handling, stall detection, HPA converter, container exclusions), automation on/off, apply mode, and optionally **native-HPA horizontal settings** (min/max replicas, CPU/memory triggers, behavior, ownership). Assigned workloads inherit the policy; workload **annotations override** policy fields (field-level for vertical; **full-object override** for horizontal).

> CAST AI strongly recommends policy-driven management with automatic assignment rules instead of per-workload console edits — the console can't even edit per-workload vertical settings; only annotations can ([settings](https://docs.cast.ai/docs/woop-configuration-settings#configuration-scope-and-hierarchy)).

## 4.2 System policies (verified list)

| Policy | Optimization | Intent (per docs) |
|---|---|---|
| `resiliency` | **Off by default** | Maximum reliability; StatefulSets auto-assigned here |
| `balanced` | Off | Optimal balance of cost vs stability/performance |
| `cost-savings` | Off | Max cost efficiency with acceptable performance |
| `stability` | Off | Prioritizes stable performance over maximum savings |
| `burstable` | Off | Workloads with sudden traffic spikes |
| `readonly` | Off (by design) | Detection/reporting without any optimization |
| `default`, `default-statefulset` | — | **Deprecated**; may remain on clusters onboarded before 2025‑07‑18 |

All system policies ship with automation **off** — nothing changes your workloads until you enable it per policy or per workload. New clusters (<24h) get automatic **gradual scaling** when enabled via policies ([policies doc](https://docs.cast.ai/docs/woop-scaling-policies)).

**Which for what:** see the production policy matrix in [10-production-best-practices.md](10-production-best-practices.md).

## 4.3 Automatic assignment & rules

When WAS is enabled, workloads are **auto-profiled and assigned** to policies by labels, types, and namespaces — no manual step needed (`balanced` for most, `resiliency` for StatefulSets, etc.). Custom policy assignment rules ([create doc](https://docs.cast.ai/docs/woop-scaling-policies-create)):

- **Matching conditions — AND semantics** when multiple conditions exist on one rule (namespace AND workload name AND labels AND controller type).
- **Selectors:** namespace names, workload names, workload labels (**regex supported** on label values/namespaces), controller types (Deployment/StatefulSet/...).
- **Rule set:** multiple rules on a policy are **OR**ed.
- **Conflicts:** if a polygon matches several policies' rules, priority resolves it — **lower policy `position` wins** (manageable in console or via `SetScalingPoliciesOrder` API).
- **Stop-on-match:** evaluation stops at the first matching policy — the same workload never lands in two policies.
- Rules work on: new workloads discovered later as well (continuous assignment), already-running or read-only workloads.

Terraform note: regex patterns + advanced label operators require provider **v7.58.3+**.

### Assignment precedence (complete)

1. **Workload annotation** `scalingPolicyName` on the workload (pins it; combined with per-field annotation overrides)
2. **Manual console/API assignment** (policy attach)
3. **Assignment rules** — first matching policy by configured rule set / priority order
4. **System default profiling** (balanced / resiliency mapping)

Unknown policy name in an annotation → workload event warns "Scaling policy '<name>' not found. Using previously assigned policy: ''" ([event log](https://docs.cast.ai/docs/event-log)).

## 4.4 OpsPilot-generated policies

Instead of hand-building policies, **OpsPilot** can analyze the cluster and generate policies + assignment rules from intent ("Generate policies with OpsPilot" card in console). Recommended by CAST AI as the starting point for new clusters. Review generated rules before enabling automation — treat as a draft, then apply §4.5 discipline. ([OpsPilot doc](https://docs.cast.ai/docs/woop-scaling-policies-opspilot))

## 4.5 Lifecycle operations

- **Update:** edit policy settings; changes propagate to all assigned workloads (recommendations regenerate).
- **Reassign:** moving a workload between policies regenerates its recommendation; **workload-level horizontal overrides persist** across policy moves ([HPA doc](https://docs.cast.ai/docs/horizontal-pod-autoscaling)).
- **Disable optimization:** set automation off at the policy; recommendations still generate, nothing applies. Per workload: console toggle (the only per-workload console control) or annotation `vertical.optimization: off`.
- **Delete custom policy:** workloads fall back to default profiling assignment; verify no pinned `scalingPolicyName` references remain (they'd log the "policy not found" event above).

## 4.6 Seven ready policy skeletons (adapt names/values; **[Suggested]** values are starting points, not CAST AI defaults)

> Vertical defaults worth remembering: overhead **[Default]** 10% CPU / 10% memory (min overhead 30m CPU / 100Mi memory, applied to **max** values), apply threshold **[Default]** 10% both, look-back **[Default]** 1 day (3h–7d), applyType **[Default]** immediate.

**1. prod-critical (mission-critical stateless)**
```yaml
# Conceptual policy shape — map to console/API/TF fields
vertical: {optimization: on, applyType: immediate}   # or deferred in strict-change-control orgs
cpu:      {target: percentile(p80-p90) [Suggested], overhead: 0.15-0.25 [Suggested], lookBack: 3-7d [Suggested]}
memory:   {target: max, overhead: 0.20-0.35 [Suggested], lookBack: 3-7d}
startup:  {period: 5m; metrics: "startup recommendations" if K8s 1.33+}
constraints: min cpu/mem floors sized to SLO boot requirements; max caps to prevent node-size blowup
rolloutBehavior: {type: NoDisruption, preferOneByOne: true, delaySeconds: 120}
excludedContainers: [istio-proxy]
```

**2. standard-web** — `balanced` system policy + automation on; tweak: overhead 0.10–0.15, sensitivity dynamic, applyType immediate. 

**3. dev-cost** — `cost-savings` + automation on; percentile lower bound (p60–p70 [Suggested]), overhead 0.05–0.10, lookBack 1d, min constraints aggressive (e.g. cpu 25m). Expect occasional throttling; acceptable in dev.

**4. batch / job-like**
```yaml
schedule: {type: jobLike}
vertical: {optimization: on, applyType: deferred}     # jobs recreate frequently anyway
cpu: {target: p80 [Suggested], overhead: 0.1}
memory: {target: max, overhead: 0.25 [Suggested]}     # job OOM = failed run
# Note: WAS skips workloads with no metrics in last 7 days (e.g. monthly jobs) — keep those read-only or annotated
```

**5. stateful-resilient (DBs, brokers)** — start from `resiliency`:
```yaml
vertical: {optimization: on, applyType: deferred}     # or immediate + preferOneByOne for mature setups
cpu:    {target: p90 [Suggested], overhead: 0.2 [Suggested]}
memory: {target: max, overhead: 0.3 [Suggested], limit: {type: keepLimits|maintainRatio}}
rolloutBehavior: {type: NoDisruption, preferOneByOne: true, delaySeconds: 300}
# Respect: STRICT PDBs will BLOCK immediate applies — verify PDBs allow 1 disruption before enabling
```

**6. jvm-services** — `balanced` clone + `jvm: {enabled: true, autoInstrument: true}` (or endpoint scraping / external Prometheus per Ch. 8); memory overhead 0.15–0.25 [Suggested] *on heap-size recommendations*; keep container memory limit strategy `maintainRatio` when `-Xmx` is fixed.

**7. bursty / spiky** — `burstable` system policy + startup metrics "regular" (include startup usage) or `startup.period` tuned to real warm-up; PSI stall detection thresholds widened (e.g. `cpuStallThresholdPercentage: 30`, `minPressuredPodPercentage: 20` [Suggested]) so stalls trigger corrective upscales.

## 4.7 Anti-patterns

- Assigning prod-critical workloads to `cost-savings` "temporarily" — it is persistent config, not a mode you flip during an incident.
- Custom policy per namespace with heavy regex when one rule per label would do — rules multiply review surface.
- Leaving `scalingPolicyName` annotations in Git manifests pointing to deleted policies (drift + warning events).
- Editing per-workload settings in the console — impossible for vertical by design; use annotations or the API so intent is in code.
