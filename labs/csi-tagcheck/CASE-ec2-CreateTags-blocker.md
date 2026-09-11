# Case — Siemens Node Autoscaler install blocked on `ec2:CreateTags` (explicitDeny)

**Customer:** Siemens AG (org `Siemens AG` `8b69b8da-00d6-47e6-8af0-a36ab02b9847`, child org suspected `SI GSW CLO` `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` — confirm)
**Date filed:** 2026-09-11
**castctl:** 0.12.0 (commit `537e8f1ec…`, built 2026-09-07)
**Reporter:** Ebrahim via CAST AI support
**Repro environment:** AWS account `050451381948` (us-west-2), iam user `arn:aws:iam::050451381948:user/ebrahim`

---

## 1. Symptom (verbatim from ticket)

```
✓ ec2:AuthorizeSecurityGroupEgress
✗ ec2:CreateTags — Permission denied: explicitDeny
✓ eks:CreateAccessEntry / AssociateAccessPolicy / DescribeAccessEntry
Error: executing installation: doing Prepare Cloud Node Autoscaling:
cloud credential validation failed: AWS permission checks failed
```

Same SCP blocks 6 clusters that otherwise run Karpenter + CAST AI workload
autoscaler fine (read-only / WOOP work; **node autoscaler install fails**).

## 2. Mechanism — how castctl performs the check (proven, not assumed)

Disassembled `/opt/homebrew/bin/castctl` (strings on the Go binary). It embeds:

- `SimulatePrincipalPolicy`, `SimulatePrincipalPolicyInput`, `SimulateCustomPolicy`
- `EvalDecision`, `explicitDeny`, `implicitDeny`
- Error strings `Permission denied:` and `AWS permission checks failed`

Conclusion: castctl's "Prepare Cloud Node Autoscaling" stage calls
`iam:SimulatePrincipalPolicy` (or `SimulateCustomPolicy`) with a fixed
action list. For each action it renders `EvalDecision` from the simulator
response. The resource ARN is synthesized as `*` (a no-resource-context
check), because preflight happens before any real resource exists.

Not a `DryRun` practice call: binary contains no CreateTags-with-DryRun
evidence, and the printed vocabulary (`Permission denied: explicitDeny`)
matches the simulator's `EvalDecision` enum, not the EC2 DryRun error
taxonomy (`DryRunOperation` vs `UnauthorizedOperation`).

## 3. Ground-truth replication — every policy combination that matters

Method: created IAM role `castai-csi-tagcheck` in account `050451381948`,
attached CAST AI's own tagging policy (the statement set CAST AI ships via
`data.castai_eks_settings.eks.iam_policy_json` in
`terraform/modules/castai-eks-full/.terraform/modules/castai-eks-role-iam`),
then ran `iam.simulate-principal-policy` with the Siemens SCP supplied as a
**PermissionsBoundary** (the only AWS-native "deny layer over allow" shape
that reproduces SCP semantics).

Files: `labs/csi-tagcheck/policy-castai-tagging.json`,
`labs/csi-tagcheck/policy-scp-block-cso.json`,
`labs/csi-tagcheck/simulate_principal.py` (runnable).

| # | Policy state | Tag context | EvalDecision | Source |
|---|---|---|---|---|
| A | role + CastEKSPolicy only | — | `allowed` | role policy |
| B | A + Siemens CSO deny (`aws:TagKeys` SSIO prefix-`CSO*`) | — | `allowed` | role policy |
| C | B + keys `cast.ai:cluster` | cast.ai | `allowed` | role policy |
| D | B + keys `CSO-team` | CSO.* | `explicitDeny` | boundary |
| E | A + blanket `Deny CreateTags` SCP | — | `explicitDeny` | boundary |
| F | E + keys `cast.ai:cluster` | cast.ai | `explicitDeny` | boundary |

Also verified: real AWS API DryRun (`aws ec2 create-tags --dry-run` on a real
SG) returns `DryRunOperation` (= allowed) in our account — so if the Siemens
check fails for real as described, it is NOT a permissions-boundary CSO SCP.

## 4. Conclusions

1. **Siemens' stated SCP shape is not sufficient to trip the check.** A
   condition-locked deny on `aws:TagKeys` matching `CSO*` makes the simulator
   answer `allowed` for every call that doesn't *actually carry* a CSO-
   prefixed key (scenario B, same no-context shape castctl uses). Siemens'
   hypothesis — "check stops on any detected restriction" — is therefore
   not what the AWS simulator does, and castctl (which uses the simulator)
   would not produce `explicitDeny` under that exact SCP.

2. **What the customer's console actually shows matches scenario E/F** — a
   `Deny ec2:CreateTags` without a key condition (or one that evaluates
   true for castctl's context). That is either (a) an SCP with no
   `aws:TagKeys` condition, (b) a DENY on a sibling action that the
   customer's UI attributes to CreateTags, or (c) an AWS managed policy on
   the *installer principal itself* (not the CAST AI role) that blanket-
   denies CreateTags and gets captured by SimulatePrincipalPolicy.

3. **The preflight's behaviour is still semantically off in one respect**:
   it simulates the *current* caller, not the eventual CAST AI cross-account
   role. If the installer principal is intentionally locked down by the
   customer's own IAM while the CAST AI role would be fine, the check
   produces a false negative at "Prepare Cloud Node Autoscaling". That is
   actionable in castctl regardless of outcome (2) — see §5.

4. **The Terraform/Helm workaround is not a clean dodge.** The upstream
   `castai/eks-role-iam/castai` module ships an IAM policy that includes
   `ec2:CreateTags` (scoped to the cluster VPC); installing full mode by any
   path still requires that API to succeed at runtime. The customer's own
   "may not be viable as-is" note is correct.

## 5. Recommended actions — in order

1. **Ask Siemens for the denial source, not just the SCP.** Easiest: a
   CloudTrial `ec2 CreateTags` event filtered on the failure window.
   The event's `errorCode` will say whether this surfaced as
   `UnauthorizedOperation` (real call) or never produced an event at all
   (simulator-only). Ask for the raw `EvalDecision` JSON or the full
   castctl `--log-level debug` line; support bundle from the customer
   machine was an empty shell (log-collection bug — different ticket).
2. **If their SCP truly is only `CSO*`-key-prefixed → dev ticket.**
   castctl's check should either (a) simulate with a synthesized
   `aws:TagKeys` context containing the tag names CAST AI will actually
   use (`cast.ai:*`, `kubernetes.io/cluster/*`), or (b) report
   `explicitDeny` *with* the offending policy denials statement list so
   the user can see which key is the actual problem.
3. **If their SCP is broader than reported (scenario E/F)** → not a
   castctl bug; it's a customer IAM change request: add a condition
   `ForAnyValue:StringNotLike aws:TagKeys CSO*` to the deny or add an
   allow exception for the CAST AI tag keys. We can provide the exact
   JSON patch once Siemens shares the current SCP.
4. **Quality improvement to castctl regardless (worth a ticket either
   way):** (a) make the permission check simulate the eventual CAST AI
   role (known shape `cast-eks-<cluster>-cluster-role-<id>`), not the
   local caller — avoids false negatives when the installer is more
   locked down than the role; (b) when `EvalDecision != allowed`, print
   `MatchedStatements` so support no longer has to reverse-engineer the
   binary.

## 6. What we still need from Siemens

- The **exact SCP JSON** attached to the OUs containing the 6 clusters
  (already requested; they promised it).
- Which **IAM principal** was running castctl (role ARN or IAM user ARN).
- **Full console output** of the failing run (not just the trimmed
  checkmarks), so we can confirm which of the ~40+ checked actions
  castctl labels with `✓/✗` — the presence of
  `AuthorizeSecurityGroupEgress ✓` next to `CreateTags ✗` under a CSO
  SCP is only reproducible if there's a second deny somewhere.
- Cluster IDs of the 6 affected clusters (we have candidate list from
  SI GSW CLO inventory: 20 clusters on file).

## 7. Lab artifacts (kept for rerun)

- `labs/csi-tagcheck/policy-castai-tagging.json` — CAST AI tagging allow (subset)
- `labs/csi-tagcheck/policy-scp-block-cso.json` — Siemens-stated SCP
- `labs/csi-tagcheck/simulate.py` — simulate_custom_policy version
- `labs/csi-tagcheck/simulate_principal.py` — simulate_principal_policy version (canonical)
- Role `castai-csi-tagcheck` created and deleted; account clean.
