# CAST AI Workload Autoscaling — Master LLM Prompt (Complete Engineering, Tuning & Best‑Practices Guide)

> **What this file is:** a self-contained, copy‑paste‑ready prompt you hand to a capable LLM to produce a full, production-grade **CAST AI Workload Autoscaler (WAS / WOOP) tuning and best‑practices guide**.
> All CAST AI documentation URLs and API references needed for the research are embedded below and were **verified against the official documentation index on 2026‑10‑17**.
> How to use: copy everything inside the `BEGIN MASTER PROMPT` / `END MASTER PROMPT` markers into a fresh LLM session and let it research + write. Appendices A–C are reference material already baked into the prompt.

---

## BEGIN MASTER PROMPT

### YOUR ROLE

Act as a **Principal Kubernetes Platform Architect, CAST AI Workload Autoscaling Specialist, Senior Site Reliability Engineer, and Cloud FinOps Architect**.

You have deep expertise in:

- CAST AI Workload Autoscaler (WAS / WOOP) and its recommendation engine
- Kubernetes VPA/HPA mechanics, in-place pod resize, and scheduling
- CPU/memory resource optimization, throttling, PSI, OOM behavior
- CAST AI Node Autoscaler interaction (bin-packing, Evictor, rebalancing)
- Amazon EKS, Google GKE, Azure AKS, and CAST AI Anywhere
- Helm, Terraform, castctl, Argo CD / Flux GitOps, and admission webhooks
- JVM optimization, Prometheus observability, custom metrics
- Cloud FinOps: workload cost attribution, savings baselines, realized vs. modeled savings

**Your task:** produce the most comprehensive, technically accurate, production-ready guide possible for **CAST AI Workload Autoscaling — tuning and best practices**. This must be a practical engineering handbook, not marketing or a product overview.

**Primary audience:** senior DevOps/platform engineers, SREs, cloud architects, CAST AI support engineers, FinOps teams.

**Research date:** 2026‑10‑17. Check the latest documentation and release notes before making any version-specific claim.

---

### 1. MANDATORY OFFICIAL DOCUMENTATION RESEARCH

You MUST read and analyze all relevant CAST AI official documentation before writing.

**Discovery mechanism (use it — do not assume the list below is exhaustive):**

1. Root index: <https://docs.cast.ai/llms.txt>
2. Full Guides index: <https://docs.cast.ai/docs/llms.txt>
3. Workload Autoscaling section index: <https://docs.cast.ai/docs/workload-autoscaling/llms.txt>
4. Monitoring & Reporting index: <https://docs.cast.ai/docs/monitoring-reporting/llms.txt>
5. API Reference index: <https://docs.cast.ai/reference/llms.txt>
6. Release notes index: <https://docs.cast.ai/changelog/llms.txt>
7. **Markdown access:** every `docs.cast.ai/docs/...` and `docs.cast.ai/reference/...` page is available as Markdown by appending `.md` to the URL (e.g. `/docs/workload-autoscaling-overview` → `/docs/workload-autoscaling-overview.md`). Prefer `.md`; fall back to HTML when unavailable.
8. OpenAPI specification (machine-readable source of truth for API fields): <https://api.cast.ai/v1/spec/>
9. Release notes: <https://docs.cast.ai/changelog>

#### A. Core Workload Autoscaling documentation (verified complete section list)

| # | Page | URL |
|---|------|-----|
| 1 | Overview | https://docs.cast.ai/docs/workload-autoscaling-overview |
| 2 | Workload Autoscaler configuration | https://docs.cast.ai/docs/workload-autoscaling-configuration |
| 3 | Available settings | https://docs.cast.ai/docs/woop-configuration-settings |
| 4 | Annotations reference | https://docs.cast.ai/docs/workload-autoscaler-annotations-reference |
| 5 | Scaling policies | https://docs.cast.ai/docs/woop-scaling-policies |
| 6 | How-to: Create a scaling policy | https://docs.cast.ai/docs/woop-scaling-policies-create |
| 7 | How-to: Manage scaling policies | https://docs.cast.ai/docs/woop-scaling-policies-manage |
| 8 | How-to: Generate scaling policies with OpsPilot | https://docs.cast.ai/docs/woop-scaling-policies-opspilot |
| 9 | Custom metrics | https://docs.cast.ai/docs/woop-custom-metrics |
| 10 | JVM workload optimization | https://docs.cast.ai/docs/woop-jvm-optimization |
| 11 | In-Place Pod Resizing | https://docs.cast.ai/docs/woop-in-place-resizing |
| 12 | Node-aware DaemonSet sizing | https://docs.cast.ai/docs/woop-node-aware-daemonset-sizing |
| 13 | Pod startup recommendations | https://docs.cast.ai/docs/woop-startup-recommendations |
| 14 | Horizontal Pod Autoscaling | https://docs.cast.ai/docs/horizontal-pod-autoscaling |
| 15 | How-to: Configure HPA on a workload | https://docs.cast.ai/docs/woop-hpa-how-to-configure |
| 16 | How-to: HPA in scaling policies | https://docs.cast.ai/docs/woop-hpa-how-to-policies |
| 17 | How-to: Migrate from legacy horizontal scaling to HPA | https://docs.cast.ai/docs/woop-hpa-how-to-migrate |
| 18 | KEDA compatibility | https://docs.cast.ai/docs/woop-hpa-third-party-support |
| 19 | Vertical & horizontal workload autoscaling | https://docs.cast.ai/docs/workload-autoscaler-hpa-vpa |
| 20 | Event log | https://docs.cast.ai/docs/event-log |

#### B. Installation, components & platform operations (supporting pages)

| # | Page | URL |
|---|------|-----|
| 21 | Connecting your cluster | https://docs.cast.ai/docs/connecting-your-cluster |
| 22 | Connect using castctl | https://docs.cast.ai/docs/connect-with-castctl |
| 23 | Connect using the console | https://docs.cast.ai/docs/connect-via-console |
| 24 | Helm charts (umbrella chart & operating modes) | https://docs.cast.ai/docs/helm-charts |
| 25 | Hosted components (component ↔ mode mapping) | https://docs.cast.ai/docs/hosted-components |
| 26 | Terraform provider | https://docs.cast.ai/docs/terraform-provider |
| 27 | EKS via GitOps | https://docs.cast.ai/docs/terraform-provider-eks |
| 28 | GKE via GitOps | https://docs.cast.ai/docs/terraform-provider-gke |
| 29 | AKS via GitOps | https://docs.cast.ai/docs/terraform-provider-aks |
| 30 | castctl command reference | https://docs.cast.ai/docs/castctl-reference |
| 31 | Cast AI Operator | https://docs.cast.ai/docs/castai-operator |
| 32 | Component control | https://docs.cast.ai/docs/component-control |
| 33 | Kubernetes permissions | https://docs.cast.ai/docs/kubernetes-permissions |
| 34 | CAST AI Anywhere — getting started | https://docs.cast.ai/docs/cast-ai-anywhere-getting-started |
| 35 | Pod mutations — Enable Workload Autoscaler with pod mutations | https://docs.cast.ai/docs/enable-workload-autoscaler-with-pod-mutations |
| 36 | Pod mutations — Overview | https://docs.cast.ai/docs/pod-mutations-overview |
| 37 | Pod mutations — Reference | https://docs.cast.ai/docs/pod-mutations-reference |
| 38 | Node Autoscaler (autoscaling) | https://docs.cast.ai/docs/autoscaler |
| 39 | Autoscaler settings | https://docs.cast.ai/docs/autoscaler-settings |
| 40 | Evictor | https://docs.cast.ai/docs/evictor |
| 41 | Node Autoscaler preparation checklist | https://docs.cast.ai/docs/autoscaler-checklist |
| 42 | Business continuity | https://docs.cast.ai/docs/business-continuity |
| 43 | APA runbook — Sync Workload Autoscaler recommendations to Git (anti-drift) | https://docs.cast.ai/docs/apa-runbook-sync-workload-autoscaler-recommendations |

#### C. Savings, reporting & observability

| # | Page | URL |
|---|------|-----|
| 44 | Available savings | https://docs.cast.ai/docs/available-savings |
| 45 | Realized savings | https://docs.cast.ai/docs/savings-report |
| 46 | Savings calculations (baseline methodology & formulas) | https://docs.cast.ai/docs/savings-baseline |
| 47 | Cluster cost report | https://docs.cast.ai/docs/cluster-total-compute-cost |
| 48 | Organization cost report | https://docs.cast.ai/docs/organizational-cluster-cost-report |
| 49 | Cost comparison | https://docs.cast.ai/docs/cost-comparison |
| 50 | Workload costs report | https://docs.cast.ai/docs/workloads |
| 51 | Cluster efficiency report | https://docs.cast.ai/docs/cluster-efficiency-report |
| 52 | Idle resources report | https://docs.cast.ai/docs/cost-idle-resources-report |
| 53 | Optimization constraints (PDB/probe/topology advisory checks) | https://docs.cast.ai/docs/optimization-constraints |
| 54 | Prometheus and Grafana metrics | https://docs.cast.ai/docs/prometheus-and-grafana |
| 55 | Reliability metrics | https://docs.cast.ai/docs/reliability-metrics |

#### D. Official API documentation (WorkloadOptimizationAPI — verified endpoint list)

Base reference: <https://docs.cast.ai/reference> · OpenAPI: <https://api.cast.ai/v1/spec/>

| Endpoint | URL |
|---|---|
| Get workload-autoscaler agent status | https://docs.cast.ai/reference/workloadoptimizationapi_getagentstatus |
| Org-wide agent statuses | https://docs.cast.ai/reference/workloadoptimizationapi_getorganizationagentstatuses |
| List workloads | https://docs.cast.ai/reference/workloadoptimizationapi_listworkloads |
| Get workload | https://docs.cast.ai/reference/workloadoptimizationapi_getworkload |
| Get workload spec | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadspec |
| Get native VPA spec | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadnativevpaspec |
| Get Recommendation CR manifest | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadrecommendationmanifest |
| Workloads optimization summary | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadssummary |
| Workloads summary time series | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadssummarymetrics |
| Query workload metrics | https://docs.cast.ai/reference/workloadoptimizationapi_queryworkloadmetrics |
| Update workload V2 / Patch workload V2 | https://docs.cast.ai/reference/workloadoptimizationapi_updateworkloadv2 · https://docs.cast.ai/reference/workloadoptimizationapi_patchworkloadv2 |
| Reset system overrides | https://docs.cast.ai/reference/workloadoptimizationapi_resetsystemoverrides |
| List scaling policies | https://docs.cast.ai/reference/workloadoptimizationapi_listworkloadscalingpolicies |
| Create scaling policy | https://docs.cast.ai/reference/workloadoptimizationapi_createworkloadscalingpolicy |
| Get scaling policy | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadscalingpolicy |
| Update scaling policy | https://docs.cast.ai/reference/workloadoptimizationapi_updateworkloadscalingpolicy |
| Delete scaling policy | https://docs.cast.ai/reference/workloadoptimizationapi_deleteworkloadscalingpolicy |
| Set scaling policies order | https://docs.cast.ai/reference/workloadoptimizationapi_setscalingpoliciesorder |
| Assign workloads to policy | https://docs.cast.ai/reference/workloadoptimizationapi_assignscalingpolicyworkloads |
| List workload events / Get workload event | https://docs.cast.ai/reference/workloadoptimizationapi_listworkloadevents · https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadevent |
| Workload events summary | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadeventssummary |
| Workload filter values | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadfilters |
| List cluster HPAs (HPA analysis) | https://docs.cast.ai/reference/workloadoptimizationapi_listclusterhpas |
| HPA v2 migration eligibility / Migrate cluster to HPA v2 | https://docs.cast.ai/reference/workloadoptimizationapi_gethpav2migrationeligibility · https://docs.cast.ai/reference/workloadoptimizationapi_migrateclustertohpav2 |
| List / Create / Update / Delete custom metrics data sources | https://docs.cast.ai/reference/workloadoptimizationapi_listcustommetricsdatasources · https://docs.cast.ai/reference/workloadoptimizationapi_createcustommetricsdatasource · https://docs.cast.ai/reference/workloadoptimizationapi_updatecustommetricsdatasource · https://docs.cast.ai/reference/workloadoptimizationapi_deletecustommetricsdatasource |
| Raw / aggregated workload custom metrics (v1beta) | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadcustommetricsv1beta · https://docs.cast.ai/reference/workloadoptimizationapi_getaggregatedworkloadcustommetricsv1beta |
| List LimitRanges / ResourceQuotas | https://docs.cast.ai/reference/workloadoptimizationapi_listlimitranges · https://docs.cast.ai/reference/workloadoptimizationapi_listresourcequotas |
| Workloads access context | https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadsaccesscontext |

Related report APIs (rightsizing/savings linkage):

- Rightsizing summary: https://docs.cast.ai/reference/clusterreportapi_getrightsizingsummary
- Cluster savings report: https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport
- Available savings estimation: https://docs.cast.ai/reference/clusterreportapi_getsavingsrecommendation
- Component/agent status: https://docs.cast.ai/reference/clusterreportapi_getclusteragentstatus
- Workload Prometheus metrics: https://docs.cast.ai/reference/reportmetricsapi_getclusterworkloadprommetrics and https://docs.cast.ai/reference/reportmetricsapi_getworkloadprommetrics

**Research requirements (mandatory):**

- Read the *complete* technical content of every relevant page: warnings, prerequisites, examples, limitations, troubleshooting.
- Follow internal links to related pages; discover newly published pages via the section llms.txt indexes.
- Extract: configurable fields, defaults, supported ranges, behavioral implications, minimum component/Kubernetes versions, feature gates, deprecated features and replacements.
- Verify every Helm value, annotation, Kubernetes manifest field, REST method/path, API schema property, and Terraform attribute against the cited source before using it in an example.
- Record conflicts between older/newer docs; prefer the newest authoritative source and flag the discrepancy.
- **Never invent** endpoints, Helm settings, feature flags, annotations, or fields. An unavailable document is not verification — flag it as unverified.
- Cite the official source URL beside every non-trivial technical claim.
- Build a **documentation coverage matrix** (page | URL | date verified | topics | fully reviewed? Y/N) as one of the final artifacts.

---

### 2. REQUIRED GUIDE STRUCTURE (16 chapters)

#### Chapter 1 — Workload Autoscaler Architecture
- What WAS is; when to use it; rightsizing vs. horizontal scaling vs. node autoscaling
- Recommendation generation (VPA-style), confidence, data coverage
- Component roles: Agent, Cluster Controller, Evictor, Pod Mutator, Workload Autoscaler, Workload Autoscaler Exporter (verify each against Hosted components doc)
- Recommendation CRDs; mutating/validating admission webhooks; how resource changes reach pods
- Recommendation-only vs. automatic application
- Full flow diagram in Mermaid: Metrics → Recommendation Engine → Scaling Policy → Recommendation CRD → Workload Autoscaler → Pod/Container Resource Adjustment → Scheduling → Node Optimization. State exactly which component performs each step.

#### Chapter 2 — Installation & Onboarding
End-to-end setup: supported distributions/versions, CAST AI permissions, Kubernetes RBAC/CRDs, Helm chart dependencies; console, castctl, Helm, Terraform, Argo CD install paths; upgrade & rollback. Dedicated EKS / GKE / AKS / Anywhere examples. Explain umbrella-chart operating modes and **verify the exact mode semantics against the Helm charts / Hosted components docs** (read-only, workload autoscaler, node autoscaler, full). Include Helm commands, values examples, verification/health-check commands, webhook verification, and distinguish *installing* from *enabling optimization*.

#### Chapter 3 — Supported Workloads & Compatibility
Version-aware matrix: Deployment, StatefulSet, DaemonSet, ReplicaSet, CronJob/Job, custom controllers, Argo Rollouts, native sidecars, JVM workloads. Per type: support status, minimum component versions, immediate/deferred/in-place eligibility, HPA support, limitations, recommended production config. Document unsupported patterns + safe alternatives.

#### Chapter 4 — Scaling Policies: Complete Engineering Guide
All current system policies (verify exact list & names in docs — e.g. balanced, cost-savings, stability, resiliency, burstable, readonly) plus deprecated ones. Per policy: workload profile, defaults, percentile strategy, safety thresholds, tradeoffs, production suitability. Assignment mechanics: precedence, manual vs. annotation vs. assignment rules, policy ordering (`SetScalingPoliciesOrder`), namespace/label/type/regex matching, OpsPilot generation, updates/reassignment, disablement, read-only vs. managed. Provide 7 ready example policies (prod-critical, standard web, dev cost-focused, batch, stateful DB/broker, JVM, CPU-bursty).

#### Chapter 5 — Complete Tuning Reference  ⭐ (the core chapter)
Table of **every documented setting**, columns:
`Setting | Purpose | Default | Supported range | Suggested starting value | When to increase | When to decrease | Perf risk | Cost impact | Config method (annotation/policy/Helm) | Source URL`
Cover: CPU (percentiles, safety overhead/margin, look-back, scale up/down thresholds, burst handling, throttling, PSI stall signals, min/max constraints) · Memory (recommendation functions/percentiles, overhead, OOM protection & cooldown, pressure events, request-vs-limit strategy, limits:requests ratio, min/max, JVM specifics) · Recommendation behavior (frequency, confidence, data coverage, gradual optimization, apply thresholds, policy-level vs. annotation-level, container exclusions, partial-resource optimization) · Advanced (immediate/deferred/in-place, eviction delay, single-replica handling, startup metrics/recommendations, predictive CPU scaling, HPA conversion, ResourceQuota/LimitRange handling, custom metrics).
**Hard rule: distinguish documented CAST AI defaults from your suggested starting values. Never present a suggestion as a product default.**

#### Chapter 6 — Immediate vs. Deferred vs. In-Place Scaling
Comparison: when calculated/applied, pod restarts, eviction behavior, PDB interaction, availability guarantees, StatefulSet considerations, eligibility, fallback. Decision tree per workload type. Kubernetes 1.32 vs. 1.33+ differences for in-place resize. Never claim "zero downtime" without verified prerequisites.

#### Chapter 7 — VPA, HPA & KEDA Interaction
Why request changes affect HPA % targets; VPA+HPA coordination; native HPA ownership (take/revert); policy-level vs. workload-level HPA config; target conversion; CPU vs. memory triggers; stabilization windows; scale-up/down rate policies; min/max replicas; anti-oscillation; KEDA ScaledObjects & third-party limitations; legacy horizontal-scaling migration (incl. `MigrateClusterToHpaV2` API). Working YAML + verification commands. Which combos coexist safely vs. need special handling.

#### Chapter 8 — Advanced Workload Optimization
JVM (heap metrics, container vs. heap memory, GC, JMX auto-instrumentation, Prometheus scraping/external data sources, JVM-internal OOM) · Predictive scaling (data requirements, eligibility, CPU-only scope, forecast behavior, safety overhead, HPA incompatibility, reporting) · Startup optimization (startup-period detection, CPU bursts, probe failures, two-phase recommendations, post-startup in-place adjustment) · Resource pressure (PSI, memory pressure, OOM recovery/cooldown) · Node-aware DaemonSet sizing (proportional-to-allocatable, fallback requests, per-container, admission-time, early-access limits).
Per feature: compatibility matrix, enablement steps, tuning guidance, validation procedure, rollback.

#### Chapter 9 — GitOps & Infrastructure as Code
Helm/Terraform/Argo CD/Flux/annotations/REST management; repo structure for platform teams. Anti-patterns: GitOps drift on resource fields (see APA sync-recommendations runbook), duplicate controllers, unexpected HPA ownership changes, webhook failures, Helm hook conflicts, accidental policy changes, manifests overwriting optimization settings. Version pinning, rollback, change review.

#### Chapter 10 — Production Best Practices
Opinionated, evidence-linked guidance per workload class: mission-critical, high-traffic, latency-sensitive APIs, JVM microservices, batch, stateful, low-traffic, dev cost-optimized, strict-PDB workloads, already-autoscaled workloads. Explain *why*. State when optimization should be deferred, restricted, or disabled.

#### Chapter 11 — Troubleshooting & Root-Cause Analysis
Playbook for ≥22 scenarios: no recommendations · low confidence · wrong policy assignment · recommendations not applied · unchanged requests · repeated restarts · PDB blocks · CPU throttling after rightsizing · OOMKilled · memory pressure/evictions · HPA instability/ownership conflicts · KEDA issues · webhook failures · in-place resize stuck · wrong startup recommendations · custom metrics missing · JVM heap metrics unavailable · GitOps reverting changes · ResourceQuota/LimitRange blocking · CAST AI components unhealthy · optimization working but savings not visible.
Format per scenario: Symptoms → Possible causes → Read-only diagnostic commands → Expected output → Root-cause confirmation → Remediation → Rollback → Official reference. Safe `kubectl`/`helm`/`curl` examples with placeholders; no credentials/secrets/customer data.

#### Chapter 12 — Monitoring & Observability
Dashboard spec: actual vs. requested vs. recommended CPU/memory, limits, confidence, managed vs. read-only coverage, HPA desired/current, OOMs, throttling, PSI, in-place status, restarts, application status, savings attribution. State which metrics come from CAST AI (`workloadautoscaler-exporter`, ReportMetricsAPI, Prometheus/Grafana docs) vs. Kubernetes/external. PromQL examples where appropriate. Alerting rules for workload safety and autoscaler malfunction.

#### Chapter 13 — Savings Measurement & FinOps
Distinguish: reduced requests → reduced capacity demand → reduced provisioned nodes → lower cloud bill; modeled WAS savings vs. Node Autoscaler realized savings; potential/available vs. gross vs. net savings; CAST AI fees. Explain why rightsizing alone may not cut the bill until nodes consolidate. Use the official savings-baseline methodology; **never double-count** workload savings already inside node-level realized savings. Cover baselines, adoption/reporting prerequisites, reporting windows/timezones, cost basis & discounts, API vs. Console, any documented adoption thresholds (only if verified for the specific report), billing reconciliation. Hypothetical worked examples with explicit assumptions + a savings-validation checklist for finance & engineering.

#### Chapter 14 — API & Automation
Document the verified WorkloadOptimizationAPI operations (from §1.D) for: listing/inspecting workloads, recommendations & events, policy CRUD/ordering/assignment, HPA inspection & conversion analysis, custom metric data sources, agent status, savings-related report APIs. Per endpoint: `HTTP method | verified path (from OpenAPI spec) | auth | permissions/scopes | params | request example | key response fields | operational risk`. Confirm paths against <https://api.cast.ai/v1/spec/>. Regional API host considerations. Read-only scripts only; state that production-changing calls require explicit approval.

#### Chapter 15 — Step-by-Step Production Adoption Runbook
Phases 0–7: Preflight inventory → Visibility (install, no wide optimization) → Recommendations review → Controlled rollout (small non-critical group) → Production rollout (gradual, monitored, rollback triggers) → Advanced features (in-place, HPA integration, JVM, predictive) → Financial validation → Continuous tuning. Per phase: preconditions, commands, config changes, success criteria, observability checks, risks, rollback, required approvals.

#### Chapter 16 — Real-World Engineering Examples
≥5 detailed case studies: (1) CPU-overprovisioned stateless API, (2) memory-sensitive JVM app, (3) HPA-managed variable-traffic microservice, (4) StatefulSet with strict availability, (5) low-traffic dev workload. Each: original requests/limits, observed usage, replicas, existing autoscaling, recommended policy, proposed tuning values (flagged as suggestions), expected request changes, reliability safeguards, possible node-capacity reduction, savings math with explicit assumptions, monitoring, rollback. Clearly separate hypothetical examples from documented behavior.

---

### 3. REQUIRED FINAL ARTIFACTS

1. Complete engineering handbook (all chapters, sourced)
2. One-page tuning cheat sheet
3. Production policy matrix (workload type → policy)
4. Feature compatibility matrix (Kubernetes/agent/Helm/autoscaler minimum versions)
5. Validated configuration examples (Helm values, annotations, manifests, API requests)
6. Troubleshooting decision tree (Mermaid)
7. Production adoption checklist
8. Savings validation framework (measured vs. modeled)
9. Operational runbook (monitoring, upgrades, rollback, escalation)
10. Documentation inventory (every URL reviewed + verification date)

---

### 4. QUALITY & ACCURACY RULES (mandatory)

1. CAST AI docs = source of truth for product behavior; upstream Kubernetes docs for generic K8s behavior.
2. Never invent settings, commands, feature support, API fields, or version requirements.
3. Verify every example against the current schema/docs.
4. Distinguish defaults from suggested tuning; facts from recommendations.
5. Do not assume parity across EKS/GKE/AKS/Anywhere.
6. Flag experimental / early-access / deprecated / version-dependent features.
7. Never promise savings % without measurement or documented basis.
8. Never claim rightsizing always cuts infrastructure cost immediately.
9. Discuss availability risk before recommending automated restarts/evictions.
10. Production-realistic examples, not pseudocode, wherever possible.
11. Cite sources next to claims; flag anything unverifiable.
12. Where docs disagree, explain and name the authoritative version.
13. Do not truncate to fit: split into self-contained volumes if needed.

### 5. OUTPUT FORMAT

Markdown: chapter headings, Mermaid architecture/decision diagrams, config matrices, copyable YAML/CLI with comments, engineering warnings, before/after examples, FinOps equations with assumptions, clickable source URLs.
Per tuning recommendation use: `What it controls → Default → Suggested starting point → When to tune → Performance impact → Cost impact → Validation → Risk → Rollback → Source`.

**Start with the documentation inventory + executive summary, then produce the complete handbook. Begin researching now.**

## END MASTER PROMPT

---

## Appendix A — Verified key facts to anchor the guide (verified 2026‑10‑17)

| Feature | Documented behavior to respect |
|---|---|
| Documentation access | All `docs.cast.ai/docs/*` and `/reference/*` pages serve Markdown via `.md` suffix; per-section `llms.txt` indexes exist and should be crawled for new pages |
| Scaling policies | Auto-assign workloads and drive vertical + horizontal optimization; order matters (`SetScalingPoliciesOrder` API) |
| Immediate mode | May evict pods to apply recommendations — PDBs matter |
| Deferred mode | No forced eviction; changes land on natural pod replacement; eligible clusters can use in-place resizing instead |
| In-place pod resizing | Requires Kubernetes 1.33+ (`InPlacePodVerticalScaling`) plus compatible CAST AI components — verify exact mins in the In-Place Pod Resizing doc |
| JVM optimization | Heap-aware recommendations; JMX auto-instrumentation or existing Prometheus endpoint scraping |
| Predictive scaling | CPU-focused, excludes HPA-managed workloads, has data/eligibility requirements |
| HPA integration | Native Kubernetes HPA management coordinated with vertical scaling; legacy horizontal scaling is migratable (docs + `MigrateClusterToHpaV2` API) |
| Pod mutations | Alternative admission-time path to enable WAS (`enable-workload-autoscaler-with-pod-mutations`) |
| GitOps drift | CAST AI ships an APA runbook to sync WAS recommendations back into Git manifests |
| Savings reporting | Modelled workload savings must be distinguished from node-level realized savings to prevent double-counting; methodology in `savings-baseline` |

## Appendix B — Verification log

| Source | Checked | Result |
|---|---|---|
| https://docs.cast.ai/llms.txt | 2026‑10‑17 | ✅ root index retrieved (sections: Guides, API Reference, Release Notes) |
| https://docs.cast.ai/docs/workload-autoscaling/llms.txt | 2026‑10‑17 | ✅ full 20-page Workload Autoscaling list confirmed verbatim |
| https://docs.cast.ai/docs/llms.txt | 2026‑10‑17 | ✅ full Guides index; supporting pages (Helm, Terraform, castctl, pod mutations, Anywhere, autoscaler, APA runbook) confirmed |
| https://docs.cast.ai/docs/monitoring-reporting/llms.txt | 2026‑10‑17 | ✅ savings/cost/observability page list confirmed |
| https://docs.cast.ai/reference/castai-api-documentation/llms.txt | 2026‑10‑17 | ✅ WorkloadOptimizationAPI + report API endpoint list confirmed |

*Anything not independently retrievable at research time must stay flagged as "unverified" in the generated guide — per Quality Rule 2 & 11.*
