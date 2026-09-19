# Cast AI — Optimization-quality metrics & optimization-health notifications

Research extracted from docs.cast.ai for a CS/support internal meeting on "metrics that describe the QUALITY of OPTIMIZATION of onboarded customer clusters, and appropriate NOTIFICATIONS around optimization health."

Method note: docs.cast.ai serves every page as clean Markdown at `<page-url>.md` (e.g. `https://docs.cast.ai/docs/cluster-score.md`) and publishes a full index at `https://docs.cast.ai/llms.txt`. All content below came from those Markdown bodies (full page content, not truncated nav). Facts are quoted verbatim where marked; anything I inferred or could not confirm is flagged `NOTE`.

---

## 1. Cluster Score (MOST IMPORTANT)

Source: https://docs.cast.ai/docs/cluster-score (full body retrieved via `https://docs.cast.ai/docs/cluster-score.md`)

**What it is.** "The Cast AI Cluster Score provides a comprehensive assessment of your Kubernetes cluster's optimization and efficiency ... an actionable rating on a scale from 0 to 10." It does NOT focus on a single aspect; it evaluates "how effectively your cluster balances resource allocation, workload efficiency, and cost optimization" and "how well you're leveraging Cast AI's full suite of optimization features."

**Score mechanics (verbatim facts):**
- Scale 0–10 with **one decimal place precision**.
- **Updates automatically every hour**; can be **manually refreshed** (refresh icon).
- **Benchmarks your cluster against averages from all Cast AI customers** ("understand if your score places you in the top percentile of all customers").
- Caveat (verbatim): "The score calculation **does not** factor in the complexity of your workloads and the specific challenges of your infrastructure. Therefore, the assessment is most relevant when the changes in score are compared against your own over time."
- Connection phase gating (verbatim table):
  | Connection Phase | Score Availability |
  | --- | --- |
  | Phase 1 (Read-only) | Partial scores for overprovisioning and resource utilization only. |
  | Phase 2 (Automation) | Full cluster score with all optimization categories. |
- Access: Cluster List View (score next to each cluster) and Cluster Detail View (**Cluster Overview → Score**).

**Composition = 3 categories, 6 sub-metrics.** Each sub-metric is scored 0–10 with status buckets:

| Score | Status |
| --- | --- |
| 7–10 | Healthy |
| 4–6 | Concerning |
| 0–3 | Poor |

(Verbatim caveat: "The score ranges that correspond with each status are approximate.")

**Category A — Resource Provisioning** ("how efficiently your cluster's resources are allocated and managed"):
1. **Cluster Overprovisioning** — "Evaluates unused allocated resources in your cluster."
   - Healthy: "CPU overprovisioning is under 20%, and memory overprovisioning is under 35%."
   - Concerning: "CPU or Memory overprovisioning slightly above target thresholds."
   - Poor: "Significant overprovisioning indicates wasted resources."
2. **Bin Packing** — "Measures how effectively pods are consolidated onto fewer nodes."
   - Healthy: "The node deletion policy is **On**, Evictor is **On**, and the median node utilization is above 65%."
   - Concerning: one or more bin-packing features off, or median node utilization low. Poor: bin-packing features disabled → fragmentation.
3. **Node Template Consolidation** — "Assesses if you're using too many node templates."
   - Healthy: "an optimal number of node templates with resource utilization above 65% across all templates."
   - Poor: excessive templates → significant underutilization/fragmentation.

**Category B — Workload Resource Optimization** ("how well your workload resource requests match actual usage"):
4. **Resource Utilization** — Healthy: "Strong CPU and memory utilization rates, most workloads have resource requests properly configured, and minimal use of CPU limits." Improvement guidance includes: ensure explicit requests, and "Minimize CPU limits, targeting **fewer than 10% of workloads with limits**, to prevent throttling."
5. **Workload Optimization** — "Evaluates the usage of Cast AI's Workload Autoscaler to automatically right-size workload resources."
   - Healthy: "Workload Autoscaler is enabled, and it optimizes most workloads."
   - Concerning: enabled but most workloads not optimized. Poor: disabled or optimizing very few.

**Category C — Rebalancer** ("how effectively you're using Cast AI's Rebalancer to replace underperforming nodes"):
6. Rebalancer — Healthy: "Regular rebalancing." Concerning: "Infrequent rebalancing." Poor: "**No rebalancing was performed in the last 30 days**." Recommended: "Run rebalancing at least once every two weeks" / configure scheduled rebalancing.

**Status indicator model (verbatim):** "Each optimization area has two tiers of goals and three possible states indicated by colored dots": 🔴 Red/Poor (first-tier goal not achieved), 🟡 Yellow/Concerning (first tier achieved, second not), 🟢 Green/Healthy (both tiers achieved).

**Explicitly separate from the score:** "Cast AI reports **optimization constraints** — advisory checks on your workload manifests for missing health probes, strict Pod Disruption Budgets, and topology spread gaps. These **don't change your score**, but they surface the configuration issues behind it." (See §8.)

**What a low score means (facts):** the docs define bucket labels only as above; the score is explicitly **not normalized for workload complexity**, so docs recommend tracking your own delta over time.
NOTE: The docs do NOT publish numeric per-category weights for computing the overall 0–10 from the six sub-metrics; the page presents thresholds per sub-metric only. Do not claim a weighting formula.

---

## 2. Savings: available vs projected vs realized

The page https://docs.cast.ai/docs/savings itself is only a stub; the Savings section has three pages (fetched in full):
- https://docs.cast.ai/docs/available-savings ("Available savings" = potential)
- https://docs.cast.ai/docs/savings-report ("Realized savings")
- https://docs.cast.ai/docs/savings-baseline ("Savings calculations" — exact formulas)

**Available savings** (potential, pre-/post-onboarding):
- For **read-only clusters**: "Estimated total savings potential; Current cluster costs; Potential savings from recommendations."
- Report cards: **Workload rightsizing** (estimated savings from optimizing workloads), **Spot Instances** (potential savings from spot automation; toggle all vs spot-friendly workloads), **ARM support** (projected savings; adjustable % of ARM CPUs), **Configuration comparison** (current vs optimized: instances quantity/name/CPU cost/hourly cost/monthly cost; CPU/memory/GPU usage current vs optimized).
- "Comparison over time": average available savings percentage, current vs optimal cost, daily CPU cost graph, average CPU waste %, current vs optimal CPU count and CPU provisioned over time. Time range adjustable (e.g., 24 hours, 7 days); cost rate display hourly/daily/monthly.
- For **Cast AI-managed clusters**: adds a **Progress indicator** ("how close your cluster is to the recommended setup") and detailed configuration comparison.
- Requirement: cluster must have at least one supported node type, else report won't load.

**Key concept definitions (verbatim, from savings-report page):**
- **Provisioned**: "the amount of a resource (CPU cores or RAM) that's actually allocated on your nodes. This is the capacity you're paying for."
- **Requested**: "the amount of a resource your workloads ask for, via Kubernetes pod resource requests, after Cast AI's workload autoscaler has rightsized them." **Original requested** = "what workloads asked for *before* rightsizing."
- **Lifecycle**: "how a node is purchased: on-demand, spot, or fallback ... The report combines all three into single totals ... It doesn't break savings down by lifecycle."
- **Realized savings**: "savings realized primarily through the node autoscaler: the difference between **projected and actual cost**, driven by bin-packing workloads more efficiently, adopting spot instances, and choosing cheaper node types. When both the node autoscaler and the workload autoscaler are enabled, the impact of the workload autoscaler is included in the realized savings."
- **Workload autoscaler savings**: "come from rightsizing ... These are **modeled estimates**. If the node autoscaler is enabled, they are already included in realized savings. Otherwise, they are potential savings not reflected in actual spend."
- **Baseline**: "the reference point Cast AI uses to model what your cluster would have cost without its optimizations."

**Baseline model (savings-baseline page, verbatim structure):** baseline = four numbers + a time window: **CPU overprovisioning factor, RAM overprovisioning factor, CPU unit cost ($/core-hour), RAM unit cost ($/GiB-hour)**. Determined automatically once/day by the first method with enough data:
1. **Cluster history** — own history between cluster connection and Cast AI taking over active node management (>20% of nodes Cast AI-managed); requires **at least 7 days** of pre-optimization history.
2. **Peer clusters** — average of other org clusters that have a Cluster-history baseline.
3. **Industry average** — fleet-wide average on the day the cluster connected to active management.
- Eligibility: cluster must be **at least 14 days old** and actively managed; younger/pre-management clusters are "absent entirely" (not zeroed).
- Manual adjustments via Cast AI representative: **Override the baseline** (hand-set any of the 4 params; automatic calc never touches it again) or **Recalculate over a custom date range**. Label in report: **Overridden**.

**Exact formulas (verbatim):**
```text
actual cost = actual CPU cost + actual RAM cost

projected CPU cost =
  if (day is on/after the baseline period ends):
      greatest(original requested core-hours, current requested core-hours)
        × CPU overprovisioning factor
        × greatest(current effective $/core-hour, baseline $/core-hour)
  else:
      actual CPU cost
```
(RAM same with RAM factor/cost.)

```text
realized savings = projected cost − actual cost

workload autoscaler savings =
  (original requested core-hours − current requested core-hours)
    × greatest(current effective $/core-hour, baseline $/core-hour)
```
- WOOP savings "counted only on days when workload autoscaling (VPA) was actually active on the cluster" and CAN accrue inside the baseline window (unlike realized savings).
- Inside baseline period: projected = actual → realized savings zero by construction.
- Reported fields: Autoscaler savings = CPU+RAM autoscaler savings; **Total savings "currently equals autoscaler savings only, since the workload autoscaler impact is already included by decreasing the CPU and RAM demand."**
- Price basis: **Discounted (default)** = negotiated/effective rates (align with Price adjustments); **Listing** = on-demand list prices. Listing prices unavailable before **August 6, 2025**; baseline unit cost is always discounted.
- Granularity: per-cluster and per-organization views over selectable time ranges; per-workload breakdown inside cluster view (see §3). Baseline parameters don't distinguish on-demand/spot/fallback.

---

## 3. Realized Savings Report (savings-report)

Source: https://docs.cast.ai/docs/savings-report

- Purpose (verbatim): "The Savings Report answers two questions: how much money has Cast AI saved you, and how? ... it compares what you're actually paying today against a modeled estimate of what you'd be paying without Cast AI."
- **Two sources of savings are attributed separately**: Realized savings (node-level autoscaler) and Workload autoscaler savings (rightsizing).
- **Views**: Organization view (all clusters) and Cluster view (single cluster, reached by drilling in from org view).
- **Shared overview cards**: Baseline spend; Realized savings (appears only when node autoscaler manages **at least 20% of nodes**); Workload autoscaler savings (appears when WOOP manages **at least 20% of workloads in VPA mode**); Actual spend.
- **Shared charts**: Savings over time (lines depend on which autoscalers are adopted); **Workload autoscaler adoption** (% of workloads managed over time); **Workload utilization rate** (CPU and memory, switchable).
- **Organization breakdown-by-cluster table columns**: which optimizations are on (node autoscaler, workload autoscaler); **Baseline source** (Cluster history / Peer clusters / Industry average); Baseline cost; Actual cost; Savings (realized or WOOP depending on which is active).
- **Cluster view — Node autoscaler impact** (shown when node autoscaler manages ≥20% of nodes): Provisioned capacity (baseline, actual, reduction for CPU and memory); Average node count (projected-without-vs-actual); Average cost per node (same split).
- **Cluster view — Workload autoscaler impact** (shown when ≥20% workloads in VPA mode): Workload resource requests (average original requests, average current requests, resources freed over time, CPU+memory); **Workload optimization breakdown table** — per workload: Namespace; which optimizations on (VPA, HPA); Workload autoscaler savings; Percentage share of total savings.
- When savings start: only after the baseline period ends (see §2); a time range fully inside the baseline shows projected = actual and zero autoscaler savings.
- NOTE: The page does **not** mention CSV export or date-range presets for this report, and does not document an export button. The API equivalent is the ValueRealization API (see §7), which supports org-level timeline report with `startTime`/`endTime`/`step` (ONE_DAY/ONE_MONTH) and a per-workload value-realization report op. Treat "CSV export" as unconfirmed in docs.

---

## 4. Cluster Efficiency Report

Source: https://docs.cast.ai/docs/cluster-efficiency-report

- Scope: "cluster's CPU, memory, and storage (where available) usage ... quantify overprovisioning"; current (real-time overprovisioned resources) and past data; "exact numbers on your cluster's provisioned and requested resources, as well as the average hourly cost per CPU and GiB."
- Three resource metrics (verbatim): **Provisioned** ("total capacity allocated by your cloud provider ... full resources you're paying for"), **Requested** ("capacity your workloads have asked for through Kubernetes resource requests"), **Used** ("actual consumption by your running applications").
- Cost metrics (verbatim): Cost per Provisioned = total cost ÷ provisioned; Cost per Requested = total cost ÷ requested; Cost per Used = total cost ÷ used. Identity:
  `(Cost per Provisioned × Provisioned) = (Cost per Requested × Requested) = (Cost per Used × Used) = Total Cost`
  Typical ordering: `Provisioned > Requested > Used`, hence `Cost per Provisioned < Cost per Requested < Cost per Used`.
  Worked example (verbatim): 10 provisioned / 8 requested / 4 used CPUs at $100 → $10 / $12.50 / $25 per CPU.
- **Overprovisioning % (verbatim formula):**
  `Overprovisioning % = 100% - (Requested Resources ÷ Provisioned Resources × 100%)`
  Example: 688 provisioned, 490 requested → `100% - (490 ÷ 688 × 100%) = 100% - 71.22% = 28.78%`.
- Features: **resource offering filter** (spot / on-demand / fallback); **hourly, daily, monthly** cost rates; daily CPU and memory efficiency details (cost per provisioned and requested resource per day + exact overprovisioning rate that day); sortable columns by overprovisioning rate/cost.
- "Optimal efficiency indicators" (verbatim): gap between provisioned and requested minimal; "an appropriate buffer between requested and used resources (allowing for traffic spikes)"; "cost per used resource is relatively close to the cost per provisioned resource."
- CPU vs memory: both tracked/ displayed separately.
- NOTE: the page defines **no "efficient" threshold/label** and no per-node-group breakdown; the only numeric thresholds tied to overprovisioning live on the Cluster Score page (CPU <20%, memory <35% = Healthy; utilization >65% targets). The efficiency view is per-cluster (plus resource-offering split).
- Cross-ref: "Include Idle Cost" (workloads report) attributes idle capacity cost to workloads/namespaces/allocation groups (see §5).

---

## 5. Workload cost report (workloads page)

Source: https://docs.cast.ai/docs/workloads

- Four views: (1) workloads with **cost details** per selected period; (2) workloads with **efficiency details**; (3) individual workload cost details with daily history; (4) individual workload efficiency details with daily history.
- **Cost-list columns (verbatim)**: workload name; workload controller type; namespace; average number of pods; average requested CPU per hour; average requested memory per hour; total cost of CPU; total cost of memory; the total cost of compute. Filters: labels and namespaces; selecting rows yields group totals.
- **Efficiency-list columns (verbatim)**: workload name; controller type; namespace; **CPU hours wasted; memory hours wasted; `$ wasted`** + "requested and used resource hours."
- **Resource hours** (verbatim): "resources multiplied by hours of usage." Example: requests 2 CPUs running 48h → 96 requested CPU hours; average usage 0.5 CPU → 24 used CPU hours. **Wasted = requested − used**: `96 CPU hours - 24 CPU hours = 72 CPU hours`.
- **Individual workload cost view**: total spend; current month forecast; average daily cost; average daily cost per resource (CPU and memory); daily compute spend per resource and per resource offering; daily cost history table (average pod count, cost per pod, requested resources, cost per resource, total cost).
- **Individual workload efficiency view**: Efficiency score in %; wasted resource hours (CPU and memory); $ wasted; pods currently running; per-container current efficiency = resource requests, resource usage, **rightsizing recommendation**, **computed overall efficiency**.
- **Computed efficiency formula (verbatim)**: "Computed efficiency is calculated by comparing resource requests against the recommended rightsized resource values. **CPU is more expensive and has a larger impact on efficiency ratings.**"
- **Rightsizing recommendations (verbatim)**: "the Cost monitoring module analyzes the resource use of a container during the **last 5 days** and calculates the percentile value (**95th percentile for CPU and 99th percentile for memory**)." Usage metrics via metrics-server (caveat: rare incorrect CPU data from a kernel bug; upgrade metrics-server ≥ v0.7.0).
- **CPU vs memory cost split (verbatim)**: 88:12 ratio — "CPU accounts for approximately **88%** and memory for approximately **12%** of the total compute cost" (derived from GCP pricing; applied to AWS/Azure). Formula: `instancePricePerHour / ((cpu_count × cpu_ratio) + (ram_gib × ram_ratio)) × resource_ratio`. Example r5.large ($0.126/hr, 2 vCPU, 16 GiB): CPU $0.0301/vCPU-hour, RAM $0.0041/GiB-hour.
- **Include Idle Cost (verbatim formulas)**: `idle resources = provisioned resources - requested resources`; `workload idle cost share = idle cost × (workload requested resources ÷ total requested resources on the node)`; `workload total cost = workload requested cost + workload idle cost share` (calculated separately for CPU and memory).
- **Grouping**: pods aggregated under top-level controllers (Deployments, DaemonSets, StatefulSets, ...); pods without/unknown controllers listed separately (batch-job dynamic pod explosion caveat); custom grouping label `workloads.cast.ai/custom-workload: "my-batch-job"`.
- Cast AI managed–mode customers get a "quick recommendations patch" to change workload requests in line with recommendations.
- NOTE (states): the page does **not** define workload states like "optimized" / "overprovisioned" / "rightsized by WOOP". The documented state vocabulary for workload optimization (from https://docs.cast.ai/docs/workload-autoscaling-overview) is: Workload Autoscaler enabled/disabled per workload; **policy-optimized vs manually enabled**; **full confidence vs low confidence** with a "Recommendation Confidence" column (low-confidence workloads under a policy get gradual scaling: max request adjustments of 10% @ <2.4h data, 25% @ <6h, 35% @ <24h, unrestricted after >24h/full confidence); and in the value-realization API, workloads split into **managed** vs **unmanaged** by WOOP. A documented verification signal: optimization applied ⇒ pod annotation `autoscaling.cast.ai/vertical-recommendation-hash`.

---

## 6. Notifications & alerts

Sources: https://docs.cast.ai/docs/notifications · https://docs.cast.ai/docs/observability-tutorial-set-up-slack-notifications · https://docs.cast.ai/docs/setup-notification-webhook

**Model:** notifications surface in UI (bell icon) and can be delivered via **Slack (native OAuth integration)** or **webhook**; "notifications are set to expire automatically in **24 hours**."

**Severity types (verbatim table):** Critical ("severe issue that requires immediate attention"), Error ("causing a malfunction or preventing expected behavior"), Warning ("potential issues or situations that could lead to problems"), Info ("general information about cluster operations, updates, or status changes"), Success ("an operation or process has completed successfully").

**Notification categories (verbatim):** **Workload Autoscaler** (workload autoscaling events); **Node Autoscaler** (node autoscaling and scheduling events); **Reporting anomalies** ("Cost and performance anomaly detection notifications"); **Inventory** (new cloud provider instance availability); **Security** (image security and best practice); **Other** (general cluster operations, system connectivity, configuration). Alert Category dropdown has an **All** option covering everything.

**Complete notification reference (verbatim names, by severity):**
- Critical (Other): The Cast AI agent is unable to connect to the API; Cluster controller not responding; IP Address quota exceeded; Node Configuration Validation Failed; Node deletion failed; Operation failed; Spot Instance quota exceeded (critical variant: "since Spot Fallback is not enabled, the Autoscaler might not be able to add any capacity").
- Error (Other): Missing permission when adding a node to a target group / to load balancer(s) / to target groups / adding VMSS IP to backend pool / deleting a node from target groups / removing a node from load balancer(s); SSO Connection problem.
- Warning — Workload Autoscaler: **Continuous OOMKilled Events Detected** ("Workload automation is disabled and re-enabled automatically after a cooldown period").
- Warning — Node Autoscaler: **Pending pod detected** (resolves automatically once scheduled).
- Warning — Reporting anomalies: **Cost anomaly detected on the {metric} metric** ("Cast AI monitors cost and efficiency metrics across your cluster (e.g. compute cost, CPU/RAM overprovisioning, network egress)").
- Warning (Other): Failed Helm Test of castai-workload-autoscaler; Failed to reconcile cluster; GPU quota exceeded; Outdated cluster-controller; Unable to update pool; Spot Instance quota exceeded (warning variant when Spot Fallback enabled).
- Info — Inventory: New machines available in AWS / Azure / GCP. Info (Other): Read-Only access activated; Trial expires soon; Trial has expired.
- Success (Other): Cluster reconciled.

**Slack channel configuration (native):** connect from console only (not from Slack); OAuth; **each Cast AI organization ↔ its own Slack workspace (1:1)**; requires Organization Owner or Enterprise Owner; select **up to 5 channels per alert**; private channels need `/invite @Cast AI`; admin-approval flow shows Pending (request expires in 7 days); alert fields: Name, Category (All or individual), **Clusters** (All clusters or specific; **Include non-cluster alerts** toggle on by default for org-level notifications), **Notification severity** (Critical/Error/Warning/Success/Info); Test button sends a test notification. Slack messages include severity, summary, console link.

**Webhook configuration:** fields (verbatim table): **Callback Url; Name; Category** (All possible); **Clusters** (with Include non-cluster alerts toggle); **Severity Triggers; Template; Headers**. Payload templates are Go templates with variables: `{{ .NotificationID }}`, `{{ .OrganizationID }}`, `{{ .Severity }}`, `{{ .Name }}`, `{{ .Message }}`, `{{ toJSON .Details }}` / `{{ toEscapedString .Details }}` / `fromJSON`, `{{ toISO8601 .Timestamp }}`, `{{ toJSON .Cluster }}`, `.Cluster.ID`, `.Cluster.Name`, `.Cluster.ProjectName` (GCP Project / AWS Account / Azure Subscription; same value as legacy `ProjectNamespaceID`), `.Cluster.ProviderType` (`eks`, `gke`, `aks`, `kops`). Strict typing: JSON object into a string field ⇒ HTTP `422 validation_error`. Documented target examples: Slack (custom formatting only), **PagerDuty** (`https://events.pagerduty.com/v2/enqueue`), **OpsGenie** (`https://api.opsgenie.com/v2/alerts`), **incident.io** (`https://api.incident.io/v2/alert_events/http/<source-id>`), all using NotificationID as dedup key; `Content-Type: application/json` header required.
- Scope: configs are **per-organization** (WebhookConfig carries organizationId), optionally filtered to specific clusters (`clusterTriggers.clusterIds`, `includeClusterless`).

**Security anomaly webhook (verbatim):** select category `Security` and operation `Anomalies`; `.Details` object contains `anomaly_id`, `status` (open/acked/closed), `rule_metadata` (id/name/type/category/labels), and up to **10 related events** (timestamp, type, cluster, resource incl. namespace/pod/container/workload, process, host_pid, payload_digest, one of exec/file/tcp/dns/socks5/stdio_via_socket detail). Rule types (10, verbatim): crypto_mining:binary_executed; crypto_mining:dns_lookup; crypto_mining:tcp_connect; network:tcp_public_non_standard_port; network:suspicious_destination_ip; suspicious_binary:nezha_server; suspicious_binary:vnc_server; general:dropped_binary_executed; general:oom_killed; ml:suspicious_container_stats. Event types: exec, dns, file_change, tcp_connect, tcp_listen, tcp_connect_error, process_oom_killed, magic_write.

**"Alerts" feature:** in the current docs the alerting feature **is** Notifications → **Manage alerts → Create alert** (delivery method Slack or Webhook) — i.e., an alert = category + cluster scope + severity triggers + destination. Cost anomaly detection alerts are the "Reporting anomalies" category (see above); security anomaly detection has its own webhook operation. NOTE: the terms in the meeting brief — "cluster heartbeat", "rebalance events", "spot interruption", "agent disconnected", "commit deadline" — do **not** appear as notification names in the current docs reference. Closest documented analogues: "The Cast AI agent is unable to connect to the API" / "Cluster controller not responding" (heartbeat/agent), "Nodes interrupted" (spot, in the audit log — see §9), rebalancing progress (audit events, e.g. `autoscaler.rebalancing.initiated` in Audit v2), commitment utilization (reported on the Commitments page, snapshot-only, no alerts documented). Do not present those legacy names as current.

---

## 7. API reference endpoints (exact, verified paths)

Index: https://docs.cast.ai/reference/llms.txt (and per-category indexes). Base domains: `https://api.cast.ai/` (US), `https://api.eu.cast.ai/` (EU). Auth on all: Bearer JWT or `X-API-Key` header. Each path below was read from the endpoint's own OpenAPI page (`.md`) unless marked "(index)" = endpoint title from the index listing, path not independently opened.

**Cost reports (ClusterReportAPI / WorkloadReportAPI):**
- `GET /v1/cost-reports/clusters/{clusterId}/cost` — cluster cost report (params: startTime, endTime, stepSeconds, useListingPrices). Response splits cost per resource offering (onDemand/spot/spotFallback) per CPU/RAM/GPU/TPU + storage.
- `GET /v1/cost-reports/clusters/{clusterId}/efficiency` — params startTime/endTime/stepSeconds/useListingPrices; response: current provisioned/requested/used CPU & RAM, `cpuOverprovisioningPercent`, `ramOverprovisioningPercent`, per-offering (OnDemand/Spot/SpotFallback) provisioned/requested/used + overprovisioning %, costPerCpu/Ram provisioned/requested/used, storage overprovisioning; `noDataReason` enum: Unknown / NoMetricsServer / AgentOutdated.
- `GET /v1/cost-reports/clusters/{clusterId}/savings` — cluster savings report (items: timestamp, downscalingSavings, spotSavings; summary totalCost/totalSavings).
- `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings` — available savings recommendation (recommendations map with hourly/monthly priceBefore/priceAfter, savingsPercentage, ARM savings; currentConfiguration; `isRebalancingRecommended`).
- `GET /v1/cost-reports/clusters/{clusterId}/cost-anomalies` — detected cost anomalies in a period (params startTime, endTime, metrics[]; response: anomalies[{timestamp, metric}]).
- `POST /v1/cost-reports/clusters/{clusterId}/workload-cost-summaries` — per-workload compute cost report (body WorkloadFilter: labels/names/types/namespaces; params include `includeIdleResourceCosts`, `useListingPrices`, pagination/sort).
- (index) More of the same family: organization cost report, clusters summary, organization efficiency report/summary, rightsizing summary, cluster resource usage, unscheduled pods, cluster overview, namespaces cost reports, allocation-group cost/efficiency reports, cost comparison report, node template metrics, instance metrics.

**Savings / value realization (ValueRealizationAPI, Reporting product):**
- `POST /reporting/v1beta/organizations/{id}:runValueRealizationTimelineReport` — org timeline report: actual vs projected cost, autoscalerSavings, workloadAutoscalerSavings, totalSavings, provisioned/projected/requested CPU & memory (hourly and cumulative hours), node counts & cost per node, WOOP adoption (`woopAdopted`, `autoscalerAdopted`, managed vs unmanaged workload counts/utilization). Params: startTime, endTime, timeZone, step (ONE_DAY/ONE_MONTH), useListingPrices, managedOnly; body filter: clusterIds[].
- (index) Also: `RunClustersValueRealizationReport`, `RunWorkloadsValueRealizationReport` (per-workload WOOP impact), `GetBaselineParams`, `UpdateBaselineParams`, `RecalculateBaselineParams` (custom date ranges) — mirroring the Savings report/baseline mechanics in §2.

**Cluster score & optimization constraints:**
- (index) `ClusterScoreAPI_ListClusterRestrictions`, `ClusterScoreAPI_GetClusterRestrictionDetails` — "restrictions" = the cluster-score optimization constraints.
- (index) `OptimizationAPI_RunClusterOptimizationsReport` — "optimization reports for clusters including utilization metrics and autoscaler suggestions."
- (index) `ReliabilityMetricsAPI_GetOrganizationClustersReliabilityMetrics`, `ReliabilityMetricsAPI_GetClusterReliabilityMetrics` — request rate, error rate, latency percentiles.

**Events / audit:**
- `GET /v1/audit` (AuditAPI_ListAuditEntries) — params: clusterId, fromDate, toDate, labels (map), operation, initiatedById, initiatedByEmail, pagination. Entry: id, eventType, initiatedBy{id,name,email}, time, event (free form), labels, operation{type,text}.
- `GET /v2/audit/events` (AuditV2API_ListAuditEvents) — filters: clusters[], domains[] (e.g. "platform", "autoscaler"), resources[] (e.g. "cluster", "node"), actions[] (e.g. "created", "deleted"), sources[] (e.g. "provisioner", "woop"), severity[] ("info", "error"), text search, fromDate/toDate, cursor pagination, sort. Event model (verbatim comment): "Event types follow a three-segment hierarchy: domain.resource.action (e.g. `autoscaler.rebalancing.initiated`)", with eventId, correlationId (+correlatedEventCount), occurredAt/ingestedAt, sourceService, severity (numeric + text), actor{type,id,displayName,email}, resource{type,id,displayName}, clusterId, labels, body (base64 JSON), description.
- (index) Related: AuditV2 GetAuditEvent, GetRelatedAuditEvents, GetAuditHistogram (bucketed by time, grouped by severity), GetAuditStats.
- NOTE: I found no current public "cluster events" listing endpoint other than the audit APIs and the WOOP Event log (console). `components` ingest endpoints are for Cast agents, not for customers reading events.

**Notifications (NotificationAPI):**
- `GET /v1/notifications` — list org notifications; filters: severities (enum UNSPECIFIED/CRITICAL/ERROR/WARNING/INFO/SUCCESS), isAcked, notificationId/name, clusterId/clusterName, operationId/operationType, project, isExpired; response has countUnacked. Also AckNotifications op.
- `GET /v1/notifications/webhook-categories` — all available webhook categories and subcategories.
- `POST /v1/notifications/webhook-configurations` — create webhook (callbackUrl, name, severityTriggers[], clusterTriggers.clusterIds[], includeClusterless, authKeys, requestTemplate, category, subcategory, dryRun validation mode). (index) Full CRUD: List/Get/Update/DeleteWebhookConfig.
- (index) Slack: List/Create/Get/Update/DeleteSlackConfig, ListSlackWorkspaces, CreateSlackWorkspaceInstall/CompleteSlackWorkspaceInstall, ListSlackChannels, SendTestSlackConfigNotification, SendSlackWorkspaceTestNotification.
- (index) Security anomalies: `/v1/security/runtime/anomalies` (+ ack, close, {id}, {id}/events, trigger-webhook) for Kvisor runtime detections.

**Workloads / recommendations (WorkloadOptimizationAPI + WorkloadReportAPI, index listings):**
- List workloads, Get workload (+spec), GetWorkloadsSummary, GetWorkloadsSummaryMetrics, ListWorkloadScalingPolicies + CRUD, AssignScalingPolicyWorkloads, GetWorkloadRecommendationManifest, GetWorkloadNativeVpaSpec, ListWorkloadEvents / GetWorkloadEvent / GetWorkloadEventsSummary (WOOP event log), GetWorkloadFilters, QueryWorkloadMetrics.
- WorkloadReportAPI: GetClusterWorkloadReport, GetClusterWorkloadEfficiencyReport (+ByName), GetClusterWorkloadRightsizingPatch, GetSingleWorkloadCostReport.
- Node/autoscaler ops relevant to "why not optimizing": AutoscalerAPI_GetProblematicNodes / GetProblematicWorkloads ("cannot be rebalanced"), ListRebalancingPlans / GenerateRebalancingPlan / Get / Execute / Cancel, SimulateNodeSpotInterruption; NodeTemplateAPI metrics; InstanceAPI_ListInstances.
- Prometheus scraping: ReportMetricsAPI_GetPromMetrics (+ workload/node/node-template/allocation-group/network variants).

---

## 8. Why a cluster cannot be optimized further (documented blockers)

Sources: https://docs.cast.ai/docs/evictor · /docs/rebalancing · /docs/preparation · /docs/autoscaler-checklist · /docs/optimization-constraints · /docs/spot · /docs/commitments

**Rebalancing preconditions & failure modes (rebalancing page):**
- Prerequisite: "**Unscheduled pods policy** must be enabled"; if disabled, triggering a rebalance returns an "**Autoscaler is disabled**" error even if the top-level autoscaler setting is enabled. (Terraform `unschedulable_pods { enabled = true }`, defaults to false.)
- Plan statuses: Generating → Ready → In progress → Completed; **Partial** ("some nodes could not be fully rebalanced, for example, nodes that failed to drain during graceful rebalancing", failed nodes annotated `rebalancing.cast.ai/status=drain-failed`); **Failed** ("blocking condition such as Pod Disruption Budgets, insufficient capacity, or a timeout"); **Obsolete** (superseded or >1h old).
- "Only Nodes without problematic workloads will be considered for rebalancing."
- PDB handling: eviction respects PDBs; if PDB can't be satisfied, wait up to drain timeout (**default 20 minutes, maximum 180 minutes**); after timeout: forceful drain+delete (default) OR with graceful eviction: cordon + `drain-failed` annotation, auto-uncordon after 3 h (`rebalancing.cast.ai/uncordon-after`; disable via `drainFailureConfig.disableUncordon=true`).
- Per-phase timeouts: Node creation 80 min; Node preparation 80 min; Node draining = configured drain timeout + 20-min buffer; Node deletion 80 min (non-configurable except draining).
- Spot-fallback nodes: "Rebalancing intentionally does not honor removal-disabled labels or annotations for spot-fallback Nodes" (by design, so clusters don't stay on expensive fallback).

**Problematic workloads (preparation page):** pods with unsupported node selector criteria, e.g. required node affinity on custom labels the rebalancer is unaware of (fix: map a NodeTemplate to the custom labels). Unfixable workloads get `Not ready` in the Rebalancer view and can be marked disposable (`autoscaling.cast.ai/disposable="true"`). Known limitations: topology spread constraints with `kubernetes.io/hostname` (low skew may be impractical); **default node template requirement** — "If a node contains pods using a disabled node template, that node will be marked as having problematic workloads and excluded from rebalancing."

**Evictor exclusion/downtime rules (evictor page, verbatim criteria for a node to be a removal candidate):** every pod on the node must be replicated (controller with >1 replica); not part of a StatefulSet unless marked disposable or CLM-eligible; not marked non-evictable; static pods considered evictable; **DaemonSet pods are not evicted**; **"Evictor always respects PDBs"** (regardless of aggressive/disposable settings). **Aggressive mode does NOT target: pods with PVCs, bare pods, StatefulSets.** Scoped mode restricts Evictor to Cast-created nodes (`provisioner.cast.ai/managed-by=cast.ai`). Opt-outs: `autoscaling.cast.ai/removal-disabled` (node/pod), `cluster-autoscaler.kubernetes.io/safe-to-evict="false"`; protection annotations apply only while pod is Running. Default `nodeGracePeriodMinutes=5` (Evictor ignores nodes younger than that). **Dry-run**: every manual install/enable command sets `autoscaler.castai-evictor.dryRun=false`, i.e. the chart default is dry-run — Evictor simulates without evicting until explicitly switched off (aligns with checklist: Evictor "continuously simulates scenarios ... Simulation respects PDBs"). CPU limits: 429 `TooManyRequests` / "Cannot evict pod as it would violate the pod's disruption budget" = PDB violation, distinct from apiserver rate limiting (troubleshooting section). Strict PDB (`minAvailable` = replica count ⇒ ALLOWED DISRUPTIONS 0) blocks eviction entirely.

**Checklist-level blockers (autoscaler-checklist):** partially managed clusters (legacy node pools/ASGs) — recommend annotating those nodes `autoscaling.cast.ai/removal-disabled="true"` "so that Cast AI can exclude such nodes from the Evictor & Rebalancing features" (this is the documented "dedicated on-demand pools" pattern). Required before production: PDBs on critical workloads; avoid `imagePullPolicy: Always`; startup probes for slow apps; stateful workloads reviewed individually; node grace period vs startup time.

**Optimization constraints (advisory checks behind low scores):** missing liveness/readiness probes (readiness skipped for CronJob/Job); PDB issues ("Missing availability settings" = PDB without minAvailable/maxUnavailable; "Too strict PDB" = `maxUnavailable: 0` or `minAvailable` ≥ replica count; applies to Deployments/ReplicaSets/StatefulSets/ReplicationControllers); topology spread (missing constraints for ≥3 replicas; "High max skew" = maxSkew > 2 for zone/region, > 3 for hostname; skipped for Pod/Job/CronJob). Suppress all checks per workload: pod-template annotation `reporting.cast.ai/ignore-optimization-constraints: "true"`. "Advisory — Cast AI does not modify your workloads to resolve them."

**Spot-specific blockers (spot page):** Why not the cheapest spot: cloud quotas; recent interruption cooling-off per instance type; blacklisting; availability fluctuation at creation; zone constraints (subnets in node configuration, template instance-type allowlist, subnet IP exhaustion, pod zone affinity, zone-bound volumes, pod affinity with zone topology, topology spread on zone). Spot-friendly workload criteria (available-savings recommendations): already on spot; tolerates spot taints; not marked cluster-critical. Spot fallback exists for "no Spot Instance availability" (temporary on-demand, labeled `scheduling.cast.ai/spot-fallback:"true"`). Interruption prediction: predictions every 10 min per node; node drain labels `autoscaling.cast.ai/draining=spot-prediction|rebalancing|spot-fallback|spot-interruption|manual`; ML model horizon ≤180 min (AWS 1h / GCP 3h coverage note).
NOTE: "spot opt-out" per workload = tolerations/nodeSelector absence, or `scheduling.cast.ai/spot: "true"` nodeSelector for spot-only; there is no single "opt-out" flag — placement is driven by workload spot config.

**Commitment-coverage blockers (commitments page):** commitment types by provider (table: AWS RI & SP, GCP resource-based & Flex CUD, Azure RI & SP; none for Cast AI Anywhere). Reasons commitments are **not utilized** (verbatim verify-list): node template lacks On-Demand offering (commitments are treated as On-Demand); commitment not enabled/assigned to the cluster; region mismatch; capacity exhausted by other clusters/workloads; instance family prioritization overrides commitment preference. Spot-only templates ignore commitments entirely. Priority: AWS RIs → Savings Plans; GCP resource CUDs → Flex CUDs → next cheapest. Autoscaler uses up to 100% of each assigned commitment, then falls back to regular On-Demand/Spot. Utilization formula (verbatim): `Commitment utilization = (Provisioned CPU ÷ Total CPU in the commitment) × 0.5 + (Provisioned MEM ÷ Total MEM in the commitment) × 0.5` (spend-based commitments: single utilization rate). Commitment reporting is snapshot-only ("no ability to review historical data" currently).

**Workload-autoscaler (rightsizing) blockers (woop overview page):** hard node requirements force **deferred** mode (required pod anti-affinity on `kubernetes.io/hostname`; host network); **Rollouts always deferred**; **whitelisting mode** ⇒ only workloads labeled `workload-autoscaler.cast.ai/enabled: "true"`; label `workload-autoscaler.cast.ai/ignore: "true"` on pod template/namespace blocks mutation; GKE Autopilot clamps recommendations to compute-class mins/ratios and marks `kube-system`/`gke-gmp-system` read-only; OOM loop protection — at 2.5x overhead cap, **20 OOM events within 1 hour disables optimization for a 4-hour cooldown** (then re-enabled); optimization-threshold gating for immediate mode (default 10% CPU & memory); immediate apply goes through the Kubernetes Eviction API, so **PDBs block VPA apply too**.

---

## 9. Audit log exporter

Sources: https://docs.cast.ai/docs/audit-log-exporter · https://docs.cast.ai/docs/audit-log

- What it is (facts): open-source component (GitHub `castai/audit-logs-receiver`, Helm chart `castai-audit-logs-receiver` in castai/helm-charts) built as a **custom OpenTelemetry Collector**: a **receiver** pulls audit logs "through CAST AI's public API" and **exporters** deliver to any external log management system (any OTel contrib exporter). Runs **on the user's infrastructure** (standalone app or Kubernetes); Cast AI provides setup/tuning support. Purpose: aggregate with logs from other systems; keep history **beyond the 90-day console retention** (compliance).
- Events it streams: the exporter doc does not enumerate event types; it exports the audit log = the event set documented on the Audit log page (verbatim table): **Policy Management** (Policy enabled, Policy configuration, Unschedulable pods policy), **Node Operations** (Node added, Node removed, Node deletion requested, Add node failed / Adding node failed, Nodes interrupted, Dead node deleted), **Cluster Management** (Cluster created/paused/deleted, Cluster hibernated + hibernation triggered/schedule failed/job finished/pending/failed, Critical components validated, Cluster reconcile triggered, Autoscaler executed, Rebalance plan change), **Instance Management** (Addblacklist executed), **Spot Instance Events** (Spot fallback enabled/disabled/updated, Spot node found, Failed to add nodes, Failed to drain nodes), **Pod Management** (Unscheduled pods policy).
- Audit log UI facts: columns Timestamp / Operation name / Initiated by; expandable details (YAML/JSON view); filters incl. text search, time range, initiated-by, and advanced criteria: Rebalance ID, Node ID, Node status, Policy applied, Node template, Node template version, Configuration version; retention 90 days then archived (link: data-collection-and-storage#audit-log-retention-policy).
- NOTE: the exporter pulls via the public audit API — today that's `GET /v1/audit` and the richer `GET /v2/audit/events` (domains like `platform`/`autoscaler`/`woop`/`dbo`, severities info/error) — this mapping to endpoints is my inference from the API pages; the exporter page itself just says "CAST AI's public API."

---

## Bonus: related "optimization health" pages worth knowing

- **Reliability metrics** (https://docs.cast.ai/docs/reliability-metrics): RED-method signals per workload — request rate, error rate (req/s and %), latency P50/P95/P99, Availability % (= 100 − error rate %); a workload is classified **unhealthy when error rate exceeds 5%** over the selected range; ranges 15m/30m/1h/6h/24h; data ~2–3 min freshness; server-side only, default ports 8080/8443/8090/6379.
- **Optimization constraints** (see §8): the advisory layer that explains *why* a score is low (probes/PDB/topology), surfaced alongside Cluster Score.
- **WOOP Event log** (https://docs.cast.ai/docs/event-log, referenced): records events such as "recommendation generated", "CPU stall detected", OOM/surge handling.
- **llms.txt convention**: full docs index at https://docs.cast.ai/llms.txt; API index at https://docs.cast.ai/reference/llms.txt; append `.md` to any docs page URL for its Markdown body.
