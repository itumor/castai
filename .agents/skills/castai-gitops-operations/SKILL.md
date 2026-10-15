---
name: castai-gitops-operations
description: Troubleshoot CAST AI Helm, Terraform, Argo CD, Flux, chart/component versions, castctl deployment ownership, Kubernetes configuration drift, and safe upgrades or rollbacks in GitOps-managed clusters.
---

# CAST AI GitOps, Helm and Terraform support

## Procedure
1. Determine authoritative owner of each CAST AI resource: Argo CD/Flux Git repo, Helm direct release, Terraform, or castctl. Never suggest an imperative edit to a GitOps-managed object as the permanent fix.
2. Inventory release/umbrella chart mode and component versions; confirm cluster/provider compatibility in current release/docs.
3. Inspect deployment status, readiness events, chart settings, configuration drift and component-level errors. Redact sensitive Helm values, Secrets, kubeconfigs and Terraform state before sharing.
4. For mode switches, identify installed and missing components and cloud/IAM prerequisites. Switching from read-only to node/full mode is operationally significant.
5. For upgrade/migration, review change log, CRD/schema changes, chart migration instructions, `preDeleteHook`/finalizer considerations, reconciliation order, disruption risk, and reversibility.
6. Present Git diff or plan as a proposal; ensure only one controller owns each resource, and test in non-production first. Never run `helm upgrade`, `terraform apply`, Argo CD sync, uninstall, or destructive cleanup without explicit approval.
7. Post-change validation (after authorized execution): compare desired vs live, pod readiness, agent connection, metrics, node/WAS behavior and rollback trigger.

## Safe inspection examples
```sh
helm list -A
helm status castai -n castai-agent
kubectl -n castai-agent get deployments
kubectl -n castai-agent get events --sort-by=.metadata.creationTimestamp
kubectl -n castai-agent get pods -o wide
```
Check release/namespace values first. Helm, GitOps and Terraform outputs can contain secrets; do not publish raw manifests, state or `helm get values` output.

## GitOps change proposal format
`Repository/path` → `Current mode and version` → `Suggested diff` → `Cloud permission prerequisite` → `Rollout order` → `Validation and rollback` → `Human approval gate`.

## References
- [Helm charts](https://docs.cast.ai/docs/helm-charts)
- [EKS via GitOps](https://docs.cast.ai/docs/terraform-provider-eks)
- [castctl reference](https://docs.cast.ai/docs/castctl-reference)
- [Changelog](https://docs.cast.ai/changelog)
