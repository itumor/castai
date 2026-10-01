# Reply draft — TKT-20260817-b640 (post-CloudTrail round)
# Voice: Ebrahim (CAST AI). Answers Sergej (latest) + Todd (CloudTrail).
# Human reviews and sends.

Hi Todd, Sergej, Anshuman,

Two points from the last round, and a concrete plan for the joint session.

## Why CloudTrail shows no CreateTags events

That is expected, and it is itself diagnostic. castctl's "Prepare Cloud Node
Autoscaling" stage never calls `ec2:CreateTags` — it calls
`iam:SimulatePrincipalPolicy` (AWS's policy simulator) and prints the
`EvalDecision` per action. The failing line

    ec2:CreateTags — Permission denied: explicitDeny

is a direct readout of the simulator, not of a real EC2 call. A simulation
produces no CloudTrail `CreateTags` event, which is exactly why Todd finds
none. So the absence of CloudTrail events does not mean "nothing was
attempted" — it means the deny was returned at evaluation time, before any
real API call.

We verified this by rebuilding the exact evaluation in our sandbox account
(050451381948): CAST AI's tagging policy + an SCP matching the described
CSO-key-prefix rule. The quoted CSO-prefix SCP answers `allowed` for
castctl's request. The only shapes that answer `explicitDeny` are (a) a tag
request that actually contains a `cso`-prefixed key, or (b) an
**unconditioned** `Deny ec2:CreateTags` (or equivalent) somewhere in the
effective policy stack. We also verified castctl 0.12.0 contains no
`cso`-prefixed tag in its binary (`strings castctl | grep -i cso`), so (a)
is ruled out on our side. That leaves (b): a broader Deny than the quoted
rule, in an SCP on the OU path of account 238720913587 or directly on the
deployer role.

Independent corroboration: Sergej's own Policy Simulator session earlier in
this ticket showed the same org SCP-denying even `iam:SimulatePrincipalPolicy`
itself (policy `p-n41po0en`), so the OU chain carries SCPs beyond the
summarised CSO-tag rule.

## For the joint session — what to capture (10 minutes)

Yes to another session; we can close it there if we collect three things on
the call:

1. The exact deployer principal ARN used by Anshuman
   (`aws sts get-caller-identity` on the machine running castctl).
2. The SCP inventory on the OU path of account 238720913587:
   ```bash
   aws organizations list-policies --filter SERVICE_CONTROL_POLICY
   aws organizations list-policies-for-target \
     --target-id <account-id-or-ou> --filter SERVICE_CONTROL_POLICY
   aws organizations describe-policy --policy-id <each-id>
   ```
3. The simulator run against the real deployer principal, sharing the
   `MatchedStatements` output:
   ```bash
   aws iam simulate-principal-policy \
     --policy-source-arn <deployer-role-arn> \
     --action-names ec2:CreateTags
   ```
   `MatchedStatements` names the exact policy + statement SID that denies.

With item 3 alone we can point at the offending statement on the call. The
correction on the Siemens side is then a single statement edit — either
narrowing that Deny with a `ForAnyValue:StringNotLike aws:TagKeys CSO*`
guard (if it was meant to be the CSO-tag rule) or scoping it away from the
CAST AI role — no org policy rewrite needed.

## What will not work (so we don't spend the session on it)

- A bypass flag in CAST AI: does not exist; the tags identify and protect
  the cluster's nodes.
- A scoped Allow for CreateTags: an explicit Deny always overrides any
  Allow — I have to correct my earlier email on this point.
- Installing via Terraform/Helm instead of castctl: the CAST AI role
  requires `ec2:CreateTags` at runtime regardless of install method, so
  every path hits the same Deny.
- Renaming the tags: the deny fires for a tag-name-free request, so no tag
  name can help.

## The zero-change path that works today

Onboard the cluster in read-only / Workload Autoscaler mode — none of the
node-management cloud permissions are needed. Node Autoscaler can be
enabled later, the moment the Deny statement is amended.

Happy to join whenever suits — please send a slot.

Best regards,
Ebrahim Ramadan
CAST AI
