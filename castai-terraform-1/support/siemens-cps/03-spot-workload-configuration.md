# 03 — Workload-Level Spot Configuration (share with Siemens)

**Audience:** Siemens CPS platform team · **Scope:** how to steer workloads onto Spot nodes in a
Cast AI autoscale cluster · **Sources:** [Spot Instances](https://docs.cast.ai/docs/spot),
[Node templates](https://docs.cast.ai/docs/node-templates),
[Pod mutations — Spot configuration](https://docs.cast.ai/docs/pod-mutations-reference#spot-configuration)

> ⚠️ **Correction vs. meeting notes:** the label is **`scheduling.cast.ai/spot`** (plural
> "scheduling"). The transcript's `schedule.cast.ai/spot` will not match any node.

## 1. The primitives

| Kind | Value | Meaning |
|---|---|---|
| Node label + taint | `scheduling.cast.ai/spot` | Present on every Cast AI Spot node (also tainted `NoSchedule`). |
| Node label | `scheduling.cast.ai/spot-fallback="true"` | Marks the temporary on-demand replacement node when Spot capacity is unavailable (fallback feature). |
| Node label | `autoscaling.cast.ai/draining=<reason>` | Why a node is being replaced: `spot-prediction`, `spot-interruption`, `spot-fallback`, `rebalancing`, `manual`. Also tainted `autoscaling.cast.ai/draining=true`. |

## 2. Per-workload modes (choose per deployment)

**A. Spot-tolerant only** — pod may land anywhere: toleration alone.

```yaml
tolerations:
  - key: scheduling.cast.ai/spot
    operator: Exists
```

**B. Spot-only** — force onto Spot (autoscaler creates only spot nodes for it):

```yaml
tolerations:
  - key: scheduling.cast.ai/spot
    operator: Exists
nodeSelector:
  scheduling.cast.ai/spot: "true"
```

**C. Spot-preferred with on-demand fallback** (recommended default for the 50/50-style states):

```yaml
affinity:
  nodeAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 1
      preference:
        matchExpressions:
        - key: scheduling.cast.ai/spot
          operator: Exists
tolerations:
  - key: scheduling.cast.ai/spot
    operator: Exists
    effect: NoSchedule
```

## 3. Splitting replicas (e.g. 50/50 across Spot and On-Demand)

Use **Pod mutations** (`spotConfig`) instead of editing every manifest — admission-time injection:

- Modes: `only-spot`, `preferred-spot`, `optional-spot`
- `distributionPercentage`: fraction of the workload's replicas targeted at Spot; remainder stays
  on on-demand (e.g. `50` ⇒ ~50/50).

## 4. Interruption behavior & fallbacks (what the demo claims were)

- AWS gives a **2-minute Spot interruption notice**; GCP/Azure ~30s
  ([docs](https://docs.cast.ai/docs/spot)).
- **Spot Fallback:** on Spot shortage or interruption, Cast AI temporarily upsizes an on-demand
  node and swaps back when Spot inventory returns; the retry interval (e.g. 30 min, as discussed)
  is configured per node template.
- **Interruption prediction model** can proactively rebalance a node *before* the 2-minute notice
  (this is the mechanism behind the "up to ~30 minutes earlier" statement from the meeting —
  proactive rebalance on ML signal, well ahead of the 2-minute notice).
- **Spot Reliability:** ML picks longer-lived Spot pools, with a configurable max price tolerance
  (`enableSpotReliability`, `spotReliabilityPriceIncreaseLimitPercent`) on the node template.

## 5. The "two templates" alternative (also results in stable/spot pools)

- Template "stable": on-demand, e.g. your T3a/Turbo families.
- Template "spot": spot enabled + spot fallback + retry interval.
- Then workloads pick a pool with the usual template taint/toleration mechanics. This matches the
  meeting's "two-template approach".

## 6. Recommended preparation for Spot workloads

- PodDisruptionBudgets for minimum availability.
- `preStop` hooks sized to the 2-minute notice.
- Watch `autoscaling.cast.ai/draining=*` to observe drain reasons in audits.

*(Quotas, recent-interruption cooling, and org/cluster blocklists can momentarily exclude a given
type from the inventory — see [troubleshooting](https://docs.cast.ai/docs/spot#general).)*
