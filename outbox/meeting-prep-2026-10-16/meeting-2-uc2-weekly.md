# Meeting 2 — Cast AI 1 to 1 | IT DF COL UC 2 — 10:30 AM

*Prep compiled Thu 2026-10-15 ~20:00 Europe/Riga for Ebrahim Ramadan (CAST AI). All data read-only: Granola meeting notes/transcripts, repo case files, live GET-only CAST AI EU API (api.eu.cast.ai), official CAST AI onboarding script template. Unverifiable items are marked **unverified**.*

---

## 1. Meeting snapshot

- **Title:** Cast AI 1 to 1 | IT DF COL UC 2 - Weekly Follow up
- **When:** Friday 2026-10-16, 10:30 AM Europe/Riga (GMT+3). Weekly slot agreed at Follow-up #4 ("I keep the same slot as today" — Fan Yang, Oct 9; #4 ran 10:30–11:00, Teams ID 299 782 252 555 10) — this is session **#5** in the UC 2 series; first under the new weekly cadence.
- **Purpose (from Oct 9 decisions):** (a) confirm the final Oct 9 Helm/autoscaling run actually completed on the test cluster; (b) run the **configuration walkthrough on dev** that was deferred from #4; (c) review Samuel's IAM mirroring prep for production — **deployment stays gated** on dev validation; (d) keep the weekly series going until both clusters are fully configured.

**Participants (confirmed at #4 on Oct 9; same list invited, attendance today unverified):**

| Name | Email | Side | Role in this engagement |
|---|---|---|---|
| Ebrahim Ramadan | ebrahim@cast.ai | CAST AI | Host / engineer; minted the new token live on Oct 9; identified + shared the full required IAM policy |
| Fan Yang | f.m.yang@accenture.com | Accenture | Organizer of #4; drove the session; requested weekly cadence |
| Samuel Frunza-Hincu | samuel.frunza@conceptboard.com | Conceptboard | Hands-on executor; owns IAM policy updates; containerized K9s env, split AWS/kubectl profiles; **no CAST AI console access** |
| Umair Shahid | umair.shahid@conceptboard.com | Conceptboard | Hands-on support |
| Markus These | markus.these@conceptboard.com | Conceptboard | On invite |
| Malika Hoffer | malika.hoffer@siemens.com | Siemens | Decision approver — pre-approved autoscaling activation on dev; was **absent** Oct 9 |
| Adolfo Cabacinhas-ribeiro | adolfo.cabacinhas-ribeiro@siemens.com | Siemens | On invite |
| Guelen Toker | guelen.toker.ext@siemens.com | Siemens | On invite |
| Christoph Göbels | christoph.goebels@accenture.com | Accenture | Coordination |
| Fabian Jennrich | fabian.jennrich@accenture.com | Accenture | Coordination |
| Tahmid Shibly | tahmid.shibly@accenture.com | Accenture | Coordination |

*Oct-9 transcript shows the active trio was Fan + Samuel + Ebrahim; Malika did not attend. An unnamed "cluster owner" holds the CAST AI console access + cluster token (Samuel explicitly cannot log in).*

---

## 2. Where we stand — verified facts

**Cluster / org identity (verified live today):**

- CAST AI org: **`IT DF COL UC 2`** = `2b9d9744-f37d-4a22-b9c6-2f1857a5417d`, created 2026-09-15T08:25:00Z. *Source: GET https://api.eu.cast.ai/v1/organizations, HTTP 200, pulled 2026-10-15T16:59:46Z.* Note: the Oct-9 transcript's "ATDF COL" reference is this org. The sister org **`IT DF COL UC`** (`3fdf2233-8c32-478f-80be-381e609bd0d2`, created 2026-08-19T07:33:10Z) currently has **zero** external clusters. *Same endpoint, same pull.*
- Cluster: **`siemenstest-siemenstest-1`** = `36575565-7149-431b-b5f6-71f43f18ef3f`, EKS, **eu-west-1** (EU Ireland), AWS account **`951463557399`**, Kubernetes 1.35, createdAt **2026-09-25T08:27:36Z**, managedBy: console. *Source: GET https://api.eu.cast.ai/v1/kubernetes/external-clusters (headers X-API-Key + X-CastAI-Organization-Id: 2b9d9744-…), HTTP 200, pulled 2026-10-15T16:59:49Z.*
- Agent / connection status **right now**: `status: ready`, **`agentStatus: online`**, last agent snapshot **`2026-10-15T16:59:34Z`** (≈15 s before pull — live). `isPhase2: true`; `reconcileInfo: mode "enabled", status "ok", errorCount 0, reconciledAt 2026-10-15T16:46:47Z`. Assume-role: `arn:aws:iam::951463557399:role/cast-eks-siemenstest-siemenstest-1-cluster-role-36575565`. *Same endpoint/pull.* → Phase-2 (cross-account role) onboarding is in place and the reconciler is healthy — **beyond the read-only state seen at the start of the Oct 9 session**.
- **But autoscaling is not yet acting:** 6 nodes visible — 5× `r6a.large` (3× eu-west-1a, 2× eu-west-1b) + 1× `m5a.xlarge` (eu-west-1a) — **none CAST AI-managed**; `eks.instanceProfileArn` empty (node provisioning not configured). *Source: GET …/external-clusters/36575565-…/nodes, HTTP 200, pulled 2026-10-15T16:59:59Z.* On Sep 25 there were 5 nodes (4× r6a.large); one r6a.large has been added since — by AWS-side tooling, not by CAST AI. *Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md §CAST AI-side state.*
- Telemetry is flowing: latest cost-report point shows **14.0 vCPU / 96 GiB provisioned, 10.23 vCPU / 48.2 GiB requested** (Sep 25: 12 vCPU / 80 GiB provisioned). *Source: GET https://api.eu.cast.ai/v1/cost-reports/clusters/36575565-…/resource-usage, HTTP 200, pulled 2026-10-15T17:02:18Z.*

**Timeline of the series (problem → fix):**

- **Follow-ups #1–#2:** no Granola notes found (searched through Oct 15). Existence inferred from the Sep-25 transcript ("last time when you tried to run the scripts, we encountered certain problems"). **Unverified.**
- **Follow-up #3 — Fri 2026-09-25, 10:30** *(Granola 1230e87c-50c6-4c69-8330-ab8a663f7711, summary+transcript)*: castctl CLI installed only after Samuel **manually created a missing directory**; install command had to be re-sent (chat lost); kubectl context pointed at the wrong cluster ("development" context) — fixed manually; **region mismatch** (AWS default eu-west-1 vs nodes reported us-east-1/EUS1); **root blocker: two separate profiles** — one with kubectl access, one with AWS access, neither with both; `eks describe-cluster` failed; token from the earlier session had **expired**, new one generated in-call. Same day, per repo case file: run 1 (`castctl cluster connect --cluster-optimization=false --workload-autoscaler=false`, 11:58 CEST) **succeeded** (cost monitoring); run 2 with both flags `=true` (15:27 CEST) **died on `iam:PutRolePolicy` 403** on role `cast-eks-…-36575565` — an identity-policy gap on deployer role `siemenstest-siemenstest-ir-admin` (not SCP/boundary). Fix documented: add `iam:PutRolePolicy/GetRolePolicy/DeleteRolePolicy` scoped to `role/cast-eks-*`, `role/cast-kvisor-*` in account 951463557399, then re-run the same idempotent command. Support bundle `castctl-support-bundle-20260925T131720.zip` held by Samuel. *Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md; brain/notes/PutRolePolicy 403 Case.md.*
- **Follow-up #4 — Fri 2026-10-09, 10:30** *(Granola db4f0e91-089b-49a0-8131-71b889d415eb, summary+transcript)*: Malika pre-approved autoscaling (absent herself). Start state: cluster in **read-only**, no autoscaling. Token had **expired again** — Ebrahim minted a new one in-meeting and pasted it in chat. The autoscaling install then failed repeatedly mid-run on IAM gaps, each error surfacing one missing permission at a time: **`iam:GetInstanceProfile`**, **`TagInstanceProfile`** (added to an edited policy live), **`sts:GetCallerIdentity`**. Root cause of the churn: **Samuel had been hand-assembling policies from older JSON snippets** ("the last one I more or less got… you send me all the data, I made it by hand"); Ebrahim pulled the full required policy from CAST AI documentation and shared it in chat; permissions were added incrementally to the generic IAM role. Each Helm run restarted from scratch. **Final run was progressing without errors when the session ended — success not confirmed.** Samuel agreed to confirm by email; **no such confirmation exists in Granola Oct 10–15** (searched today, read-only). Fan asked Samuel to prepare the production cluster but deploy only after dev is validated; weekly sessions continue until both clusters are done; Ebrahim to send the recurring invite.
- **Since Oct 9:** Samuel's confirmation email: **unverified / not found**. Live API (today) shows agent online + reconcile ok — strong signal the final run completed, but **no CAST-managed node exists yet**, consistent with "installed, configuration walkthrough still pending" (which is exactly this meeting's job).

---

## 3. Key numbers & facts to quote

| Item | Value | Source |
|---|---|---|
| CAST AI org | `IT DF COL UC 2` / `2b9d9744-f37d-4a22-b9c6-2f1857a5417d` (created 2026-09-15) | GET /v1/organizations, pulled 2026-10-15T16:59:46Z |
| Cluster | `siemenstest-siemenstest-1` / `36575565-7149-431b-b5f6-71f43f18ef3f`, EKS, K8s 1.35 | GET /v1/kubernetes/external-clusters, pulled 16:59:49Z |
| AWS account / region | `951463557399` / **eu-west-1** (the Sep-25 "us-east-1/EUS1" note is wrong or obsolete — all 6 nodes + API agree on eu-west-1) | Same pull |
| Cluster first connected | 2026-09-25T08:27:36Z (cost-monitoring run 1) | Same pull |
| Agent status | **online**, last snapshot 2026-10-15T16:59:34Z; status `ready` | Same pull |
| Reconciler | mode **enabled**, status **ok**, 0 errors, 2026-10-15T16:46:47Z; isPhase2 true | Same pull |
| CAST AI assume-role | `arn:aws:iam::951463557399:role/cast-eks-siemenstest-siemenstest-1-cluster-role-36575565` | Same pull |
| Nodes now | **6** — 5× r6a.large + 1× m5a.xlarge, eu-west-1a/1b; **0 CAST AI-managed** | GET …/nodes, pulled 16:59:59Z |
| Deployer principal | `assumed-role/siemenstest-siemenstest-ir-admin/samuel` | Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md |
| IAM actions that failed Sep 25 | `iam:PutRolePolicy` (403, identity-policy gap) | Same repo file |
| IAM actions that failed Oct 9 | `iam:GetInstanceProfile`, `iam:TagInstanceProfile`, `sts:GetCallerIdentity` (+ earlier `ec2:TagInstanceProfile` misattribution on the call — tagging an instance profile is an **iam:** action) | Granola db4f0e91 summary+transcript |
| Official operator-side preflight list (autoscaler install) | **31 actions**: `sts:GetCallerIdentity`; EKS: `DescribeCluster`, `ListNodegroups`, `DescribeNodegroup`, `ListAccessEntries`, `CreateAccessEntry`; IAM roles: `GetRole`, `CreateRole`, `UpdateAssumeRolePolicy`; instance profiles: `GetInstanceProfile`, `CreateInstanceProfile`, `AddRoleToInstanceProfile`; IAM policies: `ListPolicies`, `GetPolicy`, `CreatePolicy`, `ListPolicyVersions`, `GetPolicyVersion`, `CreatePolicyVersion`, `DeletePolicyVersion`, `AttachRolePolicy`, `PutRolePolicy`, `ListAttachedRolePolicies`, `CreateServiceLinkedRole`, `PassRole`; EC2: `DescribeSecurityGroups`, `CreateSecurityGroup`, `AuthorizeSecurityGroupEgress`, `AuthorizeSecurityGroupIngress`, `CreateTags`, `DescribeLaunchTemplateVersions`; `autoscaling:DescribeAutoScalingGroups` | Official script template: GET https://api.eu.cast.ai/v1/scripts/eks/onboarding.sh (HTTP 200, 1,987 lines, PERMS block lines 1318–1363), pulled 2026-10-15T17:00:54Z |
| Permissions CAST AI's own role gets (created by the script) | Managed policy `CastEKSPolicy-<cluster>`: `iam:PassRole` (to ec2 + eks services), `iam:CreateServiceLinkedRole`, `ec2:CreateTags`, `ec2:RunInstances`, `ec2:DeleteKeyPair`, `ec2:ImportKeyPair`, `ec2:DescribeCapacityReservations`; inline policy: tag-restricted `ec2:RunInstances/Terminate/Start/Stop/CreateTags`, autoscaling group actions, `eks:Describe*/List*/TagResource/CreateNodegroup/DeleteNodegroup`, launch-template mgmt; AWS managed policies attached: `AmazonEC2ReadOnlyAccess`, `IAMReadOnlyAccess`; worker instance-profile role gets `AmazonEKSWorkerNodePolicy` + `AmazonEC2ContainerRegistryReadOnly` | Same script, lines 640–650, 775, 942 |
| ⚠ Policy-doc gap to expect live | `iam:TagInstanceProfile` failed on Oct 9 but is **not** in the current script's preflight list → keep it (and `iam:TagRole`, `iam:RemoveRoleFromInstanceProfile`, `iam:DetachRolePolicy`, `iam:DeleteRole` from the Terraform path) in the paste-ready policy so prod mirroring doesn't rediscover it | Granola db4f0e91; repo docs/castai/terraform-e2e.md §5.1 |
| Docs to cite on the call | https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/connect-with-castctl · https://docs.cast.ai/docs/autoscaler-checklist (docs SPA — script template above is the machine-readable equivalent) | docs.cast.ai nav, fetched 2026-10-15 |
| Samuel's email confirmation of the final Oct-9 run | **Not found** in Granola (searched Oct 10–15) | Granola search, 2026-10-15 |

---

## 4. Open action items (owner → item → status)

1. **Samuel Frunza-Hincu → email confirmation that the final Oct-9 Helm run completed** → **overdue / unverified.** No email found in searchable notes. Live API says agent online + reconcile ok, 0 CAST-managed nodes → likely "installed, not yet configured".
2. **Samuel → IAM policy mirroring prep for production cluster** → agreed Oct 9: prepare but **do not deploy** until dev validated. Prep status unverified.
3. **Ebrahim → send recurring weekly invite (same slot)** → committed Oct 9; this meeting exists on the calendar, so done (invite itself unverified but implied).
4. **Fan Yang / org-admin (unnamed cluster owner) → CAST AI console invite for Samuel to org IT DF COL UC 2** → open since Sep 25; still no console access as of Oct 9 (screen-share driven). CAST AI-side org API key is read-only — cannot invite; customer-side org-admin action.
5. **Cluster owner (unnamed) → token rotation once onboarding stabilizes** → flagged Sep 25 (token circulated via plaintext email) and again relevant Oct 9 (new token pasted in Teams chat). Old token stays valid ≥60 min post-rotation; on rotation update the `castai-credentials` secret and restart all components.
6. **Ebrahim → configuration walkthrough on dev** → deferred from #4, this meeting's main agenda. Conservative first-activation scope recommended (rebalancing/spot/hibernation OFF; startup-delay set; StatefulSets excluded).
7. **Team → resolve region/profile ambiguity** → Sep-25 notes mention us-east-1/EUS1 nodes; API + all 6 current nodes say **eu-west-1**. One profile with both kubectl + AWS access still Samuel's environment debt.

---

## 5. Questions to ask in the meeting (quotable)

1. "Samuel — did the final October 9th Helm run actually finish green? We never got the email confirmation. For what it's worth, our side shows the agent online and the reconciler healthy, so I just need your yes."
2. "On your screen, do you now see both checkmarks — cluster optimization and workload autoscaler — as installed, and is anything still pending in the CAST AI agent logs?"
3. "Which AWS profile and region is the authoritative one on your side now — account 951463557399, role siemenstest-siemenstest-ir-admin, eu-west-1? Let's write that one down and kill the split-profile problem for good."
4. "Who exactly holds the CAST AI console access for the IT DF COL UC 2 org — and can we get Samuel invited today so he stops working blind through screen-shares?"
5. "For production: is the prod account's IAM setup — permission boundaries, SCPs — identical to the test account's, or do we need a policy diff reviewed by someone on the Siemens side?"
6. "Which production cluster are we mirroring to, in which account and region — and who reviews the final IAM policy document before it's applied there?"
7. "If dev stays stable after today's walkthrough, what date are we targeting for the production deployment?"
8. "Before we touch production, can we rotate the cluster token once? It's been shared over email and Teams chat twice already."
9. "For the walkthrough: which workloads on the test cluster are safe first candidates for autoscaling — anything stateful or disruption-sensitive we should exclude from day one?"

---

## 6. Risks / watch-outs

- **Confirmation gap:** the Oct-9 "final run" was never confirmed; treat as *probably installed* (agent online, reconcile ok) but verify live with Samuel before starting the walkthrough — the walkthrough itself will surface the truth.
- **No CAST-managed nodes yet** (0 of 6): nothing has actually been optimized; first node-provisioning attempt may hit *new* IAM edges (instance-profile tagging failed on Oct 9; `eks.instanceProfileArn` in our record is still empty — node configuration not yet created).
- **Policy drift into prod:** Samuel builds IAM policies by hand from old snippets — that behavior caused three mid-install failures on Oct 9. Mitigation: deliver ONE complete paste-ready policy document (§3 row "Official operator-side preflight list" + the observed extras), and have the same document reviewed for prod before mirroring.
- **Token expiry recurs every session** (Sep 25, Oct 9). Mint a fresh one *before* the call; if a previous token is still cached anywhere, expect 401s; old tokens linger valid ≥60 min.
- **Samuel has no console access** and works from a containerized K9s env with split profiles — every step is screen-share + chat-paste driven; slow, error-prone, and the chat history has been lost before (Sep 25).
- **Prod environment may differ:** separate Siemens engagement (DI FA vLab, Oct 5) hit explicit *permissions-boundary* denies on role creation — a different IAM mechanism than UC 2's identity-policy gaps. If the UC 2 prod account carries boundaries/SCPs, the test policy document will not port 1:1.
- **Nobody from Siemens-owning side may attend:** Malika (approver) missed #4; a prod deployment date shouldn't be promised without Siemens sign-off.
- **Don't quote savings yet:** recommendations need ~1 week of workload history after first activation; the cluster has zero CAST-managed nodes today.
- **Do not conflate** this engagement with: IT DF COL UC (org with 0 clusters), Siemens Dev vLab series (Vijay/Paras, umbrella-chart migration, Sep 28), or the DI FA vLab DaemonSet/boundary cases (Oct 2–5).

---

## 7. Tonight's prep checklist

1. **Re-pull the cluster before bed or 08:00 tomorrow:** `GET https://api.eu.cast.ai/v1/kubernetes/external-clusters` (headers X-API-Key + X-CastAI-Organization-Id: 2b9d9744-f37d-4a22-b9c6-2f1857a5417d) → confirm agentStatus still online; then `GET …/36575565-7149-431b-b5f6-71f43f18ef3f/nodes` → check if any node became CAST-managed overnight.
2. **Prepare the one-page IAM policy document** for hand-paste: the 31-action operator preflight list (from the official onboarding script template, saved locally at /tmp/onboarding-eks.sh lines 1318–1363) **plus** the observed extras: `iam:TagInstanceProfile`, `iam:TagRole`, `iam:RemoveRoleFromInstanceProfile`, `iam:DetachRolePolicy`, `iam:DeleteRole` — scoped to `arn:aws:iam::951463557399:role/cast-*` & instance profiles where possible. Store it as a clean .json ready to paste (do not email it — chat on the call).
3. **Mint a fresh cluster token** via console.eu.cast.ai → org IT DF COL UC 2 → cluster 36575565 → generate; stage it in the password manager for live handover. Have the rotation runbook open (.kimchi/docs/rotate-token-manual-commands.md).
4. **Open tabs:** console.eu.cast.ai (org IT DF COL UC 2 cluster page) · https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/connect-with-castctl · labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md (exact role/ARN names) · Granola note db4f0e91 (Oct 9).
5. **Draft the conservative first-activation scope** as a short checklist: startup delay on, spot OFF, rebalancing OFF, hibernation OFF, StatefulSet + disruption-sensitive workload exclusions, min/max request constraints — ready to configure live during the walkthrough.
6. **Verify the Teams invite** for tomorrow 10:30 is the recurring one and includes the full #4 participant list (esp. Malika Hoffer — her sign-off gates any prod date).
7. **Rehearse the 60-second state summary** (from §3): "agent online, 6 nodes, none managed yet, IAM policy doc ready, token ready — today we configure dev."

---

## 8. Sources

**Granola (read 2026-10-15):**
- [Follow-up #4 — Oct 9, 2026](https://notes.granola.ai/d/db4f0e91-089b-49a0-8131-71b889d415eb) — summary + full transcript (id `db4f0e91-089b-49a0-8131-71b889d415eb`)
- [Follow-up #3 — Sep 25, 2026](https://notes.granola.ai/d/1230e87c-50c6-4c69-8330-ab8a663f7711) — summary + full transcript (id `1230e87c-50c6-4c69-8330-ab8a663f7711`)
- Granola query 2026-10-15: no Conceptboard/UC 2 activity or Samuel confirmation found Oct 10–15; follow-ups #1–#2 have no notes in range (unverified).
- Note: Granola sitewide results for "follow-up #1/#2" (Sep 21 id `3bd96503-…`, Sep 28 id `44d132c8-…`) belong to the **Siemens Dev vLab** series (Vijay Kumar / Paras Puri / Christoph Göbels, umbrella-chart migration) — a *different* engagement; excluded from the UC 2 timeline.

**Repo:**
- `labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md` — Sep-25 timeline, root cause, IAM fix JSON, CAST AI-side state
- `labs/putrolepolicy-403/MEETING-PREP-followup4.md` — #4 prep (Teams link, command sheet)
- `labs/putrolepolicy-403/REPLY-to-samuel.md` — drafted customer reply (unsent draft)
- `brain/notes/PutRolePolicy 403 Case.md` — brain precedent
- `docs/castai/terraform-e2e.md` §5.1 — operator-side IAM list (Terraform path)
- `outbox/meeting-prep/meeting-prep-2026-10-16.md` (10:30 section) — day-level consolidated prep
- `outbox/case-threads/20261005T081407Z-case.md` — DI FA vLab permission-boundary precedent (different org/account; analogy only)
- `.kimchi/docs/onboarding-demo-next-session.md` — ~1-week telemetry before meaningful recommendations

**CAST AI EU API (https://api.eu.cast.ai) — GET-only, X-API-Key [+ X-CastAI-Organization-Id where marked]:**
- `GET /v1/organizations` — HTTP 200, pulled 2026-10-15T16:59:46Z (org ids, created-dates; SI GSW CLO `07aa3c29-…` is a different org, not used here)
- `GET /v1/kubernetes/external-clusters` with org id `2b9d9744-…` — HTTP 200, pulled 2026-10-15T16:59:49Z (cluster status, agentStatus online, reconcileInfo, isPhase2, assumeRoleArn)
- `GET /v1/kubernetes/external-clusters/36575565-7149-431b-b5f6-71f43f18ef3f/nodes` — HTTP 200, pulled 2026-10-15T16:59:59Z (6 nodes, 0 CAST-managed)
- `GET /v1/cost-reports/clusters/36575565-…/resource-usage` — HTTP 200, pulled 2026-10-15T17:02:18Z (14 vCPU/96 GiB provisioned, 10.2 vCPU requested)
- `GET /v1/scripts/eks/onboarding.sh` — HTTP 200, pulled 2026-10-15T17:00:54Z (official script: operator PERMS block L1318–1363; CastEKSPolicy JSON L649; inline cluster policy L648; managed-policy attachments L942; role naming L640)

**Official docs:** https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/connect-with-castctl · https://docs.cast.ai/docs/autoscaler-checklist · module source: github.com/castai/terraform-castai-eks-role-iam (policy JSON is server-generated per cluster via `castai_eks_settings`).
