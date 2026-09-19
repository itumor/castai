# Reply to Glejn — CAST AI cluster token rotation 401 issue

**To:** Glejn
**Subject:** Re: Cluster token rotation issue on `ngm-sim2-eks` — root cause, explanation, and fix procedure

---

Hi Glejn,

Thanks for the thorough report — the cluster names, timestamps, and exact error output made it straightforward to reproduce and root-cause this.

Short answer first: **no additional permissions or extra API calls are required.** The `POST /v1/kubernetes/external-clusters/{clusterId}/token` endpoint behaves the same for read-only and full-autoscaling clusters. The difference you observed is on the in-cluster side, and we've verified both the root cause and the fix end-to-end.

## Root cause

CAST AI components authenticate to our API using an `API_KEY` stored in Kubernetes secrets. Depending on how the cluster was installed, that key lives in either a single shared secret or in **separate per-component secrets**. `ngm-sim2-eks` uses the per-component layout, where the key must be identical across several secrets:

- `castai-agent`
- `castai-cluster-controller` ← shared by `castai-cluster-controller`, `castai-workload-autoscaler`, `castai-evictor`, and `castai-spot-handler`
- `castai-kvisor`
- `castai-pod-pinner`
- `live-api-key`

When you rotated the token, the API-side value changed, but the secrets in the cluster still held the previous token. The `401 Authorization Required` from `cluster-controller` is the component trying to register with that stale secret. `ngm-sim3-eks` didn't surface the problem because read-only mode only runs the agent — there is simply only one secret to keep in sync.

## Why the failure appeared delayed

One important detail we confirmed in testing: rotating the token does **not** synchronously invalidate the previous one. The old token continued to authenticate for at least **60 minutes** after rotation in our tests. That's why your cluster looked healthy right after rotation (last event ~10:25) and only failed later — the components kept working on the still-valid old token until it was finally invalidated, at which point the stale secrets caused the 401s.

## Answering your questions directly

1. **Does the `/token` endpoint require additional steps or permissions for autoscaling/rebalancing clusters?**
   No new permissions on the API side. The one additional step is in-cluster: every secret holding the CAST AI API key must be updated to the new token.

2. **Can the old token be revoked explicitly?**
   There is no revoke endpoint for cluster tokens; rotation is the only available operation. Disconnecting/deleting the cluster in CAST AI would invalidate it, but that is far heavier than needed. Updating all secrets and restarting the workloads achieves the same practical result.

## Fix procedure (Terraform-installed cluster)

After calling `POST /v1/kubernetes/external-clusters/{clusterId}/token`, run the following against the cluster:

**Step 1 — update every API-key secret:**

```bash
NEW_TOKEN="<token returned by the /token call>"

for secret in castai-agent castai-cluster-controller castai-kvisor castai-pod-pinner live-api-key; do
  kubectl create secret generic "$secret" \
    -n castai-agent \
    --from-literal=API_KEY="$NEW_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f -
done
```

**Step 2 — restart all components so they reload the secret:**

```bash
kubectl rollout restart deployment -n castai-agent \
  castai-agent \
  castai-cluster-controller \
  castai-kvisor-controller \
  castai-live-controller \
  castai-pod-pinner \
  castai-workload-autoscaler

kubectl rollout restart daemonset -n castai-agent \
  castai-kvisor-agent \
  castai-spot-handler
```

**Step 3 — verify no component is still failing auth:**

```bash
for component in castai-agent castai-cluster-controller castai-workload-autoscaler; do
  echo "--- $component ---"
  kubectl logs -n castai-agent deployment/$component --tail=50 2>/dev/null \
    | grep -i "401 Authorization Required" || echo "clean"
done
```

Once the pods are back up, the console should drop the "Cluster controller not responding" state and rebalancing will function again.

If you're unsure which layout a cluster uses, this will show you quickly:

```bash
kubectl get secrets -n castai-agent | grep -E 'castai|live|api-key'
```

## How we validated this

We reproduced and fixed this scenario across the three common install paths:

1. **Per-component secrets** — deliberately leaving `castai-cluster-controller` stale reproduced your exact symptom; updating all secrets resolved it.
2. **`castctl cluster connect` install** — single `castai-credentials` secret; one update and restart left the cluster fully `ready`/`online` with zero 401s.
3. **Terraform module install** — the five secrets listed above; after updating all of them, cluster status returned to `ready`/`online` with zero 401s.

We're also feeding this back internally — the token-rotation flow should not require customers to discover the secret topology themselves, so we're tracking an improvement to make rotation update the in-cluster secrets automatically (or document the required steps prominently). I'll make sure you're notified once that ships.

## Summary

- No extra API permissions are needed for autoscaling/rebalancing clusters.
- The 401 was caused by the stale `castai-cluster-controller` secret after rotation.
- The old token stays valid for roughly an hour, which explains the delayed failure.
- The fix is a 3-step procedure: update all five API-key secrets, restart the components, verify the logs.

Let me know once you've applied the procedure — happy to confirm the cluster state from our side, or jump on a call if you'd prefer to run through it together.

Best regards,
Ebrahim
CAST AI Support
