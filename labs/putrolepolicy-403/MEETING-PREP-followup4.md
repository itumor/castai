# Meeting Prep — Cast AI 1 to 1 | IT DF COL UC 2 — Follow up #4

**Fri 2026-10-09, 10:30–11:00 GMT+3 · Teams · ID 299 782 252 555 10 · Passcode LB3HU3TD**
Link: https://teams.microsoft.com/meet/29978225255510?p=kvJSD7hLuoFl4tvDEp
Organizer: Fan Yang (Accenture). Samuel Frunza-Hincu & Umair Shahid (Conceptboard) are the hands-on-keyboard folks.

## Verified state (API-checked 2026-09-25, EU API) — source: labs/putrolepolicy-403/

| Item | Value |
|---|---|
| Org | `IT DF COL UC 2` (`2b9d9744-f37d-4a22-b9c6-2f1857a5417d`) — EU org → **console.eu.cast.ai / api.eu.cast.ai** |
| Cluster | `siemenstest-siemenstest-1` (`36575565-7149-431b-b5f6-71f43f18ef3f`), EKS **eu-west-1** |
| AWS account | `951463557399`; deployer role `siemenstest-siemenstest-ir-admin` |
| Connected? | YES — cost-monitoring run 1 (11:58 CEST) succeeded; agent **online**, 5 nodes (4× r6a.large, 1× m5a.xlarge), telemetry flowing since 09:00Z |
| Missing | Node Autoscaler / workload autoscaler / cluster optimization — run 2 (15:27 CEST) FATAL |

## The blocker (root cause, verified)

Run 2 died at: `iam:PutRolePolicy` **403 AccessDenied** on role
`cast-eks-siemenstest-siemenstest-1-cluster-role-36575565` — "no identity-based
policy allows the iam:PutRolePolicy action" → **identity-policy gap** on
`siemenstest-siemenstest-ir-admin` (NOT an SCP/boundary). Terraform path needs
the same permission — no workaround.

**Fix (customer-side IAM statement):**
```json
{
  "Effect": "Allow",
  "Action": ["iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy"],
  "Resource": [
    "arn:aws:iam::951463557399:role/cast-eks-*",
    "arn:aws:iam::951463557399:role/cast-kvisor-*"
  ]
}
```
Then **re-run the exact same `castctl cluster connect` command Fan sent** — it is
idempotent, reuses the created role + `CastEKSPolicy-36575565`, nothing to delete.

## Open issues to walk on the call

1. **IAM grant applied?** — who owns `siemenstest-siemenstest-ir-admin` policy; if applied, re-run live.
2. **Token freshness** — Sept 25 token was circulated in plaintext email and was replaced during that call; confirm a **current cluster token** from the console owner before re-run (rotate after onboarding stabilizes; old token stays valid ≥60 min after rotation; castctl topology = single secret `castai-credentials`).
3. **Samuel's console access** — invite to org `IT DF COL UC 2` at console.eu.cast.ai still pending (org-admin action; our API key is read-only, cannot invite).
4. **Region discrepancy** — calendar notes say "us-east-1", but the API-verified cluster is **eu-west-1**. Confirm cluster name first; don't "fix" the region to us-east-1 without checking (`aws eks describe-cluster --name siemenstest-siemenstest-1 --region eu-west-1`).
5. **Success criteria** — re-run finishes green → Features: Cost monitoring + Cluster optimization + Workload autoscaler; cluster ready/online in console; autoscaler enabled.
6. **Bonus (2 weeks of telemetry now)** — recommendations/savings should be meaningful; review in console next.
7. **Hygiene** — token was emailed in plaintext; propose rotation once onboarded (need console owner).

## URLs to have open

- Teams: https://teams.microsoft.com/meet/29978225255510?p=kvJSD7hLuoFl4tvDEp
- CAST AI console (EU): https://console.eu.cast.ai — org IT DF COL UC 2 → cluster 36575565-…
- Docs: https://docs.cast.ai/ · API base https://api.eu.cast.ai
- IAM module (for security questions): https://registry.terraform.io/modules/castai/eks-role-iam/castai/latest
- AWS console (Samuel): account 951463557399, EKS + IAM, eu-west-1
- Local: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md · REPLY-to-samuel.md

## Live-troubleshooting command sheet (read-only)

```bash
# 1. One identity, both sides
aws sts get-caller-identity          # expect 951463557399 / siemenstest-siemenstest-ir-admin
aws configure list; echo $AWS_PROFILE
kubectl config current-context; kubectl config get-contexts
kubectl get nodes                    # expect 5 nodes

# 2. Cluster findable (verified region!)
aws eks describe-cluster --name siemenstest-siemenstest-1 --region eu-west-1

# 3. IAM gap check
aws iam simulate-principal-policy --policy-source-arn <deployer-arn> \
  --action-names iam:PutRolePolicy \
  --resource-arns arn:aws:iam::951463557399:role/cast-eks-*

# 4. Re-run install (Samuel runs; explicit approval per AGENTS.md §6.1)
castctl cluster connect ... --cluster-optimization=true --workload-autoscaler=true --api-token <CURRENT_TOKEN>

# 5. Verify
kubectl get pods -n castai-agent
kubectl logs -n castai-agent deployment/castai-agent
# console: cluster ready, features list, autoscaler enabled
```

If 403 persists after grant → ask for support bundle
(`castctl-support-bundle-20260925T131720.zip` held by Samuel, or a fresh one).
If 401 after any token rotation → castctl topology: update `castai-credentials`
secret, restart components (runbook: castai-terraform-1/brain/notes/support-runbook.md §8).

## Guardrails

- I do NOT run `castctl cluster connect` on the customer cluster without explicit human approval — Samuel screen-shares and runs it.
- Read-only API posture; org API key cannot invite console users.
- castctl 0.15.x has **no pre-created-role-ARN flag** (name-only EKS flags) — if Fan revives the pre-created-roles question, that's the verified answer (Oct 5 evidence E1/E2).
