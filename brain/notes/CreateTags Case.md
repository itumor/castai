# CreateTags Case

**Ticket:** TKT-20260817-b640 ("Cast AI permissions failed")
**Jira:** CSO-10662, CSO-11111
**Date opened:** 2026-08-07
**castctl:** 0.12.0 (commit `537e8f1ec…`)
**Failing account:** `238720913587` (CSO-managed)
**Test account (ignore):** `842549707235` (not CSO-managed)

## Symptom

```
✓ ec2:AuthorizeSecurityGroupEgress
✗ ec2:CreateTags — Permission denied: explicitDeny
✓ eks:CreateAccessEntry / AssociateAccessPolicy / DescribeAccessEntry
✗ executing installation: doing Prepare Cloud Node Autoscaling:
  cloud credential validation failed: AWS permission checks failed
```

## Mechanism

castctl uses `iam:SimulatePrincipalPolicy` (confirmed from binary strings:
`SimulatePrincipalPolicy`, `EvalDecision`, `explicitDeny`). It never touches
real resources during the preflight.

## Evidence from replication

Replicated in lab account `050451381948` with CAST AI's own tagging policy
plus a CSO-prefix SCP (`Deny CreateTags when aws:TagKeys starts with
cso/CSO/Cso`):

| Scenario | EvalDecision |
|---|---|
| No SCP | allowed |
| CSO-prefix SCP, no tag context (castctl shape) | allowed |
| CSO-prefix SCP, CAST AI tag keys | allowed |
| CSO-prefix SCP, CSO-prefixed key | explicitDeny |
| CSO-prefix SCP, resource already tagged `cso-xyz` + new CAST AI key | explicitDeny |
| Blanket Deny CreateTags (no condition) | explicitDeny |

Also verified: `strings castctl | grep -i cso` returns no IAM tag name —
castctl 0.12.0 does not attempt to write a `cso`-prefixed tag.

## Conclusion

The effective policy stack on account `238720913587` contains a **broader
Deny than the quoted CSO-prefix SCP**. Either:

1. The real SCP denies any CreateTags call on resources already carrying
   CSO-prefixed tags (branch H — possible because castctl patches the
   default security group, which may be CSO-tagged).
2. There is a second, unconditioned Deny statement in the OU chain (branch
   I — supported by Sergej's screenshot showing the same org also
   SCP-denies `iam:SimulatePrincipalPolicy` via `p-n41po0en`).

## Workarounds ruled out

- **Changing CAST AI tag names** — castctl emits no cso tag; won't help.
- **Terraform/Helm install instead of castctl** — still requires
  `ec2:CreateTags` at runtime; will hit the same Deny.
- **Scoped Allow with `ec2:ResourceTag` condition** — Allow does not
  override explicit Deny.

## Viable path forward today

Onboard the cluster in **read-only / Workload Autoscaler mode** — no AWS
node-management permissions required. Enable Node Autoscaler later once the
SCP is amended.

## Lab artifacts

- `labs/csi-tagcheck/CASE-ec2-CreateTags-blocker.md`
- `labs/csi-tagcheck/REPLY-to-customer.md`
- `labs/csi-tagcheck/simulate_principal.py`
- `labs/csi-tagcheck/simulate_ifexists.py`
- `labs/csi-tagcheck/simulate_resource_tags.py`

## Next ask from Siemens

1. Confirm Windows castctl has no cso tag: `Select-String -Path castctl.exe -Pattern "cso"`.
2. Provide full SCP JSON for every policy on the OU path to account
   `238720913587`:
   ```bash
   aws organizations list-policies --filter SERVICE_CONTROL_POLICY
   aws organizations describe-policy --policy-id <id>
   ```
3. Alternatively, run the IAM Policy Simulator on the deployer principal
   for `ec2:CreateTags` and share the MatchedStatements list.
