# Meeting Prep — Optimization Quality Metrics & Notifications

**Context**: The Optimized Clusters list shows Cluster Scores that are not near optimal;
Guy's view is that many clusters cannot be optimized further.
**Meeting goal**: agree on (a) metrics that measure the *quality of optimization* of
onboarded clusters and (b) the notifications that keep that quality visible.
**Backup material**: full verified docs research at
`brain/notes/castai-optimization-quality-metrics-and-notifications.md` (every fact below
is sourced there; URLs in the appendix).

---

## 1. First: what the console score actually is (verified, docs.cast.ai/docs/cluster-score)

- 0–10 scale (one decimal), refreshed **hourly**, benchmarked against **all-customer
  averages**.
- **Phase gating**: read-only (Phase 1) clusters get *partial* scores — overprovisioning
  and resource utilization only. Full score requires Phase 2 (automation enabled).
  → Before debating any low score, confirm the cluster is actually in Phase 2.
- Docs' own caveat: the score **does not factor in workload complexity or
  infrastructure-specific challenges** — it should be compared against the cluster's
  *own history over time*, not against other clusters.
- **No published weights** — don't claim a formula for how the six sub-metrics roll up.

The score is **6 sub-metrics**, each bucketed Healthy 7–10 / Concerning 4–6 / Poor 0–3
(approximate ranges):

| # | Sub-metric (category) | "Healthy" means |
|---|---|---|
| 1 | Cluster Overprovisioning (Resource Provisioning) | CPU overprov < 20% **and** memory overprov < 35% |
| 2 | Bin Packing (Resource Provisioning) | Node deletion policy **On** + Evictor **On** + median node utilization > 65% |
| 3 | Node Template Consolidation (Resource Provisioning) | Utilization > 65% across templates (not too many templates) |
| 4 | Resource Utilization (Workload Resource Opt.) | Requests configured, strong utilization, **< 10% of workloads with CPU limits** |
| 5 | Workload Optimization (Workload Resource Opt.) | Workload Autoscaler enabled **and optimizing most workloads** |
| 6 | Rebalancer | ≥ 1 rebalance per 2 weeks (**Poor = none in 30 days**) |

**This changes the meeting conversation.** "Score isn't optimal" is not one finding — it
is one of six specific, documented diagnoses. For every low cluster we can name the red
sub-metric, and the threshold it is missing. Separately, Cast AI already reports
**optimization constraints** (advisory checks: missing probes, strict/misconfigured PDBs,
topology-spread gaps) which **do not affect the score** but explain the blockers behind it.

---

## 2. The core proposal: measure *captured* value, not just *remaining* potential

The score measures posture against a generic ideal and ignores constraints by design.
So pair it with a normalized economic metric:

> **Savings capture ratio = Realized savings ÷ Addressable savings**
> Addressable = full theoretical savings − savings locked by registered constraints.

Verified definitions to anchor this (docs.cast.ai/docs/savings-baseline, /savings-report):
- **Realized savings = projected cost − actual cost** (node autoscaler: bin-packing, spot,
  cheaper node types; WOOP impact is included when both are on).
- Projected cost is modeled off a **baseline** (CPU/RAM overprovisioning factors ×
  CPU/RAM unit costs) from: cluster history (needs ≥7 pre-optimization days) → peer
  clusters → industry average; cluster must be ≥14 days old and actively managed.
- Cards only appear at adoption thresholds: realized savings shown when autoscaler
  manages **≥20% of nodes**; WOOP savings when **≥20% of workloads** are in VPA mode.
- Every registered constraint must carry an estimated $ lock; realized ÷ addressable then
  becomes the defensible "quality" number alongside the score.

Suggested bands: **≥85% captured = green · 60–85% = amber · <60% = red** (red requires a
documented reason — no unexplained reds).

---

## 3. Metric framework — three layers, mapped to real sources

### Layer A — Outcome (did we save money?)
| Metric | Source |
|---|---|
| Realized savings $ and % (discounted prices) | Savings Report; `runValueRealizationTimelineReport` API |
| Available (potential) savings still on the table | Available Savings report; `GET /v1/cost-reports/clusters/{id}/estimated-savings` |
| **Capture ratio** (realized ÷ addressable) | derived |
| Baseline source & trust (history/peer/industry/overridden) | Savings Report org table |
| WOOP adoption % and managed-vs-unmanaged workload counts | value-realization API |

### Layer B — Posture (does it run tight?) = the six score sub-metrics
Overprovisioning % has a documented formula:
`100% − (Requested ÷ Provisioned × 100%)` — pull from
`GET /v1/cost-reports/clusters/{id}/efficiency` (includes per-offering on-demand/spot/
fallback splits and a `noDataReason` field: NoMetricsServer / AgentOutdated — which is
itself a health signal).
Plus: spot node-hour share, node-template count vs 65% utilization target, % workloads
with requests set, % of workloads with CPU limits (<10% target), rebalance recency.

### Layer C — Machinery health + constraint inventory (why the score is what it is)
"Cannot be optimized further" becomes a checklist against **documented** blockers:
- Evictor exclusions: non-replicated pods, StatefulSets, PVCs/bare pods (aggressive mode),
  DaemonSets, PDBs (always respected), removal-disabled / safe-to-evict labels, dry-run
  state, scoped mode.
- Rebalancer: plan Failed on PDBs / insufficient capacity / timeouts; problematic
  workloads (custom node-affinity labels, pods using disabled templates, hostname
  topology spread); requires the unschedulable-pods policy on.
- Spot: quotas, interruption cooling-off, blacklisting, zone constraints/market depth.
- Commitments: template without on-demand offering, unassigned, region mismatch,
  exhausted, spot-only template ignores commitments.
- WOOP: hard node requirements, Rollouts, whitelisting label, OOM-loop cooldown
  (20 OOMs/h at 2.5× cap → disabled 4 h), PDB-blocked applies.

**Existing APIs make this auditable today**: `ClusterScoreAPI_ListClusterRestrictions` /
`GetClusterRestrictionDetails` (the advisory constraint catalog),
`AutoscalerAPI_GetProblematicNodes` / `GetProblematicWorkloads`, rebalance plan status.

---

## 4. Reframing Guy's statement — three buckets, all testable

- **(a) Saturated** — capture ratio ≥85% of addressable. Certify; stop re-litigating
  their score. (Score may stay mediocre by design — complexity isn't in the model.)
- **(b) Constrained** — real locked savings. Keep the constraint register dated, with
  re-review triggers (commitment expiry, PDB fixes, market changes).
- **(c) Silently degraded** — Phase-2 cluster with a red sub-metric and *no* registered
  constraint: Evictor dry-run or blocked, no rebalance in >30 days, WOOP off, template
  drift. **This bucket is where the wins and the notifications live.**

Per-cluster scorecard to pilot:
```
Cluster | Phase | Score | Red sub-metrics | Capture ratio | Addressable $ left | Top constraint (dated) | Days in state
```

---

## 5. Notification proposal

### What exists natively (verified, docs.cast.ai/docs/notifications)
Alerts = **category × cluster scope × severity triggers × destination**:
- Categories: **Workload Autoscaler, Node Autoscaler, Reporting anomalies, Inventory,
  Security, Other** (+ All). Severities: Critical / Error / Warning / Info / Success.
- Delivery: native **Slack** OAuth (≤5 channels per alert, org↔workspace 1:1) and
  **webhooks** (Go-template payloads; documented PagerDuty/OpsGenie/incident.io
  examples; NotificationID as dedup key). Notifications expire after 24 h in UI.

Signals that map directly to optimization quality:

| Concern | Native signal (category · severity) |
|---|---|
| Optimization silently off | "The Cast AI agent is unable to connect to the API", "Cluster controller not responding" (Other · Critical) |
| Cost/overprovisioning regression | "Cost anomaly detected on the {metric} metric" — covers compute cost, CPU/RAM overprovisioning, egress (Reporting anomalies · Warning) |
| Capacity/quota blocking spot | "Spot Instance quota exceeded" (Critical w/o fallback, Warning with), "IP/GPU quota exceeded" |
| Autoscaling health | "Pending pod detected" (Node Autoscaler · Warning), "Failed to reconcile cluster", "Node deletion failed", "Outdated cluster-controller" |
| Rightsizing health | "Continuous OOMKilled Events Detected" (WOOP auto-disabled 4 h cooldown) (Workload Autoscaler · Warning) |
| Positive confirmation | "Cluster reconciled" (Success) |

### The honest gap (bring this up — it's an ask, not a complaint)
There are **no native notifications** for: rebalance plans failing/partial, zero-eviction
streaks, spot interruption/fallback events, savings-trend regressions, score drops.
Close them via:
- **Audit API v2** (`GET /v2/audit/events` — `domain.resource.action`, e.g.
  `autoscaler.rebalancing.initiated`; filterable by cluster/source/severity) — poll or
  stream via the open-source **audit-log-exporter** (OTel collector) into the existing
  log/alerting stack; console retention is only 90 days.
- **Prometheus endpoints** (`ReportMetricsAPI_GetPromMetrics` + per-node/workload
  variants) for utilization/eviction-derived alerts.
- **Weekly cron** over the value-realization API for the capture-ratio digest.

### Cadence (no paging)
- **Weekly (CSU portfolio)**: capture-ratio table; top 5 clusters by addressable $
  remaining with their red sub-metric/constraint; new Degraded; new Constrained.
- **Monthly (leadership)**: realized $ trend vs baseline source, capture-ratio trend,
  constraint register movement, bucket (c) closures.
- **Paging only**: agent/controller Critical, Spot quota Critical, stuck rebalance on
  production (via audit events), cost-anomaly Critical.

---

## 6. Asks / decisions to push for in the meeting

1. Adopt the vocabulary: **score (posture) + capture ratio (quality) + constraint
   register (explanation)**. No more naked scores in customer conversations.
2. Agree the constraint taxonomy from documented blockers (§3 Layer C) and who owns the
   register + re-review cadence.
3. Standard notifications-as-baseline for every onboarded org: Slack alert = Critical +
   cost-anomaly Warning categories; webhook for audit-derived rebalance/spot events.
4. Pilot: ~10 clusters across buckets (a)/(b)/(c); build the scorecard manually via the
   Efficiency + Value-realization + Restrictions APIs; validate; then automate
   (potentially codified in the onboarding Terraform stack).
5. Decide what becomes customer-facing; the score docs' own caveat (no complexity
   normalization) should shape that wording.

## 7. Suggested 30-min agenda

- 5 min — What the score is (6 sub-metrics, phase gating, no complexity normalization).
- 5 min — The gap: quality = captured ÷ addressable; the three buckets.
- 10 min — Metric framework walk-through + scorecard demo sketch.
- 8 min — Notifications: native matrix now, gap-closing plan, cadences.
- 2 min — Pilot, owners, date.

---

## Appendix — verified sources
- Cluster Score: https://docs.cast.ai/docs/cluster-score
- Savings: https://docs.cast.ai/docs/available-savings · /savings-report · /savings-baseline
- Efficiency: https://docs.cast.ai/docs/cluster-efficiency-report
- Workloads: https://docs.cast.ai/docs/workloads
- Notifications: https://docs.cast.ai/docs/notifications · /observability-tutorial-set-up-slack-notifications · /setup-notification-webhook
- Blockers: https://docs.cast.ai/docs/evictor · /rebalancing · /preparation · /autoscaler-checklist · /optimization-constraints · /spot · /commitments
- APIs: `api.cast.ai` / `api.eu.cast.ai` — `/v1/cost-reports/...`, `/reporting/v1beta/...runValueRealizationTimelineReport`, `/v1/notifications/...`, `/v2/audit/events`, ClusterScoreAPI restrictions, AutoscalerAPI problematic nodes/workloads, ReportMetricsAPI Prometheus.
- Docs trick: append `.md` to any docs.cast.ai URL for the full Markdown body; full index at https://docs.cast.ai/llms.txt
