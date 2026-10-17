# Chapter 2 — Installation & Onboarding

Sources: [Helm charts](https://docs.cast.ai/docs/helm-charts) · [Connecting your cluster](https://docs.cast.ai/docs/connecting-your-cluster) · [Configuration](https://docs.cast.ai/docs/workload-autoscaling-configuration) · [Anywhere getting started](https://docs.cast.ai/docs/cast-ai-anywhere-getting-started) · [castctl reference](https://docs.cast.ai/docs/castctl-reference) · [K8s permissions](https://docs.cast.ai/docs/kubernetes-permissions) *(EKS/GKE/AKS GitOps pages verified at index level — command shapes below follow the umbrella-chart doc)*

## 2.1 Prerequisites

| Requirement | Value | Source |
|---|---|---|
| Kubernetes | **≥ 1.18** (WAS); **1.33+** for in-place resize; **1.34+** for PSI stall metrics | [Overview](https://docs.cast.ai/docs/workload-autoscaling-overview) |
| Cluster mode | **Automated optimization mode** — the cluster controller must be able to create Recommendation CRs | Overview → Getting started |
| metrics-server | Installed and healthy (K8s usage metrics input) | Overview → Troubleshooting |
| Helm | **v3.14.0+** if using `--reset-then-reuse-values` | Configuration → Upgrading |
| CAST AI access | Console account / API key for script or castctl onboarding | Connecting your cluster |

## 2.2 Operating modes (umbrella chart tags) — verified semantics

The umbrella chart `castai-helm/castai` selects components via **Helm tags** ([helm-charts](https://docs.cast.ai/docs/helm-charts)):

| Mode tag | Workload rightsizing | Node provisioning | Requires | Purpose |
|---|---|---|---|---|
| `readonly` | No (visibility only) | No | Nothing | Cost visibility + security telemetry; evaluation mode |
| `workload-autoscaler` | **Yes** | No | No cloud IAM/Terraform | Rightsizing only |
| `node-autoscaler` | No | Yes | Terraform for cloud IAM | Node provisioning, bin-packing, spot, Container Live Migration |
| `full` | Yes | Yes | Terraform for cloud IAM | Both, combined |

Mode switch is a tag flip in one `helm upgrade` (e.g. readonly → full: `--set tags.readonly=false --set tags.full=true`).

## 2.3 Install paths

### A. Console onboarding (most common)
Cluster → Connect → choose provider/method → run the generated script (installs agent +, when WAS selected, `castai-workload-autoscaler` + `-exporter` + Recommendation CRDs automatically). Verify on the **Workload Autoscaler → Optimization** page.

### B. castctl
```shell
castctl cluster connect --provider <eks|gke|aks> ...   # see castctl reference
castctl component enable workload-autoscaler --cluster-id <id>   # command names per castctl reference
```
*(Exact subcommands: follow [castctl command reference](https://docs.cast.ai/docs/castctl-reference); do not guess flags.)*

### C. Helm (umbrella chart) — workload autoscaler only, no Terraform needed
```shell
helm repo add castai-helm https://castai.github.io/helm-charts && helm repo update
helm upgrade -i castai castai-helm/castai -n castai-agent --create-namespace \
  --set tags.workload-autoscaler=true \
  --set agent.apiKey="<API_KEY>"  # or use a pre-created secret; see helm-charts doc for the exact value key
```

### D. Terraform
Use the CAST AI Terraform provider to register the cluster + IAM, then install the umbrella chart with the mode tags (full per-provider walkthroughs: [EKS](https://docs.cast.ai/docs/terraform-provider-eks) · [GKE](https://docs.cast.ai/docs/terraform-provider-gke) · [AKS](https://docs.cast.ai/docs/terraform-provider-aks)). Scaling policies themselves are managed by the `castai_workload_scaling_policy` resource (full assignment-rule support requires provider **v7.58.3+**).

### E. Argo CD / EKS GitOps
Recommended pattern from the docs (`terraform-provider-eks`, "Creating the ArgoCD GitOps repository"):

1. **TF module** creates: CAST AI node configurations/templates, `aws_iam_policy`, EKS Access Entry + policy association, `castai_eks_cluster` registration, and the **`castai` Helm release for everything except the self-updating agent**, **plus** `castai-agent` as its own `helm_release` (self-updating, so excluded from Argo).
2. **Argo app** owns: evictor, cluster-controller, workload-autoscaler, workload-autoscaler-exporter, pod-pinner as Helm charts from `https://castai.github.io/helm-charts`, with values `clusterID + apiKey` sourced from a `kubernetes_secret` written by TF (sensitive).
3. Set Terraform `install_agent = false` so only Argo manages those components.

⚠️ Known Argo CD issue ([Configuration → ArgoCD compatibility](https://docs.cast.ai/docs/workload-autoscaling-configuration#argocd-compatibility)): with deployments >100k pods, Argo CD `application.resourceTrackingMethod: annotation` can hammer the K8s API because the WAS adds tracking annotations during admission; set it to `annotation+label` or `label`.

## 2.4 Post-install verification

```shell
# Components (WAS runs 2 replicas since v0.30.0)
kubectl get pods -n castai-agent -l app.kubernetes.io/name=castai-workload-autoscaler
kubectl get pods -n castai-agent -l app.kubernetes.io/name=castai-workload-autoscaler-exporter

# CRDs present (= optimization available)
kubectl get crd recommendations.autoscaling.cast.ai recommendationconfigs.autoscaling.cast.ai

# Webhook registered + config
kubectl get mutatingwebhookconfigurations | grep -i castai
kubectl rollout status deployment/castai-workload-autoscaler -n castai-agent

# Metrics pipeline
kubectl logs -n castai-agent -l app.kubernetes.io/name=castai-workload-autoscaler-exporter --tail=50
kubectl get apiservice v1beta1.metrics.k8s.io   # metrics-server registered

# First recommendations (up to 30 min)
kubectl get recommendations.autoscaling.cast.ai -A
```

## 2.5 Enable optimization ≠ install

Installing gives **recommendations only** until you enable automation: per workload in console, or via scaling policy (`optimization: on`), or annotation `vertical.optimization: on`. Gradual-scaling protections apply automatically for clusters <24h old (Chapter 1.6).

## 2.6 Upgrades

```shell
helm repo update castai-helm
helm list -n castai-agent                        # note current chart version
helm upgrade castai castai-helm/castai -n castai-agent --reset-then-reuse-values   # Helm ≥3.14
```

- **Config-only change:** pin the current chart `--version <x>` so no component versions move.
- **Upgrade with self-test** (validates reconciliation loop + admission webhook):
  ```shell
  helm upgrade castai castai-helm/castai -n castai-agent --reset-then-reuse-values \
    --set autoscaler.castai-workload-autoscaler.test.enabled=true
  # Anywhere clusters use the autoscaler-anywhere.* prefix instead of autoscaler.*
  ```
  ⚠️ The agent must not be upgrading at the same time; run Helm tests with `--cleanup` during scheduled maintenance and don't run them concurrently with other Helm tests on the same components.
- **High-load clusters:** bump WAS memory (example from docs: `resources.limits.memory=5Gi`, `requests.memory=5G`).
- Rollback: `helm history castai -n castai-agent` → `helm rollback castai <REVISION> -n castai-agent` → `helm uninstall castai-agent-workload-autoscaler-tests -n castai-agent` if test leftovers → `kubectl rollout status`. Rollback restores the chart, **not** workload requests — workloads keep their last applied values.

## 2.7 Cloud-specific notes

| Platform | Notes |
|---|---|
| **EKS** | Standard path. WAS webhook + Eviction API; no special enforcer handling. |
| **AKS** | WAS v0.74.1+ handles AKS **Admissions Enforcer**: sets `admissions.enforcer/disabled: "true"` on its webhook (value `webhook.aksAdmissionsEnforcerDisabled`, default `auto`). To revert, remove the label and run the `aks-linux-sizing-webhook` `RestoreTool`. |
| **GKE** | Standard + Autopilot supported ([documented limitations](https://docs.cast.ai/docs/workload-autoscaling-overview#gke-autopilot)). |
| **Anywhere** (bare metal/on-prem/edge/Autopilot) | Component config under the `autoscaler-anywhere.*` prefix; onboarding via [cast-ai-anywhere-getting-started](https://docs.cast.ai/docs/cast-ai-anywhere-getting-started). No node provisioning — WAS only. |

## 2.8 Whitelisting mode (opt-in instead of opt-out)

By default, once enabled, WAS optimizes broadly (opt-out via `vertical.optimization: off`). **Whitelisting mode** (v0.51.0+, agent v0.81.0+) flips it: only workloads labeled `workloads.cast.ai/optimization-enabled: "true"` (on the controller or namespace) are optimized. Enable on the WAS Helm release with value `optimizationMode: whitelist`, label targets with kubectl, verify via console. Docs warn the label-only approach is preferable to the unsupported `workload-autoscaler.cast.ai/ignore` label.
