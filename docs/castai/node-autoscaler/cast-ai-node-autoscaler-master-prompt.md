# CAST AI Node Autoscaler — Master LLM Research Prompt

**Purpose:** Feed this entire prompt to a research-capable LLM (one that can open URLs and follow links) to produce a complete, production-grade Node Autoscaling tuning & best-practices engineering guide.

**Verified against:** https://docs.cast.ai live navigation + https://docs.cast.ai/llms.txt (checked 2026-10-17 — both reachable, HTTP 200).

**How to use:**
1. Copy everything inside the `MASTER PROMPT` section below (between the two `---` rules) into your LLM session.
2. Run it with an agent/model that has web browsing. The official docs expose machine-readable indexes (`/llms.txt`) and per-page Markdown (append `.md` to any docs URL).
3. Review the "Documentation coverage matrix" it returns first — confirm all sections were actually read before accepting the final handbook.

---

## MASTER PROMPT (copy from here)

**ROLE: Senior CAST AI Node Autoscaling Architect & Kubernetes SRE**

You are a Principal Kubernetes Platform Architect, CAST AI Node Autoscaler Specialist, Cloud FinOps Engineer, and Senior Site Reliability Engineer.

Your task is to produce the most comprehensive, technically accurate, hands-on CAST AI Node Autoscaler engineering guide possible, using ONLY the current official CAST AI documentation (plus the listed Kubernetes/AWS references).

- Main documentation: https://docs.cast.ai/docs/autoscaler
- Scope: CAST AI's **native Node Autoscaler** on Amazon EKS, Google GKE, and Azure AKS — with especially detailed Amazon EKS coverage.
- Audience: Senior DevOps Engineers, Kubernetes Platform Teams, Cloud Architects, SREs, FinOps teams, and CAST AI Technical Support Engineers.
- Objective: Teach an engineer how to design, install, configure, operate, tune, troubleshoot, secure, and optimize CAST AI Node Autoscaler end to end in real production environments.

This must be an **engineering operations manual**, not marketing material or a high-level overview.

---

### PART 1 — MANDATORY DOCUMENTATION RESEARCH

#### Documentation discovery (machine-readable first)

CAST AI documentation advertises machine-readable indexes. Start here and use them to discover every currently relevant Node Autoscaling page:

1. https://docs.cast.ai/llms.txt — top-level index (verified live)
2. https://docs.cast.ai/docs/llms.txt — full Guides section index
3. https://docs.cast.ai/docs/node-autoscaling/llms.txt — **Node Autoscaling section index (primary source)**
4. https://docs.cast.ai/docs/monitoring-reporting/llms.txt — savings/cost reporting section index
5. https://docs.cast.ai/reference/llms.txt — API reference index
6. https://docs.cast.ai/reference/cluster-autoscaler/llms.txt — Cluster/Node Autoscaler API endpoints
7. https://docs.cast.ai/reference/workload-eviction/llms.txt — Evictor API endpoints
8. https://docs.cast.ai/reference/castai-api-documentation/llms.txt
9. https://docs.cast.ai/changelog/llms.txt — release notes index
10. https://api.cast.ai/v1/spec/ — OpenAPI spec

Tip: append `.md` to any `https://docs.cast.ai/docs/<slug>` URL to get the Markdown version of that page. If an index or Markdown endpoint is inaccessible, use the HTML documentation and its internal navigation.

**Follow relevant links recursively. Do not limit research to the URLs listed below.** For every source, record:

- Page title and exact URL
- Access date and last-updated date, if available
- Features and configuration options documented
- Default values and limitations
- Cloud-provider applicability (EKS / GKE / AKS)
- Deprecations and breaking changes
- Associated API methods, fields, and permissions

Do not invent undocumented behavior or configuration fields. Mark anything that cannot be verified as **Unverified**.

#### A. Core Autoscaler documentation (read completely)

| # | Topic | URL |
|---|-------|-----|
| 1 | Autoscaler (main) | https://docs.cast.ai/docs/autoscaler |
| 2 | Node Autoscaler preparation checklist | https://docs.cast.ai/docs/autoscaler-checklist |
| 3 | Autoscaler settings | https://docs.cast.ai/docs/autoscaler-settings |
| 4 | Node templates | https://docs.cast.ai/docs/node-templates |
| 5 | Node configuration | https://docs.cast.ai/docs/node-configuration |
| 6 | Pod placement | https://docs.cast.ai/docs/pod-placement |
| 7 | Pod Pinner | https://docs.cast.ai/docs/pod-pinner |
| 8 | Autoscaler node labels and taints | https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints |
| 9 | Troubleshooting node autoscaling | https://docs.cast.ai/docs/autoscaler-troubleshooting |
| 10 | Managing DaemonSets with Cast AI | https://docs.cast.ai/docs/troubleshooting-daemonset-management |

#### B. Capacity types & specialized nodes

| # | Topic | URL |
|---|-------|-----|
| 11 | Spot Instances | https://docs.cast.ai/docs/spot |
| 12 | Spot interruption prediction API | https://docs.cast.ai/docs/ml-spot-interruption-prediction-api |
| 13 | GPU Instances | https://docs.cast.ai/docs/gpu |
| 14 | GPU sharing (time-slicing / MIG / MPS / fractional) | https://docs.cast.ai/docs/gpu-sharing (+ /gpu-sharing-time-slicing, /gpu-sharing-mig, /gpu-sharing-mps, /gpu-sharing-fractional) |
| 15 | Storage-optimized nodes | https://docs.cast.ai/docs/storage-optimized-nodes |
| 16 | TPU Instances (GKE) | https://docs.cast.ai/docs/tpu |
| 17 | AWS Neuron Instances (EKS) | https://docs.cast.ai/docs/neuron |
| 18 | Dynamic Resource Allocation (DRA) | https://docs.cast.ai/docs/dra |
| 19 | ARM / Graviton support | https://docs.cast.ai/docs/guide-arm-and-graviton-support |

#### C. Networking & commitments

| # | Topic | URL |
|---|-------|-----|
| 20 | Subnets | https://docs.cast.ai/docs/subnets |
| 21 | Network bandwidth | https://docs.cast.ai/docs/network-bandwidth |
| 22 | Commitments (overview) | https://docs.cast.ai/docs/commitments |
| 23 | Enterprise commitments | https://docs.cast.ai/docs/enterprise-commitments |
| 24 | AWS capacity reservations | https://docs.cast.ai/docs/aws-capacity-reservations |
| 25 | GCP capacity reservations | https://docs.cast.ai/docs/gcp-reservations |

#### D. Downscaling, Evictor, Rebalancing

| # | Topic | URL |
|---|-------|-----|
| 26 | Downscaling | https://docs.cast.ai/docs/downscaling |
| 27 | Evictor | https://docs.cast.ai/docs/evictor |
| 28 | Evictor vs. Rebalancer | https://docs.cast.ai/docs/node-autoscaling-evictor-vs-rebalancer |
| 29 | Rebalancing | https://docs.cast.ai/docs/rebalancing |
| 30 | Workload preparation for rebalancing | https://docs.cast.ai/docs/preparation |
| 31 | Scheduled rebalancing | https://docs.cast.ai/docs/scheduled-rebalancing |
| 32 | Paused drain configuration | https://docs.cast.ai/docs/rebalancing-paused-drain-configuration |
| 33 | Cluster hibernation | https://docs.cast.ai/docs/autoscaling-cluster-hibernation |
| 34 | Cluster hibernation (Legacy) | https://docs.cast.ai/docs/pausing-a-cluster |

#### E. Container Live Migration (disruption reduction for Evictor/Rebalancer)

| # | Topic | URL |
|---|-------|-----|
| 35 | CLM overview | https://docs.cast.ai/docs/clm-overview |
| 36 | CLM requirements and limitations | https://docs.cast.ai/docs/clm-requirements-and-limitations |
| 37 | CLM workload eligibility | https://docs.cast.ai/docs/clm-reference-workload-eligibility |
| 38 | CLM with Evictor and Rebalancer (tutorial) | https://docs.cast.ai/docs/clm-getting-started |
| 39 | CLM on AWS EKS | https://docs.cast.ai/docs/clm-cloud-providers-eks |

#### F. Pod mutations & scheduling automation

| # | Topic | URL |
|---|-------|-----|
| 40 | Pod mutations overview | https://docs.cast.ai/docs/pod-mutations-overview |
| 41 | Pod mutations quickstart | https://docs.cast.ai/docs/pod-mutations-quickstart |
| 42 | Pod mutations reference | https://docs.cast.ai/docs/pod-mutations-reference |
| 43 | Enable Workload Autoscaler with pod mutations | https://docs.cast.ai/docs/enable-workload-autoscaler-with-pod-mutations |

#### G. Installation, onboarding & operations

| # | Topic | URL |
|---|-------|-----|
| 44 | Connecting your cluster | https://docs.cast.ai/docs/connecting-your-cluster |
| 45 | Connect with castctl | https://docs.cast.ai/docs/connect-with-castctl |
| 46 | Connect via console | https://docs.cast.ai/docs/connect-via-console |
| 47 | Cloud Connect | https://docs.cast.ai/docs/cloud-connect |
| 48 | AWS PrivateLink | https://docs.cast.ai/docs/aws-privatelink |
| 49 | GCP Private Service Connect | https://docs.cast.ai/docs/gcp-private-service-connect |
| 50 | Cluster onboarding troubleshooting | https://docs.cast.ai/docs/cluster-onboarding-troubleshooting |
| 51 | Cloud permissions | https://docs.cast.ai/docs/cloud-permissions |
| 52 | Kubernetes permissions | https://docs.cast.ai/docs/kubernetes-permissions |
| 53 | Data collection and storage | https://docs.cast.ai/docs/data-collection-and-storage |
| 54 | Communication requirements | https://docs.cast.ai/docs/communication-requirements |
| 55 | API access | https://docs.cast.ai/docs/api-access |
| 56 | Hosted components | https://docs.cast.ai/docs/hosted-components |
| 57 | Cluster controller | https://docs.cast.ai/docs/cluster-controller |
| 58 | Spot Handler | https://docs.cast.ai/docs/spot-handler |
| 59 | Helm charts | https://docs.cast.ai/docs/helm-charts |
| 60 | Terraform provider | https://docs.cast.ai/docs/terraform-provider |
| 61 | EKS via GitOps (Terraform) | https://docs.cast.ai/docs/terraform-provider-eks |
| 62 | GKE via GitOps (Terraform) | https://docs.cast.ai/docs/terraform-provider-gke |
| 63 | AKS via GitOps (Terraform) | https://docs.cast.ai/docs/terraform-provider-aks |
| 64 | Terraform troubleshooting | https://docs.cast.ai/docs/terraform-troubleshooting |
| 65 | Import and apply cluster configuration (castctl) | https://docs.cast.ai/docs/castctl-import-cluster-configuration |
| 66 | Migrate standalone Helm charts (castctl) | https://docs.cast.ai/docs/castctl-migrate-standalone-helm-charts |
| 67 | Migrate GitOps and IaC installations (castctl) | https://docs.cast.ai/docs/castctl-migrate-gitops |
| 68 | castctl command reference | https://docs.cast.ai/docs/castctl-reference |
| 69 | Component control | https://docs.cast.ai/docs/component-control |
| 70 | Cast AI Operator | https://docs.cast.ai/docs/castai-operator |
| 71 | Troubleshooting Cast AI components | https://docs.cast.ai/docs/component-troubleshooting |
| 72 | Upgrading Kubernetes version | https://docs.cast.ai/docs/upgrading-kubernetes-version |
| 73 | Cluster certificate rotation | https://docs.cast.ai/docs/troubleshooting-certificate-rotation |
| 74 | Disconnect your cluster | https://docs.cast.ai/docs/disconnect-your-cluster |
| 75 | Business continuity | https://docs.cast.ai/docs/business-continuity |
| 76 | Watchdog | https://docs.cast.ai/docs/watchdog |

#### H. Monitoring, savings & FinOps

Discover the exact current pages via https://docs.cast.ai/docs/monitoring-reporting/llms.txt, then read at minimum:

| # | Topic | URL |
|---|-------|-----|
| 77 | Available savings | https://docs.cast.ai/docs/available-savings |
| 78 | Realized savings / savings report | https://docs.cast.ai/docs/savings-report |
| 79 | Savings calculations and baseline | https://docs.cast.ai/docs/savings-baseline |
| 80 | Cost comparison | https://docs.cast.ai/docs/cost-comparison |
| 81 | Cluster cost report | https://docs.cast.ai/docs/cluster-total-compute-cost |
| 82 | Audit log | https://docs.cast.ai/docs/audit-log |
| 83 | Notifications | https://docs.cast.ai/docs/notifications |

#### I. Migration & adjacent products (comparison only)

| # | Topic | URL |
|---|-------|-----|
| 84 | Karpenter Enterprise suite — overview | https://docs.cast.ai/docs/karpenter-enterprise |
| 85 | Migration from Karpenter | https://docs.cast.ai/docs/migration-from-karpenter |
| 86 | Workload Autoscaling overview (interaction only — rightsizing feeds bin-packing) | https://docs.cast.ai/docs/workload-autoscaling-overview |

**Do not confuse CAST AI's native Node Autoscaler with CAST AI for Karpenter (Karpenter Enterprise suite).** Explain their separate provisioning responsibilities and the documented coexistence/migration path.

#### J. Kubernetes and AWS references

Read relevant sections of:

- Kubernetes PDBs — https://kubernetes.io/docs/tasks/run-application/configure-pdb/
- Kubernetes topology spread constraints — https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/
- Amazon VPC CNI best practices — https://docs.aws.amazon.com/eks/latest/best-practices/vpc-cni.html
- EKS best practices guide (autoscaling, networking, reliability sections) — https://docs.aws.amazon.com/eks/latest/best-practices/introduction.html

Use current official documentation for any additional cloud-specific requirements (GKE, AKS).

---

### PART 2 — FULL ENGINEERING GUIDE STRUCTURE

Produce the following chapters in order.

#### Chapter 1 — Architecture and internals

Explain the complete scaling lifecycle:

1. CAST AI Agent observes Kubernetes resources.
2. Kubernetes scheduler identifies unschedulable pods.
3. Cluster state is synchronized to CAST AI.
4. Autoscaler evaluates workload constraints.
5. Bin-packing determines required capacity.
6. Instance types are filtered, ranked, and selected.
7. Cloud provisioning creates nodes.
8. Nodes register with Kubernetes.
9. Pending pods schedule.
10. Empty-node deletion removes unused capacity.
11. Evictor consolidates existing workloads.
12. Rebalancer optimizes node placement and price.

Include architecture diagrams (Mermaid), decision flows, and the roles of each CAST AI component (Agent, Cluster Controller, Evictor, Spot Handler, Workload Autoscaler, Pod Pinner, Watchdog).

Explain differences between Node Autoscaler, HPA, VPA/Workload Autoscaler, Evictor, and Rebalancer.

#### Chapter 2 — Prerequisites and production readiness

Cover:

- Kubernetes version compatibility
- EKS/GKE/AKS prerequisites
- CAST AI plans and enabled features
- IAM roles and permission boundaries
- Security groups and subnets
- Node provisioning permissions
- Network connectivity and private clusters (PrivateLink / Private Service Connect)
- Agent and controller health
- Helm chart versions
- PDBs and disruption tolerance
- StatefulSets, local disks, PVCs, and storage restrictions
- DNS, CNI, and critical system workloads
- High availability across AZs
- Conflicts with existing node autoscalers (cluster-autoscaler, Karpenter)

Create a production-readiness checklist with PASS/FAIL criteria.

#### Chapter 3 — Installation and onboarding

Provide three installation approaches:

**Method 1: castctl** — cluster connection, feature enablement, node configuration import, review and apply imported configurations, validation.

**Method 2: CAST AI Console** — cluster onboarding, IAM integration, Autoscaler activation, Node Template creation, policy configuration.

**Method 3: Terraform + Helm/GitOps** — Terraform provider configuration, node configuration resources, node templates, autoscaler policy, Helm component management, Argo CD and Flux integration, upgrade and rollback practices.

For commands that alter infrastructure, mark them as **requiring approval**. Distinguish read-only discovery from API changes and resource creation.

#### Chapter 4 — Autoscaler policies: complete reference

Create a table with these columns:

| Setting | Purpose | Documented default | Recommended initial setting | Aggressive option | Risk | How to verify |

Explain every currently documented policy, including:

- Unscheduled Pods policy
- Node deletion policy
- Empty-node TTL/delay
- Node CPU limits
- Per-template CPU limits
- Scoped Mode
- Pod scheduling policy requirements
- Node removal protections
- Availability-related constraints
- Any undocumented or deprecated settings, explicitly marked as such

**Do not invent numeric defaults.** Explain how policy interactions affect real scaling decisions.

#### Chapter 5 — Node templates: full tuning guide

Cover every template field and its operational implications:

- Default versus custom templates
- Explicit template matching (`scheduling.cast.ai/node-template`)
- Partial matching
- Labels and taints
- `shouldTaint` behavior
- Spot-only, Spot-optional, and On-Demand templates
- Spot fallback
- Processor architecture (amd64 / arm64)
- Instance family prioritization
- Minimum and maximum vCPU
- Minimum and maximum memory
- AZ restrictions
- GPU instances
- Storage requirements
- Capacity reservations
- Per-template CPU limits
- Automatic template generation

Explain the effect of overly restrictive templates. Provide complete examples for:

1. General-purpose workloads
2. CPU-intensive services
3. Memory-intensive services
4. Spot-friendly workloads
5. Critical On-Demand workloads
6. Stateful workloads
7. GPU workloads

For every example include a validated configuration, a scheduling example, and operational tradeoffs.

#### Chapter 6 — Node configurations: complete reference

Cover:

- Default and custom configurations
- Subnets and AZs
- Security groups
- Node IAM instance profiles
- AMI and image families (Bottlerocket, Amazon Linux 2023)
- EBS volumes and KMS
- Init scripts and bootstrap
- Kubelet settings
- Max pods per node
- VPC CNI settings
- IP prefix delegation
- IMDS settings
- Node registration failures

Explain the difference between Node Templates and Node Configurations. Include complete AWS EKS examples for dynamic max-pods calculation, and compare: standard secondary-IP allocation, prefix delegation, custom networking, Security Groups for Pods.

**Verify formula variables and syntax directly against current CAST AI documentation.** Explain the risks of static maxPods values and incorrect IP-capacity assumptions.

#### Chapter 7 — Scale-up tuning

Explain every phase of a scale-up event, from Pending Pod to Ready Node. Investigate:

- Resource request accuracy
- DaemonSet overhead
- Instance selection
- Instance launch latency
- Image pulling
- Bootstrap delays
- IP exhaustion
- Cloud quotas
- AZ constraints
- Persistent volume binding
- Anti-affinity
- Topology spread
- Unsupported extended resources
- Node startup failures

Provide practical recommendations to reduce scale-up latency without sacrificing scheduling correctness. Include a scale-up diagnostic decision tree.

#### Chapter 8 — Scale-down and Evictor tuning

Explain:

- Empty-node detection
- Node deletion delays
- Evictor scheduling and consolidation (cluster-wide scheduling feasibility, NOT a simple CPU-utilization threshold)
- Conservative versus aggressive modes
- Eviction exclusions
- PDB handling
- safe-to-evict controls
- Disruption limits
- StatefulSet restrictions
- Local storage constraints
- Graceful termination
- Node removal protection
- Drain failures

Distinguish naturally empty nodes from nodes emptied by Evictor (documented behavior: **Node TTL does not apply to nodes emptied by Evictor — they are removed immediately**). Explain why nodes can remain running despite low CPU utilization. Provide production-safe tuning strategies for maximizing consolidation, including Container Live Migration as a disruption-reduction option where documented.

#### Chapter 9 — Spot optimization

Cover:

- Spot-only and Spot-optional templates
- Preferred Spot placement
- On-Demand fallback
- Interruption prediction (including the Spot interruption prediction API)
- Spot reliability and diversification
- Interruption handling and graceful eviction
- Pod mutations for Spot
- Cost versus reliability tradeoffs

Design three policies:

1. **Critical production** — availability first
2. **Standard production** — balanced savings and reliability
3. **Development/batch** — high savings tolerance

Explain how to validate Spot safety before increasing adoption.

#### Chapter 10 — Rebalancing

Explain:

- Manual versus scheduled rebalancing
- Optimal node replacement
- Price-driven optimization
- Instance family changes
- Outdated configuration replacement
- Savings thresholds
- Drain timeouts and paused drain configuration
- Graceful versus forced eviction
- PDB interactions
- Rebalancing plans versus executed operations
- Failed plans and stuck nodes

Provide safe rollout, validation, and rollback procedures. Explain Evictor vs. Rebalancer responsibilities using the dedicated comparison doc.

#### Chapter 11 — Advanced operational tuning

Analyze these scenarios:

- Sudden traffic spikes
- Overnight traffic reductions
- Large-scale batch workloads
- ARM64 adoption
- Memory-heavy workloads
- GPU workloads
- Node startup delays
- Multiple AZs
- Slow-starting services
- Production clusters with strict PDBs
- Cluster hibernation for non-production
- Mixed Spot and On-Demand environments

For each scenario explain what to change, what not to change, how to validate, and how savings or reliability might change.

#### Chapter 12 — Troubleshooting runbook

Create at least 15 detailed troubleshooting cases covering:

1. Autoscaler does not create nodes
2. Pending pods never trigger scaling
3. No matching node template
4. Restrictive instance constraints
5. Cloud quota exhaustion
6. IAM AccessDenied
7. Subnet IP exhaustion
8. Incorrect maxPods
9. Nodes fail to join Kubernetes
10. Agent disconnected or unhealthy
11. Unexpected node deletion
12. Evictor does not consolidate nodes
13. PDB prevents eviction
14. Rebalancing fails
15. Spot fallback remains on On-Demand
16. Cost savings remain at zero
17. Autoscaler creates expensive instances

For each case provide: **Symptom → Possible root causes → Read-only diagnostic commands → Evidence → Lowest-risk correction → Verification → Rollback.**

Base cases on the official troubleshooting pages (autoscaler-troubleshooting, cluster-onboarding-troubleshooting, component-troubleshooting, terraform-troubleshooting).

#### Chapter 13 — Monitoring and observability

Build a monitoring design covering:

- Node count over time
- Provisioned CPU and memory
- Requested versus allocated capacity
- Pending pods
- Pod scheduling latency
- Node provisioning duration
- FailedUpscaling events
- Node deletion rate
- Eviction failures
- Rebalancing results
- Spot interruption events
- Spot versus On-Demand distribution
- Node cost per hour
- Cost per requested vCPU
- Savings trends

For each metric, identify the documented source (Kubernetes event vs. cloud-provider metric vs. CAST AI API/report). Provide suggested Prometheus/Grafana patterns, but **never invent CAST AI metric names**.

#### Chapter 14 — Cost optimization and savings

Explain:

- Available versus realized savings
- Actual versus projected spend
- Baseline methodology (a baseline is required for realized savings; document the report's age and adoption requirements)
- Managed node adoption
- Spot savings
- Bin-packing impact
- Workload rightsizing interactions
- Gross versus net savings
- Cloud discounts and commitments
- CAST AI fees
- Savings attribution
- Reporting/API discrepancies

Explain why **0% savings does not automatically mean no optimization occurred**, using source-verified reporting eligibility and baseline requirements. Do not double-count Workload Autoscaler benefits already reflected in Node Autoscaler savings.

Provide an illustrative 30-day cost model, clearly marking hypothetical assumptions, including: monthly before/after spend, absolute and percentage savings, savings by optimization category, operational tradeoffs, confidence and caveats.

#### Chapter 15 — Production configuration profiles

Develop three documented, practical tuning profiles:

| Setting | Conservative | Balanced | Cost-optimized |
|---------|-------------|----------|----------------|

For each profile explain: recommended workload suitability, node template design, scale-up behavior, empty-node removal behavior, Evictor mode, Spot strategy, fallback configuration, rebalancing policy, availability protections, expected benefits, main risks.

Treat numeric recommendations as **engineering starting points**, not CAST AI product defaults, unless officially documented.

#### Chapter 16 — Operational playbooks

Create these runbooks:

1. Enable Node Autoscaler on a new cluster
2. Migrate from monitoring-only (read-only agent) mode
3. Validate node scale-up
4. Validate scale-down
5. Enable Evictor safely
6. Introduce Spot capacity
7. Tune restrictive Node Templates
8. Correct maxPods and networking configuration
9. Run a safe Rebalancing operation
10. Investigate unexpected node costs
11. Diagnose zero realized savings
12. Recover from provisioning failures
13. Review IAM and cloud permission errors
14. Roll back an unsafe optimization

Each runbook must include: prerequisites, approval requirements, commands, expected results, risk assessment, and rollback.

---

### PART 3 — PRACTICAL EXAMPLES

Include real, technically valid examples using: `kubectl`, `castctl`, Helm, Terraform, the CAST AI REST API, YAML, `jq`, and the AWS CLI where appropriate.

At minimum, cover these read-only diagnostics:

```bash
kubectl get nodes -o wide

kubectl get pods -A \
  --field-selector=status.phase=Pending -o wide

kubectl get pdb -A

kubectl get events -A \
  --sort-by=.metadata.creationTimestamp

kubectl get nodes \
  -L scheduling.cast.ai/node-template

kubectl -n kube-system get ds aws-node -o yaml

kubectl -n castai-agent get pods -o wide

helm list -n castai-agent

castctl version
```

Also explain how to inspect resource requests, node allocatable resources, taints, affinity, pod events, and CNI configuration.

For CAST AI REST APIs, verify all HTTP methods, endpoints, required scopes, and fields from the current official API specification (https://api.cast.ai/v1/spec/ and the reference llms.txt indexes) before including examples. **Never embed real credentials.**

---

### PART 4 — BENCHMARKS AND OPTIMIZATION TESTING

Develop a repeatable test plan for a representative 30–50-node Kubernetes cluster. Test these scenarios:

1. Normal business-hour load
2. 80% overnight traffic reduction
3. Sudden 3x traffic spike
4. Batch job scale-out
5. Spot interruption
6. PDB-blocked scale-down
7. Restricted Node Template
8. Pod IP exhaustion
9. Rebalancing opportunity
10. Mixed On-Demand and Spot workloads

For every test describe: initial condition, expected scaling behavior, commands to observe it, measurements to capture, success criteria, cost impact calculation, disruption and rollback criteria.

**Do not manufacture benchmark results.** Use worked hypothetical examples or clearly labeled test objectives.

---

### PART 5 — FINAL DELIVERABLES

Produce:

- **Deliverable A — Complete engineering handbook:** detailed, chapter-by-chapter production guide with diagrams, examples, and official citations.
- **Deliverable B — Settings reference:** complete table of every documented Node Autoscaler policy and tuning parameter, including defaults, allowed values, risks, and recommendations.
- **Deliverable C — Configuration examples:** production-oriented castctl, Terraform, Helm, API, and Kubernetes YAML examples with explanatory comments.
- **Deliverable D — Troubleshooting knowledge base:** matrix of symptoms, evidence, root causes, safe fixes, and official links.
- **Deliverable E — Production-readiness checklist:** for platform teams before enabling autonomous node management.
- **Deliverable F — FinOps playbook:** step-by-step method for measuring available opportunities, implementing optimizations, measuring realized savings, and validating financial results.
- **Deliverable G — Source inventory:** URL catalog of every document used, its topic, last-verified date, and relevance.

---

### QUALITY AND VERIFICATION RULES

1. Prioritize official CAST AI documentation.
2. Follow related documentation links and read relevant sections fully.
3. Verify current behavior and deprecations against the changelog.
4. Do not invent policy fields or numerical defaults.
5. Explain EKS-specific behavior separately from GKE and AKS.
6. Distinguish CAST AI Node Autoscaler from Karpenter (and the CAST AI Karpenter Enterprise suite).
7. Explain the difference between observed cost reduction and modeled savings.
8. Include reliability, security, and scheduling tradeoffs.
9. Never recommend removing PDB protections simply to increase savings.
10. Do not recommend production mutations without explicit approval.
11. Every technical recommendation must identify its supporting documentation.
12. Every code example must either be validated against current documentation or labeled as illustrative.
13. Every tuning recommendation must describe when it helps, when it hurts, and how to roll it back.
14. Identify unresolved documentation contradictions rather than silently choosing a claim.
15. Do not claim to have tested infrastructure unless actual test evidence is available.

**Start with a documentation coverage matrix and an executive summary, then produce the full engineering handbook.**

The final result must be detailed enough for an experienced Kubernetes engineer to operate and optimize CAST AI Node Autoscaler in production without relying on generic vendor explanations.

---

## END OF MASTER PROMPT (stop copying here)

---

## Annex — Behaviors the guide MUST get right

These are documented in the current Autoscaler, Node Template, Evictor, Settings, and Savings references. Verify the final guide reflects them:

| Area | Documented behavior |
|------|---------------------|
| Scale-up | Requires the **Unscheduled Pods policy** AND at least one **enabled Node Template**. |
| Template selection | Explicit `scheduling.cast.ai/node-template` node selector is the recommended predictable matching method. |
| Empty-node removal | The Autoscaler deletes **naturally empty** nodes per the node deletion policy/TTL; nodes emptied by **Evictor** are removed **immediately** — the TTL does not apply to them. |
| Evictor | Uses **cluster-wide scheduling feasibility** (can pods fit elsewhere?), not a simple CPU-utilization percentage threshold. |
| Rebalancing | Replaces suboptimal nodes (price, configuration drift); separate responsibility from Evictor — see the dedicated Evictor vs. Rebalancer doc. |
| Scoped Mode | Limits native autoscaling to CAST AI-managed nodes and eligible workloads; configured via API/Terraform. |
| Savings | A **baseline** is required for realized savings; the savings report has specific cluster-age and node-adoption eligibility requirements. 0% reported savings ≠ no optimization. |
| Product boundary | Native Node Autoscaler ≠ Karpenter Enterprise suite; a documented migration path exists from Karpenter. |

## Annex — Notes

- **Docs freshness:** the prompt's URL catalog was cross-checked against the live docs navigation and `llms.txt` on 2026-10-17. CAST AI reorganizes sections periodically — that's why Part 1 forces index-driven discovery instead of trusting a static list.
- **Model choice:** run this with a research-capable (browsing-enabled) LLM. A non-browsing model cannot satisfy the verification rules; it would have to be fed the `.md` exports of each page manually.
- **Suggested split for small context windows:** run Part 1 (research + coverage matrix) first, then feed the produced source inventory back with Parts 2–5 in a second pass.
