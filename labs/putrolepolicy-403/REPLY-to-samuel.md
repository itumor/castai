# FINAL — reply to Samuel (2026-09-25, ready to paste)

**To:** samuel.frunza@customer.example.com
**Cc:** Umair Shahid; Fabian Jennrich; Christoph Göbels; Tahmid Shibly
**Re:** Post meeting question — PutRolePolicy 403 during onboarding

---

Hallo Samuel,

short version: nothing broken on the CAST AI side — your first run already connected the cluster. The 403 is one missing IAM permission on the AWS role you run `castctl` from, and the fix is a small change on your side.

**Wait or fix myself?** You (or whoever administers the `siemenstest-siemenstest-ir-admin` role) can fix it directly — no CAST AI-side change needed.

**What happened**

Your second run got almost all the way through: it created the CAST AI role (`cast-eks-siemenstest-siemenstest-1-cluster-role-36575565`) and attached its managed policies. The last step writes CAST AI's node-management permissions as an **inline policy** into that role, and that call needs `iam:PutRolePolicy` — which AWS denied:

> "no identity-based policy allows the iam:PutRolePolicy action"

So the identity policy of the deployer role allows creating roles and attaching managed policies, but not writing inline policies. (The kvisor warning in your first run was the same missing permission on a different role — harmless there, which is why that run completed.)

**The fix**

Add this statement to the `siemenstest-siemenstest-ir-admin` role (account 951463557399):

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

Then re-run the exact same `castctl cluster connect` command Fan sent. It detects the role and policy it already created and continues where it stopped — nothing needs to be deleted first. (Installing via Terraform instead needs exactly the same permission, so the small IAM addition is the shortest path either way.)

**"Can CAST AI already read stuff?"** — yes. Your 11:58 run onboarded the cluster in cost-monitoring mode: it shows as connected and online, 5 nodes (4× r6a.large, 1× m5a.xlarge, eu-west-1), with resource/cost telemetry flowing since this morning. Utilization and cost data are visible in the console now; savings and workload recommendations build up over the next days and become meaningful after ~a week of history.

**Console login** — you need an invitation to the CAST AI organization for this cluster. We'll arrange it for your @customer.example.com address; please confirm that address is OK.

**Should you look into anything else until the next session?** No. Once the IAM line above is in place and the re-run finishes green, the dev cluster is fully onboarded in autoscaler mode (approved by Malika). Onboarding itself does not touch existing nodes — CAST AI only changes capacity after node configurations and policies are activated in the console, which we can walk through together next session.

If the re-run still 403s after the grant, send over `castctl-support-bundle-20260925T131720.zip` and we'll dig in.

Kind regards,
Ebrahim

---

## Internal notes (do NOT send)

- Token hygiene: Fan's message includes a live `--api-token` in plaintext email.
  Recommend rotating it after onboarding; do not quote it in follow-ups.
- Console invite must be done by an org admin in console.eu.cast.ai (org
  "IT DF COL UC 2", `2b9d9744-f37d-4a22-b9c6-2f1857a5417d`) — our API key is
  read-only and cannot add users.
- If Samuel's security team asks what CAST AI does with these permissions, point
  them to the public module that defines the role:
  https://registry.terraform.io/modules/castai/eks-role-iam/castai/latest
