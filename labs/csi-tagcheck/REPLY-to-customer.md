# Paste-ready reply — TKT-20260817-b640 thread
# Reply to Fabian's "Can you investigate?" — in Ebrahim's voice.

Hi Fabian, Todd, Sergej — investigated end-to-end. Here is the definitive
answer, and one correction to my earlier email in this thread.

## What we proved (replicated in our sandbox AWS account 050451381948)

castctl's preflight check calls `iam:SimulatePrincipalPolicy`. I rebuilt the
exact evaluation: a role with CAST AI's own tagging policy, evaluated
against the CSO SCP precisely as Todd described it (Deny CreateTags/DeleteTags
only when a tag key starts with `cso`/`CSO`/`Cso`). Result table:

```
  castctl's request (no tag context)    → allowed        ← quoted SCP does NOT block it
  tag keys cast.ai:cluster              → allowed
  a CSO-prefixed tag key                → explicitDeny   ← the ONLY way to get your error
  (identical results for StringLike and StringLikeIfExists SCP variants)
```

I also verified that castctl never attempts to write a `cso`-prefixed tag:
`strings castctl | grep -i cso` over the 0.12.0 binary returns no IAM tag
name — so the claim "your process must be attempting to modify CSO-owned
tags" is not supported by the binary.

## What that means, plainly

- The CSO-prefix SCP as described gives castctl `allowed`.
- The customer account actually returns `explicitDeny`.
- Therefore the effective policy stack on account 238720913587 contains a
  **broader Deny than the quoted CSO-prefix rule** — most likely in another
  SCP in the same OU chain. (Independent corroboration exists already:
  Sergej's IAM Policy Simulator screenshot shows the same org SCP-denies
  even `iam:SimulatePrincipalPolicy` via policy `p-n41po0en` — so the OU
  chain carries aggressive SCPs that aren't in the summary we were given.)

This also settles two questions from the thread definitively:

- **Todd's question "a tag with another name will not be blocked, right?"**
  Under the CSO-prefix SCP alone, correct — but that SCP cannot explain the
  observed failure, so the real block is elsewhere.
- **"Would changing the tag name fix it?"** No — the deny fires for
  castctl's tag-name-free request, so no rename can help.

## Correction to my earlier email

I suggested a scoped-Allow statement
(`ec2:ResourceTag/kubernetes.io/cluster/<name>`) as a safe way to grant
CreateTags. That does not get around this failure — an explicit Deny always
overrides any Allow, scoped or not. Please disregard that as a solution
path; it set the wrong expectation and I'm sorry for the detour.

## No workaround exists on the CAST AI side, and one clarifies the thread

John asked whether CreateTags can be bypassed: no — there is no such option,
and **the Terraform/Helm alternate install path would NOT avoid the Deny
either**, since CAST AI's role policy itself requires `ec2:CreateTags` at
runtime against this same account. (Earlier in the thread switching to
Helm/Terraform was floated as a possible workaround; the analysis above
rules it out.)

The one path that does work today with zero account change: onboard the
cluster in **read-only / Workload Autoscaler mode** — it needs none of the
node-management cloud permissions. Node Autoscaler (Phase 2) can be flipped
on later, the moment the account's Deny is amended.

## What we need — one command, one document

1. Sergej, on the **customer's Windows** castctl please also run
   `Select-String -Path castctl.exe -Pattern "cso" -AllMatches` (or the
   `strings` equivalent) — rules out a Windows-build difference in 5 min.
2. The full active SCP JSON documents attached at every OU level above
   account 238720913587:
   `aws organizations list-policies --filter SERVICE_CONTROL_POLICY` →
   for each policy on those OUs `aws organizations describe-policy --policy-id <id>`.
   You already asked CSO for the policy-as-JSON — please include any
   further policies those calls reveal (we expect the list to contain more
   than the quoted statement, given the `p-n41po0en` deny you hit in the
   simulator yourself).

With the real JSON we will point our simulator at it via the same harness
(`labs/csi-tagcheck/simulate_principal.py`) and come back within the day
with the exact offending SID — at which point the correction on the Siemens
side is a single condition edit (adding the `ForAnyValue:StringNotLike
aws:TagKeys CSO*` guard or an explicit Allow exception for the CAST AI tag
keys on the CAST AI role), not an org policy rewrite.

## CAST AI side improvement (already filing)

When a preflight permission check returns non-`allowed`, castctl will print
the simulator's `MatchedStatements` (policy name + statement SID) so the
offending Deny is named on the very first run. That one line of output
would have resolved this ticket on day one.

Happy to take Fabian's Friday call slot — if we have the SCP JSON by then,
we close on that call.

Best regards,
Ebrahim Ramadan
CAST AI
