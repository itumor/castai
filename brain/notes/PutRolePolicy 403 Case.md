# PutRolePolicy 403 Case

**Date:** 2026-09-25
**Customer:** Conceptboard (Siemens engagement, Accenture: Fan Yang, Fabian Jennrich)
**Org:** `IT DF COL UC 2` (`2b9d9744-f37d-4a22-b9c6-2f1857a5417d`)
**Cluster:** `siemenstest-siemenstest-1` (`36575565-…-71f43f18ef3f`), EKS eu-west-1
**Customer AWS account:** `951463557399`

## TL;DR

Full/autoscaling `castctl cluster connect` failed fatally with
`iam:PutRolePolicy` 403 on role `cast-eks-…-36575565`. Cause: deployer role
`siemenstest-siemenstest-ir-admin` identity policy lacks `iam:PutRolePolicy`
(**identity gap, not SCP/boundary** — message says "no identity-based policy
allows"). Read-only onboarding (earlier same day) succeeded; kvisor inline-policy
skip was the same missing permission, non-fatal.

## State

- Cluster connected via cost-monitoring run at 08:27Z; agent **online**; 5 nodes
  (4× r6a.large, 1× m5a.xlarge); `resource-usage` telemetry flowing since 09:00Z.
- Node Autoscaler NOT yet enabled.
- Fix path: add `iam:PutRolePolicy(+Get/DeleteRolePolicy)` scoped to
  `arn:aws:iam::951463557399:role/cast-*`, then re-run the same command
  (idempotent — reuses created role/policy). Terraform onboarding needs the same
  permission, so no workaround there.
- Open: console invite for samuel.frunza@customer.example.com (org-admin action);
  connect token circulated by email — recommend rotation later.

## Case file

- `labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md`
- `labs/putrolepolicy-403/REPLY-to-samuel.md` (draft, human reviews before send)

Related: [[CreateTags Case]] (SCP explicitDeny variant — different mechanism).
