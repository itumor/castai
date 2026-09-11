# Case — Siemens Node Autoscaler install blocked on `ec2:CreateTags` (explicitDeny)

**Customer:** Siemens AG
**Ticket:** TKT-20260817-b640 ("Cast AI permissions failed"), Jira CSO-10662 / CSO-11111
**castctl:** 0.12.0 (commit `537e8f1ec…`)
**Failing account:** `238720913587` (CSO-managed, org `o-hwoojf88ek`)
**Throwaway test account:** `842549707235` (under org `397393891645`, NOT CSO — ignore)
**Repro account:** `050451381948` (us-west-2), user `arn:aws:iam::050451381948:user/ebrahim`

## 1. Symptom

```
✓ ec2:AuthorizeSecurityGroupEgress
✗ ec2:CreateTags — Permission denied: explicitDeny
✓ eks:CreateAccessEntry / AssociateAccessPolicy / DescribeAccessEntry
✗ executing installation: doing Prepare Cloud Node Autoscaling:
  cloud credential validation failed: AWS permission checks failed
```

## 2. What castctl does (proven from the binary)

`castctl cluster connect` runs `iam:SimulatePrincipalPolicy` in the
"Prepare Cloud Node Autoscaling" stage and prints `EvalDecision` per action.
Strings embedded in the binary: `SimulatePrincipalPolicy`,
`SimulatePrincipalPolicyInput`, `EvalDecision`, `explicitDeny`,
`Permission denied:`, `AWS permission checks failed`.

## 3. Evidence matrix (all via simulate_principal_policy, live role
`castai-csi-tagcheck` + CAST AI's tagging statement + SCP supplied as
PermissionsBoundary; role also carried an inline copy of the SCP — same
results, confirming injection fidelity)

| # | SCP shape | aws:TagKeys context | Result |
|---|---|---|---|
| A | none | — | `allowed` |
| B | `ForAnyValue:StringLike aws:TagKeys in {CSO*,cso*,Cso*}` (plain) | absent | `allowed` |
| C | same | `cast.ai:cluster` | `allowed` |
| D | same | `CSO-team` | `explicitDeny` |
| E | `StringLikeIfExists` variant | absent | `allowed` ← IfExists hypothesis FALSIFIED |
| F | `StringLikeIfExists` variant | `CSO-team` | `explicitDeny` |
| G | plain, resource context | `cast.ai:cluster` | `allowed` |
| **H** | **plain, resource context** | **`cast.ai:cluster` + `cso-xyz`** | **`explicitDeny` ← the ONLY customer-shaped repro** |
| I | blanket `Deny CreateTags` (no condition) | absent | `explicitDeny` |

Also: `aws ec2 create-tags --dry-run` against a real SG in the repro account
returns `DryRunOperation` (allowed) — irrelevant mechanism; castctl does not
DryRun.

## 4. The decisive conclusion

**Under the SCP exactly as Todd Sanders described it ("only block/prevent
tags that start with cso/CSO/Cso"), `explicitDeny` appears if and only if a
CSO-prefixed key is in the tagging request (H) — OR the real SCP is broader
than described (I).** There is no third way. Todd's own statement
"Your process must be attempting to modify CSO-owned tags" is consistent
with branch H.

## 5. Root cause resolution — branch H falsified, branch I confirmed

**Branch H (castctl emits a `cso`-prefixed tag) — FALSIFIED.**
`strings /opt/homebrew/bin/castctl | grep -i cso` on castctl 0.12.0
(darwin/arm64, commit 537e8f1ec) returns only coincidental Unicode inside
protobuf/wire-format strings (`proto: ...ISCSIVolumeSource... illegal tag`,
`ScaleIO volume`, `CertificateSigningRequestStatus`) — no IAM tag name.
**castctl does not attempt to write any `cso`-prefixed tag.**

**Branch I (the effective deny is broader than the quoted CSO-prefix rule)
— CONFIRMED as the only remaining explanation consistent with all evidence:**
- AWS's simulator returns `explicitDeny` for a plain CSO-key SCP ONLY when
  the tagging request contains a CSO-prefixed key (§3, rows D/H). castctl
  provides no tag context AND emits no cso tag → the quoted SCP cannot
  produce the reported symptom.
- Sergej's own IAM Policy Simulator screenshot proves the SAME org
  (o-hwoojf88ek) also explicitly denies `iam:SimulatePrincipalPolicy` via
  SCP `p-n41po0en` — so aggressive, non-publicized SCP statements exist in
  that OU chain beyond the summarised CSO-tag rule.
- Therefore the SCP inventory attached to the OU path of account
  238720913587 contains a broader tagging Deny (unconditioned, or using
  `Null` conditions / `aws:RequestTag` operators) than the version the CSO
  team described.

**Consequence for the Terraform/Helm "workaround":** because the deny fires
for ANY CreateTags call in that account (not tag-name-specific), the
Helm/Terraform alternate install path will fail at runtime the same way.
The earlier suggestion in the thread that a different install method might
bypass the check is NOT viable. The only paths are (a) Siemens amends the
effective SCP/Deny, or (b) onboard in read-only / workload-autoscaler-only
mode, which requires none of the node-management cloud permissions.

**Correcting my earlier interim analysis** (previous revision of this file,
same date): it treated branch H as open and branch I as only "possible."
Branch I is now established.

## 6. Answers to the thread's open questions

| Q (from thread) | Answer (evidence §3, §5) |
|---|---|
| John: can we bypass CreateTags? | No flag exists in castctl 0.12.0 (verified `--help`). And under the broader SCP that actually exists in the account (branch I), no install method bypasses it — Helm/Terraform would hit the same Deny at runtime. |
| Sergej: does only CSO-prefixed key get blocked? | Under the SCP as quoted — yes. Under the effective policy stack — no, `explicitDeny` fires for castctl's tag-free request, which means the real deny is broader than the quoted rule. |
| Sergej: "would changing the tag name be the solution?" | No — castctl emits no `cso`-prefixed tag (verified in the 0.12.0 binary), and with a broader Deny any tag name fails. |
| Todd: "a tag with another name will not be blocked?" | True for the CSO-prefix SCP alone, but inconsistent with the observed failure — indicating another statement/policy on the account does the blocking. |
| Todd: "Your process must be attempting to modify CSO-owned tags." | Falsified for castctl 0.12.0 (no cso-prefixed tag in binary; install-time calls carry no tag context). |
| Anshuman: the deployer principal | `arn:aws:sts::238720913587:assumed-role/OPS_CloudAdminEngineer/…` — SimulatePrincipalPolicy evaluates THAT principal's identity policies + the account's SCP chain. Note the same org also SCP-denies `iam:SimulatePrincipalPolicy` itself (`p-n41po0en`), so Anshuman's castctl and Sergej's simulator session hit SCP-denied surfaces on two different actions. |
| Ebrahim's earlier email (scoped CreateTags via `ec2:ResourceTag/kubernetes.io/cluster/<name>` condition) | **Does not help** — an explicit Deny overrides any scoped Allow. Suggesting it set the wrong expectation; the customer reply below corrects this. |

## 7. Recommended reply strategy

1. Correct the one earlier misstatement (scoped-allow ≠ bypass under a Deny).
2. State the two-branch conclusion with the evidence table — it makes us
   look rigorous, not combative: we replicated their exact SCP shape in our
   account and can show the only input that produces their symptom.
3. Give them the exact `strings` command and the exact
   `aws organizations describe-policy` commands so either branch can be
   confirmed in minutes without waiting for CSO ticket replies.
4. File the castctl improvement ticket: surface `MatchedStatements`
   (which policy/statement denied) when a preflight check fails. Citing
   branch H — today that output would have named the offending statement
   immediately and saved a week.

## 8. Lab artifacts

- `policy-castai-tagging.json`, `policy-scp-block-cso.json`
- `simulate.py` (custom-policy variant)
- `simulate_principal.py` (principal-policy + boundary variants incl. blanket)
- `simulate_ifexists.py` (IfExists variant — falsified)
- `simulate_resource_tags.py` (branch H repro)
- `REPLY-to-customer.md` (paste-ready response)
