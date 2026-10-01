# token_rotation: support case case-401-authorization-required-a-9f66f33e

- Date: 2026-09-28
- Case: case-401-authorization-required-a-9f66f33e
- Category: token_rotation
- Topic: 401 Authorization Required after cluster token rotation

## Problem
A customer hit a token_rotation case: "401 Authorization Required after cluster token rotation". This note captures the generic shape of the problem so the next occurrence is handled faster; all customer-specific identifiers stay in the case ledger, not here.

## Detection signals
- [documentation] nous token-revocation API for cluster tokens; the previous token remained valid after rotation. We empirically verified the old token returned HTTP 200 for at least **60 minutes** after rotation. Ther
- [documentation] ts. 4. Do *not* route the token through `castai_eks_cluster.this.cluster_token` after rotation, because Terraform’s state will still hold the old value. ### Q6. After a token rotation, what is the re
- [prior_ticket] he old token continued to authenticate successfully for at least **60 minutes** after rotation. This explains why `ngm-sim2-eks` could initially continue working after rotation and only fail later: th
- [documentation] bash shellcheck -e SC1091,SC2329 -x \ e2e/token-rotation/run.sh \ e2e/token-rotation/lib/*.sh \ e2e/token-rotation/tests/*.sh # exit code: 0 ``` Shellcheck is clean excluding the expected SC109
- [documentation] 2e.md` **Reviewed against:** repo `AGENTS.md`, original task context (customer `401 Authorization Required` in `castai-cluster-controller` after full-mode token rotation). ## Verdict NEEDS_REVISION
- [documentation] ai` (the key is EU-only; `api.cast.ai` returns 401); header `X-API-Key: $CASTAI_API_KEY` (official; `Authorization: Token` also works but is undocumented legacy — standardize on `X-API-Key`); **header
- customer question: 401 after rotation — expected?
- customer question: Old token validity — how long?
- customer question: Which secrets to update and restart?
- customer question: Org API key usable instead of the cluster token?

## Resolution
1. Reproduce the behavior in the lab to pin down the root cause, then apply the smallest manifest change it points to and watch one workload before rolling out.
2. Rollback: keep the previous manifest/policy version in source control and re-apply it through your normal CI path if the change misbehaves — nothing in this plan is one-way.

## Reusable checklist
- [ ] Confirm the organization id and cluster id before investigating.
- [ ] Reproduce the behavior in the lab before claiming a fix (read-only).
- [ ] Attach evidence to every claim; let the verifier gate the answer.
- [ ] Update every secret using the cluster token and restart every component.
- [ ] Draft the reply with grounded claims only; a human reviews before any send.
