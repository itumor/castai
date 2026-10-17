# CAST AI Workload Autoscaler (WAS) — Engineering, Tuning & Best Practices Guide

> **Production handbook** for platform engineers, SREs, cloud architects, CAST AI support engineers and FinOps teams.
> **Researched and written 2026‑10‑17** against the official CAST AI documentation (see the coverage matrix below). Every product behavior statement cites its source page. Suggested starting values are labeled **[Suggested]**; CAST AI product defaults are labeled **[Default]** — they are never mixed.

---

## Executive summary

CAST AI Workload Autoscaler ("WAS", docs codename `woop`) rightsizes Kubernetes workload **CPU/memory requests** continuously:

1. The in-cluster agent + `castai-workload-autoscaler-exporter` collect usage metrics (metrics-server, PSI, JVM heap, probes).
2. The CAST AI control plane generates **Recommendation CRs** (`recommendations.autoscaling.cast.ai`) roughly every **30 minutes**, plus immediately on anomalies (surge ≥50% over recommendation, OOM, CPU stall).
3. The `castai-workload-autoscaler` component applies them per the workload's **scaling policy**: **immediate** (evict via Eviction API, PDB-honored) or **deferred** (mutating webhook applies on natural pod recreation; in-place resize on K8s 1.33+).
4. Smaller, accurate requests shrink schedulable demand → the **Node Autoscaler** (if enabled) can bin-pack and remove nodes → realized savings.

The tuning surface is small but sharp: **percentile target, overhead, apply thresholds (sensitivity), look-back period, min/max constraints, limits strategy, startup handling, confidence threshold, stall detection, HPA converter** — set at **policy level** (recommended) with **annotation overrides** per workload. The most consequential choices are *which workloads you automate at all*, *which apply mode they get*, and *how requests interact with existing HPAs*.

**Golden rules (evidence-linked inside):**

- Start in recommendation-only; enable automation per policy gradually. Wait ~a week before enabling "all workloads" so weekly patterns are visible. ([config docs](https://docs.cast.ai/docs/workload-autoscaling-configuration))
- **Memory** targets `max` + overhead (OOM is fatal); **CPU** targets a percentile (throttling is survivable). ([settings](https://docs.cast.ai/docs/woop-configuration-settings))
- Under HPA, CPU percentile & overhead are **automatic** — don't fight it; tune the HPA instead. ([VPA+HPA](https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa))
- Rightsizing ≠ instant bill reduction: savings require consolidation; WAS savings in the report are **modeled** unless the Node Autoscaler is enabled. ([savings report](https://docs.cast.ai/docs/savings-report))
- Immediate mode evicts through the Eviction API → **PDBs are enforced**; strict PDBs block optimization. ([configuration](https://docs.cast.ai/docs/workload-autoscaling-configuration))

## Guide volumes

| File | Chapter | Content |
|---|---|---|
| [01-architecture.md](01-architecture.md) | 1 | Components, recommendation flow, CRDs, webhooks, HA |
| [02-installation-onboarding.md](02-installation-onboarding.md) | 2 | Helm modes, install paths, upgrades, rollback, cloud specifics |
| [03-workload-compatibility.md](03-workload-compatibility.md) | 3 | Workload-type matrix, sidecars, custom workloads, job-like |
| [04-scaling-policies.md](04-scaling-policies.md) | 4 | System policies, assignment rules, priority, 7 example policies |
| [05-tuning-reference.md](05-tuning-reference.md) | 5 | ⭐ Every setting: default → suggested → when to tune → risk |
| [06-scaling-mechanisms.md](06-scaling-mechanisms.md) | 6 | Immediate vs deferred vs in-place resize, decision tree |
| [07-hpa-vpa-keda.md](07-hpa-vpa-keda.md) | 7 | Native HPA coordination, ownership, HPA converter, KEDA |
| [08-advanced-optimization.md](08-advanced-optimization.md) | 8 | JVM, predictive scaling, startup, PSI stall, node-aware DS sizing |
| [09-gitops-iac.md](09-gitops-iac.md) | 9 | Helm/Terraform/Argo CD management, drift avoidance |
| [10-production-best-practices.md](10-production-best-practices.md) | 10 | Per workload-class guidance, when NOT to optimize |
| [11-troubleshooting.md](11-troubleshooting.md) | 11 | 22-scenario diagnostic playbook + decision tree |
| [12-monitoring-observability.md](12-monitoring-observability.md) | 12 | Dashboard spec, PromQL, alert rules |
| [13-savings-finops.md](13-savings-finops.md) | 13 | Baseline methodology, modeled vs realized, worked examples |
| [14-api-automation.md](14-api-automation.md) | 14 | Verified WorkloadOptimizationAPI operations |
| [15-adoption-runbook.md](15-adoption-runbook.md) | 15 | 8-phase production rollout |
| [16-case-studies.md](16-case-studies.md) | 16 | 5 worked engineering examples |
| [cheat-sheet.md](cheat-sheet.md) | — | One-page tuning cheat sheet |

## Documentation coverage matrix

Research date: **2026‑10‑17**. Method: retrieved each page in Markdown (`.md` suffix). "Fully reviewed" = full text extracted and mined.

| # | Page | URL | Verified | Fully reviewed |
|---|---|---|---|---|
| 1 | Overview | https://docs.cast.ai/docs/workload-autoscaling-overview | ✅ | ✅ |
| 2 | Configuration | https://docs.cast.ai/docs/workload-autoscaling-configuration | ✅ | ✅ |
| 3 | Available settings | https://docs.cast.ai/docs/woop-configuration-settings | ✅ | ✅ |
| 4 | Annotations reference | https://docs.cast.ai/docs/workload-autoscaler-annotations-reference | ✅ | ✅ |
| 5 | Scaling policies | https://docs.cast.ai/docs/woop-scaling-policies | ✅ | ✅ |
| 6 | Create a scaling policy | https://docs.cast.ai/docs/woop-scaling-policies-create | ✅ | ✅ |
| 7 | Manage scaling policies | https://docs.cast.ai/docs/woop-scaling-policies-manage | ✅ | ◐ index + cross-refs |
| 8 | OpsPilot policies | https://docs.cast.ai/docs/woop-scaling-policies-opspilot | ✅ | ◐ index + cross-refs |
| 9 | Custom metrics | https://docs.cast.ai/docs/woop-custom-metrics | ✅ | ✅ |
| 10 | JVM optimization | https://docs.cast.ai/docs/woop-jvm-optimization | ✅ | ✅ |
| 11 | In-place pod resizing | https://docs.cast.ai/docs/woop-in-place-resizing | ✅ | ✅ |
| 12 | Node-aware DaemonSet sizing | https://docs.cast.ai/docs/woop-node-aware-daemonset-sizing | ✅ | ✅ |
| 13 | Pod startup recommendations | https://docs.cast.ai/docs/woop-startup-recommendations | ✅ | ✅ |
| 14 | Horizontal Pod Autoscaling | https://docs.cast.ai/docs/horizontal-pod-autoscaling | ✅ | ✅ |
| 15 | HPA on a workload | https://docs.cast.ai/docs/woop-hpa-how-to-configure | ✅ | ◐ index + cross-refs |
| 16 | HPA in scaling policies | https://docs.cast.ai/docs/woop-hpa-how-to-policies | ✅ | ◐ index + cross-refs |
| 17 | Legacy HPA migration | https://docs.cast.ai/docs/woop-hpa-how-to-migrate | ✅ | ✅ |
| 18 | KEDA compatibility | https://docs.cast.ai/docs/woop-hpa-third-party-support | ✅ | ✅ |
| 19 | VPA & HPA coordination | https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa | ✅ | ✅ |
| 20 | Event log | https://docs.cast.ai/docs/event-log | ✅ | ✅ |
| 21 | Helm charts (umbrella/modes) | https://docs.cast.ai/docs/helm-charts | ✅ | ✅ |
| 22 | Hosted components | https://docs.cast.ai/docs/hosted-components | ✅ | ◐ via helm-charts |
| 23 | Optimization constraints | https://docs.cast.ai/docs/optimization-constraints | ✅ | ✅ |
| 24 | Prometheus & Grafana | https://docs.cast.ai/docs/prometheus-and-grafana | ✅ | ✅ |
| 25 | Realized savings | https://docs.cast.ai/docs/savings-report | ✅ | ✅ |
| 26 | Savings calculations/baseline | https://docs.cast.ai/docs/savings-baseline | ✅ | ✅ |
| 27 | Available savings | https://docs.cast.ai/docs/available-savings | ✅ | ✅ |
| 28 | WorkloadOptimizationAPI index | https://docs.cast.ai/reference/castai-api-documentation/llms.txt | ✅ | ✅ (endpoint inventory) |
| 29 | Root & section indexes | https://docs.cast.ai/llms.txt etc. | ✅ | ✅ |

*Legend: ✅ fetched 200 OK on 2026‑10‑17; ◐ = verified to exist in the official index and covered via cross-referenced pages, but not mined line-by-line — statements depending solely on those pages are flagged inline.*

Notes & discrepancies found during research:

- **Kubernetes minimum for stall detection is 1.34** (PSI metrics), while in-place resize needs **1.33+** and WAS itself supports **K8s ≥1.18** — three different floors that guides often conflate.
- `default` / `default-statefulset` system policies are **deprecated** (clusters onboarded before 2025‑07‑18 may still show them); current system policies: `resiliency, balanced, cost-savings, stability, burstable, readonly`.
- The label `workload-autoscaler.cast.ai/ignore` **is not a supported config option** though it appears in webhook selectors — use whitelisting mode instead. (⚠️ warning in the configuration doc.)
- On AKS, Workload Autoscaler sets `admissions.enforcer/disabled: "true"` on its own webhook (value `webhook.aksAdmissionsEnforcerDisabled`, default `"auto"`).
