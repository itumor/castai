# Chapter 9 — GitOps & Infrastructure as Code

Sources: [EKS GitOps](https://docs.cast.ai/docs/terraform-provider-eks) · [GKE](https://docs.cast.ai/docs/terraform-provider-gke) · [AKS](https://docs.cast.ai/docs/terraform-provider-aks) · [Helm charts](https://docs.cast.ai/docs/helm-charts) · [Configuration → ArgoCD compatibility](https://docs.cast.ai/docs/workload-autoscaling-configuration#argocd-compatibility) · [Terraform provider](https://docs.cast.ai/docs/terraform-provider) · [APA runbook: sync WAS recommendations to Git](https://docs.cast.ai/docs/apa-runbook-sync-workload-autoscaler-recommendations)

## 9.1 Ownership split (what lives where)

| Layer | Managed by | Notes |
|---|---|---|
| Cluster registration, cloud IAM, node configs/templates | **Terraform** (CAST AI provider) | EKS: `castai_eks_cluster`, `aws_iam_policy`, EKS access entries |
| CAST AI components (evictor, cluster-controller, WAS, exporter, pod-pinner) | **Argo CD / Flux** Helm releases from `https://castai.github.io/helm-charts` | Docs' recommended split |
| `castai-agent` | its own Terraform `helm_release` | self-updating → keep OUT of Argo |
| Scaling policies | Terraform `castai_workload_scaling_policy` (full rules support **provider v7.58.3+**) or API/console | pick ONE control plane |
| Workload-level overrides | annotations in your app manifests | vertical = field-level; horizontal = full-object override |

Example layout: TF module writes a `kubernetes_secret` (sensitive: `clusterID`, `apiKey`) consumed as Helm values by the Argo-managed components; `install_agent = false` in TF so Argo alone owns the component charts.

## 9.2 Argo CD specifics

- Set `application.resourceTrackingMethod: annotation+label` (or `label`) — **annotation** tracking + WAS admission annotations can overload the K8s API on >100k-pod deployments ([documented issue](https://docs.cast.ai/docs/workload-autoscaling-configuration#argocd-compatibility)).
- Pin chart versions; diffs of CRs (`recommendations.autoscaling.cast.ai`) should be **ignored** in Argo (`ignoreDifferences`/exclude the CRD) — they're cluster-state, not desired-state.
- Prerequisites before enabling WAS via GitOps: CRDs installed, webhook reachable, mode tags consistent with TF (`tags.workload-autoscaler=true` or `tags.full=true`).

## 9.3 The resource-drift problem (real, and solvable)

GitOps controllers revert `resources:` fields in app manifests; WAS mutates them at admission → **perpetual diff war**. Options, in order of preference:

1. **Remove `resources` from Git** for WAS-managed workloads (let the webhook own them; keep them only where WAS is off).
2. **Sync recommendations back to Git automatically** — CAST AI ships an APA runbook that syncs WAS recommendations into Git manifests ([runbook doc](https://docs.cast.ai/docs/apa-runbook-sync-workload-autoscaler-recommendations)) so desired state tracks optimized reality.
3. Argo CD `ignoreDifferences` on `/spec/template/spec/containers/*/resources` for opted-in workloads (blind spot: you no longer see real drift for those fields).
4. Kustomize/Helm patterns that template `resources` per environment and accept WAS winning at runtime (document the choice in-repo).

Never run both "Git owns resources" and "WAS automation on" for the same workload — pick per workload and record it (e.g. a repo `OPTIMIZATION.md` or labels).

## 9.4 Config-as-code for policies

Terraform (preferred in docs for reproducibility):
```hcl
resource "castai_workload_scaling_policy" "web" {
  cluster_id = castai_eks_cluster.this.id
  name       = "standard-web"
  # vertical settings; assignment rules (regex support: provider >= v7.58.3)
}
```
- Keep **one** system of record for policy CRUD: Terraform OR console OR API scripts — mixing causes silent overwrites.
- Version-pin the CAST AI provider; review `terraform plan` diffs for policy changes like code.
- API alternative: `CreateWorkloadScalingPolicy` / `Update…` / `SetScalingPoliciesOrder` / `AssignScalingPolicyWorkloads` (Ch. 14) for pipeline-driven management.

## 9.5 Guardrails against config accidents

- Webhook availability is critical: monitor `castai-workload-autoscaler` deployment health; alert on webhook timeouts (Ch. 12).
- `helm upgrade` changes umbrella-wide: use `--reset-then-reuse-values` and pinned `--version` for config-only changes (Ch. 2.6).
- HPA manifests in Git vs WAS ownership: if WAS takes ownership, delete the HPA manifest from Git (or mark it ignored) — otherwise GitOps fights WAS-managed HPAs.
- Change review: policy edits = prod-impacting; require PR review + staged rollout (Ch. 15 phases).
