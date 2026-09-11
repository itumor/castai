# Ticket update — paste into the Siemens `ec2:CreateTags` thread
# (written in Ebrahim's voice, reporting reproduction results back to the thread)

Team,

Reproduced the permission check end-to-end in our sandbox AWS account
(050451381948) and can now pinpoint exactly what `explicitDeny` means here
— and what it doesn't mean. Findings below; one request for Siemens at the
end still stands.

## How the castctl check works

The "Prepare Cloud Node Autoscaling" stage calls `iam:SimulatePrincipalPolicy`
(AWS's policy simulator — it never touches real resources). For each required
action castctl prints the simulator's `EvalDecision`:
`allowed` / `implicitDeny` / `explicitDeny`. The failing line
`ec2:CreateTags — Permission denied: explicitDeny` is a direct readout of
that API.

## Reproduction results

Policies used: CAST AI's own `CastEKSPolicy` tagging statement (exactly as
shipped by the `castai/eks-role-iam` module) plus a deny policy matching the
SCP as Siemens described it: Deny CreateTags/DeleteTags **only when a tag key
starts with `CSO*` / `cso*` / `Cso*`**, using
`ForAnyValue:StringLike aws:TagKeys` — evaluated with no tag context, the
same shape castctl uses:

```
A. role + CastEKSPolicy only             → allowed
B. A + CSO-key-prefix SCP (as described) → allowed
C. B + tag keys CAST AI actually sets    → allowed
D. B + a CSO-prefixed key (control)      → explicitDeny   (SCP fires correctly)
E. blanket Deny CreateTags (no condition)→ explicitDeny   (matches the ticket)
F. E + any tag keys                      → explicitDeny
```

**Key result: a CSO-key-prefix SCP does NOT make the simulator answer
`explicitDeny`.** Even in the exact simulation shape castctl uses (no tag
context), the answer stays `allowed`. So the check is not "stopping on any
detected restriction" — `explicitDeny` appears only when the deny actually
covers the action unconditionally, i.e. scenario E.

## What this means for the ticket

Two possible root causes, distinguished by the opposing evidence:

1. **The effective SCP is broader than reported.** Somewhere in the OU
   chain above those 6 accounts there may be a second deny — e.g.
   `Deny ec2:CreateTags` without a `aws:TagKeys` condition — possibly in a
   parent OU governance SCP that wasn't in the summary Siemens sent us.
2. **The deny is on the deployer principal, not the SCP.** If the IAM role
   or user running castctl itself carries a managed policy that denies
   CreateTags (some orgs gate tagging directly on deployer roles), the
   simulator reports `explicitDeny` for the caller regardless of SCP content.

Both are customer-side IAM changes; neither matches the original hypothesis
of the check being over-broad.

## Still requesting from Siemens

- The full SCP JSON attached at **every** OU level above the affected
  accounts (parent OUs included), or a CloudTrail lookup for `CreateTags`
  events in the failure window — the `errorCode` field settles whether a
  real call was attempted vs. simulator-only.
- The ARN of the IAM principal running castctl (role or user).

## Cast AI side — dev ticket recommendation

Filing a castctl improvement ticket regardless of the SCP outcome, with a
narrower scope than the original ask:

1. When a permission check returns non-`allowed`, print the simulator's
   `MatchedStatements` (which policy + which statement produced the deny).
   Today support has to reverse-engineer the binary to learn this.
2. Consider simulating with a synthesized `aws:TagKeys` context containing
   the actual tag names CAST AI will set (`cast.ai:*`,
   `kubernetes.io/cluster/*`), so key-prefix denies on unrelated keys
   provably can't block installs — defense-in-depth in case a different
   customer hits a genuinely over-broad evaluation.

Note on the Terraform/Helm workaround from the thread: confirmed not viable
as-is — the upstream `castai/eks-role-iam` module ships `ec2:CreateTags` in
the CAST AI role's policy, so every install path exercises that API at
runtime. The fix is IAM-side or check-side, not install-method-side.

Lab artefacts (reproducible): two policy JSONs + `simulate_principal.py` —
happy to share with anyone who wants to rerun against the real SCP once
Siemens sends it.
