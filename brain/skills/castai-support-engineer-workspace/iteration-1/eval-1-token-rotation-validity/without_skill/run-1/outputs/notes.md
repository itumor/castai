# Notes — eval-1-token-rotation-validity

## Sources consulted

### Local files

- `/Users/eramadan/castai/.kimchi/docs/token-rotation-e2e-status.md` — E2E test results; key facts: old cluster token observed authenticating (HTTP 200) for ≥60 minutes after rotation; no public revoke endpoint; only cluster-token operation is `POST /v1/kubernetes/external-clusters/{clusterId}/token`; disconnect/delete of the cluster is the only guaranteed invalidation; org API keys are a separate credential.
- `/Users/eramadan/castai/.kimchi/docs/reply-glejn-token-rotation.md` — previously reviewed customer reply on the same incident (401 after rotation); used for tone, topology context (per-component secrets, `castai-cluster-controller` most commonly missed), and the org-API-key kill-switch guidance.
- `/Users/eramadan/castai/.kimchi/docs/rotate-token-manual-commands.md` — manual rotation runbook; token lifecycle note (no synchronous revocation, ≥60 min observed validity, no revoke endpoint, `DELETE /v1/auth/tokens/{id}` applies only to org API keys).

### URLs

- https://docs.cast.ai/docs/api-access — referenced in the local runbooks for org API key management; cited in the reply. (Not fetched directly during this session; carried over from the reviewed runbooks.)

## Assumptions made

1. **Console rotation == API rotation** — rotating via the CAST AI console is assumed to use the same `POST /v1/kubernetes/external-clusters/{clusterId}/token` operation, so the same validity/revocation behavior applies.
2. The customer's "zero downtime" goal is addressed by the overlap behavior plus the update-all-secrets/restart-components procedure; the reply reframes the risk (missed secret vs. rotation cutover).
3. The 60-minute figure is presented as an empirical lower bound, not a CAST AI guarantee, matching the caveat in the reviewed docs.
4. Signed "Ebrahim" consistent with the existing reviewed reply template; human review before sending per repo AGENTS.md workflow.
5. No CAST AI skill was loaded (without_skill condition); all facts taken from local runbooks in `.kimchi/docs/`.
