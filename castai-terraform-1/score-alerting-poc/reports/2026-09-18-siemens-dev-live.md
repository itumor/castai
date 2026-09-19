# Score-based alerting — scan report
_Generated 2026-09-18T12:58:20+00:00_

## sp-tofu-simple — 33%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region eu-central-1
- owners (default): ahmed.khaldi@cast.ai
- findings: 2

### 🔴 Evictor disabled — no continuous bin packing
Evictor is off. The Bin Packing sub-metric needs the node deletion policy and Evictor on, with median node utilization > 65%.
- Enable Evictor on the cluster policies (nodeDownscaler.evictor.enabled=true) — dryRun first is fine.
- Confirm PDBs on critical workloads before production eviction.
- Annotate dedicated on-demand pools with autoscaling.cast.ai/removal-disabled=true if they must stay.


### 🔴 Last rebalance 130 days ago (generated)
Docs: run rebalancing at least every two weeks; Poor = none in 30 days.
- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.
- Set up scheduled rebalancing (weekly/biweekly) so recency stays green.
- If the plan comes back Partial/Failed: check problematic workloads (custom node-affinity labels, disabled node templates, hostname topology spread) and strict PDBs.


## dev-vlab-cluster — 0%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region ap-southeast-1
- owners (default): ahmed.khaldi@cast.ai
- findings: 5

### 🔴 Evictor disabled — no continuous bin packing
Evictor is off. The Bin Packing sub-metric needs the node deletion policy and Evictor on, with median node utilization > 65%.
- Enable Evictor on the cluster policies (nodeDownscaler.evictor.enabled=true) — dryRun first is fine.
- Confirm PDBs on critical workloads before production eviction.
- Annotate dedicated on-demand pools with autoscaling.cast.ai/removal-disabled=true if they must stay.


### 🔴 Rebalancer never run on this cluster
No rebalancing plan has ever been executed. Docs: Poor = no rebalancing in the last 30 days; recommended at least once every two weeks.
- FIRST: enable the Unscheduled Pods policy — rebalancing refuses to run while it is off ("Autoscaler is disabled" error).
- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.
- Set up scheduled rebalancing (weekly/biweekly) so recency stays green.
- If the plan comes back Partial/Failed: check problematic workloads (custom node-affinity labels, disabled node templates, hostname topology spread) and strict PDBs.


### 🔴 Workload Autoscaler not configured on any workload
No workload scaling policies exist. The Workload Optimization sub-metric needs WOOP enabled and optimizing most workloads.
- Create one scaling policy covering broad namespaces with 'recommend' defaults, then flip optimization on for the top waste offenders.
- Exclude/cover deliberately: label workloads workload-autoscaler.cast.ai/enabled=true for allowlist mode, or workload-autoscaler.cast.ai/ignore=true to opt out.
- Watch for PDB-blocked applies and OOM-loop cooldown (20 OOMs/h → 4h pause) in the WOOP event log.


### 🔴 CAST AI flags rebalancing as recommended — modeled savings ≈ 86%
The available-savings recommendation says the current node configuration could cost ≈ 86% less — run the plan, don't leave it on the table.
- Generate and review a rebalancing plan; execute during a maintenance window if drain risk worries you.
- Verify spot readiness (quotas, subnet IPs, instance-type allowlists) before executing.


### 🔵 29 optimization constraints registered
Advisory checks that explain *why* optimization may stall: Deployment/aws-load-balancer-controller -> missing_probes, DaemonSet/aws-node -> missing_probes, Deployment/castai-agent -> missing_probes, Deployment/castai-agent-cpvpa -> missing_probes, Deployment/cert-manager -> missing_probes (+24 more). Constraints do not change the score but block evictions/rebalancing.
- Fix strict PDBs (maxUnavailable: 0 or minAvailable >= replicas).
- Add liveness/readiness probes and sane topology spread constraints.
- Suppress intentional cases with the pod-template annotation reporting.cast.ai/ignore-optimization-constraints: "true".


## dev-vlab-cluster — 0%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region us-west-2
- owners (default): ahmed.khaldi@cast.ai
- findings: 5

### 🔴 Evictor disabled — no continuous bin packing
Evictor is off. The Bin Packing sub-metric needs the node deletion policy and Evictor on, with median node utilization > 65%.
- Enable Evictor on the cluster policies (nodeDownscaler.evictor.enabled=true) — dryRun first is fine.
- Confirm PDBs on critical workloads before production eviction.
- Annotate dedicated on-demand pools with autoscaling.cast.ai/removal-disabled=true if they must stay.


### 🔴 Rebalancer never run on this cluster
No rebalancing plan has ever been executed. Docs: Poor = no rebalancing in the last 30 days; recommended at least once every two weeks.
- FIRST: enable the Unscheduled Pods policy — rebalancing refuses to run while it is off ("Autoscaler is disabled" error).
- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.
- Set up scheduled rebalancing (weekly/biweekly) so recency stays green.
- If the plan comes back Partial/Failed: check problematic workloads (custom node-affinity labels, disabled node templates, hostname topology spread) and strict PDBs.


### 🔴 Workload Autoscaler not configured on any workload
No workload scaling policies exist. The Workload Optimization sub-metric needs WOOP enabled and optimizing most workloads.
- Create one scaling policy covering broad namespaces with 'recommend' defaults, then flip optimization on for the top waste offenders.
- Exclude/cover deliberately: label workloads workload-autoscaler.cast.ai/enabled=true for allowlist mode, or workload-autoscaler.cast.ai/ignore=true to opt out.
- Watch for PDB-blocked applies and OOM-loop cooldown (20 OOMs/h → 4h pause) in the WOOP event log.


### 🔴 CAST AI flags rebalancing as recommended — modeled savings ≈ 78%
The available-savings recommendation says the current node configuration could cost ≈ 78% less — run the plan, don't leave it on the table.
- Generate and review a rebalancing plan; execute during a maintenance window if drain risk worries you.
- Verify spot readiness (quotas, subnet IPs, instance-type allowlists) before executing.


### 🔵 29 optimization constraints registered
Advisory checks that explain *why* optimization may stall: Deployment/aws-load-balancer-controller -> missing_probes, DaemonSet/aws-node -> missing_probes, Deployment/castai-agent -> missing_probes, Deployment/castai-agent-cpvpa -> missing_probes, Deployment/cert-manager -> missing_probes (+24 more). Constraints do not change the score but block evictions/rebalancing.
- Fix strict PDBs (maxUnavailable: 0 or minAvailable >= replicas).
- Add liveness/readiness probes and sane topology spread constraints.
- Suppress intentional cases with the pod-template annotation reporting.cast.ai/ignore-optimization-constraints: "true".


## pfm-eks-cluster — 100%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region eu-west-1
- owners (default): ahmed.khaldi@cast.ai
- findings: 2

### 🔴 CAST AI flags rebalancing as recommended — modeled savings ≈ 67%
The available-savings recommendation says the current node configuration could cost ≈ 67% less — run the plan, don't leave it on the table.
- Generate and review a rebalancing plan; execute during a maintenance window if drain risk worries you.
- Verify spot readiness (quotas, subnet IPs, instance-type allowlists) before executing.


### 🔵 80 optimization constraints registered
Advisory checks that explain *why* optimization may stall: Deployment/alarm -> pod_disruption_budget, StatefulSet/alertmanager-nxpower-monitoring-prometh-alertmanager -> missing_probes, DaemonSet/alloy -> missing_probes, Deployment/asset -> pod_disruption_budget, Deployment/audit-trail -> topology_spread_constraint (+75 more). Constraints do not change the score but block evictions/rebalancing.
- Fix strict PDBs (maxUnavailable: 0 or minAvailable >= replicas).
- Add liveness/readiness probes and sane topology spread constraints.
- Suppress intentional cases with the pod-template annotation reporting.cast.ai/ignore-optimization-constraints: "true".


## dev-vlab-cluster — 0%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region eu-central-1
- owners (default): ahmed.khaldi@cast.ai
- findings: 5

### 🔴 Evictor disabled — no continuous bin packing
Evictor is off. The Bin Packing sub-metric needs the node deletion policy and Evictor on, with median node utilization > 65%.
- Enable Evictor on the cluster policies (nodeDownscaler.evictor.enabled=true) — dryRun first is fine.
- Confirm PDBs on critical workloads before production eviction.
- Annotate dedicated on-demand pools with autoscaling.cast.ai/removal-disabled=true if they must stay.


### 🔴 Last rebalance 490 days ago (finished)
Docs: run rebalancing at least every two weeks; Poor = none in 30 days.
- FIRST: enable the Unscheduled Pods policy — rebalancing refuses to run while it is off ("Autoscaler is disabled" error).
- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.
- Set up scheduled rebalancing (weekly/biweekly) so recency stays green.
- If the plan comes back Partial/Failed: check problematic workloads (custom node-affinity labels, disabled node templates, hostname topology spread) and strict PDBs.


### 🔴 Workload Autoscaler not configured on any workload
No workload scaling policies exist. The Workload Optimization sub-metric needs WOOP enabled and optimizing most workloads.
- Create one scaling policy covering broad namespaces with 'recommend' defaults, then flip optimization on for the top waste offenders.
- Exclude/cover deliberately: label workloads workload-autoscaler.cast.ai/enabled=true for allowlist mode, or workload-autoscaler.cast.ai/ignore=true to opt out.
- Watch for PDB-blocked applies and OOM-loop cooldown (20 OOMs/h → 4h pause) in the WOOP event log.


### 🔴 CAST AI flags rebalancing as recommended — modeled savings ≈ 68%
The available-savings recommendation says the current node configuration could cost ≈ 68% less — run the plan, don't leave it on the table.
- Generate and review a rebalancing plan; execute during a maintenance window if drain risk worries you.
- Verify spot readiness (quotas, subnet IPs, instance-type allowlists) before executing.


### 🔵 49 optimization constraints registered
Advisory checks that explain *why* optimization may stall: Deployment/aws-load-balancer-controller -> missing_probes, DaemonSet/aws-node -> missing_probes, Deployment/backend -> missing_probes, Deployment/backend -> missing_probes, Deployment/backend -> missing_probes (+44 more). Constraints do not change the score but block evictions/rebalancing.
- Fix strict PDBs (maxUnavailable: 0 or minAvailable >= replicas).
- Add liveness/readiness probes and sane topology spread constraints.
- Suppress intentional cases with the pod-template annotation reporting.cast.ai/ignore-optimization-constraints: "true".


## shared-services-us-east-1-eks — 0%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region us-east-1
- owners (default): ahmed.khaldi@cast.ai
- findings: 5

### 🔴 Evictor disabled — no continuous bin packing
Evictor is off. The Bin Packing sub-metric needs the node deletion policy and Evictor on, with median node utilization > 65%.
- Enable Evictor on the cluster policies (nodeDownscaler.evictor.enabled=true) — dryRun first is fine.
- Confirm PDBs on critical workloads before production eviction.
- Annotate dedicated on-demand pools with autoscaling.cast.ai/removal-disabled=true if they must stay.


### 🔴 Rebalancer never run on this cluster
No rebalancing plan has ever been executed. Docs: Poor = no rebalancing in the last 30 days; recommended at least once every two weeks.
- FIRST: enable the Unscheduled Pods policy — rebalancing refuses to run while it is off ("Autoscaler is disabled" error).
- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.
- Set up scheduled rebalancing (weekly/biweekly) so recency stays green.
- If the plan comes back Partial/Failed: check problematic workloads (custom node-affinity labels, disabled node templates, hostname topology spread) and strict PDBs.


### 🔴 Workload Autoscaler not configured on any workload
No workload scaling policies exist. The Workload Optimization sub-metric needs WOOP enabled and optimizing most workloads.
- Create one scaling policy covering broad namespaces with 'recommend' defaults, then flip optimization on for the top waste offenders.
- Exclude/cover deliberately: label workloads workload-autoscaler.cast.ai/enabled=true for allowlist mode, or workload-autoscaler.cast.ai/ignore=true to opt out.
- Watch for PDB-blocked applies and OOM-loop cooldown (20 OOMs/h → 4h pause) in the WOOP event log.


### 🔴 CAST AI flags rebalancing as recommended — modeled savings ≈ 87%
The available-savings recommendation says the current node configuration could cost ≈ 87% less — run the plan, don't leave it on the table.
- Generate and review a rebalancing plan; execute during a maintenance window if drain risk worries you.
- Verify spot readiness (quotas, subnet IPs, instance-type allowlists) before executing.


### 🔵 23 optimization constraints registered
Advisory checks that explain *why* optimization may stall: StatefulSet/alertmanager-kube-prometheus-stack-alertmanager -> missing_probes, Deployment/aws-load-balancer-controller -> missing_probes, DaemonSet/aws-node -> missing_probes, Deployment/castai-agent -> missing_probes, Deployment/castai-agent-cpvpa -> missing_probes (+18 more). Constraints do not change the score but block evictions/rebalancing.
- Fix strict PDBs (maxUnavailable: 0 or minAvailable >= replicas).
- Add liveness/readiness probes and sane topology spread constraints.
- Suppress intentional cases with the pod-template annotation reporting.cast.ai/ignore-optimization-constraints: "true".


## dev — 0%
- org: `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2` (Siemens Dev) · provider eks · region us-west-2
- owners (default): ahmed.khaldi@cast.ai
- findings: 4

### 🔴 Evictor disabled — no continuous bin packing
Evictor is off. The Bin Packing sub-metric needs the node deletion policy and Evictor on, with median node utilization > 65%.
- Enable Evictor on the cluster policies (nodeDownscaler.evictor.enabled=true) — dryRun first is fine.
- Confirm PDBs on critical workloads before production eviction.
- Annotate dedicated on-demand pools with autoscaling.cast.ai/removal-disabled=true if they must stay.


### 🔴 Rebalancer never run on this cluster
No rebalancing plan has ever been executed. Docs: Poor = no rebalancing in the last 30 days; recommended at least once every two weeks.
- FIRST: enable the Unscheduled Pods policy — rebalancing refuses to run while it is off ("Autoscaler is disabled" error).
- Generate a rebalancing plan in the console or via AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.
- Set up scheduled rebalancing (weekly/biweekly) so recency stays green.
- If the plan comes back Partial/Failed: check problematic workloads (custom node-affinity labels, disabled node templates, hostname topology spread) and strict PDBs.


### 🔴 Workload Autoscaler not configured on any workload
No workload scaling policies exist. The Workload Optimization sub-metric needs WOOP enabled and optimizing most workloads.
- Create one scaling policy covering broad namespaces with 'recommend' defaults, then flip optimization on for the top waste offenders.
- Exclude/cover deliberately: label workloads workload-autoscaler.cast.ai/enabled=true for allowlist mode, or workload-autoscaler.cast.ai/ignore=true to opt out.
- Watch for PDB-blocked applies and OOM-loop cooldown (20 OOMs/h → 4h pause) in the WOOP event log.


### 🔴 CAST AI flags rebalancing as recommended — modeled savings ≈ 90%
The available-savings recommendation says the current node configuration could cost ≈ 90% less — run the plan, don't leave it on the table.
- Generate and review a rebalancing plan; execute during a maintenance window if drain risk worries you.
- Verify spot readiness (quotas, subnet IPs, instance-type allowlists) before executing.

