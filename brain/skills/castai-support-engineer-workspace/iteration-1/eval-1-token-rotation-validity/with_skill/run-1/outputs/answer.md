# Reply to Glejn — token rotation: old token validity window and revocation

**To:** Glejn
**Subject:** Re: Cluster token rotation — how long the old token stays valid, and revoking it

---

Hi Glejn,

Answering your two questions directly.

## (a) How long does the old token keep working after a rotation?

Rotating the cluster token — whether through the console or via `POST /v1/kubernetes/external-clusters/{clusterId}/token` — issues a new token but does **not** synchronously invalidate the previous one. Both tokens authenticate during an overlap window.

Two important caveats on the exact duration:

- CAST AI does **not document a fixed TTL** for the old token. There is no contractual "it works for N minutes" value we can point you at.
- What we can share is empirical: in our own end-to-end testing, the previous token kept authenticating successfully for **at least 60 minutes** after rotation. Treat that as an observed lower bound from our testing, not a guaranteed window, and don't build runbooks around a specific number.

What this means for your zero-downtime requirement: the overlap window is on your side. The safe procedure is **rotate → update every secret that stores the token → roll-restart the components** — never restart a component before its secret has been updated. If you follow that order, components always hold a valid token and there is no auth gap.

One reassurance on "downtime": even if a CAST AI component briefly fails to authenticate, your running workloads are not affected — pods keep running; only autoscaling/optimization pauses until the component reconnects.

This overlap also explains the symptom you reported: right after the console rotation the cluster kept working because the still-valid old token covered the stale secrets. The `401 Authorization Required` lines only started once the old token finally stopped being accepted — at which point the components whose Kubernetes secrets were never updated had no valid credential left.

## (b) Can the old token be revoked immediately via an endpoint?

No — there is no public revoke endpoint for cluster tokens. We verified this today against the current CAST AI OpenAPI spec (<https://api.cast.ai/v1/spec/openapi.json>): the only cluster-token operation exposed is

```
POST /v1/kubernetes/external-clusters/{clusterId}/token
```

"Returns cluster token that is used for agent and cluster controller" — see <https://docs.cast.ai/reference/externalclusterapi_createclustertoken>. There is no DELETE/revoke method on that path, and no revoke endpoint anywhere else in the public API.

Two things not to confuse it with:

- **Organization API access keys** (`/v1/auth/tokens`) are a different credential type and *can* be deleted (`DELETE /v1/auth/tokens/{id}`), but they are for management-API automation only — the agent and cluster controller cannot use them as a substitute for the cluster token. See <https://docs.cast.ai/docs/api-access>.
- The only server-side action that **guarantees** a cluster token stops working is removing the cluster record itself (`DELETE /v1/kubernetes/external-clusters/{clusterId}`, i.e. disconnect/delete the cluster from the CAST AI console). That is far heavier than needed for a routine rotation — it removes the cluster from CAST AI entirely.

Practical guidance:

- **Routine rotation:** no revocation is needed. Once every secret holds the new token and all components have restarted, nothing uses the old token anymore, and it stops being accepted on its own shortly afterwards.
- **Suspected compromise of the old token:** there is no self-service kill-switch. Guaranteed invalidation requires disconnecting/re-onboarding the cluster — if you ever suspect the old token has leaked, flag it to us immediately and we will coordinate that with you to keep disruption minimal.

## Recommended zero-downtime rotation procedure

For your per-component install (secrets `castai-agent`, `castai-cluster-controller`, `castai-kvisor`, `castai-pod-pinner`, `live-api-key` in namespace `castai-agent`):

```bash
# 1. Rotate (console, or API) and capture the new token
NEW_TOKEN=$(curl -sS -X POST \
  -H "X-API-Key: $CASTAI_API_KEY" -H "Accept: application/json" \
  "https://api.eu.cast.ai/v1/kubernetes/external-clusters/$CLUSTER_ID/token" | jq -r '.token')

# 2. Update EVERY secret before restarting anything
for secret in castai-agent castai-cluster-controller castai-kvisor castai-pod-pinner live-api-key; do
  kubectl create secret generic "$secret" -n castai-agent \
    --from-literal=API_KEY="$NEW_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f -
done

# 3. Roll-restart all components (each picks up a valid token)
kubectl rollout restart deployment -n castai-agent \
  castai-agent castai-cluster-controller castai-kvisor-controller \
  castai-live-controller castai-pod-pinner castai-workload-autoscaler
kubectl rollout restart daemonset -n castai-agent castai-kvisor-agent castai-spot-handler
```

Verify afterwards that the 401s are gone, including from the agent that is currently logging them:

```bash
kubectl logs -n castai-agent deployment/castai-agent --tail=100 | grep -c "401 Authorization Required"
# Expected: 0 (and likewise for castai-cluster-controller, castai-workload-autoscaler, ...)
```

The cluster should return to `status=ready` / `agentStatus=online` in the console shortly after. This is the same procedure we validated end-to-end on three install layouts (per-component secrets, `castctl`, and Terraform module) with zero post-rotation 401s.

Happy to confirm the cluster state from our side once you've run the update, or jump on a call to run through it together.

Thanks,
Ebrahim
CAST AI Support
