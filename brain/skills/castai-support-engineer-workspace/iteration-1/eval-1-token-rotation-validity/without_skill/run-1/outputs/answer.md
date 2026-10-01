# Draft reply to Glejn — cluster token validity after rotation & revocation

**To:** Glejn
**Subject:** Re: Cluster token rotation — old token validity window and revocation

---

Hi Glejn,

Good questions — here are the answers based on what we verified end-to-end on a live EKS cluster during the last incident.

## (a) How long does the old token keep working after a rotation?

Rotating the cluster token — whether through the console or the API (`POST /v1/kubernetes/external-clusters/{clusterId}/token`) — issues a new token but does **not synchronously revoke the previous one**. Both tokens authenticate in parallel for an overlap period.

Two important caveats on the exact duration:

- **There is no documented TTL for the overlap.** CAST AI does not publish how long the old token remains accepted.
- **Empirically, we observed the old token returning HTTP 200 for at least 60 minutes after rotation** in our test cluster. It may be longer, but treat 60 minutes as a lower bound from our testing, not a guarantee.

**On zero downtime:** this overlap actually works in your favor. Rotation is not a hard cutover, so the correct procedure causes no downtime at all:

1. Rotate the token (console or API) — existing components keep working on the old token.
2. Update **every** Kubernetes secret that holds the cluster token.
3. Rolling-restart all CAST AI components so they pick up the new token.

At no point is a component left without a valid credential. The `401 Authorization Required` errors you saw previously were not caused by the rotation itself — they were caused by a component still holding the old token **after the overlap window closed** (in your case, a missed `castai-cluster-controller` secret). So the risk is not "how fast you rotate," it's "did every secret get updated."

One warning for your runbook: because the overlap duration is undocumented, don't design around a specific grace period. Update all secrets and restart components promptly after rotating, and verify with a log scan (0 occurrences of `401 Authorization Required` across all CAST AI components).

## (b) Is there an endpoint to revoke the old token immediately?

**No.** The CAST AI public API exposes exactly one operation for cluster tokens:

```
POST /v1/kubernetes/external-clusters/{clusterId}/token
```

There is no `DELETE` or revoke method for cluster tokens. The only API-side action that guarantees a cluster token stops working is to **disconnect or delete the cluster** from CAST AI — which invalidates the cluster record and its tokens, but obviously also stops all optimization/autoscaling for that cluster, so it's not something we'd suggest just to expire a token.

If your concern is a compromised token, the practical sequence is: rotate, update all secrets, restart all components — then the old token is no longer in use anywhere on your side, and its remaining server-side lifetime is moot.

**One distinction worth keeping in mind for your automation:** organization-level API keys (used for management-API callers — scripts, CI/CD) are a *different* credential and **can** be revoked, via the console or:

```
POST   /v1/auth/tokens          # create
DELETE /v1/auth/tokens/{id}     # revoke
```

So for anything that calls the CAST AI management API, use org API keys (or scoped service-account credentials) — those give you the immediate kill-switch you're looking for. Just don't use them as a substitute for the cluster token in the agent/controller components.

Details: https://docs.cast.ai/docs/api-access

## Bottom line

- **(a)** Old token stays valid for an overlap window — undocumented duration, observed ≥60 minutes. That's what makes zero-downtime rotation possible: update all secrets, restart all components, no cutover gap.
- **(b)** No cluster-token revoke endpoint exists. Rotation + updating every secret + restarting every component is the complete mitigation. For management-API automation, use org API keys, which are revocable.

Happy to jump on a call and walk through the rotation runbook for your clusters if useful.

Thanks,
Ebrahim
