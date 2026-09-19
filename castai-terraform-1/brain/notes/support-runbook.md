# Cast AI EKS Onboarding Support Runbook

## Quick Diagnostics

### 1. Terraform init fails
- Check backend.hcl exists and S3 bucket/region/dynamodb are correct.
- Verify AWS credentials have access to the S3 backend.
- Run: `terraform init -backend-config=backend.hcl`

### 2. `CONFIG_MAP` authentication error
- Cause: EKS cluster uses legacy `CONFIG_MAP`-only auth.
- Fix: Migrate to `API` or `API_AND_CONFIG_MAP`.
- Command: `aws eks update-cluster-config --name <cluster> --access-config authenticationMode=API_AND_CONFIG_MAP`
- Reference: https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html

### 3. VPC / subnet validation error
- Subnets must belong to the EKS cluster VPC.
- Subnets must have `map_public_ip_on_launch = false`.
- Security groups must belong to the EKS cluster VPC.
- Use private worker subnets with outbound NAT/internet.

### 4. Helm timeout / EKS connection error
- Terraform runner must reach the EKS API endpoint.
- Run: `aws eks get-token --cluster-name <cluster> --region <region>`
- If private endpoint only, run Terraform from inside the VPC.

### 5. Cluster not showing ready in CAST AI console
- Check agent pods: `kubectl get pods -n castai-agent`
- Check agent logs: `kubectl logs -n castai-agent deployment/castai-agent`
- Verify `castai_api_token` has permission to onboard.
- Check outputs: `terraform output castai_cluster_id`

### 6. Spot not being used
- Verify `spot = true` in node template constraints.
- Verify `use_spot_fallbacks = true` for fallback.
- Check instance type availability and Spot capacity in the region.
- Review workload labels/taints preventing Spot placement.

### 7. Nodes not scaling down
- Check evictor enabled and not in dry_run.
- Check `node_grace_period_minutes` and `delay_seconds`.
- Check pod disruption budgets.
- Check for pods with `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`.

### 8. Cluster controller 401 after cluster token rotation
- **Cause**: `POST /v1/kubernetes/external-clusters/{clusterId}/token` rotates the token on the CAST AI API side, but the in-cluster secrets still hold the old token. In **per-component secrets** topology (default for Terraform full install), each CAST AI component has its own secret; the most commonly missed one is `castai-cluster-controller`, which is shared by `castai-cluster-controller`, `castai-workload-autoscaler`, `castai-evictor`, and `castai-spot-handler`.
- **Why read-only clusters seem fine**: they have no active control-plane component calling back to the CAST AI API with that token, so fewer secrets need updating.
- **Delayed failure**: the old token is **not synchronously revoked**. It can continue to authenticate for ~60 minutes after rotation, which is why the cluster may initially look healthy.
- **No revoke endpoint**: CAST AI does not expose a cluster-token revoke endpoint. The only API-side way to invalidate the old token is to disconnect/delete the cluster. In practice, rotate, update every secret, and restart every workload.
- **Terraform-installed cluster secrets to update**:
  - `castai-agent`
  - `castai-cluster-controller`
  - `castai-kvisor`
  - `castai-pod-pinner`
  - `live-api-key`
- **Fix**:
  1. Rotate via `POST /v1/kubernetes/external-clusters/{clusterId}/token`.
  2. Update every API-key secret:
     ```bash
     for secret in castai-agent castai-cluster-controller castai-kvisor castai-pod-pinner live-api-key; do
       kubectl create secret generic "$secret" -n castai-agent \
         --from-literal=API_KEY="<NEW_TOKEN>" \
         --dry-run=client -o yaml | kubectl apply -f -
     done
     ```
  3. Restart components:
     ```bash
     kubectl rollout restart deployment -n castai-agent \
       castai-agent castai-cluster-controller castai-kvisor-controller \
       castai-live-controller castai-pod-pinner castai-workload-autoscaler
     kubectl rollout restart daemonset -n castai-agent \
       castai-kvisor-agent castai-spot-handler
     ```
- **Verify**: check that controller logs no longer show `401 Authorization Required` and the CAST AI console no longer reports “Cluster controller not responding”.
- **Topology check**:
  ```bash
  helm get values castai-agent -n castai-agent | grep -i apiKey
  kubectl get secrets -n castai-agent | grep -E 'castai|live|api-key'
  ```

## Customer Response Template

```
Hi [Name],

Thanks for reaching out. I investigated [issue] and here is what I found:

**Root cause:** [concise explanation]

**Next steps:**
1. [step]
2. [step]

**Command to verify:**
```
[command]
```

Let me know the output or if you need me to join a call.

Best,
[Engineer]
```

## Escalation Path
- Engineering bug with provider/module → collect `terraform version`, provider versions, sanitized plan/logs, cluster ID, open Jira with `castai-terraform` component.
- Security/incident → escalate immediately with cluster ID and timeline.
