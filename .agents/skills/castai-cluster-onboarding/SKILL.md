---
name: castai-cluster-onboarding
description: Diagnose CAST AI cluster onboarding and connectivity for EKS, GKE, AKS, and castctl. Use for cluster connect failures, agent Not responding, AWS IAM or IRSA AccessDenied, permission boundaries, cross-account trust, Kvisor permissions, and read-only to automation readiness.
---

# CAST AI cluster onboarding / IAM

## Procedure
1. Identify **provider, cluster, environment, region, CAST AI organization/API region, requested mode** (monitoring-only, node, workload, or full), installed versions and exact error stage.
2. Map stage: cloud discovery → registration → IAM/cloud integration → Helm components → agent connectivity → readiness → enablement. Do not conflate a successful agent install with operational autoscaler readiness.
3. For `AccessDenied`, inspect error principal, operation, target resource, policy evaluation and boundary/SCP implications. Distinguish who is running castctl, cross-account role, node instance profile, and per-service-account IRSA roles.
4. Distinguish permissions missing from a role versus blocked by permission boundary, SCP, or failed trust conditions. Do not propose bypassing organization controls; route blocked role creation to authorized IAM owners.
5. Validate Kubernetes agent health, version, service account annotations (metadata only), installation mode, and AWS-side evidence using authorized read-only APIs.
6. Document customer-approved remediation path: existing-role configuration **only if supported by current castctl flags/docs**, IAM owner provisioning, updated trust/policies, or GitOps/Terraform changes. Verify exact flags with `castctl cluster connect --help` and official docs; never fabricate a `--role-*` flag.
7. Provide post-fix validations: agent healthy, cluster connected, correct feature mode, policy readiness, and non-production readiness checks before enabling automation.

## Safe checks (adjust before use)
```sh
castctl version
castctl cluster connect --help
kubectl config current-context
kubectl -n castai-agent get pods
kubectl -n castai-agent get serviceaccounts
kubectl -n castai-agent logs -l app.kubernetes.io/name=castai-agent -c agent --since=30m --tail=200
aws sts get-caller-identity
```
Review IAM role policies and organization boundaries only with authorized *read-only* access. ServiceAccount listings do not prove AWS permissions. Never ask a user to paste access keys or secret tokens.

## Modes and caveats
- A successful **read-only** connection does not enable node or workload mutation.
- `castctl cluster import-config` **creates** CAST AI node configurations/templates on confirmation; it is not a pure dry-run. Prefer `--file plan.yaml` for review, using current documented options.
- Onboarding operations and IAM creation are changes; obtain explicit approval before running them.

## Output
**Stage where it fails** / **Observed error** / **Principal and permission implicated** / **Non-mutating verification** / **Owner for change** / **Post-change validation**.

## References
- [castctl connect](https://docs.cast.ai/docs/connect-with-castctl)
- [castctl reference](https://docs.cast.ai/docs/castctl-reference)
- [Cloud permissions](https://docs.cast.ai/docs/cloud-permissions)
- [Onboarding troubleshooting](https://docs.cast.ai/docs/cluster-onboarding-troubleshooting)
- [Import cluster configuration](https://docs.cast.ai/docs/castctl-import-cluster-configuration)
