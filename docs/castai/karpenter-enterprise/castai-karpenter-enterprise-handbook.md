# CAST AI Karpenter Enterprise Suite — Complete Engineering, Operations, Optimization & FinOps Handbook

**Version:** 1.0
**Compiled:** 2026-10-17
**Research basis:** 30+ official CAST AI documentation pages (fetched in full via the CAST AI documentation Markdown endpoints), the `castai/helm-charts` GitHub repository (chart source read directly: umbrella chart `castai` v0.45.8, `kent` profile wrapper v0.16.0, `castai-kentroller` chart v0.27.1), and the CAST AI published Helm repository index.
**Audience:** Kubernetes platform engineers, DevOps/SRE leads, FinOps practitioners, CAST AI support engineers.
**Primary platform:** Amazon EKS with self-managed Karpenter ≥ 1.0.0. **Secondary:** Azure AKS with self-managed Karpenter ≥ 1.0.0 or Node Auto-Provisioning (NAP).

---

## How to read this handbook

* **Documented facts** cite a source URL per section. Statements marked **[chart-verified]** were confirmed against the current Helm chart source in `github.com/castai/helm-charts`, not only documentation.
* **Engineering recommendations** are explicitly labeled *Recommendation* — they are practice, not product documentation.
* Anything that could not be verified is marked **Not documented / Not verified — requires CAST AI confirmation.**
* Commands are labeled **[read-only]** or **[change]**. All change commands include a rollback note. Do not run change commands in production without the approval gates defined in Chapter 18.
* A consolidated log of documentation inconsistencies found during research — with resolutions where available — is in **Appendix B (Documentation Conflict Log)**. Read it before treating any single default value as authoritative.

---

## Table of contents

1. Executive overview
2. Complete architecture
3. Prerequisites and readiness assessment
4. Installation from zero (5 scenarios)
5. Kentroller deep dive
6. Rebalancing and consolidation
7. NodePool and scheduling optimization
8. Workload Autoscaler optimization
9. Spot intelligence and reliability
10. Container Live Migration
11. Commitments optimization (RI / Savings Plans)
12. Advanced tuning matrix
13. Monitoring and observability
14. Savings and FinOps
15. Troubleshooting playbook (20 scenarios)
16. Security and enterprise governance
17. Day-2 operations runbook
18. Production adoption strategy
19. End-to-end case study
20. Reference handbook (cheat sheets, matrices, glossary)

Appendix A — Source and evidence inventory
Appendix B — Documentation conflict log (must-read before applying defaults)

---

# Chapter 1 — Executive Overview

Source: https://docs.cast.ai/docs/karpenter-enterprise · https://docs.cast.ai/docs/karpenter-enterprise-features

## 1.1 What the Karpenter Enterprise suite is

> "Karpenter Enterprise suite is a suite of optimization features designed to work alongside open-source Karpenter. Rather than replacing Karpenter, Karpenter Enterprise suite extends it with capabilities that help you capture additional savings, improve operational stability, and gain visibility into cluster efficiency." — CAST AI, Overview

The suite is CAST AI's optimization layer for clusters where **Karpenter is, and remains, the node provisioner**. CAST AI components are deployed **alongside** your existing Karpenter installation ("Castware components alongside your existing Karpenter installation") and steer Karpenter's decisions **through CRD modifications and policy adjustments** rather than replacing Karpenter's controller logic.

## 1.2 The three models side by side

| Aspect | Open-source Karpenter | CAST AI Karpenter Enterprise suite | CAST AI standard Node Autoscaler |
|---|---|---|---|
| Node provisioner | Karpenter | **Karpenter** (unchanged) | CAST AI Autoscaler |
| Configuration source of truth | NodePools / NodeClasses | **NodePools / NodeClasses** (unchanged; console view is read-only) | Node Templates / Node Configurations |
| Cost-visibility | None (no RI/SP awareness, no cost reporting) | Savings reports, available/realized savings, commitment utilization | Same reporting family |
| Consolidation | Karpenter-native (node-level) | Kentroller Continuous Rebalancing **takes over cost-driven consolidation**; Karpenter keeps drift detection | CAST AI Evictor/Rebalancer |
| Commitments (RI/SP) steering | No | Yes — weighted shadow NodePools (EKS only today) | Native commitments integration |
| Spot interruption prediction | Cloud-native signals only (2-min AWS notice) | Up to 30-minute prediction via CAST AI ML API | Same prediction family |
| Container Live Migration | N/A | Available via `castai-live` (used by Kentroller during rebalancing) | Available via Evictor/Rebalancer |
| Can it run next to Karpenter? | — | Yes — this is the design | **No — unsupported, undefined behavior** |

**Hard architectural rule (documented, verbatim):** "Karpenter Enterprise suite is designed for clusters where Karpenter is the sole node provisioner. Running Cast AI's standard node autoscaler and Karpenter together in the same cluster is not supported and will result in undefined behavior."

## 1.3 What problems it solves beyond open-source Karpenter

Documented gap analysis (Overview page):

1. **Cost visibility gaps** — Karpenter has no awareness of Reserved Instances, Savings Plans, or negotiated discounts.
2. **Consolidation limitations** — Karpenter's consolidation works at node level, doesn't coordinate with workload rightsizing or real utilization.
3. **Spot reliability** — Karpenter treats all Spot pools equally and relies on the standard 2-minute interruption warning.
4. **Spot fallback debt** — after fallback to On-Demand, expensive nodes linger after Spot capacity returns (CAST AI's automatic recovery for this is **planned, not yet shipped** as of research date — see Ch. 9).

## 1.4 Feature availability — supported vs. not available vs. planned

**Available features (Feature reference, verbatim categories):**

| Feature | What it does | Karpenter integration |
|---|---|---|
| Continuous rebalancing | Ongoing consolidation with CLM capability | **Replaces Karpenter's native consolidation** |
| Rebalancer (manual/scheduled/API) | Cluster-wide cost optimization through node selection/replacement, capacity-failure avoidance | Coordinates with Karpenter provisioning |
| Spot intelligence | Interruption prediction + observed-interruption reporting | Enhances Karpenter Spot handling |
| Capacity failure detection | `UnavailableOffering` records avoid failing instance/zone/capacity combos | Improves capacity intelligence |
| Workload Autoscaler | Continuous workload rightsizing | Feeds optimized requests to Karpenter |
| Pod mutations | Automated Pod spec adjustments | Simplifies workload configuration |
| Cost reporting | Savings analysis, cost monitoring | Read-only analysis of Karpenter clusters |
| Commitments | AWS RI/SP via weighted shadow NodePools | Steers Karpenter provisioning |

**Not available with Karpenter (documented):**

| Feature | Why | Alternative |
|---|---|---|
| Pod Pinner | Requires CAST AI Autoscaler scheduling integration | Karpenter-native Pod affinity |
| Cluster hibernation | Requires direct node lifecycle control | NodePool `weight: 0` |
| Rebalancer aggressive mode | Limited by Karpenter drain behavior | — |
| Graceful eviction controls (Rebalancer) | Same | Continuous Rebalancing `evictionConfig` |
| Paused drain configuration | Same | — |
| UI progress bar for Rebalancer | Console gap on Karpenter clusters — use CRDs | `kubectl get rebalancing -n castai-agent` |
| Rebalancer commitment-aware instance selection | Rebalancer can't directly influence Karpenter's instance selection | Commitments feature (shadow NodePools) |

**Planned / not yet shipped (documented as of 2026-10-17):**

* Spot reliability model (steering to historically stable pools) — "coming in future releases"
* Spot fallback recovery (auto-return to Spot after fallback) — explicitly "planned for a future release"; today fallback nodes stay On-Demand until manually replaced/consolidated
* Node overlays (Karpenter 1.6+ feature) — console tab is "Coming soon"; CAST AI support planned
* Commitments on AKS — "Not yet supported"
* GKE — **absent from all Karpenter Enterprise pages**; only EKS/AKS are documented as supported

## 1.5 Who benefits most

*Recommendation:* biggest wins come to organizations that (a) already run Karpenter well but lack RI/SP-aware provisioning, (b) run mixed on-demand + Spot with over-provisioned requests, (c) operate ≥ 30–50 Karpenter-managed nodes where manual consolidation tuning doesn't scale, and (d) need Kubernetes-native (CRD-driven, GitOps-friendly) control of the optimization layer. Small clusters (< 10 nodes) usually recover the platform fee more slowly; the free reporting tier is the right entry point.

## 1.6 Switching away later

Documented exit path (Overview): `kubectl delete namespace castai-agent` removes all CAST AI components (nodes/pods/config untouched) → optionally uninstall Karpenter → re-onboard choosing **Other** (not Karpenter) as the autoscaling tool to adopt the standard CAST AI Autoscaler. Rollback is explicitly designed to be non-destructive — this matters for your change-approval narrative.

---

# Chapter 2 — Complete Architecture

Sources: https://docs.cast.ai/docs/karpenter-enterprise · https://docs.cast.ai/docs/karpenter-enterprise-kentroller · https://docs.cast.ai/docs/hosted-components · castai/helm-charts (`charts/castai-umbrella/charts/kent/Chart.yaml` — dependency tree, chart-verified)

## 2.1 Responsibility split

* **Karpenter** — creates and deletes nodes/instances (`NodeClaims`, `NodePools`, `EC2NodeClasses`/`AKSNodeClasses`), keeps drift detection, keeps native disruption budgets.
* **Kentroller (in-cluster)** — CAST AI's Karpenter-integration controller: rebalancing plans (claim/schedule/continuous), node consolidation coordination, Spot interruption prediction handling, `UnavailableOffering` records, `CommitmentBudget` → shadow NodePools.
* **CAST AI backend (SaaS)** — plan generation for console/API/scheduled rebalances, savings analysis, ML prediction API, commitment sync (`CommitmentBudget` CRDs), console feature flags.
* **Your GitOps/kubectl** — the only writers of NodePools/NodeClasses; the console's Karpenter view is **read-only**.

## 2.2 Components deployed by the `kent` profile

The getting-started page documents this component set (namespace `castai-agent`). The `kent` wrapper chart **pins** these component charts (chart-verified, kent v0.16.0):

| Component | Purpose | Chart pin (kent v0.16.0) | Notes |
|---|---|---|---|
| `castai-agent` | Cluster metrics/workload data to CAST AI | 0.162.7 | Base component |
| `castai-cluster-controller` | Coordinates optimization actions | 0.92.20 | kent sets `autoscaling.enabled: false` — no CAST AI node autoscaling |
| `castai-kentroller` | Karpenter integration controller | 0.27.1 | The Karpenter Enterprise core |
| `castai-kvisor` | Cluster proxy for console↔cluster connectivity | 1.165.5 | In kent profile: kvisor **agent disabled**, controller-only (cluster proxy) |
| `castai-live` (controller + daemon) | Container Live Migration orchestration | 0.141.0 | **`controller.replicaCount: 0` = CLM disabled by default** in kent profile |
| `castai-pod-mutator` | Pod spec mutations | 0.17.11 | |
| `castai-spot-handler` | Spot interruption monitoring/reporting | 0.35.11 | Read-only reporter — never drains |
| `castai-workload-autoscaler` | Continuous rightsizing | 1.14.2 | |
| `castai-workload-autoscaler-exporter` | Metrics for recommendations + Prometheus export | 1.14.2 | |
| `metrics-server` | metrics.k8s.io API | 3.13.0 | **Disabled by default** in kent (most clusters already run one) |
| `castai-chart-upgrader` | Chart self-upgrade helper | 0.2.1 | Disabled by default |

Plus a `castai-kent-preflight` hook Job (completes; validates Karpenter detection). `kent.managedKarpenter: true` skips the in-cluster controller lookup for AKS NAP [chart-verified].

## 2.3 What talks to what

| Component | Depends on | Kubernetes resources it touches | Operational blast radius |
|---|---|---|---|
| Kentroller | K8s API, Karpenter CRDs, CAST AI API (gRPC) + ML API, AWS EC2/Pricing APIs (Azure inventory APIs on AKS) | Nodes, Pods, NodePools, NodeClaims, PDBs, DaemonSets, EC2NodeClasses; its own CRDs (Ch. 5); shadow NodePools | **High** — can drain/replace nodes when rebalancing features are on |
| castai-agent | CAST AI API | Cluster state read | Low |
| cluster-controller | CAST AI API | Executes platform actions | Medium |
| castai-live controller/daemon | containerd v2+, CRIU, kernel/CNI path (Ch. 10) | Pods (checkpoint/restore), node labels, CNI (EKS forked VPC CNI path) | Medium-High when enabled; default off in kent |
| Workload Autoscaler | metrics-server, admission webhook (port 9443) | Deployments/StatefulSets requests via webhook | Medium — changes Pod requests |
| Pod mutator | K8s admission chain | Pod specs at creation time | Medium |
| Spot Handler | Cloud interruption signals (IMDS/SQS) | Reports only | Low — documented: "does not take any action" |
| Preflight hook | Karpenter CRDs (`karpenter.sh`, `karpenter.azure.com`) | CRD discovery | None (install-time) |

## 2.4 Control flows

**Continuous Rebalancing (in-cluster, no SaaS round-trip for plan generation):** Kentroller polls on its cycle → reads Nodes/NodeClaims/NodePools/Pods/DaemonSets/PDBs/EC2NodeClasses + AWS pricing → finds the largest replaceable subset ≥ both savings thresholds → creates a `RebalancePlan` directly → provisions replacement `NodeClaims` via Karpenter → drains/deletes old ones. One active plan at a time.

**Console/schedule/API rebalancing:** `RebalancePlanClaim` created (by you, a schedule, or the console) → CAST AI SaaS generates the plan → Kentroller executes (create phase → savings validation → delete phase), recording everything in CRD status.

**Commitments:** commitments assigned in CAST AI console → SaaS syncs `CommitmentBudget` CRDs into the cluster → Kentroller creates `weight: 100` `zzz-`-prefixed shadow NodePools, rebalances their limits every 2 minutes, tears them down to 0 and deletes on unassign.

## 2.5 Architecture diagram

```mermaid
flowchart LR
  subgraph User["Platform team"]
    GITOPS["GitOps / kubectl<br/>(NodePools, NodeClasses — source of truth)"]
  end

  subgraph SaaS["CAST AI SaaS"]
    API["REST API / Console"]
    GRPC["gRPC plan coordination + Kent channel"]
    ML["ML API — Spot interruption prediction"]
    SYNC["Commitment sync<br/>(CommitmentBudget CRDs)"]
  end

  subgraph Cluster["Kubernetes cluster (EKS / AKS)"]
    K["Karpenter controller<br/>NodePools · NodeClaims · EC2NodeClasses"]
    subgraph CASTNS["castai-agent namespace"]
      AGENT["castai-agent"]
      CC["cluster-controller"]
      KENT["Kentroller<br/>CRDs: rp / rpc / rps / rmp / uo / cb"]
      LIVE["castai-live<br/>(CLM — disabled by default)"]
      WOOP["workload-autoscaler<br/>+ exporter"]
      PM["pod-mutator"]
      SH["spot-handler"]
      KV["kvisor (cluster proxy)"]
    end
    WORKLOADS["Application Pods"]
  end

  subgraph Cloud["Cloud provider"]
    EC2["EC2 / Azure VMs"]
    PRICING["Pricing APIs"]
    SQS["Spot/ICE signals (SQS/IMDS)"]
  end

  GITOPS --> K
  KENT -->|reads NodePools/NodeClaims| K
  KENT -->|creates/deletes NodeClaims,<br/>labels do-not-disrupt during plans| K
  K -->|provisions/terminates| EC2
  KENT --> GRPC
  SYNC -->|creates/updates cb CRDs| KENT
  KENT -->|creates weight-100 zzz- shadow NodePools| K
  ML -->|prediction polls (1m)| KENT
  SH -->|observed interruptions| API
  KENT -->|observed ICE + interruptions only| API
  AGENT --> API
  WOOP -->|mutates Pod requests at admission| WORKLOADS
  KENT -->|RebalanceMigrationPlan| LIVE
  SH -. polls .-> SQS
```

## 2.6 Concept mapping (documented)

| Karpenter | CAST AI equivalent | Role |
|---|---|---|
| NodePool | Node Template | Provisioning constraints (types, zones, capacity, taints, labels) |
| EC2NodeClass (AWS) | Node Configuration | AMI, SGs, subnets |
| AKSNodeClass (AKS) | Node Configuration | VNet subnet, OS image, GPU driver |

With Karpenter Enterprise you keep NodePools/NodeClasses. Migrating later to the standard Autoscaler replaces them with Node Templates/Node Configurations.

---

# Chapter 3 — Prerequisites and Readiness Assessment

Sources: https://docs.cast.ai/docs/karpenter-enterprise-getting-started · https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/communication-requirements · https://docs.cast.ai/docs/connect-with-castctl

## 3.1 Supported platforms and versions

| Item | Requirement | Source |
|---|---|---|
| Kubernetes (tools) | kubectl v1.19+, Helm v3.0+ per getting-started; **use Helm ≥ 3.14.0** — required for `--reset-then-reuse-values` used throughout CAST AI docs [conflict, see App. B #2] | getting-started, helm-charts |
| EKS | Self-managed Karpenter **1.0.0+** installed and operational | overview |
| AKS | Self-managed Karpenter **1.0.0+**, **or** NAP enabled (auto-detected via `karpenter.azure.com` CRDs) | overview, getting-started |
| GKE | **Not documented for Karpenter Enterprise** (nav shows no GKE KE path) | overview |
| NodePools | ≥ 1 Karpenter `NodePool` configured | getting-started |
| kubectl access | cluster-admin equivalent (create namespaces, deploy workloads) | getting-started |
| Workload rightsizing | metrics-server (kent profile ships one, disabled by default; reuse your own) | getting-started, kent values |
| CLM (if enabled) | Kubernetes 1.30+, containerd v2+, supported node image — see Ch. 10 | clm-requirements |

## 3.2 Cloud permissions

**AWS — for the principal running the install:** must be able to create IAM roles/policies, create instance profiles, and manage EC2 security groups (getting-started; minimal policy referenced at cloud-permissions#aws). castctl creates the required identity automatically. The broader cross-account role model (AmazonEC2ReadOnlyAccess + IAMReadOnlyAccess + custom policy, trust to CAST AI's account with ExternalId = cluster ID) is documented in cloud-permissions — note that page is largely written for the **standard** onboarding; the Karpenter path delegates provisioning to Karpenter, so CAST AI's AWS footprint is smaller and primarily read/analytics + the identity castctl creates. **The exact minimal Kentroller AWS permission set is not published as a dedicated Karpenter-Enterprise policy** — Not verified; confirm with CAST AI before writing a custom least-privilege policy.

**Azure (AKS):** Kentroller reads VM SKU inventory, compute quota, and AZ mappings — needs built-in **Reader** at subscription scope, via one of:

1. **castctl (recommended)** — creates a managed identity, grants Reader, federates through AKS Workload Identity (requires OIDC issuer + workload identity enabled), and installs the chart.
2. **Manual Workload Identity** — pass the federated client ID: `--set kent.castai-kentroller.azure.workloadIdentityClientID=<CLIENT_ID>`. The federated credential subject **must be** `system:serviceaccount:castai-agent:castai-kentroller`. The chart adds the `azure.workload.identity/use` pod label and SA annotation itself — **do not add them manually** (getting-started, verbatim).
3. **Ambient node credentials** — default Azure credential chain, no flags.

If skipped: Kentroller falls back to SKU data via CAST AI backend, but **quota-aware rebalancing and AZ mapping are unavailable**.

## 3.3 Network / egress requirements (verbatim endpoints)

Core (per region, all TCP 443, outbound):

| Region | Endpoints |
|---|---|
| US | `api.cast.ai`, `grpc.cast.ai` (Pod pinner only), `kvisor.prod-master.cast.ai`, `files.cast.ai` |
| EU | `api.eu.cast.ai`, `grpc.eu.cast.ai`, `kvisor.prod-eu.cast.ai`, `files.eu.cast.ai` |
| India | `api.india.cast.ai`, `grpc.india.cast.ai`, `api-grpc.india.cast.ai` (Kvisor/APA/newer), `files.india.cast.ai` |

Supporting: image registries `ghcr.io` (`ghcr.io/castai/images`, default) and `us-docker.pkg.dev/castai-hub/library` (fallback, same paths); Helm hosts `castai.github.io` + GitHub asset hosts; node binaries/logs via `files.*` proxies.

Static IPs for allowlists and CAST AI egress IPs are published on the same page (US/EU/India sets) — Chapter 16 tabulates governance use.

Webhook port: Workload Autoscaler admission webhook listens on **9443** (configurable via `webhook.port`); the API server must reach it.

Proxy: set `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (include pod/svc CIDRs, `*.cluster.local`). **TLS-intercepting proxies require a custom CA** (see 4.6). Private endpoints: AWS PrivateLink / GCP Private Service Connect pages exist but Karpenter-Enterprise-specific private-link guidance is **Not documented** — treat private-EKS onboarding as a CAST AI confirmation item.

## 3.4 Risks when the cluster also runs other provisioners

* **CAST AI standard Node Autoscaler + Karpenter = unsupported, undefined behavior** (documented). The kent profile explicitly sets `castai-cluster-controller.autoscaling.enabled: false` [chart-verified].
* **Rebalancing scope is Karpenter-managed nodes only.** Pre-Karpenter legacy nodes, EKS managed node groups, and Cluster-Autoscaler nodes are excluded by design (no cloud-side control over them). Mixed-provisioner clusters get partial optimization coverage — plan migrations to Karpenter management for full value.
* **Competing consolidation:** when Continuous Rebalancing is enabled it takes over cost-driven consolidation **entirely**; Karpenter keeps drift detection. During manual/scheduled plan execution Kentroller annotates nodes `karpenter.sh/do-not-disrupt=true` so Karpenter's consolidator does not compete (`castai.rebalance.disruptGuard`, default true) [chart-verified].

## 3.5 Pre-installation checklist (read-only)

```bash
# [read-only] Karpenter present and healthy
kubectl get pods -n karpenter
kubectl get crd | grep -E 'karpenter\.(sh|azure\.com)'
kubectl get nodepools

# [read-only] Version ≥ 1.0.0
kubectl get deployment -n karpenter karpenter -o jsonpath='{.spec.template.spec.containers[0].image}'; echo

# [read-only] EKS interruption queue configured (needed for Spot prediction signal path)
kubectl get deployment -n karpenter karpenter -o yaml | grep -i queue

# [read-only] metrics-server for workload rightsizing
kubectl top nodes && kubectl top pods -A | head -5

# [read-only] No CAST AI autoscaler already running in parallel
helm list -n castai-agent 2>/dev/null

# [read-only] Egress reachability (from a node or a debug pod)
curl -sI https://api.cast.ai | head -3

# [read-only] castctl dry-run resolves the right identity
castctl auth login            # interactive browser login
castctl cluster connect --dry-run   # prints resolved provider/region/name as YAML, changes nothing
```

---

# Chapter 4 — Installation From Zero

Sources: https://docs.cast.ai/docs/karpenter-enterprise-getting-started · https://docs.cast.ai/docs/connect-with-castctl · https://docs.cast.ai/docs/helm-charts · castai/helm-charts source (chart-verified)

## 4.0 Critical chart facts before you install anything

Read this box once — it prevents the three most common onboarding mistakes.

* **Chart identity.** The umbrella chart directory is `charts/castai-umbrella` in `github.com/castai/helm-charts`, but the chart's `name:` field is **`castai`** (Chart.yaml, version 0.45.8 at research date). The published repo also contains a `castai-umbrella` entry (legacy alias). All three of these are documented in various CAST AI pages: `castai-helm/castai`, `castai castai --repo https://castai.github.io/helm-charts`, and `castai/castai-umbrella`. **This handbook standardizes on `castai-helm/castai`** after `helm repo add castai-helm https://castai.github.io/helm-charts`.
* **The `kent` profile.** Karpenter Enterprise is delivered by the `kent` wrapper subchart (v0.16.0), a dependency of the umbrella chart gated by `kent.enabled=true`. It pins castai-kentroller 0.27.1, castai-agent 0.162.7, castai-cluster-controller 0.92.20, castai-live 0.141.0, castai-pod-mutator 0.17.11, castai-spot-handler 0.35.11, castai-kvisor 1.165.5, castai-workload-autoscaler(-exporter) 1.14.2, metrics-server 3.13.0 (off by default), castai-chart-upgrader 0.2.1 (off) [chart-verified].
* **Values nesting for the umbrella (chart-verified).** Root path is `kent.<subchart>.<values>`, e.g. `kent.castai-kentroller.castai.continuousRebalancing.enabled`. **Documentation pages frequently show `castai-kentroller.castai.continuousRebalancing.*` without the `kent.` prefix** — that matches the standalone `castai-kentroller` chart layout, not the current umbrella tree. Confirm your release's actual layout with `helm get values castai -n castai-agent -a | head -40` after install. (See Appendix B #4.)
* **One Helm release.** Everything lands in namespace `castai-agent` under release name `castai`. The `castai-kent-preflight` hook Job must reach `Completed`.
* **Secrets.** Never inline `global.castai.apiKey` in GitOps. The umbrella chart supports `global.castai.apiKeySecretRef` (default `castai-credentials`, must contain key `API_KEY`) — create the secret out-of-band or via External Secrets [chart-verified].
* **Helm ≥ 3.14.** For `--reset-then-reuse-values`.

## 4.A Scenario A — Existing EKS + Karpenter, onboarded with `castctl` (recommended path)

**Prerequisites:** Chapter 3 checklist green; CAST AI account; AWS principal able to create IAM roles/policies/instance profiles and manage SGs (castctl creates cloud resources for you).

```bash
# 1. Install castctl (pick one)
brew tap castai/tap && brew trust --cask castai/tap/castctl && brew install castctl   # macOS/Linux
curl -fsSL https://get.cast.ai/linux | bash                                          # script, SHA256-verified
# Windows PowerShell: iwr -useb https://get.cast.ai/windows | iex

# 2. Authenticate (browser SSO; org selected interactively; token in ~/.config/castctl/config.yaml)
castctl auth login

# 3. [read-only] Resolve and print what WOULD be configured — changes nothing
castctl cluster connect --dry-run

# 4. [change] Connect: registers cluster, installs umbrella chart with kent profile,
#    creates the cloud identity. Interactive feature selection.
castctl cluster connect

# Non-interactive (CI):
castctl cluster connect --non-interactive --cluster-optimization=true --workload-autoscaler=true

# With custom umbrella values (tolerations, secret ref, etc.):
castctl cluster connect --umbrella-values-file ./castai-values.yaml
```

castctl detects Karpenter and "offers to keep it as your node provisioner via Cast AI for Karpenter" (verbatim). On success it prints the cluster's console URL.

**Expected output (after 2–3 min):**

```bash
kubectl get pods -n castai-agent   # [read-only]
# castai-agent-… Running; castai-cluster-controller-… Running; castai-kentroller-… 2×Running
# castai-kvisor-controller-… Running; castai-pod-mutator-… Running; castai-spot-handler-… Running
# castai-workload-autoscaler-… Running; castai-workload-autoscaler-exporter-… Running
# castai-kent-preflight-… Completed   ← hook Job, Completed is correct
```

**Common errors:** wrong org/region endpoints (set `global.castai.apiURL`/`grpcURL` per Ch. 3.3); SSO session expiry in CI (use `--non-interactive` with pre-authed config); missing IAM create rights (pre-create roles — Scenario E).

**Rollback [change]:** `castctl cluster disconnect` — removes Helm releases, the cloud resources it created, and the cluster record. Not for Terraform-managed clusters.

## 4.B Scenario B — Existing EKS + Karpenter, manual Helm install

Use when castctl is not permitted. Get the API key from console **API > API access keys** (an org-level key from **Service Accounts** for GitOps use).

```bash
# 0. [change] Pre-create the credentials secret (preferred over --set apiKey)
kubectl create namespace castai-agent --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic castai-credentials -n castai-agent \
  --from-literal=API_KEY='<YOUR_API_KEY>'

# 1. [change] Install (EKS) — kent profile, documented flag set
helm repo add castai-helm https://castai.github.io/helm-charts && helm repo update
helm upgrade -i castai castai-helm/castai \
  -n castai-agent --create-namespace \
  --set kent.enabled=true \
  --set global.castai.provider=eks \
  --set global.castai.apiKey=<YOUR_API_KEY> \
  --set global.castai.apiURL=https://api.cast.ai \
  --set global.castai.grpcURL=grpc.cast.ai:443
```

Equivalent with the pre-created secret (drop `--set global.castai.apiKey`):

```bash
helm upgrade -i castai castai-helm/castai -n castai-agent --create-namespace \
  --set kent.enabled=true \
  --set global.castai.provider=eks \
  --set global.castai.apiKeySecretRef=castai-credentials \
  --set global.castai.apiURL=https://api.cast.ai \
  --set global.castai.grpcURL=grpc.cast.ai:443
```

**Verification [read-only]:** pod list as in 4.A; then `kubectl get rp,rpc,rps,uo,cb` (CRDs must exist; kentroller chart installs CRDs via `crds.enabled=true` by default [chart-verified]); `kubectl logs -n castai-agent -l app=castai-kentroller --tail=50`.

**Common errors:** `azure.subscriptionID is required when provider resolves to "azure"` (that's the AKS case — Scenario C); mutable-values mistakes after GitOps adoption (Scenario D); chart name confusion (`castai-umbrella` legacy alias — prefer `castai-helm/castai`).

**Rollback [change]:** `helm uninstall castai -n castai-agent` → `kubectl delete namespace castai-agent` (also documented as the off-board step); optionally remove created CRDs after confirming no plans are running (`kubectl get rp`).

## 4.C Scenario C — AKS with self-managed Karpenter or NAP

Deltas vs Scenario B: plus the **mandatory** subscription and identity wiring (Ch. 3.2).

```bash
# [change] AKS install — castctl path recommended; manual Helm:
helm upgrade -i castai castai-helm/castai \
  -n castai-agent --create-namespace \
  --set kent.enabled=true \
  --set global.castai.provider=aks \
  --set kent.castai-kentroller.azure.subscriptionID=<AZURE_SUBSCRIPTION_ID> \
  --set kent.castai-kentroller.azure.workloadIdentityClientID=<FEDERATED_CLIENT_ID> \
  --set global.castai.apiKeySecretRef=castai-credentials \
  --set global.castai.apiURL=https://api.cast.ai \
  --set global.castai.grpcURL=grpc.cast.ai:443
```

* Missing `kent.castai-kentroller.azure.subscriptionID` → chart fails with `azure.subscriptionID is required when provider resolves to "azure"` (verbatim error).
* NAP or self-managed Karpenter is auto-detected via `karpenter.azure.com` CRDs; for NAP additionally set `--set kent.managedKarpenter=true` so preflight skips the in-cluster controller lookup [chart-verified].
* Federated credential subject **must be** `system:serviceaccount:castai-agent:castai-kentroller`; chart adds the pod label + SA annotation itself.
* Without workload identity (nor ambient credentials): Kentroller reads SKU data via the CAST AI backend; **quota-aware rebalancing and AZ mapping become unavailable**.

## 4.D Scenario D — Enterprise GitOps (Argo CD / Flux, pinned)

Rules that keep GitOps and CAST AI from fighting each other:

1. **You own:** the umbrella release values, your NodePools/NodeClasses, `RebalancePlanSchedules` (they're CRDs — GitOps them).
2. **CAST AI/Kentroller owns:** `CommitmentBudget` CRs (synced by SaaS), shadow `zzz-*` NodePools, `RebalancePlanClaim`/`RebalancePlan` CRs, Kentroller's dynamic-config ConfigMap, and `karpenter.sh/do-not-disrupt` labels during plans. **Configure Argo CD to ignore these** (do not include them in your app; add `IgnoreExtraneous` / pruning exceptions). The chart already labels the dynamicConfig ConfigMap with `argocd.argoproj.io/compare-options: IgnoreExtraneous` [chart-verified].
3. **Secret via External Secrets** (`global.castai.apiKeySecretRef`), never in Git.
4. **Pin the chart version**; upgrade via PR after reviewing the chart changelog (Ch. 17).

Repository sketch:

```
gitops/castai/
├── application.yaml            # Argo CD Application (below)
├── values.yaml                 # umbrella values (no secrets)
├── externalsecret.yaml         # castai-credentials from Vault/AWS SM
└── crd/
    └── rebalanceplanschedules/ # your schedules as GitOps-managed CRs
```

`application.yaml` (Argo CD):

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: castai
  namespace: argocd
spec:
  project: platform
  source:
    repoURL: https://castai.github.io/helm-charts
    chart: castai
    targetRevision: 0.45.8            # PIN; bump via reviewed PR
    helm:
      releaseName: castai
      valueFiles:
        - $values/gitops/castai/values.yaml
  sources: []
  destination:
    server: https://kubernetes.default.svc
    namespace: castai-agent
  syncPolicy:
    automated:
      prune: false                    # prune=false: never delete CAST AI-synced CRs
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
  ignoreDifferences: []
```

Example `values.yaml`:

```yaml
kent:
  enabled: true
global:
  castai:
    provider: eks
    apiKeySecretRef: castai-credentials
    apiURL: https://api.cast.ai
    grpcURL: grpc.cast.ai:443
# Umbrella-nested kentroller config (chart-verified nesting; see App. B #4)
kent:
  castai-kentroller:
    castai:
      continuousRebalancing:
        enabled: false              # enable in Phase 4 of the rollout (Ch. 18)
        mode: drain-only
```

> Migrating an existing standalone-chart install into the umbrella: use castctl's phased, no-downtime flow — `castctl cluster migrate generate --format argocd`, then `pre-umbrella-install`, install umbrella, then `post-umbrella-install` (castctl ≥ 0.15.0).

## 4.E Scenario E — Restricted environments (platform team pre-creates identities/secrets)

* **AWS:** pre-create the identity resources the onboarding expects, then run Scenario A/B with reduced rights, or hand castctl only the remaining scope. The documented installer needs: create IAM roles/policies, instance profiles, SG management. The *node-side* provisioning IAM already belongs to **your Karpenter install** (Karpenter's own controller policy + node instance profile) — the suite does not replace it.
* **AKS:** pre-create the user-assigned managed identity with **Reader** on the subscription + federated credential (subject `system:serviceaccount:castai-agent:castai-kentroller`), then install with `kent.castai-kentroller.azure.{subscriptionID,workloadIdentityClientID}` (Scenario C).
* **Egress-locked:** allow the Ch. 3.3 endpoints or IPs; set `HTTP(S)_PROXY`/`NO_PROXY` env on components; behind **TLS interception**, create the dual-key CA secret and reference it — note the documented key inconsistency: `TLS_CA_CERT_FILE` (agent, cluster-controller, spot-handler) **and** `TLS_CA_CERT` (workload-autoscaler); put both keys in one secret. `castai-kvisor` does not support `trustedCACertSecretRef`; `castai-live` mounts it as a volume. (On the kent profile the kentreller's CA story is **Not documented** — test in staging.)
* **Private clusters:** AWS PrivateLink/GCP PSC pages exist for CAST AI generally; Karpenter-Enterprise-specific private-link guidance is **Not documented** — confirm with CAST AI.
* **Offline/standalone operation:** the kentroller chart has `deploymentMode: connected|standalone` — standalone injects inert sentinel config and requires no runtime connection to the control plane [chart-verified]. This is a chart capability; the supported enterprise pattern for it is **Not documented** — treat as CAST AI-confirmation territory.

---

# Chapter 5 — Kentroller Deep Dive

Sources: https://docs.cast.ai/docs/karpenter-enterprise-kentroller · https://docs.cast.ai/docs/karpenter-enterprise-commitments · castai-kentroller chart v0.27.1 values (chart-verified)

## 5.1 What Kentroller is

> "Kentroller is the in-cluster control-plane component that coordinates Cast AI's node rebalancing and automation features with Karpenter. It runs inside your cluster as a Kubernetes controller, watches Cast AI custom resources, and drives optimization workflows by interacting directly with Karpenter's NodeClaims and NodePools."

Responsibilities (documented): generate/reconcile rebalancing plans; claim- and schedule-driven rebalancing; continuous in-cluster rebalancing; proactive Spot replacement on predictions; record unavailable offerings; coordinate node consolidation with NodeClaim deletion; manage commitment budgets.

Deployment shape [chart-verified]: `replicaCount: 2` (leader-elected), requests `cpu: 1, memory: 2Gi`, nodeselector `kubernetes.io/os: linux` (it *manages* Windows rebalancing but cannot run on Windows), pod anti-affinity, metrics endpoint on **:8443** (`metrics.enabled=true`, Service created), audit events to namespace `castai-audit` (`castai.audit.enabled=true`), OpenTelemetry metrics+logs over the Kent gRPC channel (`castai.otelMetrics/otelLogs.enabled=true`).

## 5.2 CRDs (`autoscaling.cast.ai/v1alpha`, all cluster-scoped — documented)

| CRD | Short | Purpose | Key status fields |
|---|---|---|---|
| `RebalancePlanSchedule` | `rps` | Cron schedule definitions | `active`, `lastScheduleTime`, `nextScheduleTime`, `lastExecution`, conditions `Ready`/`Scheduled` |
| `RebalancePlanClaim` | `rpc` | One rebalancing execution request | `state` (Pending→Generating→Ready→Executing→Completed/Failed), `status.conditions`, `status.errorMessage` |
| `RebalancePlan` | `rp` | Concrete plan: NodeClaims to add/remove, pods to migrate | `state` (Pending/Running/Done/DoneWithWarnings/Failed), `savings`, `validatedSavings`, `nodesCreation`, `nodesDeletion`, `failurePhase` |
| `RebalanceMigrationPlan` | (none) | Coordinates CLM within a plan | per-pod live-migration states |
| `UnavailableOffering` | `uo` | (instance type, zone ID, capacity type) to avoid temporarily | `spec.reason`, `spec.expiresAt`, `spec.attempts` |
| `CommitmentBudget` | `cb` | RI/SP commitment steering | `status.matchedNodePools`, condition `CompatibleNodePools` (+reason) |

Full OpenAPI schemas for these CRDs are **not published**; the verified field sets above come from docs + examples. (`kubectl get rp` state column shows `Done`/`DoneWithWarnings`, while the claim lifecycle uses `Completed` — two different state vocabularies on two CRDs; both documented.)

## 5.3 Plan lifecycle and execution

```mermaid
sequenceDiagram
  autonumber
  participant U as User / Schedule / CRB / Spot-prediction
  participant K8s as Kubernetes API
  participant KT as Kentroller (2× HA)
  participant CAST as CAST AI SaaS + ML API
  participant KP as Karpenter
  participant EC2 as AWS EC2 / Pricing

  U->>K8s: Create RebalancePlanClaim (rpc) — or CRB creates RebalancePlan directly
  Note over KT,CAST: Claim path: CAST AI generates the plan (SaaS round-trip)
  KT->>CAST: Submit claim (Pending→Generating→Ready)
  CAST-->>KT: RebalancePlan (projectedSavings, blue/green node costs)
  Note over KT,CAST: Continuous path: plan computed locally from cluster state + pricing, no SaaS round-trip
  KT->>K8s: Create RebalancePlan (rp), annotate nodes karpenter.sh/do-not-disrupt (disruptGuard)
  KT->>KP: Create replacement NodeClaims
  KP->>EC2: Provision instances
  EC2-->>KT: ICE on a type/zone? retry next type (status.nodesCreation -attempt-N), record UnavailableOffering
  KT->>KT: Validate savings (executionPolicy.achievedSavingsPercentageThreshold) — abort = FailureReasonInsufficientSavings
  alt CLM available & pods eligible
    KT->>K8s: RebalanceMigrationPlan (live-migrate first)
  else standard path
    KT->>K8s: Drain via eviction API (PDBs honored)
  end
  KT->>KP: Delete old NodeClaims (Karpenter terminates instance)
  KT-->>CAST: Report outcome, savings, observed ICE/interruptions; audit log
```

**Execution phases (documented):** *Creation* — replacement NodeClaims, ICE retries recorded in `status.nodesCreation` (`instanceType`, `nodeClaimName` with `-attempt-N`, `status`, `description`). *Deletion* — drains and deletes; with CLM it first creates a `RebalanceMigrationPlan`; per-node events recorded in `status.nodesDeletion` (`LiveMigrationCreated/InProgress/Succeeded/Failed`→fallback to standard eviction, `InProgress`, `Success`, `Failed`).

**Savings gates (documented):** a plan executes only when thresholds pass; if the claim sets `executionPolicy.achievedSavingsPercentageThreshold` (0–100; 80 = at least 80% of predicted savings must materialize), post-provision validation can abort with `FailureReasonInsufficientSavings`; validated values land in `status.validatedSavings`. `status.savings` carries `projectedSavingsPercent`, `projectedSavingsCostMonthly`, current/projected monthly cost (nodes and cluster), and per-node `blueNodes`/`greenNodes` cost detail.

**Failure recovery (documented):** `status.failurePhase=Creation` → rollback = delete newly created NodeClaims; `=Deletion` → uncordon new nodes so Karpenter manages them normally.

## 5.4 Node consolidation controller

Deletes `[NodeClaims]` when: (a) **expiration** — `NodeClaim.spec.expireAfter` elapsed; (b) **CRB drain** — Continuous Rebalancing drained the node; (c) **empty node** — pool has consolidation enabled and Karpenter set `Consolidatable=True`. "Deleting the NodeClaim delegates final node and cloud instance termination to Karpenter."

## 5.5 Capacity-failure intelligence (`UnavailableOffering`)

Recorded after (i) ICE during NodeClaim creation, (ii) observed Spot interruption, (iii) prediction-flagged risk. Future plans skip the combo until expiry; `spec.attempts` grows with repeats and "repeated failures extend the local backoff window." Kentroller reports **only observed** ICE and observed interruptions to CAST AI — prediction-only records are never reported as observed. Expired entries are ignored locally and garbage-collected later. The TTL/backoff formula is **Not documented**.

```bash
kubectl get uo          # [read-only]
kubectl describe uo <name>
```

## 5.6 Spot interruption prediction wiring

Polls the CAST AI ML API (poll default 1m; `castai.spotInterruptionPrediction.enabled: true` by default in connected mode [chart-verified]). On prediction: labels the node `autoscaling.cast.ai/predicted-interruption=true`, creates a claim scoped to that node, emits a `SpotInterruptionPredicted` event, and applies a 15-minute post-replacement cooldown. Env knobs (documented, env-level): `SPOT_INTERRUPTION_PREDICTION_MODEL_NAME`, `POLL_INTERVAL` (1m), `SPOT_REPLACEMENT_COOLDOWN` (15m), `INTERRUPTION_THRESHOLD` (0–1). **EKS prerequisite:** Karpenter's interruption queue (SQS) must be configured with proper IAM — verify with `kubectl get deployment -n karpenter karpenter -o yaml | grep -i queue`.

## 5.7 Behavior-tuning surface on the rebalance engine (chart-verified, kentroller v0.27.1)

| Helm value (standalone chart path) | Default | Effect |
|---|---|---|
| `castai.rebalance.enabled` | `true` | Master switch for rebalance feature |
| `castai.rebalance.preferenceWeightedPacking` | `true` | Scores candidates by cost **+ reliability + preference penalties** (PodAffinity, TopologySpread, VolumeZone) instead of pure cheapest-fit. Hot-reloadable |
| `castai.rebalance.namespaceLabeling` | `true` | Applies `rebalancing.cast.ai/active` to namespaces during rebalancing (drives TSC webhook; may cause Cilium identity churn — disable if you don't use hard TSC) |
| `castai.rebalance.softTSCSpreading` | `false` | Spread soft-TSC pods across AZs during rebalancing (opt-in) |
| `castai.rebalance.disruptGuard` | `true` | While a plan executes, nodes get `karpenter.sh/do-not-disrupt=true` so Karpenter's consolidator doesn't compete; reverted at completion. Env-based — pod restart to change |
| `castai.spotInterruptionPrediction.enabled` | `true` | Connected-mode Spot prediction |
| `castai.clm.enabled` | `false` | CLM node-labeling feature |
| `dynamicConfig.annotations` | IgnoreExtraneous | GitOps-friendly runtime config ConfigMap |

Documented env-level knobs (Kentroller doc): `GRPC_DISABLE_TLS`, `FEATURES_WATCH_NAMESPACES` (=castai-agent), `NODE_CONSOLIDATION_MAX_CONCURRENT_RECONCILES` (=10), `REBALANCER_MAX_CONCURRENT_RECONCILES` (=10), `DYNAMIC_CONFIG_MAP_NAME`. Required: `CLUSTER_ID`, `API_KEY`, `API_URL`, `GRPC_URL`. A documented Helm mapping for every env var is **Not documented** — use the chart's values first; env overrides are advanced/support-guided territory.

## 5.8 Feature gating

"All Kentroller features are enabled and disabled dynamically through the Cast AI console without restarting the controller." Two settings are **static** (pod restart required): `nodePoolFilterMode` and `castai.rebalance.disruptGuard` [chart-verified].

---

# Chapter 6 — Rebalancing and Consolidation

Sources: https://docs.cast.ai/docs/karpenter-enterprise-continuous-rebalancing · https://docs.cast.ai/docs/karpenter-enterprise-scheduled-rebalancing · https://docs.cast.ai/docs/karpenter-enterprise-features · kentroller chart values (chart-verified)

## 6.1 The three rebalancing paths

| Path | Trigger | Plan generation | Execution | Best for |
|---|---|---|---|---|
| **Continuous Rebalancing (CRB)** | Recurring in-cluster cycle | **In-cluster** (local state + pricing; no SaaS round-trip) | Auto (no approval) | Steady-state optimization |
| **Scheduled** (`RebalancePlanSchedule` → rpc) | Cron (UTC) | CAST AI SaaS | `autoExecute` in template | Maintenance windows, nightly spot rebalances |
| **Manual / console / API claim** (`rpc`) | You | CAST AI SaaS | Optional `autoExecute` | First rebalance, one-off moves |

All three honor the same exclusions and budgets. When CRB is enabled it **takes over cost-driven consolidation entirely**; Karpenter keeps drift detection, and Kentroller suppresses competing consolidation during its own plans (`disruptGuard`).

## 6.2 CRB modes (documented, hierarchical)

| Mode | What it does | Disruption risk | Includes |
|---|---|---|---|
| `delete-empty` | Removes nodes with no running workloads (pool consolidation enabled + Karpenter `Consolidatable`) | None | — |
| `drain-only` | Bin-packs pods from underutilized nodes **onto existing capacity only**, then deletes the emptied node; no replacements created | Low | delete-empty |
| `full` | Replaces underutilized/overpriced nodes with cheaper new NodeClaims | Medium (drain traffic) | drain-only |

"If a pod cannot be rescheduled on existing nodes, the cycle produces no plan for that run" (drain-only).

## 6.3 CRB tuning reference (chart-verified defaults from castai-kentroller v0.27.1; docs page matches where noted)

> **Naming drift Alert:** chart v0.27.1 renamed `savingsThresholdPercentage` → **`savingsThresholdPercent`** (marked `[OBSOLETE]` / fallback). Semantics per the chart comment: *"compared against projected savings as a percentage of total cluster cost, not the cost of replaced nodes… Relevant only for modes that can replace nodes (full mode)."* Use the new key; the old key still works as fallback. Kentroller doc's env default `0.0` and doc-page Helm default `15` disagree — the chart default is **15** (see App. B #1).

| Helm path (standalone: `castai.continuousRebalancing.*`; umbrella: `kent.castai-kentroller.castai.continuousRebalancing.*`) | Default | What it does | Operational guidance |
|---|---|---|---|
| `enabled` | `false` | Master switch | Enable in Phase 4, after baseline (Ch. 18) |
| `mode` | `full` | See 6.2 | Start `drain-only` in production pilots |
| `cycleIntervalSeconds` | `60` | Base cycle interval; **ignored for a mode when that mode's specific interval is set** | Leave |
| `fullModeCycleIntervalSeconds` | `1800` (30m) | Full-mode cadence | Expensive path; don't tighten below ~15–30m |
| `drainOnlyCycleIntervalSeconds` | `60` | Drain-only cadence | Leave |
| `deleteEmptyCycleIntervalSeconds` | `60` | Delete-empty cadence | Leave |
| `savingsThresholdPercent` | `15` | Min projected savings **% of total cluster cost** (full mode) | 10–20 typical; raise to cut churn |
| `savingsThresholdPercentage` | `15` | **OBSOLETE** — fallback only | Stop using |
| `minNodeAgeSeconds` | `300` | Node age floor before candidacy | 300–900 |
| `evictionConfig` | `[]` | Ordered selector+settings pairs (6.6) | Add protections here |
| `diagnosticsVerbose` | `false` | Full per-node decision logs (`crb_node_decision`, cycle summaries); hot-reloadable | Flip true for a debugging window |
| `disableDriftPlans` | `false` | Stop replacing drifted NodeClaims; leave drift to Karpenter; hot-reloadable | Enable if you manage drift via Karpenter upgrade waves |

Env-level documented knobs: `CONTINUOUS_REBALANCING_MIN_NODES_TO_CONSIDER` (=1), `MAX_NODES_PER_ITERATION` (=10), `SAVINGS_THRESHOLD_COST_MONTHLY` (=$50.0 — plan must clear **both** thresholds), `FAILURE_BACKOFF_DURATION` (=30m base, exponential), plus `MIN_NODE_AGE`/`POLLING_PERIOD` env forms that the Helm values now govern.

Apply pattern:

```bash
# [change] — umbrella release
helm upgrade castai castai-helm/castai -n castai-agent --reset-then-reuse-values -f values.yaml
# verify (docs pattern)
helm get values castai | grep -A12 continuousRebalancing
```

## 6.4 Exclusion hierarchy (strongest first — all documented)

1. **NodePool exclusion** — `kentroller.cast.ai/consolidation: "exclude"` (opt-out default) or `"include"` under `nodePoolFilterMode: opt-in` (top-level value, restart required). **Blocks every rebalancing path** — continuous (all modes, even delete-empty), drift replacement, scheduled and API claims. Aggressive mode and evictionConfig **cannot override** it. Plans may still *place* new nodes in an excluded pool — but those new nodes are then never consolidated by Kentroller. In opt-in mode with zero `include` annotations, **all rebalancing stops**.
2. **Per-node label** — `kubectl label node <n> autoscaling.cast.ai/removal-disabled=true` (remove with a trailing `-`).
3. **Karpenter native semantics** — static NodePools (fixed replica count) are never selected; `consolidationPolicy: WhenEmpty` pools yield only empty nodes; `karpenter.sh/do-not-disrupt=true` also blocks Karpenter drift-triggered replacement (Kentroller manages this label itself during active plans — don't fight it).
4. **NodePool `disruption.budgets`** — plan may exceed budgets; deletions are **gated at execution** and re-checked every 30s as budget slots free. You don't need to size plans to the budget.

```bash
# [read-only] audit the exclusion surface
kubectl get nodepool -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.kentroller\.cast\.ai/consolidation}{"\n"}{end}'
kubectl get nodes -l autoscaling.cast.ai/removal-disabled=true
```

## 6.5 Scheduled rebalancing — CRD contract (documented)

`RebalancePlanSchedule.spec`: `schedule` (5-field cron, **UTC**), `suspend`, `startingDeadlineSeconds`, `successfulJobsHistoryLimit`/`failedJobsHistoryLimit` (default 3/3), `preserveHistory` (false → claims deleted with the schedule), `rebalancePlanClaimTemplate`.

Claim template keys: `autoExecute`; `scope.nodeNames` **xor** `scope.nodeSelector.nodeSelectorTerms` (terms OR, expressions AND; excluded pools override any scope); `nodeConstraints.{minAgeSeconds, maxNodes (min 1), minClusterSize}`; `minSavingsPercentage` (0–100, 0 = always — for spot rotation); `executionPolicy.achievedSavingsPercentageThreshold` (0–100); `aggressiveModeConfig` (`ignoreLocalPersistentVolumes`, `ignoreProblemRemovalDisabledPods`, `ignoreProblemJobPods`, `ignoreProblemPodsWithoutController`, `ignoreInstanceCriteria`, `aggressiveEviction`, `drainTimeout` — **PV/bare-pod ignores can mean data loss / unrescheduled pods**: human approval required); `timeouts.{planGenerationTimeout: 5m, rebalanceExecutionTimeout: 1h}`.

Verbatim nightly spot example:

```yaml
apiVersion: autoscaling.cast.ai/v1alpha
kind: RebalancePlanSchedule
metadata:
  name: nightly-spot-rebalance
spec:
  schedule: "0 2 * * *"            # UTC
  rebalancePlanClaimTemplate:
    metadata: {}
    spec:
      autoExecute: true
      minSavingsPercentage: 15
      nodeConstraints:
        minAgeSeconds: 300
        maxNodes: 10
      scope:
        nodeSelector:
          nodeSelectorTerms:
            - matchExpressions:
                - key: karpenter.sh/capacity-type
                  operator: In
                  values:
                    - spot
```

Behavior: one active claim per schedule (else `ScheduleSkipped`); controller downtime → catch-up unless past `startingDeadlineSeconds` (`ScheduleMissed`); history pruned to limits. Suspend/resume via `kubectl patch rps <name> --type=merge -p '{"spec":{"suspend":true}}'`.

## 6.6 Eviction config (documented, ordered first-match-wins by restrictiveness)

Behaviors — `removalDisabled` > `disposable` > `aggressive` (most restrictive match wins):

| Behavior | Effect | Use for |
|---|---|---|
| `removalDisabled` | Never evict/drain matching pods or nodes | Critical stateful services, GPU nodes |
| `aggressive` | May evict single-replica pods and PDB-protected pods; **local PVs still respected** | Batch-ish Deployments, ≥3 replicas |
| `disposable` | Removes all guards (PDBs, replica count, local storage) | Jobs, ephemeral workloads |

Selectors (one per entry — never both): `podSelector{namespace, kind, replicasMin, labelSelector}` — `replicasMin` doesn't apply to DaemonSet/Job pods — or `nodeSelector{labelSelector}`. Default (no config): standard eviction — PDBs respected, bare pods block drain, local PVs block.

Production-protective example (docs-derived):

```yaml
# umbrella nesting: kent.castai-kentroller.castai.continuousRebalancing.evictionConfig
evictionConfig:
  - nodeSelector:
      labelSelector:
        matchLabels: { dedicated: gpu }
    settings:
      removalDisabled: { enabled: true }
  - podSelector:
      kind: StatefulSet
    settings:
      removalDisabled: { enabled: true }
  - podSelector:
      kind: Deployment
      replicasMin: 3
      labelSelector:
        matchExpressions:
          - { key: environment, operator: NotIn, values: [production] }
    settings:
      aggressive: { enabled: true }
  - podSelector:
      kind: Job
      namespace: batch
    settings:
      disposable: { enabled: true }
```

> Chart note: the kentroller values.yaml example writes the node matcher as `nodeSelectorTerm` while the docs page writes `nodeSelector` — **treat `nodeSelector` (docs) vs `nodeSelectorTerm` (chart comment) as an unverified divergence**; validate against your installed CRD/chart with a dry-run before applying evictions broadly (App. B #6).

## 6.7 Tuning profiles (*Recommendation* — validate in staging)

| Knob | Conservative | Balanced | Aggressive |
|---|---|---|---|
| mode | `delete-empty` → `drain-only` | `drain-only` | `full` |
| savingsThresholdPercent | 20 | 15 | 8–10 |
| `…_SAVINGS_THRESHOLD_COST_MONTHLY` (env) | $100 | $50 | $25 |
| minNodeAgeSeconds | 900 | 300 | 300 |
| fullModeCycleIntervalSeconds | 3600 | 1800 | 1800 |
| evictionConfig | removalDisabled for StatefulSets + 0-disruption PDBs | + aggressive for big Batch/Deployments | + disposable for Jobs |
| nodePoolFilterMode | opt-out with critical pools excluded | opt-out | opt-out |

Never start `full` in production without PDB coverage on single-replica services and a tested rollback sim.

---

# Chapter 7 — NodePool and Scheduling Optimization

Sources: https://karpenter.sh/docs/concepts/nodepools/ · https://docs.cast.ai/docs/karpenter-enterprise-continuous-rebalancing (interaction rules) · engineering practice (labelled)

Your NodePools remain the source of truth — CAST AI reads and, where enabled, modifies CRDs, but deliberate NodePool hygiene is the single biggest lever you control before any CAST AI feature is enabled.

## 7.1 NodePool design checklist (*Recommendation*)

| Area | Guidance | Why it matters to the suite |
|---|---|---|
| Instance breadth | Broad, multi-generation, multi-size `requirements` lists per pool | CRB's search space: the "largest replaceable subset" math and ICE recovery retry next types from your requirements |
| Capacity type | Separate or clearly-tagged Spot vs on-demand pools (`karpenter.sh/capacity-type`) | Scheduled rebalances scope on this label; commitments only clone **spot-allowing** pools |
| Weights | Use `weight` deliberately; remember: shadow commitment pools win via `weight: 100` + `zzz-` lexicographic tiebreak | Commitment steering (Ch. 11) |
| `disruption.consolidationPolicy` | `WhenEmptyOrUnderutilized` for flexible pools; `WhenEmpty` for sensitive ones | CRB honors it — `WhenEmpty` pools only ever lose empty nodes |
| `disruption.budgets` | Set per-pool rate limits | CRB/scheduled plans defer deletions to budgets, re-checking every 30s |
| `expireAfter` | Use for hygiene rotation | Kentroller's node-consolidation explicitly kills expired NodeClaims |
| Taints/labels | Stable taint taxonomy for dedicated pools | Shadow pools inherit taints/NodeClass/disruption from source |
| Limits (`spec.limits`) | Keep headroom vs. commitments; avoid pinning total CPU below commitment allocations | Shadow pools get their own limits; fights over cluster-level headroom distort both |
| Architecture | Split amd64/arm64 pools if you plan CLM (single-arch requirement) | CLM compatibility (Ch. 10) |
| AMI family | AL2023 over AL2 (AL2 is also CLM-incompatible) | CLM + modern containerd |
| VPC CNI | Prefix delegation on EKS increases pod density → better bin-packing | Note: CLM's VPC-CNI path forbids prefix delegation — pick the trade-off per pool class |
| Pod density | Check `maxPods` vs instance ENI limits | Drain-only bin-packing dead-ends on IP exhaustion |

## 7.2 Validate before/after any NodePool change

```bash
# [read-only]
kubectl get nodepool <name> -o yaml
kubectl get nodeclaims --sort-by=.metadata.creationTimestamp | tail -20
kubectl describe nodeclaim <nc>          # stuck provisioning? events + conditions
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter --tail=100 \
  | grep -i "disruption\|drift\|consolidat"    # who is consolidating and why
```

*Recommendation:* roll NodePool changes through staging and observe one full CRB cycle + one Karpenter consolidation cycle before production promotion. If Kentroller CRB is enabled, remember cost-driven consolidation is now Kentroller's job — NodePool `disruption` settings still gate deletions, and `disruptGuard` prevents mid-plan races.

---

# Chapter 8 — Workload Autoscaler Optimization

Sources: https://docs.cast.ai/docs/workload-autoscaling-overview (+ configuration page) · https://docs.cast.ai/docs/karpenter-enterprise-features

## 8.1 What it is on Karpenter clusters

"Workload Autoscaler behavior is largely identical whether you're using Karpenter Enterprise suite or Cast AI's Autoscaler — it operates at the workload level independently of Node provisioning." On KE it **feeds optimized requests to Karpenter**: tighter requests → denser packing → CRB can remove/replace nodes. CRB even coordinates with **pending rightsizing recommendations not yet applied** when planning.

Components: `castai-workload-autoscaler` (admission webhook on :9443) + `castai-workload-autoscaler-exporter` + recommendation CRDs `recommendations.autoscaling.cast.ai` (created by cluster-controller). Requires metrics-server.

## 8.2 Apply modes (documented)

| Mode | Behavior | Notes |
|---|---|---|
| `immediate` (default) | Evicts via the **Kubernetes Eviction API**; webhook applies new requests at pod recreation | **PDBs are enforced**; OOMKilled/CrashLoopBackOff pods are deleted directly, bypassing PDB checks (recovered unhealthy pods) |
| `deferred` | No forced evictions; requests applied at natural pod recreation; on K8s **1.33+** may apply via **in-place resize** without restart | Best for sensitive workloads |

Forced-deferred overrides even when `immediate` is set: hard `kubernetes.io/hostname` pod anti-affinity (requiredDuringScheduling), host-network pods, and **Rollout-kind workloads**.

Rollout-behavior controls (`workloads.cast.ai/configuration` annotation): zero-downtime updates for single-replica Deployments (temporarily scales to 2; requires replica=1, no PVCs), one-by-one eviction, eviction delays (10s/60s/5m/60m).

## 8.3 Scaling policy knobs (documented)

* **Recommendation percentile** — 100% = use max observed value, not pod average.
* **Overhead** — default 10% CPU + 10% memory on top of the recommendation.
* **Optimization threshold** — default 10%; asymmetric: upscale thresholds measure against current requests, downscale against the new recommendation.
* **Automate** on/off per policy; per-workload overrides via `workloads.cast.ai/configuration` (annotation beats policy).

```yaml
workloads.cast.ai/configuration: |
  vertical:
    optimization: on
    applyType: immediate
  rolloutBehavior:
    type: NoDisruption
    preferOneByOne: true
    delaySeconds: 120
```

## 8.4 Confidence, ramp-up, OOM/surge/stall guards (documented)

* New-cluster gradual tiers: <2.4h data → max 10% adjustment; <6h → 25%; <24h → 35%; >24h → confidence-based. Manually-enabled workloads bypass gradual scaling immediately.
* Full confidence ≈ 24h monitoring + ~40% metric density.
* **OOM handling:** initial OOM → +20% **or** +100Mi (whichever greater) memory overhead; linear decay to 0 over 24h; cap 2.5× original; repeated-loop protection (20 OOMs/h → optimization disabled, auto re-enable ~4h; continuous-OOM streak ≥2h → read-only + Event log). *Doc-internal conflict: one diagram says "min 500Mi baseline" vs text 100Mi (App. B #9).*
* **Surge detection:** CPU ≥100m & ≥100%; Mem ≥100Mi & ≥20% → immediate recommendation refresh (suppressed while HPA is below maxReplicas).
* **Startup-failure detection:** >10 readiness/startup probe failures in 5m → +20% overhead, decays.
* **HPA interop:** CPU overhead ignored when vertical+horizontal both on (auto-balanced); optional HPA target converter (`AverageValueFromOriginalRequests`, v1.0.11+) stops request-drift fights.

## 8.5 Karpenter-specific operating pattern (*Recommendation*)

1. Enable with default scaling policies OFF; onboard namespaces one at a time via per-workload toggles or whitelisting (`workloadWhitelistingEnabled=true` + pod-template label `workload-autoscaler.cast.ai/enabled: "true"`).
2. Let 24–48h of recommendations accumulate; review in the console's workload drawer (difference between original vs current requests).
3. Start in `immediate` with PDBs everywhere; switch StatefulSets to `deferred` (or in-place on 1.33+).
4. **Verify node-level impact:** freed requests only become savings when CRB/scheduled rebalancing removes capacity — watch `rp` plans and the cost report; a rightsized workload that still pads a dedicated pool saves nothing.
5. Exclusions: label `workload-autoscaler.cast.ai/ignore` on pod templates/namespaces (functional but documented as "not a supported configuration option" — prefer annotations/feature flags); `workloads.cast.ai/custom-workload` for operator-owned workloads (doesn't cover every controller).

Verify wiring:

```bash
# [read-only]
kubectl get mutatingwebhookconfiguration castai-workload-autoscaler -o yaml | grep -A3 objectSelector
kubectl get recommendations.autoscaling.cast.ai -A | head
kubectl logs -n castai-agent -l app.kubernetes.io/name=castai-workload-autoscaler | grep -E "reconciling recommendation|mutating pod resources" | tail -5
```

---

# Chapter 9 — Spot Intelligence and Reliability

Sources: https://docs.cast.ai/docs/karpenter-enterprise-features · https://docs.cast.ai/docs/spot · https://docs.cast.ai/docs/spot-handler · changelog (Jul 2026)

## 9.1 The moving parts — and their exact roles on KE

| Piece | Role on a Karpenter Enterprise cluster |
|---|---|
| Kentroller spot prediction | Polls the CAST AI ML API (1m); labels at-risk nodes `autoscaling.cast.ai/predicted-interruption=true`; creates a scoped RebalancePlanClaim; emits `SpotInterruptionPredicted`; 15m replacement cooldown |
| Karpenter interruption queue | **Without CLM:** Kentroller signals Karpenter's interruption queue → Karpenter's standard replacement workflow runs with extended lead time. EKS SQS queue must exist (IAM!) |
| Continuous Rebalancing (+CLM) | **With CLM:** CRB consolidates the at-risk node using live migration before interruption; without CLM it uses standard drains |
| Spot Handler | **Observe-and-report only.** "Spot Handler does not take any action on nodes or workloads." Feeds the ML models |
| `UnavailableOffering` | Avoids the failing (type, zone, capacity) combo after ICE/observed interruption; prediction-only records never reported as observed |

## 9.2 Prediction horizon — read this before writing SLAs

Three different figures exist in official docs: KE pages say "**up to 30 minutes** before interruptions" (vs AWS's 2-minute notice); the Spot page says horizons of "1 hour for AWS, 3 hours for GCP" and separately that the model "can predict that a specific instance will be interrupted within the next 180 minutes." These describe adjacent-but-different surfaces (KE prediction signal vs the generic model's window). **Handbook rule: plan around the documented KE guarantee — up to ~30 minutes lead — and treat anything beyond as uncommitted** (App. B #8). AWS's own signal remains ~2 minutes.

## 9.3 EKS prerequisites for the signal path

```bash
# [read-only]
kubectl get deployment -n karpenter karpenter -o yaml | grep -i queue     # Karpenter interruption queue present?
kubectl get events --field-selector reason=SpotInterruptionPredicted      # predictions being acted on?
kubectl logs -n castai-agent -l app=castai-kentroller --tail=50           # prediction flow
kubectl logs -l name=spot-handler -n castai-agent --tail=50               # observation feed
```

Karpenter needs its SQS interruption queue + IAM (standard Karpenter prerequisite); the prediction toggle lives in the cluster's CAST AI Settings.

## 9.4 What's NOT shipped (as of 2026-10-17)

* **Spot fallback recovery** — explicitly "planned for a future release. Currently, if Karpenter falls back to On-Demand due to Spot unavailability, those Nodes remain On-Demand until manually replaced or consolidated." A good interim approximation is a **scheduled nightly spot-scoped rebalance** (`minSavingsPercentage: 0`, scope `karpenter.sh/capacity-type In [on-demand]` targeting recovered spots is *not* directly expressible — scope by pool labels instead) or CRB `full` mode.
* **Spot reliability model** (steering to historically calmer pools) — "coming in future releases."
* AWS Rebalance Recommendations as a prediction source — **removed Jul 2026**; CAST AI ML model only.

## 9.5 Production strategy for strict-availability workloads (*Recommendation*)

* Keep strict-SLO workloads on on-demand NodePools (`kentroller.cast.ai/consolidation: "exclude"` if truly untouchable) or with Pod mutations that lock spot-preferences per namespace.
* Spot pools: diversify families/sizes in requirements (Karpenter spreads across offerings); PDBs + ≥2 replicas + preStop hooks; cross-AZ topology spread.
* For Spot disruption handling expect the **prediction → claim → replacement** path; with CLM enabled and eligible workloads, it becomes a near-zero-downtime move — but CLM itself documents it "cannot guarantee successful migration before the CSP terminates the node" on Spot, so the guarantee level stays **best-effort**.

---

# Chapter 10 — Container Live Migration (CLM)

Sources: https://docs.cast.ai/docs/clm-overview · /clm-requirements-and-limitations · /clm-getting-started (label matrix) · castai-live chart values in kent profile (chart-verified)

## 10.1 What CLM does under KE

Continuous Rebalancing "uses CLM when available" for eligible workloads: `RebalanceMigrationPlan` CRs move pods to replacement nodes preserving memory state, process state, and TCP connections (CRIU-based), "with graceful fallback to traditional eviction." Kentroller's CRB + CLM is also the delivery path for predicted-Spot-interruption moves.

**Default state in the kent profile:** the `castai-live` chart ships with **`controller.replicaCount: 0` — CLM is disabled by default**; `2` enables it [chart-verified]. `castai-live.daemon.labelNodeSubnet: true` and kentroller's `castai.clm.enabled: false` default are the adjacent switches.

Enable (umbrella nesting):

```yaml
kent:
  castai-live:
    controller:
      replicaCount: 2
  castai-kentroller:
    castai:
      clm:
        enabled: true
```

## 10.2 Requirements (documented — treat as hard gates)

| Gate | Requirement |
|---|---|
| Kubernetes | **1.30+** (checkpoint/restore Beta) |
| Runtime | **containerd v2+** only |
| Node image (EKS) | **Amazon Linux 2023** (standard, NVIDIA, Neuron); **Bottlerocket and AL2 NOT supported** |
| Node management | **Both source and destination nodes must be CAST AI-managed** — on KE this means the CLM-enabled node set; verify against your KE rollout |
| Architecture | Single-arch per node set (amd64 **or** arm64; amd64 = full incremental transfer; arm64 = non-iterative); generation-compatible families (c3↔m3 ok; c3↔c5 not) |
| TCP path | EKS **VPC CNI (forked)** — same-IP, no cross-subnet, **no prefix delegation / IPv6 / multi-NIC**; or **Traffic Control** — kernel 6.6+, new IP, in-cluster connections only; or **Calico-as-CNI** (VXLAN, EKS/AKS) |
| Freeze budget | `requestedFreezeTimeDefaultSeconds` default 5s |

## 10.3 Workload eligibility and the label decision matrix (documented)

Live controller auto-labels pods `live.cast.ai/migration-enabled=true|false` — inspect with `kubectl get pods -A -l live.cast.ai/migration-enabled=true`. Eligible ≠ guaranteed.

| Labels | Behavior |
|---|---|
| migration-enabled only | Live-migrate; on failure **fallback to eviction** |
| + `autoscaling.cast.ai/removal-disabled=true` | Live-migrate; **no eviction fallback** — restore on source |
| + `autoscaling.cast.ai/live-migration-disabled=true` | Skip migration entirely (with removal-disabled: fully protected; without: plain eviction) |
| StatefulSet + migration-enabled (not disposable) | Migrate; on failure **no eviction fallback** |
| `autoscaling.cast.ai/disposable=true` | Always evicted (migration attempted first) |

Supported: StatefulSets, Deployments, bare pods, Jobs, CronJobs (init containers skipped). **Not supported:** DaemonSets (by design), **GPU workloads**, heavy eBPF, io_uring, MPTCP, privileged containers. Storage: PVC (zonal PVs = same-zone), NFS, emptyDir, configMap, secret; hostPath experimental. PVC reattach ≈ 9s average on EKS.

## 10.4 Operations

```bash
kubectl get migrations -A -w        # [read-only] watch live migrations
kubectl get rebalancemigrationplans # [read-only] KE-side coordination CRs
```

Migration events: `PreDumpSkipped/PreDumpFinished/PreDumpFailed`, `MigrationReconfigured`, `PodCreateFinished/PodCreateFailed`, `MigrationFinished/MigrationFailed`.

**Never promise universal zero downtime** (*Recommendation*): CLM docs themselves say the "application is briefly paused"; large-memory pods lengthen the freeze; subnet-IP exhaustion can stall the VPC-CNI path. Frame CLM to stakeholders as *downtime eliminated for eligible pod classes, graceful reduction elsewhere*.

## 10.5 Decision checklist before enabling CLM on a production KE cluster

- [ ] K8s ≥ 1.30, containerd v2+, AL2023 images on candidate pools
- [ ] Decide TCP path per pool (VPC-CNI same-subnet vs TC kernel 6.6+)
- [ ] Disable for GPU/io_uring/privileged workloads (labels)
- [ ] Verify `live.cast.ai/migration-enabled` coverage AFTER the live controller labels pods
- [ ] Test one manual rebalance with a RebalanceMigrationPlan in staging, watch `kubectl get migrations`, measure freeze time
- [ ] Document the Pod-mutation caveat: "mutations whose scheduling outcome is decided per pod at creation time are not supported with CLM"

---

# Chapter 11 — Commitments Optimization (RI / Savings Plans)

Source: https://docs.cast.ai/docs/karpenter-enterprise-commitments · kentroller chart values (chart-verified) · changelog Jul 2026

## 11.1 The problem and the mechanism

Karpenter has no native commitment awareness — it can provision full-price capacity while your RI/SP discounts sit idle. CAST AI closes the gap with **high-weight shadow NodePools**:

1. You import and **assign commitments to the cluster** in the CAST AI console (Commitments page).
2. CAST AI converts them to `CommitmentBudget` CRDs (RI / Compute SP / EC2 Instance SP; multiple commitments may merge into one budget; SPs get per-family CPU pricing embedded from the AWS pricing API) and syncs them into the cluster continuously.
3. Kentroller matches each budget to **compatible spot-allowing NodePools** (validated against real AWS instance inventory), and creates shadow pools: `weight: 100`, name prefix `zzz-` (wins Karpenter's equal-weight lexicographic tiebreak), **on-demand only**, taints/NodeClass/disruption inherited, `consolidateAfter: 5m` default.
4. Kentroller **rebalances shadow-pool limits every 2 minutes** proportional to usage (zonal RI = node count; regional RI + SPs = CPU millicores).
5. On unassign/disable: limits → 0, wait for empty, delete pools. **Your existing NodePools are never modified.**

Shadow pools only target spot-allowing pools because their value is replacing *spot* with *committed on-demand*; an on-demand-only pool already consumes commitments through normal Karpenter scheduling.

**Platform availability (documented):** AWS EKS = Supported (RI + SP). Azure AKS = **Not yet supported**. GKE = no statement.

## 11.2 Prerequisites & chart controls

* Kentroller **v0.1.162+** (app version; older = RI budgets only, no Savings Plans).
* Controller enabled: `castai.commitmentBudgets.enabled: true` (default) [chart-verified].
* Filter: `castai.commitmentBudgets.nodePoolFilterMode` (default `opt-out`; annotation `kentroller.cast.ai/commitment-nodepool-clone: "exclude"|"include"`).
* Over-limit enforcement: `castai.commitmentBudgets.drainMode` = `off` (default) | `safe` (drain shadow-pool nodes above allocation using standard eviction checks) | `aggressive` (bypass) [chart-verified]. Keep `off` until you trust allocation math in production.

## 11.3 Commitment types and the $→capacity math (documented)

| Type | CRD type value | Scope | Usage measured in | Spec block |
|---|---|---|---|---|
| Zonal RI | `reserved-instance` | Instance type + AZ | node count | `spec.ri` with `availabilityZone` |
| Regional RI | `reserved-instance` | Family region-wide | CPU millicores | `spec.ri` without AZ |
| Compute SP | `compute-savings-plan` | All families region-wide | $/hr → millicores | `spec.computeSP` |
| EC2 Instance SP | `ec2-instance-savings-plan` (added Jul 2026) | Single family | $/hr → millicores | `spec.ec2InstanceSP` |

`total millicores = floor(commitmentAmount / pricePerCPU × 1000)`; every matched pool gets ≥ 1000m or the budget reports `InsufficientCommitment`. Compute SP: Kentroller picks the **most expensive** valid `pricePerCPU` among families each pool supports (conservative allocation).

Key fields: `spec.budgetID`, `spec.type`, `spec.ri.{availabilityZone,instanceType,count,instanceFamily,cpu,memory}`, `spec.computeSP.{offeringId,commitmentAmount,familyCPUPrices}`, `spec.ec2InstanceSP.{instanceFamily,offeringId,commitmentAmount,pricePerCPU}`; `status.matchedNodePools`; condition `CompatibleNodePools` with reasons `Compatible / Incompatible / InsufficientCommitment / InvalidPricing / NoCustomerNodePools`.

## 11.4 Inspect & validate

```bash
# [read-only]
kubectl get commitmentbudgets        # TYPE / RI COUNT / COMMITMENT / MATCHED NODEPOOLS / COMPATIBLE
kubectl get cb <name> -o yaml
kubectl get nodepools | grep zzz-    # shadow pools present
kubectl get nodepool <zzz-pool> -o jsonpath='{.spec.weight}{"\n"}{.spec.limits}'
```

## 11.5 Worked example (*Hypothetical lab values*)

Cluster buys a **regional RI family m6i** + a **Compute SP $1.50/hr**. Spot-heavy pool `web-spot` (allows m5/m6i families) and `api-spot` (allows c6i/m6i). Expect: `CommitmentBudget` CRs appear within minutes of console assignment; shadow pools `zzz-castai-budget-…-web-spot` etc. with `weight: 100`; limits re-tuned every 2 minutes toward observed CPU usage; Karpenter packs new `web-spot` pods onto committed on-demand m6i instead of spot; the commitments report shows utilization rising. On-demand-heavy pools (no spot allowed) are intentionally **not** cloned.

**Double-counting warning (*Recommendation*):** commitment discounts are *your* pre-purchased cloud discounts. Savings reports mix public pricing with your Price-adjustments; attribute commitment utilization **improvement** to CAST AI, not the RI discount itself.

---

# Chapter 12 — Advanced Tuning Matrix

Consolidated from Chapters 5, 6, 10, 11 (each row cites its source chapter; defaults chart-verified unless marked *docs*).

| Parameter | Path (standalone chart) | Default | Conservative | Balanced | Aggressive | Risk / notes |
|---|---|---|---|---|---|---|
| CRB enable | `castai.continuousRebalancing.enabled` | false | false→true late | true | true | Ch. 6 |
| CRB mode | `.mode` | full | drain-only | drain-only | full | full disrupts |
| Cycle interval | `.cycleIntervalSeconds` | 60 | 300 | 60 | 60 | env default 10s *docs* — App. B |
| Full-mode cadence | `.fullModeCycleIntervalSeconds` | 1800 | 3600 | 1800 | 1800 | — |
| Drain-only cadence | `.drainOnlyCycleIntervalSeconds` | 60 | 300 | 60 | 60 | — |
| Savings % | `.savingsThresholdPercent` | 15 (**cluster-cost** %) | 20 | 15 | 10 | old key obsolete |
| Savings $ (env) | `…_SAVINGS_THRESHOLD_COST_MONTHLY` | 50.0 *docs* | 100 | 50 | 25 | BOTH gates must pass |
| Min node age | `.minNodeAgeSeconds` | 300 | 900 | 300 | 300 | churn guard |
| Pool filter | `nodePoolFilterMode` (top-level) | opt-out | opt-out + excludes | opt-out | opt-out | restart; opt-in empty = full stop |
| Eviction policy | `.evictionConfig` | [] | removalDisabled criticals | +aggressive N≥3 | +disposable Jobs | PDB/data-loss semantics |
| Diagnostics | `.diagnosticsVerbose` | false | true during triage | false | false | log volume |
| Drift plans | `.disableDriftPlans` | false | false | false | true (if Karpenter owns drift) | — |
| Weighted packing | `castai.rebalance.preferenceWeightedPacking` | true | true | true | false (pure cost) | hot-reload |
| TS-spreading | `castai.rebalance.softTSCSpreading` | false | false | on if soft TSC | on | — |
| NS labeling | `castai.rebalance.namespaceLabeling` | true | true | true | true | Cilium churn caveat |
| Disrupt guard | `castai.rebalance.disruptGuard` | true | true | true | true | restart to change |
| Spot prediction | `castai.spotInterruptionPrediction.enabled` | true | true | true | true | needs Karpenter queue |
| Prediction cooldown (env) | `…_SPOT_REPLACEMENT_COOLDOWN` | 15m *docs* | 30m | 15m | 15m | — |
| Prediction threshold (env) | `…_INTERRUPTION_THRESHOLD` | unset *docs* | 0.7 | default | 0.5 | 0–1; unset=model default |
| CLM feature | `castai.clm.enabled` + `castai-live.controller.replicaCount` | false / 0 | false/0 | true/2 (eligible pools) | true/2 | gates in Ch. 10 |
| Commitments ctrl | `castai.commitmentBudgets.enabled` | true | true | true | true | needs Kentroller ≥ v0.1.162 |
| CB drain enforcement | `castai.commitmentBudgets.drainMode` | off | off | off→safe later | safe | never `aggressive` pre-prod |
| CB pool filter | `castai.commitmentBudgets.nodePoolFilterMode` | opt-out | opt-out | opt-out | opt-out | annotation override |
| Kentroller resources | `resources` | 1 CPU / 2Gi req | default | default | default | VPA-managed by chart |
| TS webhook | `webhook.scaleDown.{enabled,mode}` | false/opt-in | false | opt-in | opt-in | NS label `tsc-scaledown.cast.ai/enabled` |

**Rule:** every change above rides through GitOps with `helm get values` diffs, one knob per PR; measure for ≥1 week on the day-2 cadence (Ch. 17) before the next turn.

---

# Chapter 13 — Monitoring and Observability

## 13.1 Telemetry surfaces that exist (verified)

| Surface | What it is | Source |
|---|---|---|
| Kentroller metrics endpoint | `:8443` metrics endpoint enabled (`metrics.enabled=true`, Service created) | chart-verified. **Metric names are not published** — discover via `kubectl port-forward` + `/metrics`; do not hardcode names without checking |
| Kentroller OTel export | Metrics + logs over the Kent gRPC channel (`castai.otelMetrics/otelLogs.enabled=true`) | chart-verified |
| Audit log | Dedicated `castai-audit` namespace (`castai.audit.enabled=true`) | chart-verified; audit also viewable for Karpenter clusters in console (Feb 2026 changelog) |
| Activity/event stream | `SpotInterruptionPredicted` events, rp/rpc/rps status fields, `migrations` CRs | docs |
| Console dashboards | Cost monitoring (60s refresh), savings reports, component control (health + Mothership status), Event Log | docs |
| Reliability metrics (Karpenter clusters) | One-step enable via castctl v0.10.1 (Jul 2026) — Prometheus-style cluster reliability metrics | changelog; exact metric names **Not documented** |
| Workload cost metrics API | `GET /v1/metrics/clusters/{clusterId}/workload-costs` — "scrapable workload metrics in Prometheus format" | live OpenAPI-verified |
| CAST AI API suite | savings/cost/commitments endpoints (Ch. 14) for your own pipelines | live OpenAPI-verified |

## 13.2 What to watch (SLO-oriented; alert thresholds are *example recommendations*, not product defaults)

| Signal | Source | Watch for | Example alert |
|---|---|---|---|
| Pod health, all CAST AI comps | kube-metrics | any non-Running pod in `castai-agent` | `kube_pod_status_phase{namespace="castai-agent", phase!="Running",phase!="Succeeded"} > 0` for 10m |
| Kentroller leadership/crash loops | k8s | CrashLoopBackOff on `-l app=castai-kentroller` | immediate page |
| Active/failed plans | `kubectl get rp` / API | `Failed`, repeated `DoneWithWarnings`, stuck `Executing` > timeouts (1h) | failed plan = ticket |
| Claim backlog | `rpc` states | claim stuck `Generating` > `planGenerationTimeout` (5m) | event |
| NodeClaim provisioning | `kubectl describe nodeclaim` | stuck > 15 min (docs' support-escalation trigger) | ticket + escalate evidence (Ch. 15) |
| UnavailableOffering growth | `kubectl get uo` | persistent same-type records ⇒ capacity drought | weekly review |
| Shadow pools | `kubectl get cb`, `get nodepools | grep zzz-` | `CompatibleNodePools` not `Compatible`; commitment unused | weekly |
| Scheduled health | `rps` status/`lastExecution` | `ScheduleMissed`/`ScheduleSkipped` events | ticket |
| Prediction flow | events | prediction events but no follow-up claim | weekly |
| Drift surprises | node age distribution | sudden node replacement waves | correlate with NodePool edits |
| Cost outcome | cost report / API | month-end spend vs forecast | FinOps cadence |

**Grafana design (*Recommendation*):** four rows — *Fleet* (nodes, NodeClaims, provisioned vs requested CPU/mem from kube-state-metrics); *Optimization activity* (rp state counts, drains, migrations, prediction events); *Cost* (CAST AI cost API panels: daily compute spend, per-lifecycle split, forecast); *Commitments* (cb status, shadow-pool node counts, utilization). Never alert on absolute savings; alert on **plan failure rates and stuck states**.

---

# Chapter 14 — Savings and FinOps

Sources: https://docs.cast.ai/docs/savings-report · /savings-baseline · /available-savings · /cost-comparison · /cluster-total-compute-cost · https://api.cast.ai/v1/spec/ (endpoints live-verified) · Kentroller doc (plan-level savings)

## 14.1 Definitions (documented — verbatim meanings)

* **Provisioned** — resources actually allocated on nodes (what you pay for).
* **Requested / Original requested** — pod requests after vs before rightsizing.
* **Available savings** — potential savings modeled from current state (works for read-only and managed clusters; the page defines only those two categories — see 14.6).
* **Realized savings** = `projected cost − actual cost`, "realized primarily through the node autoscaler", including spot adoption, bin-packing, cheaper types. Cards appear once the node autoscaler manages ≥ 20% of nodes.
* **Workload autoscaler savings** = `(original requests − current requests) × unit cost`, counted only on VPA-active days. **Included inside realized savings when the node autoscaler is enabled — do not add the two cards together ("Total savings currently equals autoscaler savings only").**
* **Baseline** — frozen four-parameter model (CPU/RAM overprovisioning factors + CPU/RAM unit costs) measured over a pre-optimization window; method chosen once per cluster: **cluster history → peer clusters → industry average**; cluster must be ≥ 14 days old and actively managed; overrides only via CAST AI rep.

## 14.2 Interfaces (live-verified)

Console: Cluster report, Savings report, Available savings, Cost comparison (needs ≥ 14 days data), organization views. API (OpenAPI-verified): `GET /v1/cost-reports/clusters/{id}/savings`, `/estimated-savings(+history)`, `/cost`, `GET /v1/cost-reports/organization/cost-comparison`, `/organization/daily-cost`, commitments family `/savings/v1beta/organizations/{orgId}/commitments*`. No documented CSV export except the org per-node-template table (Jul 2026). Pricing basis is **public pricing + your Price adjustments** — not your bill; for EDP/private pricing fidelity configure Price adjustments (docs).

## 14.3 The Karpenter-mode caveat you must state to your CFO (documented gap)

All six cost/savings pages **never mention Karpenter**; the realized-savings mechanics are defined in CAST-AI-Autoscaler terms (baseline window ends "when more than 20% of nodes became Cast AI-managed"; realized savings "primarily through the node autoscaler"). The KE pages separately promise "Cost reporting works identically for Karpenter clusters." **Which baseline method and card-gating a Kentroller-managed Karpenter cluster gets is not documented.** Treat it as vendor-ambiguous: verify empirically (below) before publishing any realized-savings figure to Finance, and use plan-level `status.savings` + cost-comparison deltas as your evidence meanwhile.

**Empirical verification protocol (*Recommendation*):** (1) connect, wait 14+ days; (2) check which savings cards appear; (3) record baseline source label (history/peers/industry); (4) run one clearly-attributable scheduled rebalance; (5) confirm day-over-day actual-cost delta ≈ plan `status.savings.projectedSavingsCostMonthly/30`; (6) reconcile against AWS CUR at month end.

## 14.4 Attribution model for a KE cluster (*Recommendation*, formulas)

Measure **incremental** savings over your existing open-source Karpenter baseline:

```
Period A (Karpenter-only):            CostA  (7–14 stable days, pre-KE features)
Period B (+ one KE feature):          CostB  → feature attributable saving = CostA_scaled − CostB
Scale correction:                     scale by requested core-hours (docs' own fairness method)
rebalance-level truth:                Σ rp.status.savings.projectedSavingsCostMonthly  → realized proxy at month end
rightsizing truth:                    Σ (originalRequested − currentRequested) × effective unit price
commitments truth:                    Δcommitment-utilization × commitment spend  (NOT the discount itself)
```

Feature-by-feature expected mechanics: **WOOP** → request reduction (visible week 1); **CRB drain-only** → fewer nodes same demand; **CRB full** → cheaper types; **Spot prediction** → fewer interruption events (cost-avoidance, not line-item saving); **Commitments** → spot→committed-on-demand substitution; **CLM** → enables all of the above on stateful/pinned workloads (cost-avoidance + unlock).

## 14.5 Illustrative 30-day model — 100 nodes (**all values hypothetical**)

Baseline (Karpenter-only, mixed OD/spot): 100 nodes × avg 8 vCPU × 730h × $0.045/vCPU-h ⇒ **$26,280/month** (hypothetical unit economics).

| Phase | Feature state | Monthly effect (hypothetical) | New run-rate | Cumulative vs baseline |
|---|---|---|---|---|
| 0 | Reporting only | $0 (visibility) | $26,280 | 0% |
| 1 | + WOOP rightsizing (−12% requests) | −8% realized (12% request cut → fewer nodes) | $24,178 | −8% |
| 2 | + CRB drain-only | −4% | $23,211 | −11.7% |
| 3 | + CRB full (cheaper types) | −5% | $22,050 | −16.1% |
| 4 | + Spot prediction (avoidance) | stability, −1% | $21,830 | −16.9% |
| 5 | + Commitments steering (RI utilization 55%→85% on committed spend) | −6% on committed share | ~$21,000 | ~−20% |
| 6 | CAST AI platform fee (hypothetical % of compute) | add back | in net figure | net = gross − fee |

Rules: each phase needs ≥ 1 stable week before attribution; document Price-adjustments state; reconcile against CUR; report **gross**, **fee**, **net** separately. These numbers are illustrative only — never present them as CAST AI-published rates.

## 14.6 Monthly FinOps reporting template (*Recommendation*)

```
1. Cluster compute spend (CAST AI cluster report)            $__
2. Month-end forecast vs actual                              $__  (__%)
3. Rebalance activity: N plans, N failed, Σ projected $/mo   __
4. Rightsizing: original vs current requests (CPU, RAM)      __ / __
5. Commitments: assigned $, utilization %, shadow-pool nodes __
6. Reliability: predicted interruptions, observed, evictions __
7. Actions next month (knobs to turn per Ch. 12)             __
```

---

# Chapter 15 — Troubleshooting Playbook

Format: **Symptom → Likely causes → Diagnostics [read-only] → Fix [change] → Verify → Rollback → Escalate**. Escalation trigger documented by CAST AI: plans failing repeatedly with the same error, NodeClaims stuck > 15 minutes, or persistent connection/API errors — collect pod logs (`-l app=castai-kentroller --tail=200`), `kubectl describe` of all rp/rpc/uo CRs, and component versions before opening a ticket.

**1. Cluster not connected / components pending**
→ Causes: egress blocked, bad endpoints, CA interception, wrong org.
→ Diag: `kubectl get pods -n castai-agent`; `kubectl describe pod -n castai-agent <pending>`; `curl -sI https://api.cast.ai` from a node; check `global.castai.apiURL/grpcURL` region.
→ Fix: allowlist Ch. 3.3 endpoints; dual-key CA secret (`TLS_CA_CERT_FILE`+`TLS_CA_CERT`); re-run `helm upgrade … --reset-then-reuse-values`.
→ Verify: all Running; preflight `Completed`. Rollback: uninstall.

**2. Karpenter not detected (preflight warns/fails)**
→ Causes: Karpenter < 1.0; no NodePool; NAP without `kent.managedKarpenter=true`.
→ Diag: `kubectl logs -n castai-agent -l job-name=<preflight>` (or the completed preflight pod); `kubectl get pods -n karpenter`; `kubectl get crd | grep karpenter`.
→ Fix: set `kent.managedKarpenter=true` for NAP; otherwise fix Karpenter first. Verify → re-run helm. Rollback: unset.

**3. Kentroller CrashLoopBackOff**
→ Causes: missing ARM identity (AKS subscriptionID/workload identity), bad API key secret, webhook cert issues, resource pressure.
→ Diag: `kubectl logs -n castai-agent -l app=castai-kentroller --previous`; check secret `castai-credentials` has key `API_KEY`; on AKS verify federated credential subject `system:serviceaccount:castai-agent:castai-kentroller` and that the chart added the label/annotation (don't hand-add).
→ Fix per cause. Verify: 2/2 Running, leader logs flowing. Rollback: pin previous chart version.

**4. Missing IAM permissions (cloud APIs)**
→ Causes: installer identity too narrow; AKS Reader missing.
→ Diag: Kentroller/agent logs for 403s; on AKS confirm managed identity has **Reader at subscription scope**; confirm OIDC issuer enabled.
→ Fix: grant per Ch. 3.2/4.E. Verify: quota/AZ lookups stop erroring; `uo` records start appearing on ICE tests. Rollback: none needed (additive).

**5. Private cluster can't reach CAST AI**
→ Causes: no NAT/egress; DNS; PrivateLink expectation.
→ Diag: egress test from node; component logs `dial tcp`.
→ Fix: NAT egress to listed endpoints/IPs or proxy env (`HTTP(S)_PROXY`,`NO_PROXY`); **PrivateLink-for-KE path is Not documented — confirm with CAST AI before designing around it.**

**6. No savings reported**
→ Causes: cluster < 14 days old (documented gate — report absent, not zero); baseline window still open; no supported node types (available-savings); Karpenter-mode mapping ambiguity (Ch. 14.3).
→ Diag: cluster age; savings cards present?; baseline label (history/peers/industry); cost report loading?
→ Fix: wait out the window; verify cost monitoring data flows (60s refresh). Escalate if > 21 days.

**7. No RebalancePlans created (CRB)**
→ Causes: `enabled: false`; thresholds not met (both % AND $/mo gates); all nodes < minNodeAge; opt-in filter with zero includes; all pools excluded.
→ Diag: `helm get values castai | grep -A15 continuousRebalancing`; `kubectl get nodepool -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations}{"\n"}{end}'`; `kubectl logs -n castai-agent -l app=castai-kentroller | grep "continuous-rebalancing"`.
→ Fix config; verify next cycle logs a decision summary (temporarily `diagnosticsVerbose: true`). Rollback: disable CRB.

**8. Rebalancing stuck in Executing**
→ Causes: drain blocked by PDB/bare pods/local PVs; NodePool budgets at zero; CLM stall.
→ Diag: `kubectl describe rp <plan>` (`status.nodesDeletion` per-node events, `LiveMigration*` states); `kubectl get pdb -A`; `kubectl get migrations -A`.
→ Fix: resolve the blocker (PDB, evictionConfig, budgets). If genuinely wedged: plan execution timeout (default 1h) will fail it — then investigate `status.failurePhase` recovery path (uncordoned nodes). Rollback: not needed if recovery completed; verify no stuck cordons (`kubectl get nodes` vs `kubectl get nodeclaims`).

**9. NodeClaims stuck in provisioning**
→ Causes: ICE across all listed types; AMI/subnet/SG mismatch (NodeClass); quota.
→ Diag: `kubectl describe nodeclaim <nc>`; Kentroller `status.nodesCreation` attempt history; AWS quota console; `kubectl get uo`.
→ Fix: broaden NodePool requirements/zones; raise quota; rotate AMI family. Verify: new NodeClaim Ready. Rollback: delete the plan; Kentroller's Creation-phase rollback also deletes its fresh NodeClaims.

**10. Nodes not removed after plans complete**
→ Causes: disruption budgets re-check loop; labels; pool exclusion semantics placing new nodes into excluded pools (documented behavior!); Karpenter finalizer issues.
→ Diag: pool budgets; `kubectl get node <n> --show-labels`; pool annotation.
→ Fix: relax budgets/labels; move excluded-pool workloads deliberately. Rollback: n/a.

**11. PDB blocking eviction everywhere**
→ Causes: `maxUnavailable: 0` on single-replica workloads.
→ Diag: `kubectl get pdb -A` (ALLOWED DISRUPTIONS = 0).
→ Fix [change]: correct PDBs (replicas ≥ 2 or maxUnavailable ≥ 1), or scoped `evictionConfig.aggressive` (approval required). Verify: drain completes. Rollback: remove evictionConfig entry.

**12. Workloads Pending after provisioning**
→ Causes: taints without tolerations; shadow-pool taints inherited; zone/constraint mismatch; webhook outage (9443) blocking creation; WOOP mis-requesting.
→ Diag: `kubectl describe pod <pending>`; pool taints; `kubectl get svc,endpoints -n castai-agent | grep workload`; webhook logs.
→ Fix per cause. Verify: pods schedule. Rollback: restore tolerations/requests.

**13. Spot prediction not working (no events)**
→ Causes: feature off; no Karpenter interruption SQS queue; AKS (documented KE prediction text is AWS-centric — AKS behavior Not verified); threshold too high.
→ Diag: `kubectl get deployment -n karpenter karpenter -o yaml | grep -i queue`; prediction toggle in console Settings; `kubectl get events --field-selector reason=SpotInterruptionPredicted`.
→ Fix: configure queue + IAM; enable toggle. Verify: event appears within model horizon. Rollback: disable toggle.

**14. `UnavailableOffering` repeatedly blocking a needed type**
→ Causes: sticky local record from a transient ICE storm.
→ Diag: `kubectl get uo` (check `ATTEMPTS`, `EXPIRES`, `REASON`).
→ Fix: records expire automatically (TTL formula Not documented); if the type is business-critical and blocked stale-state long, escalate with the `uo` YAML attached. Do NOT hand-delete records without understanding — document as last-resort with CAST AI support.

**15. Workload Autoscaler not applying recommendations**
→ Causes: metrics-server absent/broken; gradual-confidence gate (24h tiers); scaling policy Automate off; whitelisting mode without labels; webhook blocked by CNI host-network requirement.
→ Diag: `kubectl top pods -A`; `kubectl get recommendations.autoscaling.cast.ai -A`; policy state; webhook logs; on custom CNI check `hostNetwork=true` (EKS Calico/Cilium documented fix) and port-conflict move `webhook.port=9444`.
→ Fix per cause. Verify: `mutating pod resources` log lines + changed requests on next pod recreation. Rollback: toggle optimization off per workload.

**16. Nodes unexpectedly replaced**
→ Causes: NodePool `expireAfter`; drift (AMI/SG/labels changed); Karpenter consolidation; Kentroller plan you forgot; commit schedule.
→ Diag: `kubectl get nodepool -o yaml | grep -i expireafter`; `kubectl get nodeclaim -o yaml | grep -A5 disruption`; `kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter --tail=100 | grep -i "disruption\|drift\|consolidat"`; `kubectl get rp --sort-by=.metadata.creationTimestamp | tail`.
→ Fix: pin the offending input. Rollback: disable drift plans (`disableDriftPlans: true`) / raise thresholds.

**17. CommitmentBudget not generating shadow pools**
→ Causes: no commitment assigned in console (most common); Kentroller < v0.1.162 (SPs omitted); controller disabled; no compatible spot-allowing pools; `InvalidPricing`; `InsufficientCommitment` (budget too small for 1 vCPU/pool).
→ Diag: `kubectl get cb` + `kubectl describe cb <name>` (condition reason); console Commitments assignment screen.
→ Fix per cause; verify `zzz-` pools within minutes of assignment. Rollback: `castai.commitmentBudgets.enabled: false` → one-time cleanup.

**18. GitOps overwriting CAST AI-managed state**
→ Causes: Argo pruning/on selfHeal fighting shadow pools, `cb` CRs, dynamicConfig ConfigMap.
→ Fix [change]: exclude `zzz-*` pools + `autoscaling.cast.ai` CRs + dynamicConfig from the app; rely on the chart's `IgnoreExtraneous` annotation; keep `prune: false`.

**19. Savings figures inconsistent between console/API/bill**
→ Causes: public-pricing basis vs your discounts (configure Price adjustments); baseline window; discount/listing toggle; double-counting realized + WA cards (Total = autoscaler only).
→ Fix: choose Discounted view, configure Price adjustments, read Ch. 14 formulas; align the period. Escalate unresolved deltas > ±10% to CAST AI with both datasets.

**20. NodePool exclusions blocking all rebalancing**
→ Causes: `nodePoolFilterMode: opt-in` set with zero `include` annotations (everything stops — documented); overzealous `exclude`.
→ Diag: annotation audit command (Ch. 6.4); `helm get values` filter mode.
→ Fix: annotate pools with `include`, restart Kentroller (static setting); or return to opt-out. Verify: next cycle produces decisions.

---

# Chapter 16 — Security and Enterprise Governance

| Domain | Controls (cited) | Practice (*Recommendation*) |
|---|---|---|
| Cloud identity | castctl-created identity; AKS: dedicated managed identity, Reader-only, federated (subject fixed) | Scenario E-style pre-creation; never reuse node roles |
| AWS permissions | Installer needs role/policy/instance-profile/SG create | Scope installer role to onboarding window; Karpenter's own provisioning IAM unchanged |
| API keys | `global.castai.apiKeySecretRef` (key `API_KEY`) [chart-verified]; secrets never in Git; External Secrets (4.D) | Org-level key, quarterly rotation; least-privilege scopes; separate keys per cluster archetype |
| K8s RBAC | Install needs cluster-admin-level create rights; runtime components use fixed SAs (`castai-kentroller`, `castai-agent`, …) | Review chart-rendered RBAC per release; gate upgrades |
| Network | Endpoint/IP allowlists (Ch. 3.3); proxy + CA patterns; webhook 9443 internal | Egress policy allowing only documented hosts; alert on new endpoints after upgrades |
| Webhooks | WOOP + kentroller TS webhook are admission path | Monitor webhook failure policy; test in staging |
| Secrets hygiene | Example: node startup uses per-node, read-only, ≤1h expiring log keys (documented) | No plaintext keys in Helm history — use `--set-file`/secrets |
| Audit | `castai-audit` namespace (helm: `castai.audit`) + console Event Log/audit view; Kentroller reports actions to CAST AI audit | Ship `castai-audit` events into your SIEM |
| Separation of duties | Read-only analysis (agent, reports) vs node-moving changes (CRB, schedules, evictionConfig, CB drainMode, CLM) | Two roles in your RACI: `castai-reader` vs `castai-operator`; destructive knobs behind change approval |
| GitOps ownership | Ch. 4.D boundaries: your Git owns pools/schedules/values; CAST AI owns synced CRs | Argo ignore lists reviewed in each upgrade |
| Change management | Features toggle dynamically via console without restarts | Require ticket + second approver for CRB mode changes, aggressive eviction, CB drainMode != off |

---

# Chapter 17 — Day-2 Operations

**Daily (5 min):** `kubectl get pods -n castai-agent`; `kubectl get rp` (failed/stuck); `kubectl get uo | wc -l` trend; console component-control health (Healthy/Warning/Disconnected + Mothership). **When CAST AI SaaS is unreachable:** Kentroller's **continuous** path keeps working locally (documented: in-cluster, local state + pricing); claim/console/API/scheduled plan generation and feature toggles need the backend; prediction needs the ML API. Expect degraded-but-safe operation: no new SaaS plans, CRB continues, Karpenter unaffected.

**Weekly:** review rp outcomes + savings telemetry (`kubectl describe rp`); evictionConfig/PDB exceptions; commit `helm get values` diffs; review `uo` reasons; check pending NodePool images/drift.

**Monthly:** FinOps report (Ch. 14.6); commitment utilization + shadow-pool audit; chart upgrade review (see below); access review (API keys, RBAC); game-day: suspend schedules (`spec.suspend: true`) then resume.

**Upgrades:** pin chart versions in GitOps; upgrade procedure = bump pin → staging → watch one CRB cycle + one scheduled plan → production. `helm upgrade castai castai-helm/castai -n castai-agent --version <pinned> --reset-then-reuse-values`. Karpenter upgrades are **your** separate track — the suite reads Karpenter CRDs; re-run the preflight expectations (≥ 1.0.0). Kentroller minimum for SP commitments = **v0.1.162** (app). Component versions: console Component control. Changelog watch: KES entries run Nov 2025 EA → May 2026 GA → Jul 2026 (latest at research).

**Feature toggling:** most features flip from the console without restarts (documented); static: `nodePoolFilterMode`, `disruptGuard` (pod restart); CLM enablement via `castai-live.controller.replicaCount` 0↔2 [chart-verified].

**Emergency rollback:** (1) `kubectl patch rps --all --type=merge -p '{"spec":{"suspend":true}}'`; (2) `helm upgrade … --set kent.castai-kentroller.castai.continuousRebalancing.enabled=false --reset-then-reuse-values`; (3) `helm uninstall castai -n castai-agent` and/or `kubectl delete namespace castai-agent` (documented off-board; nodes/pods/config remain intact); (4) commitments: `castai.commitmentBudgets.enabled: false` first — shadow pools drain to zero and delete cleanly before namespace removal.

---

# Chapter 18 — Production Adoption Strategy

| Phase | Goal | Entry criteria | Actions | Success criteria | Rollback trigger |
|---|---|---|---|---|---|
| 0 — Inventory | Know the estate | Ch. 3 checklist | Map pools/NodeClasses, workloads, PDBs, commitments, Spot usage | Written inventory + risk list | — |
| 1 — Baseline | Cost truth | Phase 0 | Connect (kent profile), **zero features on**; 7–14d data | Cost report stable; baseline established (≥14d for full reports) | Uninstall (17) |
| 2 — Non-prod validation | Mechanics proven | Phase 1 | Staging cluster: CRB drain-only, one schedule, one manual rebalance, CLM eligibility scan | Plans complete; no SLO blips | Disable CRB |
| 3 — Rightsizing | Demand down | Phase 2 | WOOP on pilot namespaces → all non-prod → prod namespaces in waves | Requests reduced; no OOM surge loops; node count follows via drain-only | Toggle off per workload |
| 4 — Conservative rebalancing | Capacity down | Phase 3 stable 2w | Prod CRB `drain-only` thresholds 20%/$100; nightly spot schedule manual-then-auto | Plans pass both gates; zero PDB incidents | CRB off; schedules suspended |
| 5 — Spot & commitments | Rate down | Phase 4 | Commitments assigned; shadow pools verified; `drainMode: off`; prediction on | Commitment util ↑; spot fallback debt shrinking via schedules | CB off; prediction off |
| 6 — Continuous optimization | Steady state | Phase 5 | CRB `full` balanced profile; evictionConfig matured; CLM on eligible pools | Sustained net savings; churn within budget | Revert to drain-only |
| 7 — FinOps handover | Operationalize | Phase 6 | Monthly template live; CUR reconciliation method agreed | CFO signs the method | — |

**Approval gates (*Recommendation*):** every phase needs (a) SLO/error-budget green for 2 consecutive weeks, (b) change ticket with exact knob diffs, (c) named rollback command pre-staged. 30/60/90: **Day 30** = Phases 0–2 done, baseline + first staging plans; **Day 60** = Phase 3–4 in production, first measured savings; **Day 90** = Phase 5–6 live, FinOps operating monthly.

---

# Chapter 19 — End-to-End Case Study (*Hypothetical, fully labeled*)

**Scenario:** "Aurora Bank" runs a production EKS cluster (K8s 1.31, self-managed Karpenter 1.5, AL2023, VPC CNI no prefix-delegation, 120 nodes avg, 40% spot) plus a dev AKS+NAP cluster. Goal: cut compute cost 20%+ without SLO risk.

*All numbers below are hypothetical illustrations of method, not CAST AI claims.*

**Week 1 — Connect + baseline.** castctl connect on both clusters (kent profile); AKS gets `azure.subscriptionID` + federated workload identity. No features enabled. Cost report flows within the hour (60s refresh documented); savings cards stay absent until day 14 (documented gate). Baseline period runs — projected==actual by design.

**Week 3 — Read-only insight.** Available-savings shows: rightsizing ~11% of requested CPU; 18% of nodes oversized by ≥2×; RI utilization 52% while spot is interrupted 6×/day on the `batch-spot` pool. First **manual rebalance** (console → Generate plan) on `web-general`: plan `DoneWithWarnings` — 9/11 nodes moved, `validatedSavings` 91% of projection, 2 nodes skipped over a 0-budget NodePool disruption window (documented gating).

**Week 4 — Non-prod + rightsizing wave.** Dev AKS: CRB `drain-only`, 15%/$50 gates. Prod: WOOP on the 20 largest Deployments (`immediate`, PDB-safe). Requests drop 12% average; OOM guard fires once (+20% overhead, decays 24h — documented).

**Week 6 — Production rebalancing.** Prod CRB `drain-only` balanced profile; nightly `rps` on spot pools (`maxNodes: 10`, `minSavingsPercentage: 15`). Week-2 metrics: 31 plans, 2 Failed (one `FailureReasonInsufficientSavings`, one drain-timeout on a legacy StatefulSet → added to evictionConfig `removalDisabled`), 24 nodes decommissioned.

**Week 8 — Commitments + CLM pilot.** Console assigns two zonal RIs + one Compute SP; three `zzz-castai-*` shadow pools appear; `CompatibleNodePools: Compatible`. RI-heavy pods migrate via plans. CLM enabled on the `stateful-standard` pool (replicaCount 0→2): 14 pods migrated with `MigrationFinished`, one `PreDumpFailed` (eBPF-heavy agent excluded via `live-migration-disabled`).

**Day 90 — Numbers (hypothetical).** Provisioned CPU −22%; effective $/vCPU-h −14% (spot stability + committed on-demand substitution); month-end: $34.1k → $26.9k (−21%); two notable incidents, zero customer-facing. **Reported net = gross − platform fee**, reconciled ±4% against CUR. Lessons encoded: NodePool budget windows before plans; stateful pool exclusions first; thresholds loosened only after 2 stable weeks.

**Reusable pattern:** Inventory → silent baseline → staging mechanics → rightsizing → drain-only → schedules → commitments → CLM/full → steady-state (this is exactly the Ch. 18 phase table with dates).

---

# Chapter 20 — Quick Reference Handbook

## 20.1 Command index

```bash
# —— Install / verify ——
helm repo add castai-helm https://castai.github.io/helm-charts && helm repo update
helm upgrade -i castai castai-helm/castai -n castai-agent --create-namespace \
  --set kent.enabled=true --set global.castai.provider=eks \
  --set global.castai.apiKey=<K> --set global.castai.apiURL=<API> --set global.castai.grpcURL=<GRPC>   # [change]
kubectl get pods -n castai-agent                                             # [read-only]
helm get values castai -n castai-agent -a                                    # [read-only] confirm nesting

# —— CRDs (kubectl get uo|rp|rpc|rps|cb) ——
kubectl get rp; kubectl describe rp <name>                                   # plan state, savings, phases
kubectl get rpc -w                                                           # claim lifecycle
kubectl get rps; kubectl patch rps <n> --type=merge -p '{"spec":{"suspend":true}}'   # suspend/resume
kubectl get cb; kubectl describe cb <name>                                   # budgets + match reasons
kubectl get uo                                                               # avoid-list
kubectl get rp,rpc,rps,uo,cb | head                                          # everything at once
kubectl logs -n castai-agent -l app=castai-kentroller --tail=200             # engine room
kubectl get migrations -A -w                                                 # CLM
kubectl get rebalancing -n castai-agent                                      # console manual-rebalance tracking CR

# —— Exclusions ——
kubectl annotate nodepool <p> kentroller.cast.ai/consolidation=exclude        # [change] pool-level
kubectl label node <n> autoscaling.cast.ai/removal-disabled=true              # [change] node-level
kubectl label node <n> autoscaling.cast.ai/removal-disabled-                  # remove

# —— Karpenter side-of-house ——
kubectl get nodepools; kubectl get nodeclaims; kubectl describe nodeclaim <nc>
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter --tail=100

# —— Emergency ——
helm upgrade castai castai-helm/castai -n castai-agent --reset-then-reuse-values \
  --set kent.castai-kentroller.castai.continuousRebalancing.enabled=false     # stop CRB
helm uninstall castai -n castai-agent                                        # full off-board
kubectl delete namespace castai-agent                                        # documented off-board step
```

## 20.2 Parameter quick reference

| Knob | Default | Where |
|---|---|---|
| CRB `enabled/mode` | false / full | `castai.continuousRebalancing` |
| `savingsThresholdPercent` (+ `$50/mo` env) | 15 (cluster-cost %) | both gates required |
| `cycleIntervalSeconds` / full 1800 / drain 60 / empty 60 | 60 base | per-mode overrides |
| `minNodeAgeSeconds` | 300 | CRB |
| `nodePoolFilterMode` | opt-out | top-level kentroller; restart |
| `preferenceWeightedPacking` / `disruptGuard` / `softTSCSpreading` / `namespaceLabeling` | true/true/false/true | `castai.rebalance.*` |
| Spot prediction / cooldown 15m / poll 1m | enabled | `castai.spotInterruptionPrediction` |
| CLM | off (`replicaCount: 0`) | `kent.castai-live.controller` + `castai.clm.enabled` |
| Commitment budgets / `drainMode` | on / off | `castai.commitmentBudgets.*` |
| Kentroller HA | 2 replicas, 1CPU/2Gi | chart |

## 20.3 Decision tree — "should my node be touched?"

```
Pool annotation kentroller.cast.ai/consolidation=exclude ? ──yes──▶ NEVER touched (all paths)
  │no (opt-out default)
  static NodePool (fixed replicas) ? ──yes──▶ never consolidated
  node label autoscaling.cast.ai/removal-disabled=true ? ──yes──▶ excluded
  consolidationPolicy=WhenEmpty ? ──yes──▶ only if empty
  disruption budget exhausted ? ──yes──▶ deletion deferred (30s re-check)
  karpenter.sh/do-not-disrupt=true ? ──yes──▶ blocked (label managed by Kentroller during active plans)
  node < minNodeAgeSeconds ? ──yes──▶ wait
  plan passes BOTH savings gates (% AND $/mo)? ──no──▶ no plan
  evictionConfig match (most restrictive wins)? ──removalDisabled──▶ never
  ──▶ ELIGIBLE for: CRB per mode | scheduled | manual | drift
```

## 20.4 Emergency runbook (one page)

1. **Stop the movers** [change]: suspend all `rps`; disable CRB (`kent.castai-kentroller.castai.continuousRebalancing.enabled=false`); console feature toggles off. Karpenter continues default safe scheduling.
2. **Assess blast radius** [read-only]: `kubectl get rp` (Executing plans → their `failurePhase` recovery), cordoned nodes vs NodeClaims, `kubectl get migrations -A`.
3. **Protect crown jewels** [change]: pool annotations to `exclude`; node labels `removal-disabled`.
4. **Commitments safety**: `castai.commitmentBudgets.enabled: false` → limits→0 → shadow pools empty out (pods unaffected; capacity just stops being steered).
5. **Full off-board** only if needed: uninstall + delete namespace (config untouched).
6. **Escalate** with the evidence bundle (Ch. 15 header).
7. **Restore** in reverse order; re-enable one feature at a time with a full cycle observed between each.

## 20.5 Glossary

**CRB** Continuous Rebalancing · **uo** UnavailableOffering (type/zone/capacity avoid-list) · **rp/rpc/rps** plan / claim / schedule · **cb** CommitmentBudget · **Shadow NodePool** Kentroller-created weight-100 `zzz-*` pool steering pods to committed capacity · **disruptGuard** Kentroller's `do-not-disrupt` management during active plans · **WOOP** Workload optimization (rightsizing) · **CLM** Container Live Migration (CRIU-based) · **drainMode** commitment over-allocation enforcement (off/safe/aggressive) · **validatedSavings** post-provision savings check value · **karpenter.sh/do-not-disrupt** native label honored by both Karpenter and Kentroller.

---

# Appendix A — Source Inventory

| # | Source | Used for | Verified |
|---|---|---|---|
| 1 | https://docs.cast.ai/docs/karpenter-enterprise | Overview, positioning, unsupported-coexistence, cost-reporting claims | yes (2026-10) |
| 2 | https://docs.cast.ai/docs/karpenter-enterprise-features | Feature deep dives, CLM/WOOP on Karpenter | yes |
| 3 | https://docs.cast.ai/docs/karpenter-enterprise-getting-started | Install, prereqs, component table | yes |
| 4 | https://docs.cast.ai/docs/karpenter-enterprise-kentroller | CRDs, env vars, plan lifecycle, consolidation | yes |
| 5 | https://docs.cast.ai/docs/karpenter-enterprise-continuous-rebalancing | CRB modes/values/exclusions/eviction | yes |
| 6 | https://docs.cast.ai/docs/karpenter-enterprise-scheduled-rebalancing | Schedules, claim template, semantic rules | yes |
| 7 | https://docs.cast.ai/docs/karpenter-enterprise-commitments | Shadow pools, CRD contract, math | yes |
| 8 | https://docs.cast.ai/docs/connect-with-castctl · /castctl-reference | castctl flows, connect/disconnect/migrate | yes |
| 9 | https://docs.cast.ai/docs/helm-charts | Umbrella/individual charts, CA secret | yes |
| 10 | https://docs.cast.ai/docs/hosted-components · /component-control | Component versions/health, tags | yes |
| 11 | https://docs.cast.ai/docs/cloud-permissions | AWS/Azure permission models | yes |
| 12 | https://docs.cast.ai/docs/communication-requirements | Egress endpoints, IPs, proxy, webhook | yes |
| 13 | https://docs.cast.ai/docs/connect-via-console | Cloud Connect, script onboarding | yes |
| 14 | https://docs.cast.ai/docs/workload-autoscaling-overview (+ configuration) | WOOP modes, confidence, OOM, HPA | yes |
| 15 | https://docs.cast.ai/docs/pod-mutations-overview (+ quickstart) | PodMutation CRD, webhook, enforcer | yes |
| 16 | https://docs.cast.ai/docs/clm-overview (+ requirements-and-limitations, getting-started) | CLM gates, TCP paths, label matrix | yes |
| 17 | https://docs.cast.ai/docs/spot · /spot-handler | Notice windows, model, drain labels, handler scope | yes |
| 18 | https://docs.cast.ai/docs/cost-management · available-savings · savings-report · savings-baseline · cost-comparison · cluster-total-compute-cost | FinOps definitions & mechanics | yes |
| 19 | https://docs.cast.ai/changelog | Timeline Nov-2025 EA → Jul-2026 | yes |
| 20 | https://api.cast.ai/v1/spec/openapi.json | Cost/savings/commitments endpoints | yes (live fetch) |
| 21 | github.com/castai/helm-charts (`castai` [dir castai-umbrella] 0.45.8, kent 0.16.0, castai-kentroller 0.27.1) | All [chart-verified] defaults/nesting | yes (chart source) |
| 22 | https://karpenter.sh/docs (upstream) | Karpenter-native semantics | yes (general) |

# Appendix B — Documentation Conflict & Gap Log

| # | Topic | Source A says | Source B(chart/other) says | Resolution used |
|---|---|---|---|---|
| 1 | CRB savings % default | Kentroller doc env `…_SAVINGS_THRESHOLD_PERCENT` default **0.0**; doc-page Helm default **15** | Chart: `savingsThresholdPercent: 15` (new key; `savingsThresholdPercentage` obsolete fallback), **cluster-cost %** | Chart value is authoritative; flag both keys |
| 2 | CRB cycle default | Env `POLLING_PERIOD` **10s** | Chart `cycleIntervalSeconds` **60s** + per-mode 1800/60/60 not in docs | Chart authoritative |
| 3 | Umbrella chart name | `castai-helm/castai` · `castai castai --repo …` · `castai/castai-umbrella` | Dir `castai-umbrella`, `name: castai` | Standardize `castai-helm/castai` |
| 4 | Kentroller Helm nesting (umbrella) | KE pages show `castai-kentroller.castai.*` | Umbrella tree = `kent.castai-kentroller.*` (matches getting-started `kent.castai-kentroller.azure.*` flags) | Print both; verify via `helm get values` |
| 5 | Kentroller log label | `-l app=castai-kentroller` | `-l instance=castai-kentroller` elsewhere | Use `app`; instance is a Helm release label variant |
| 6 | evictionConfig node matcher | docs page: `nodeSelector.labelSelector` | chart comment: `nodeSelectorTerm.labelSelector` | **Unverified divergence** — dry-run before broad apply |
| 7 | Spot prediction horizon | KE pages "**up to 30 min**" | spot page "1h AWS / 3h GCP" + "180 minutes window" | Plan for ≤30 min; rest uncommitted |
| 8 | Spot Handler role | KE overview: "manages lifecycle and fallback recovery" | spot-handler page: monitoring-only; fallback recovery "planned" | Monitoring-only; recovery future |
| 9 | OOM overhead floor | text: max(20%, **100Mi**) | same-page diagram: min **500Mi** | Quoted both; flagged |
| 10 | Helm minimum | v3.0+ (getting-started) | **v3.14.0+** (helm-charts, `--reset-then-reuse-values`) | 3.14 |
| 11 | Realized savings on KE | KE pages: "works identically" | 6 FinOps pages: no Karpenter clause; mechanics autoscaler-defined | **GAP** — Ch. 14.3 protocol |
| 12 | Available-savings categories | read-only vs managed only | KE read-only/managed unnamed | Flagged |
| 13 | CLM "zero downtime" | KE pages promise | CLM page: "application is briefly paused"; Spot preemption can't be guaranteed | Frame as best-effort/eligible workloads |
| 14 | castctl pin-version install | docs show snippet | snippet broken/duplicated in docs | Not verified — don't promise |
| 15 | Update channels / auto-update policy | no channel concept in docs | `castai-chart-upgrader` comp exists (off); "self-updating Helm releases" changelog (May 2026, off by default) | Flagged; pin versions in GitOps |
| 16 | Private cluster connectivity (PrivateLink/PSC for KE) | pages exist generally | KE-specific guidance absent | Confirm with CAST AI |
| 17 | Hosted vs in-cluster matrix | implied | no single authoritative list | Derived; flagged |
| 18 | `uo` record TTL/backoff formula | "expiresAt", "attempts extend backoff" | no formula/TTL documented | Escalation-only removal guidance |
| 19 | Kent selector for preflight logs | docs examples differ | both exist in the wild | Use the Completed-pod/job-name form |
| 20 | Costs endpoint schemas | endpoints verified live | field-level `/savings` schema not probed | Not verified |

*End of handbook. Maintainer: review quarterly against https://docs.cast.ai/changelog and umbrella chart releases.*

---

**Handbook complete — 20 chapters + 2 appendices.** Status policy: facts marked *Not documented / Not verified* inside are intentional gaps in CAST AI's public documentation, not omissions of this guide.





