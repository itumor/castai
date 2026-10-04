# NGM clusters — Evictor, Rebalancing, Hibernation, Spot: recommended settings per cluster

Companion to `RECOMMENDATIONS-node-templates-configs.md` / `OUTBOX-ngm-node-tuning-email.md`. All current values verified live 2026-10-04 (`deep-audit-2026-10-04/`), docs: [Evictor](https://docs.cast.ai/docs/evictor), [Rebalancing](https://docs.cast.ai/docs/rebalancing), [Cluster hibernation](https://docs.cast.ai/docs/autoscaling-cluster-hibernation), [Spot](https://docs.cast.ai/docs/spot).

---

## 1. Evictor — the "Incompatible" decision comes first

**Live state (all 3 clusters, identical):**

```json
"evictor": { "enabled": true, "allowed": false, "status": "Incompatible",
  "dryRun": false, "aggressiveMode": false, "scopedMode": false,
  "cycleInterval": "1m", "nodeGracePeriodMinutes": 10,
  "podEvictionFailureBackOffInterval": "30s", "ignorePodDisruptionBudgets": false,
  "cleanupKarpenterNodes": true, "softTainting": false }
```

`evictor-advanced-config`: empty on all three. `Incompatible` = CAST AI detected a **self-managed** Evictor install; none of these settings are changeable from the console until you decide:

**Option A (recommended): switch to CAST-managed**

```shell
helm upgrade castai castai-helm/castai -n castai-agent \
  --reset-then-reuse-values \
  --set autoscaler.castai-evictor.managedByCASTAI=true
```

**Option B: keep self-managed** — same parameters below, set as Helm values.

**Recommended values per cluster** (sized by observed 30d peak nodes: helios 574, integ 885, kronos 104):

| Setting | ngm-helios (prod) | ngm-integ (test) | ngm-kronos (dev) | Rationale |
|---|---|---|---|---|
| `dryRun` | `false` | `false` | `false` | already live |
| `aggressiveMode` | `false` | **`true`** | `false` | integ's single-replica batch/reindex pods are the packing blockers; acceptable in test. Jobs will be interrupted on evict — use `disposable` selectors (below) for known batch namespaces instead if that's too blunt |
| `scopedMode` | `false` | `false` | `false` | ~95% of nodes are CAST-managed; scoping adds nothing |
| `cycleInterval` | **`10m`** | **`10m`** | `1m` | docs sizing table: 500+ nodes → 10m; overlapping 1m cycles on 574/885-node peaks cancel drains mid-flight |
| `maxTargetNodesPerCycle` | **`5`** | **`5`** | `20` (default) | same table; kube-apiserver pressure control at scale |
| `nodeGracePeriodMinutes` | `10` (keep) | `10` (keep) | `10` (keep) | matches JVM/slow-start workloads; raise if rebalances disrupt fresh nodes |
| `ignorePodDisruptionBudgets` | `false` — never true on prod | `false` | `false` | safety |
| `softTainting` | `false` | `false` | `false` | only useful behind a third-party autoscaler; you have none |
| `cleanupKarpenterNodes` | `true` | `true` | `true` | no-op without Karpenter; harmless |
| `podEvictionFailureBackOffInterval` | `30s` | `30s` | `30s` | — |

**Advanced config addition for integ** (instead of global aggressive mode, if preferred) — via `castai-evictor-config` ConfigMap with `charts.cast.ai/managed: "false"`:

```yaml
evictionConfig:
  - podSelector:
      namespace: "it-*"             # batch/reindex tenants
      kind: CronJob
    settings:
      disposable: { enabled: true }
  - podSelector:
      namespace: "csc-runner-0"     # gitlab runner
    settings:
      removable: { enabled: true }  # single-replica runner eviction
  - nodeSelector:
      labelSelector:
        matchLabels:
          autoscaling.cast.ai/removal-disabled: "true"
    settings:
      removalDisabled: { enabled: true }   # codifies the live pins (2/1/1 nodes)
```

**Pre-flight before enabling anywhere (prod especially):** `kubectl get pdb -A` — fix any PDB where `minAvailable == replicas` (zero-disruption PDBs stall drains); review the live `removal-disabled` pins (helios 2, integ 1, kronos 1); Evictor always respects PDBs regardless of mode.

---

## 2. Rebalancing — keep the schedules, tune thresholds and gentleness

**Live schedules (all enabled):**

| Cluster | Schedule | Window | Targets | Min savings | Algorithm |
|---|---|---|---|---|---|
| helios | prescale / postscale / **hourly-nightly** | 22:00–03:59 Europe/London hourly | 50 nodes/run | 5% | UtilizedPrice |
| integ | postscale / **hourly** | hourly | (same launch config family) | 5% | UtilizedPrice |
| kronos | prescale / postscale / hourly / **ami-update-weekly** | mixed | — | 5% | — |

Today both "skipped" and "failed" runs trace to `achievedSavingsBelowThreshold` — benign (on-demand curve converged). Recommendations:

1. **Lower `executionConditions.achievedSavingsPercentage` 5 → 2%** on integ + kronos. Their per-plan savings are small by design (integ reshuffles constantly, kronos is tiny); at 5% the plans correctly bail, but a 2% floor keeps micro-wins flowing without thrash. Keep helios at 5%.
2. **`evictGracefully: true` on helios's nightly** plan — drained-but-blocked nodes get cordoned and kept instead of force-drained at `drainTimeoutSec`; gentler on prod, next night's run retries.
3. **`keepDrainTimeoutNodes: false`** already correct.
4. Keep `minNodes: 1`, `nodeTtlSeconds: 300`, `numTargetedNodes: 50` as-is (helios).
5. After the WOOP/rightsizing and spot-template changes land, **rerun full-cluster rebalances** — the converged curve opens up again.
6. Known blockers stay on the exceptions list: zone-pinned PVCs (`scada-dp-server`, `valkey` on integ) and removal-disabled nodes — plans skip them; that's correct behavior, not failure.

---

## 3. Hibernation — none exists today; one candidate cluster

Org-wide `hibernation-schedules` → **empty**. Recommendation per cluster:

| Cluster | Hibernation? | Shape |
|---|---|---|
| **kronos** | **Yes — pilot** (weekend collapse to 14 vCPU is already observed behavior) | `pauseConfig.cron: "0 20 * * FRI"` Europe/Berlin, `resumeConfig.cron: "0 7 * * MON"`. Resume `jobConfig.nodeConfig`: `{ "instanceType": "m6a.xlarge", "spotConfig": { "spot": false }, "zone": "eu-central-1a" }`. Save ≈ 59 h/wk ≈ 35% of kronos compute ≈ **~$0.7k/mo**. Confirm with the team that weekends are truly idle (today's snapshot shows 3 nodes on a Sunday — strongly suggests yes) |
| integ | No (for now) | nightly/weekend test runs are unpredictable; the spot-batch template + aggressive-mode evictor capture the same money without an on/off boundary. Revisit if a test calendar exists |
| helios | **No** | production — hibernation is for non-prod by design |

**Prerequisites before the kronos pilot** (clusters onboarded 2025-09-30 → pre-October-2025 rule applies):

1. EKS hibernation IAM permissions: re-run the Phase-2 onboarding script **or** Terraform provider ≥ v7.74.0 re-apply.
2. If the node IAM role authenticates via **aws-auth ConfigMap** (check: `aws eks describe-cluster --query 'cluster.accessConfig.authenticationMode'`): set `eks.nodeGroupArn` in the **default** node configuration to a dedicated resume role — otherwise resume node-group deletion removes the role from aws-auth and breaks the remaining cluster.
3. `CriticalAddonsOnly` toleration on all critical components (CNI, DNS, castai-agent, cluster-controller, pod-mutator, workload-autoscaler). Cast agent v0.161.1 exceeds the minimum appVersions — verify chart versions with `helm list -n castai-agent`.
4. Check for Gatekeeper/Kyverno webhook deadlock risk (docs section) if policy engines present.
5. Node count well under the ~1000-node hibernation ceiling ✓. Note PVs keep billing during hibernation.

---

## 4. Spot — staged rollout (values match the email draft)

| Cluster | Stance | Concrete values |
|---|---|---|
| **integ (P1, now)** | dedicated tainted template **`spot-batch`** | `spot: true, onDemand: true, useSpotFallbacks: true, fallbackRestoreRateSeconds: 300, enableSpotReliability: true (price limit +20%), spotInterruptionPredictionsEnabled: true (type: castai-predictions), shouldTaint: true, azs: [a,b,c], maxCpu: 32, minCpu: 4, cpuLimitMaxCores: 6000`. Observed discount: m6a.24xlarge −62.8%. Scenario ceilings: integ SpotInstances −16.3% / SpotOnly −57.6% (listing basis) |
| **kronos (P2)** | flip default template to spot-with-fallback after the integ pilot proves itself | same flags as above, `shouldTaint: false` (dev cluster, wide tolerance). SpotOnly ceiling: **−84%** of $2.3k/mo |
| **helios (P3)** | hold | Namespace-gated pilot only after: PDB audit clean, evictor CAST-managed, cqa2/uxpt batchish workloads identified with PDBs. SpotOnly ceiling −64.3% of listing basis. Non-negotiable until then: `spot: false` on default template |

Housekeeping regardless of rollout: replace deprecated `spotInterruptionPredictionsType: aws-rebalance-recommendations` with the CAST AI prediction model on all templates.

---

## Cross-cutting sequencing

1. Evictor decision (managedByCASTAI) → integ first, then kronos, helios last after PDB audit.
2. Rebalancing threshold fix (5→2% integ/kronos) + gracefully on helios — zero-risk, do now.
3. Kronos hibernation prerequisites (IAM/script, nodeGroupArn, tolerations) → pilot one weekend.
4. Spot: integ template → kronos default flip → helios namespace pilot.

Live evidence: `deep-audit-2026-10-04/{helios,integ,kronos}/{policies.json, rebalancing-jobs.json, sched-*.json, evictor-advanced.json, failed-plan.json}`.
