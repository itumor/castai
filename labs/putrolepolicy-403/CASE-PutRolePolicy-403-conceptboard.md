# CASE: `iam:PutRolePolicy` 403 during full (autoscaling) onboarding

**Date:** 2026-09-25
**Customer:** Conceptboard Cloud Service GmbH (Siemens engagement via Accenture)
**Org:** `IT DF COL UC 2` (`2b9d9744-f37d-4a22-b9c6-2f1857a5417d`)
**Cluster:** `siemenstest-siemenstest-1` (`36575565-7149-431b-b5f6-71f43f18ef3f`), EKS, eu-west-1
**Customer AWS account:** `951463557399`
**Deployer principal:** `arn:aws:sts::951463557399:assumed-role/siemenstest-siemenstest-ir-admin/samuel`
**People:** Samuel Frunza-Hincu, Umair Shahid (Conceptboard); Fan Yang, Fabian Jennrich, Christoph Göbels, Tahmid Shibly (Accenture); Malika approved autoscaler mode on dev.

## Timeline

1. **Run 1 (11:58 CEST)** — `castctl cluster connect … --cluster-optimization=false --workload-autoscaler=false`
   → cost-monitoring onboarding **succeeded**. One non-fatal warning:
   kvisor inline policy attach was **skipped** (`iam:PutRolePolicy` 403 on role
   `cast-kvisor-siemenstest-siemenstest-1-eks-36575565`). Final state:
   `✓ CAST AI setup complete! — Features enabled: • Cost monitoring`.
2. **Run 2 (15:27 CEST)** — same command with `=true` flags (Fan's request, Malika's approval):
   - ✓ Got CAST AI user ARN
   - ✓ Got EKS cluster details
   - ✓ Created role `cast-eks-siemenstest-siemenstest-1-cluster-role-36575565`
   - ✓ Created+attached managed policy `CastEKSPolicy-36575565`
   - ✓ Attached AWS managed policies
   - ✗ FATAL: `PutRolePolicy` 403 AccessDenied on the cluster role.
     `"no identity-based policy allows the iam:PutRolePolicy action"`
   - Support bundle: `castctl-support-bundle-20260925T131720.zip` (kept by Samuel).

## Root cause

The deployer role `siemenstest-siemenstest-ir-admin` has an identity policy that
allows `iam:CreateRole`, `iam:CreatePolicy`, `iam:AttachRolePolicy` — but **not**
`iam:PutRolePolicy`.

- This is an **identity-policy gap**, not an SCP/permissions-boundary block:
  the error says `no identity-based policy allows the iam:PutRolePolicy action`.
  An SCP deny would report `explicitDeny` (cf. [[CreateTags Case]]); a boundary
  gap would say `no permissions boundary allows`.
- CAST AI full (Node Autoscaler) onboarding writes the EC2/EKS permissions CAST AI
  uses to provision nodes **as an inline policy on the CAST AI role** — hence
  `PutRolePolicy` is required. Read-only onboarding does not need it, which is why
  run 1 completed.
- The `castai/eks-role-iam` Terraform module does the same thing
  (`aws_iam_role_policy` inline), so **switching to Terraform does not avoid
  this requirement**. Repo evidence: `docs/castai/terraform-e2e.md` §5.1 lists
  `iam:PutRolePolicy` as an operator-side requirement for full mode.
- The run-1 kvisor warning is the **same gap** on a different role
  (`cast-kvisor-…`); it is non-fatal in read-only mode (security agent skipped).

## CAST AI-side state (verified read-only via EU API, ~15:45 UTC 2026-09-25)

- Cluster status: `ready`, agentStatus: `online`, createdAt `2026-09-25T08:27:36Z`,
  `managedBy: console`.
- 5 nodes visible: 1× `m5a.xlarge`, 4× `r6a.large`; none CAST AI-managed.
- Cost-report `resource-usage` already has hourly points since 09:00Z:
  12 vCPU / 80 GiB provisioned; ~7.0 → 8.6 vCPU requested.
  → **Telemetry is flowing; CAST AI can already read the cluster.**
- Node Autoscaler NOT enabled (run 2 failed before completion).

## Fix (customer side, one small IAM change)

Add to the identity policy of role `siemenstest-siemenstest-ir-admin`
(account `951463557399`):

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

(`Get/DeleteRolePolicy` are for read-back and later cleanup; resource scope can be
`arn:aws:iam::951463557399:role/cast-*` if their convention prefers one statement.)

Then **re-run the exact same `castctl` command**. The connect flow reuses the
already-created role/policy and continues — nothing needs to be deleted first.

## Open items

- **Console access for Samuel:** he must be invited to org `IT DF COL UC 2` in
  console.eu.cast.ai. Org-admin / Accenture action — our API key is read-only
  (AGENTS.md §2) and we cannot invite users.
- **Recommendations ETA:** ~1 week of workload history before savings
  recommendations are meaningful (per `onboarding-demo-next-session.md` §4).
- **Hygiene note (internal):** the `castctl --api-token` circulated in plaintext
  via email today. Flag to Fan; consider rotating the cluster token after
  onboarding stabilizes. Do NOT paste the token into any repo file.
- If the 403 persists after the grant, ask Samuel for the support bundle zip.

## Lab artifacts

- `CASE-PutRolePolicy-403-conceptboard.md` (this file)
- `REPLY-to-samuel.md` — drafted customer reply (human reviews before send)
