# Meeting Prep — Friday, October 16, 2026

Prepared for Ebrahim Ramadan · compiled Thu 2026-10-15 ~20:15 Europe/Riga · all data read-only (Granola meeting notes, engagement repo docs, live read-only CAST AI EU API where available). Declined meetings ("Cast AI 1 to 1 | DI PA MI 2", "Cast AI x Siemens | DSC GTE CLO") and Focus/Pray blocks are excluded.

## Day at a glance

| Time | Meeting | Core objective | The one must-ask |
|---|---|---|---|
| 9:30 | Cast AI & Siemens — Org Structure | Agree BU property + Application ID access model and ONE delivery path | Who owns the canonical BU enum and the BU→org backfill mapping? |
| 10:30 | 1to1 — IT DF COL UC 2 | Confirm Oct 9 install completed; run config walkthrough on test | Is the agent online now, and which AWS profile/region is authoritative? |
| 12:30 | SMO Railigent X | Align Sept WOOP value story + time-off contacts + next steps | Which non-prod cluster hosts a node-autoscaling pilot, with what success criterion? |
| 15:00 | SiBase X #3 (APM0414470) | Log image-signing ticket today; agree Karpenter pilot option + metrics | Which signing tool (Cosign/Notary/Sigstore) and admission controller (Kyverno/Gatekeeper)? |
| 17:00 | Cluster Score Review | Lock top-10 red clusters with DRIs; align restated Sept numbers | Quote September ONLY on the restated basis — agreed? |

## Cross-cutting thread for tomorrow

- September savings methodology: Value Realization API (V1 beta) is the single source of truth. Node Realized Savings already INCLUDE workload savings — report the $14,746.76 Workload-Autoscaler line separately; never sum. September fleet savings were RESTATED $320,348.65 → $86,106.22 (36 clusters) after the CSU-6233 baseline bug fix; corrections were still landing on Oct 15. Quote pull timestamps.
- Karpenter posture is consistent across meetings 12:30 and 15:00: Karpenter stays the node provisioner; CAST AI adds workload right-sizing + Spot-fallback/rebalancing as a pilot first. The Sep 30 full-replacement incident (undersized nodes, ~25-min disruption, rollback) is the reason Option 4 is never step one.
- Access/permissions theme runs through 9:30 and 10:30: apply full authoritative policy JSONs (no manual snippet assembly); mint fresh tokens before calls; mind Siemens permission boundaries (vLab precedent).
- People: Sergej Petrovski = API power user, CC on all API follow-ups. Ahmed Khaldi = TAM, /scorecards automation owner. Accenture implementers: Christoph Goebels, Fabian Jennrich, Fan Yang, Tahmid Shibly. Coverage: Ahmed Tue–Thu, Ebrahim Mon/Fri.

---

### 9:30 — Cast AI & Siemens — Cast AI Org Structure

*Assumptions: attendee list inferred from the Sep 8 session of this same series; "Sergej" = Sergej Petrovski (transcripts sometimes spell "Sergey").*

- **Attendees & roles**
  - Siemens: Sergej Petrovski (drives this thread; REST API power user — CC him on ALL API-related follow-ups, standing request 2026-10-13); likely Bosko Corak, plus Christoph Goebels / Fabian Jennrich / Tahmid Shibly (Accenture, implementers).
  - CAST AI: Ebrahim (customer engineer); Aleksy Zaleński (owns API-flow validation), Renata Klimiato (owns fine-grained service-account feasibility), Guy Faigenboim, Ahmed Khaldi, Theodor Iacob (pipeline approach), Alexandra Bakalova attended the Oct 14 internal sync.

- **Objective / definition of success**
  - Agree on how user & group access will be managed off the new **BU property** and the proposed **"Application ID" (APM*) text field** — e.g., "analytical access to all orgs where BU=DI."
  - Align on ONE delivery path (pipeline hook vs fine-grained service accounts), confirm the backfill owner/mapping, and leave with a dated commitment for the FinOps-champion rollout.

- **Background & history**
  - Aug 10 — CAST internal consensus: "map BUs to organizations, no need for nested sub-orgs."
  - Sep 7 — Requirement: BU champions must NOT see other BUs' cost data.
  - Sep 8 (this same series) — Agreed: flat structure stays, mandatory BU tag per child org (DI, SI, SMO…); **Analyst role** = best fit for FinOps champions (read-only, no cluster edits); bulk API backfill needed; create 2–3 tags upfront.
  - Sep 18 — RACI session: org-structure question months old.
  - Sep 28 — Interim over-exposure: Vijay & Paras granted full-org owner-level access to unblock; needs scoping down.
  - Sep 29 — CAST engineering building FinOps role with tag-based org access ("next sprint"); Oct 2 ETA "weeks, not days."
  - Oct 5 — Enterprise cost visibility may require "Super Enterprise Admin" — champion role fit for the cost surface unconfirmed.
  - Oct 12 — CFR-1536 internal drafts; verified 126 child orgs.
  - Oct 14 (internal sync) — Two paths: (1) Theo's pipeline hook in John's self-service portal (extra API call at org creation; only enterprise owners can create orgs, so enforceable); (2) Renata's fine-grained service accounts (one SA scoped to multiple child orgs, reuses fine-grained PAT logic — preferred, but not built). Open: Aleksy to validate role-binding API flow end-to-end (no missing IDs); Renata to confirm feasibility by Thursday; ideal outcome was presenting both options + a dummy-org demo to Sergej. Also: no API returns the orgs a user belongs to yet (UI maintenance as fallback).

- **Key numbers** (verified)
  - **126 child orgs** under Siemens enterprise (verified read-only Oct 12); live API today returns **131 total org objects** and confirms the org schema has **no tag/property field** (only `id, name, createdAt, type, internal, organizationMember, blockEscalatedPrivilege`) — the BU property is genuinely net-new.
  - Clusters: ~240 onboarded of ~1,000 (Oct 12) / ~900 total with **target 800 onboarded by February** (Oct 14 note).
  - Growth: 71 new child orgs in Aug+Sep (36/35), ~35/month; teams restructure ~every 3 years.
  - Accenture: ~$1M implementation spend; Ibrahim (PS) onboards 2 days/week.

- **Talking points**
  1. No hierarchy change — BU is an **org property, visibility metadata only**; enterprise discounts stay top-level and propagate.
  2. BU property spec: mandatory, admin-defined enum (DI, SI, SMO…) + `n/a`, owned at enterprise level, enforced on create (console + API), audit-logged, extensible to Sergej's "BU second level" later *without migration* — but keep it simple now (Bosko's steer).
  3. Application ID: text field, values "APM…" — propose format validation; clarify whether it's the join-key to Siemens CMDB/FinOps tooling (MyIT/ServiceNow/Cloudability mentioned earlier).
  4. Analyst role for champions — flag the unresolved discounted-cost visibility question (Oct 5) before promising reporting.
  5. Access automation: manual per-BU grants are scriptable TODAY via `/v1/organizations/{orgId}/groups` + `.../role-bindings`; rule-based binding ("grant X where BU=Y") is net-new engineering. Present pipeline vs fine-grained SA trade-off; end state = auto-assignment at org creation.
  6. Backfill: one-time ~130-call bulk job, but name-parsing is unreliable (APM-named, test/template orgs like `APMXXXX - APP NAME`) — Siemens must supply the BU→org mapping; the canonical BU list (Bosko/Christoph) is the blocker.

- **Questions Ebrahim should ask**
  1. Who owns the canonical BU enum and its change process on the Siemens side? Exact values?
  2. Who supplies the BU→org (and APM→org) backfill mapping, and by when?
  3. Application ID: mandatory, unique, validated against a Siemens registry?
  4. Preference: pipeline hook in John's portal (shippable sooner) vs fine-grained service accounts (cleaner, later)?
  5. Pilot acceptance: can 2–3 champions start with manually-scripted BU groups while the rule ships?
  6. iWire/SSO constraints on service accounts vs user-level groups; expiry/re-certification expectations for grants?
  7. Deadline driving the champion rollout — and does the 800-cluster Feb target keep org growth at ~35/mo?

- **Risks / watch-outs**
  - Analyst/Viewer roles may not expose discounted enterprise cost views (Oct 5 signal) — don't commit to reporting until checked.
  - Rule-based bindings + org-property schema are genuine engineering ("weeks, not days") — avoid firm dates before Renata's answer.
  - Outstanding over-exposure: Vijay/Paras full-org owner grants since Sep 28; every new champion grant repeats the pattern until grouping exists.
  - Churn: ~35 new orgs/month decays any manual interim fast — propose a weekly untagged-org report.
  - Sergej's flat-structure quote is email-only (not found in ~12 searched notes/transcripts) — paraphrase, don't quote him to himself.
  - Cross-customer CFR references (NASDAQ/BMW/Deloitte) need careful framing if used.

- **Tonight's prep checklist**
  1. Collect Aleksy's role-binding validation result + Renata's feasibility answer (were due today).
  2. Decide demo plan: live dummy org + binding calls if Aleksy green-lit; else walk payloads conceptually.
  3. Re-read outbox/cfr-1536-comment-draft-2026-10-12.md and outbox/cfr-input-siemens-child-org-2026-10-12.md.
  4. Re-verify the live org count in console; separate Siemens vs non-Siemens entries in the 131 returned.
  5. Confirm final attendee list; draft follow-up email skeleton (CC Sergej per his standing rule).
  6. Prepare the "org creation without BU = what happens?" enforcement question.

- **API payload sketch** (conceptual — property endpoints don't exist yet)
  - Bulk backfill (net-new endpoint — proposed shape): `PATCH /v1/organizations/{orgId}/properties` with body `{ "properties": { "bu": "DI", "applicationId": "APM12345" } }`
  - Group assignment (works today, per org, scriptable): `POST /v1/organizations/{orgId}/role-bindings` with `{ "subject": { "kind": "GROUP", "id": "<finops-di-group-uuid>" }, "roleId": "analyst" }`
  - Future rule-based binding (the engineering ask): `POST /v1/organizations/<enterpriseId>/group-rules` with `{ "role": "analyst", "subject": { "kind": "GROUP", "name": "finops-di" }, "filter": "organization.properties.bu == 'DI'", "onCreate": true }`

- **Sources**
  - Granola: [INTERNAL — Siemens org structure, Oct 14](https://notes.granola.ai/d/dea2cba7-fcfc-4193-9dd0-698ef093ae92) · [Cast AI & Siemens org structure, Sep 8](https://notes.granola.ai/d/81b10bdc-727d-4d75-b082-ba608a253e1f) · [BU champion access](https://notes.granola.ai/d/ff220548-a48a-4df3-ba6e-fcf5d4f7806e) · [metadata/CMDB](https://notes.granola.ai/d/e1d4c656-8e55-4790-becb-16fad4c9a718) · [ownership gaps](https://notes.granola.ai/d/22f0f422-0418-453d-bf05-8503ceeceedf)
  - Repo: outbox/cfr-1536-comment-draft-2026-10-12.md · outbox/cfr-input-siemens-child-org-2026-10-12.md · outbox/cfr-1536-reply-theodor-final-2026-10-12.md · outbox/cfr-1536-support-ahmed-2026-10-12.md · brain/notes/Siemens People.md
  - API: `GET https://api.eu.cast.ai/v1/organizations` → HTTP 200, 2026-10-15 (131 orgs; schema confirms no property/tag field). Read-only; no secrets printed.

---

### 10:30 — Cast AI 1 to 1 | IT DF COL UC 2 — Weekly Follow up

- **Attendees & roles**
  Ebrahim Ramadan (CAST AI, host/engineer). Conceptboard: Samuel Frunza-Hincu (hands-on executor; owns IAM policy updates; works from containerized K9s with split AWS+kubectl profiles; cannot log into CAST AI console), Umair Shahid, Markus These. Siemens: Malika Hoffer (decision approver — approved autoscaling on dev), Guelen Toker, Adolfo Cabacinhas-ribeiro. Accenture: Fan Yang, Fabian Jennrich, Christoph Göbels, Tahmid Shibly (coordination). Cluster owner (unnamed) holds the token + console access.

- **Objective / definition of success**
  Confirm the Oct 9 final Helm/autoscaling run completed on the dev/test cluster (Samuel owed email confirmation — unverified), run the configuration walkthrough on dev/test, agree on a conservative first-activation scope, and fix a production timeline gated on dev stability. Success = agent online + autoscaling registered + walkthrough done + dated prod-mirror plan.

- **Background & history**
  - **2026-09-25 (Follow-up #3):** castctl/CLI blockers; token expired→regenerated; split kubectl/AWS profiles + region mismatch (default eu-west-1 vs us-east-1/EUS1 nodes) blocked install. Repo case file: read-only (cost-monitoring) onboarding succeeded 11:58 CEST; full-mode connect failed 15:27 CEST on `iam:PutRolePolicy` 403 — identity-policy gap on deployer role `siemenstest-siemenstest-ir-admin`, not an SCP.
  - **2026-10-09 (Follow-up #4):** Malika pre-approved autoscaling; cluster still read-only. Token had expired again — Ebrahim minted a new one in-meeting. Repeated mid-install failures: missing `iam:GetInstanceProfile`, `TagInstanceProfile`, `sts:GetCallerIdentity`; Samuel had been assembling policies manually from older JSON snippets. Ebrahim shared the full required policy; permissions added incrementally. Final Helm run appeared error-free but was **not confirmed** before session end. Decision: validate on test first; prod postponed until successful; Samuel mirrors IAM for prod; weekly cadence continues.

- **Key numbers / cluster status** (verified where possible)
  Org `IT DF COL UC 2` (`2b9d9744-f37d-4a22-b9c6-2f1857a5417d`); cluster `siemenstest-siemenstest-1` (`36575565-7149-431b-b5f6-71f43f18ef3f`), EKS; AWS account `951463557399`; deployer `assumed-role/siemenstest-siemenstest-ir-admin/samuel`. Last API-verified (2026-09-25 ~15:45 UTC): status `ready`, agent `online`, 5 nodes (1× m5a.xlarge, 4× r6a.large, none CAST AI-managed), telemetry flowing, Node Autoscaler NOT enabled. **Post-Oct-9 state: unverified** — refresh via GET `/v1/kubernetes/external-clusters/36575565-7149-431b-b5f6-71f43f18ef3f` or the console before the meeting. Region discrepancy to resolve: case file says eu-west-1; Sep-25 notes say nodes in us-east-1.

- **Talking points**
  1. **IAM checklist for Samuel to verify:** `sts:GetCallerIdentity`; instance profile: `iam:GetInstanceProfile`, `iam:CreateInstanceProfile`, `iam:AddRoleToInstanceProfile`, `iam:RemoveRoleFromInstanceProfile`; `iam:PassRole` scoped to `cast-eks-*`/`castai-eks-*` ARNs; tagging: `ec2:CreateTags`/`ec2:DeleteTags` + `iam:TagRole`/`iam:TagInstanceProfile` (TagInstanceProfile is an **iam:** action — align to the authoritative CAST AI policy JSON, not older snippets); from the Sep-25 blocker: `iam:PutRolePolicy`/`GetRolePolicy`/`DeleteRolePolicy` on `cast-eks-*`, `cast-kvisor-*`; full mode adds `iam:CreateRole/CreatePolicy/AttachRolePolicy/DetachRolePolicy/DeleteRole`, `eks:DescribeCluster/ListClusters`, `ec2:Describe*`. Key fix: apply the full policy JSON as one document — stop manual snippet assembly.
  2. **Token for someone without console access:** Ebrahim mints via console.eu.cast.ai (cluster → generate token) or `POST /v1/kubernetes/external-clusters/36575565-7149-431b-b5f6-71f43f18ef3f/token` with the org API key (`X-API-Key`, api.eu.cast.ai), handed over live via secure channel. Caveats: org API key is management-API-only, never a cluster-token replacement; previous token stays valid ≥60 min, so update every secret + restart all components; a token circulated via plaintext email Sep 25 — flag rotation once stable.
  3. **Conservative first-activation:** limited/canary scope; startup-delay/stabilization window so JVM warm-up spikes don't trigger upsizes; exclude StatefulSets and disruption-sensitive workloads via annotations/policy exclusions; rebalancing, spot, and hibernation OFF initially; min/max request constraints; recommendations meaningful after ~1 week of history.

- **Questions Ebrahim should ask**
  1. Did the final Oct-9 run complete; is the agent online (email confirmation status)?
  2. Which AWS profile/region is authoritative now?
  3. Who is the cluster owner — can they get Samuel invited to org IT DF COL UC 2 (org-admin/Accenture action; CAST AI-side key is read-only)?
  4. Is the prod account's permissions boundary identical to test's (DI FA vLab, Oct 5: boundaries blocked role creation there)?
  5. What date gates the prod mirror? Who reviews prod policy changes?

- **Risks / watch-outs**
  Manual JSON snippet assembly → policy drift (root cause of Oct 9 churn). Region/profile split still unresolved. Token expiry mid-meeting — mint fresh beforehand. Prod account may carry different SCPs/permission boundaries (vLab precedent). No console access → screen-share-driven walkthrough. Plaintext-email token hygiene. Don't promise immediate savings figures.

- **Tonight's prep checklist**
  1. Refresh cluster state via API/console (agent online? autoscaler registered?).
  2. Mint a fresh cluster token, staged securely for in-call handover.
  3. Open the authoritative full IAM policy JSON (docs.cast.ai EKS).
  4. Confirm the recurring invite is sent/accepted for 10:30.
  5. Prepare conservative-policy examples (startup-delay, StatefulSet exclusions).
  6. Skim the Sep-25 case file for exact role/ARN names.

- **Sources**
  Granola: [Follow-up #4, Oct 9](https://notes.granola.ai/d/db4f0e91-089b-49a0-8131-71b889d415eb); [Follow-up #3, Sep 25](https://notes.granola.ai/d/1230e87c-50c6-4c69-8330-ab8a663f7711). Follow-ups #1–#2 have no Granola notes in range (2026-08-01→10-15). Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md; docs/castai/terraform-e2e.md (§5.1 IAM list); .kimchi/docs/rotate-token-manual-commands.md; .kimchi/docs/siemens-castai-token-rotation-meeting-brief.md; .kimchi/docs/onboarding-demo-next-session.md; outbox/case-threads/20261005T081407Z-case.md (boundary precedent). API endpoints: `GET https://api.eu.cast.ai/v1/kubernetes/external-clusters/36575565-7149-431b-b5f6-71f43f18ef3f` (to run before the meeting); `POST …/external-clusters/{clusterId}/token` (documented, human-run only).

---

### 12:30 — SIEMENS x Cast AI | SMO Railigent X — Alignment & Potential Next Steps

**Attendees & roles**
- Cast AI: Ebrahim Ramadan (customer engineer, Siemens), Ahmed Khaldi (TAM; note-taker on Siemens cadence calls)
- Accenture (implementation partner): Christoph Goebels (organizer), Fabian Jennrich, Fan Yang, Tahmid Shibly
- Siemens: Andreas Schieb (Railigent X cluster owner — the only human who ever flipped WOOP policies readonly→managed org-wide, in three bulk waves Jun–Jul 2026); possibly Sunil Bandi / SMO-RI-CSX team from the weekly sync
- Coverage/escalation (established Aug): Ahmed primary Tue–Thu, Ebrahim Mon/Fri; Ebrahim stays CC'd as fallback during onboarding sprints. Escalation path: Aleksy Zaleński (SA, SALP-129) → Carl Gridley (account).

**Objective / definition of success**
Align on the September Workload Autoscaler (WOOP) value story for the 8 SMO Railigent X clusters, confirm points of contact during the upcoming time off, and leave with 1–2 concrete next steps (node-autoscaling pilot + WOOP coverage expansion).

**Background & history**
- Apr–Jul 2026: WOOP installed on all Karpenter clusters in org SMO Railigent X (`f15f33b9-20ad-4128-8289-da529844d3f0`); Andreas Schieb activated customer-workload optimization in 3 waves (06-24, 07-02, 07-14).
- Aug/Sep: WOOP matured to 85–97% VPA adoption; CPU requests cut 36–78% fleet-wide — with Karpenter still running nodes (no CAST node autoscaling).
- Oct 12: k8s-andreas anomaly ($158,738 "savings" on $754 actual) root-caused (INDUSTRY_AVERAGE baseline frozen over a 24h window → ×169 CPU factor); decision to exclude Karpenter/Enterprise Suite clusters from node-level savings reports. Bug = CSU-6233; fix merged, savings recalculated. WOOP-track savings on these clusters are measured separately and are clean.
- Oct 14: weekly SMO-RI-CSX-CS call — first Azure test cluster connected via `CASTAI_IMPERSONATE` workaround; 28 more Azure clusters pending; Fan to sync with Sunil next week.

**Key numbers**
- Reported September WOOP savings: **$8,513.97 across 8 clusters, without node autoscaling** (from Ebrahim's distributed reporting; pull for a fresh per-cluster breakdown — see checklist 1).
- Fleet context (Oct 5 audit): 9 productive Karpenter clusters + dormant rhx-test; CPU requests −36%…−78%; RAM cut on most, upsized on two — don't sell RAM savings there. Agent drift: 7 of 9 clusters on WOOP v1.2.5 vs current v1.14.1.
- Enterprise framing (Oct 12): ~$300K gross → $131K excl. Karpenter/ES → $121K headline across all Siemens orgs.

**Talking points**
1. $8.5K in September from request right-sizing alone — pure WOOP, defensible, baseline-bug-free track.
2. Node-level savings deliberately deferred (Karpenter); one non-prod pilot with CAST AI node autoscaler/rebalancing quantifies the upside without touching prod.
3. k8s-andreas fix is merged and recalculated; exclusions are reporting hygiene, not a value gap.
4. Agent upgrade (v1.2.5 → v1.14.1) unlocks scoped recommendations — a free win on 7 clusters.

**Questions Ebrahim should ask**
1. Which non-prod cluster (staging?) can host the node-autoscaling/rebalancing pilot, and what's the success criterion?
2. Can we expand WOOP opt-in coverage beyond current adoption and beyond the 8 clusters — what blocks the rest?
3. Time off: exact dates, primary contact per side, and does escalation route Ebrahim→Ahmed→Aleksy or direct?
4. Who owns the WOOP agent upgrade window?
5. Should the Sept WOOP figure feed the management report, on which basis (VR `workloadAutoscalerSavings`)?

**Risks / watch-outs**
- Never sum WOOP and node savings; VR `totalSavings == autoscalerSavings`, WOOP already inside.
- Don't cite k8s-andreas VR autoscaler figures — recalculated values only.
- WOOP savings views are limited in Karpenter mode ("Show Trend" proxy) — pre-answer the console question.
- Managed-identity onboarding for the remaining 28 Azure clusters is still workaround-based; no castctl GA dates.

**Tonight's prep checklist**
1. Pull per-cluster Sept WOOP savings via `POST /reporting/v1beta/organizations/f15f33b9-20ad-4128-8289-da529844d3f0/clusters:runValueRealizationReport` (2026-09-01→10-01, body `{"clusterIds":[…]}`, header `X-CastAI-Organization-Id`) to confirm $8,513.97 and build the table.
2. Confirm Goebels' attendee list and the time-off window.
3. Skim the k8s-andreas case doc for the 30-second bug-fix summary.
4. Draft the pilot proposal: scope, guardrails (no Turbo nodes), rollback.
5. Quote VR numbers with pull timestamps (recomputed on read).

**Sources**
- Granola: [Oct 12 decisions](https://notes.granola.ai/d/150ba07d-75f8-47f5-b324-e4aff6d780b0), [Oct 14 SMO-RI weekly](https://notes.granola.ai/d/056db3bf-5b0d-45c6-b9c7-efb21a7ec49e), [WOOP+Karpenter model](https://notes.granola.ai/d/18e3523c-8468-4e6f-9db4-56bfd6e451ee), [Sep 29 methodology](https://notes.granola.ai/d/02150355-46dd-440d-b409-121f7890f4b8), [coverage notes](https://notes.granola.ai/d/642192a4-eb91-4966-a402-bb64a61abbc1), [47e1c27b](https://notes.granola.ai/d/47e1c27b-0c4e-4ec0-baa7-0e8887d12777)
- Repo: .kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md, .kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md, .kimchi/docs/console-org-woop-enablement-2026-10.md, .kimchi/docs/woop-status-console-org-2026-10-05.md, .kimchi/docs/castai-api-savings-endpoints.md

---

### 15:00 — CAST AI 1 to 1 | APM0414470 — SiBase X — Follow Up Session #3

- **Attendees & roles**
Expected (adjacent Siemens follow-up pattern — confirm live): Ebrahim Ramadan (CAST AI CE, host); Fabian Jennrich + Tahmid Shibly + Fan Yang (Accenture, platform/Karpenter owners); Christoph Göbels (Siemens product owner); likely Paras Puri / Vijay Kumar (Siemens engineers) and Sven Kiebler. Granola holds **no note titled "SiBase X" or "APM0414470"** — attendee list is inferred from the Siemens 1-to-1 series.

- **Objective / definition of success**
(1) Capture the SiBase X security team's written image-signing/verification requirements (or capture them live) and log a CAST AI support ticket today; (2) agree which Karpenter↔CAST AI integration option to pilot in non-prod, with named metrics and a review date.

- **Background & history**
- *2026-08-03* — Siemens Cast.ai Adoption onsite workshop; onboarding wave begins.
- *2026-09-26* — Enterprise recon: **APM0414470 — SiBase X = 4 EKS clusters, all read-only/inventory-only in Sep** (no CAST AI fee, no savings) — matches the "4 read-only clusters" email context.
- *2026-09-28* — Fabian sync: 4 Karpenter+CAST AI options defined: 1) Karpenter alone; 2) Karpenter + Workload Autoscaler; 3) Karpenter + Node-Autoscaling add-on (Spot→on-demand fallback); 4) full CAST AI node autoscaling replacing Karpenter. Leadership concern: "don't want to manage Karpenter and CAST AI as 2 tools."
- *2026-09-30* — "Switch out Karpenter" incident on a Siemens integration cluster: full-switch attempt (Karpenter scaled to 0, NodePools imported to node templates, rebalance cut provisioned CPUs ~114→~56) hit **undersized-node failure** (autoscaler picked cheap 2–4 vCPU nodes, no min-CPU constraint set; ~25-min disruption, management escalation, rollback to Karpenter). Preconditions for any retry: min CPU ≥16 in all node templates; Jay to raise high-priority eng ticket. JVM workloads: startup-metrics policy so JVM start spikes aren't read as peak (~30-min startup-delay recommendation policy).
- *2026-10-05 / 10-12* — DI FA vLab follow-ups: IAM permission-boundary (CloudDevBoundary) blocks CLI install → Terraform-module path; live Frankfurt rebalance 5→3 nodes; open check that vulnerability scanner covers CAST AI-provisioned nodes.

- **Key numbers**
SiBase X: 4×`eks-cluster`, read-only (Sep-26 recon; orgs `da42870b-cc64-4239-b7f8-e223c32f76f8` "APM0414470 - SiBase X" + `0c6e0c08-78f6-4f8b-b2a6-da6dfa18d77a` "SiBase X"). Email context reports a significant provisioned-vs-actual gap — exact CPU/mem numbers to pull from the CAST AI console dashboard filtered to org `APM0414470 - SiBase X` before/at the call. Reference rebalance result from the Siemens integration cluster: provisioned vCPU −51% (114→56).

- **Talking points**
1. Security first: requirements doc pending — capture it live on the template below; commit to logging the ticket same-day.
2. Read-only findings: the 4 clusters show the provisioned-vs-requested gap; node autoscaling addresses provisioned vs requested, workload autoscaling addresses requested vs actual.
3. Pilot recommendation: **Option 2+3 combined** (Karpenter stays sole provisioner + CAST AI Karpenter-Enterprise layer: Workload Autoscaler rightsizing, Spot→OD fallback recommendations, Kentroller-driven rebalancing). Option 4 (full replacement) only after the pilot proves out — per Sep-30 incident.
4. Success metrics: cost per requested vCPU; bin-packing density (requested/provisioned vCPU ratio); Spot fallback stability (interruption recovery time, fallback-event count); gap vs the read-only baseline.

- **Questions Ebrahim should ask**
1. Which signing tool — Cosign, Notary, or Sigstore keyless? Verify at CI, at admission, or both?
2. Admission control already in place — Kyverno or Gatekeeper? Policies blocking, or audit-only?
3. Registry details: which registry(-ies), pull-through cache, private mirror? Must CAST AI images come from a specific registry/allow-list?
4. Where must verification happen for CAST AI-deployed components (agent, cluster-controller, autoscaler images) — namespace exemptions acceptable?
5. Pilot: confirm option 2+3 on one non-prod cluster; who owns scaling nothing down; timeline to review?
6. Metrics: agree 2–4 week window; baseline = current read-only numbers; target = density + $/requested vCPU improvement; Spot fallback SLO?

- **Image-signing support ticket — capture template**
Title: `[APM0414470 SiBase X] Container image signing & admission-control requirements`
  - Signing tool: ____ (Cosign / Notary / Sigstore keyless) · Key mgmt: ____ (KMS / keyless OIDC / BYOK)
  - Verification point(s): ____ (CI pipeline / registry webhook / cluster admission)
  - Admission controller: ____ (Kyverno / Gatekeeper / other) · Mode: ____ (enforce / audit)
  - Registry: ____ URL · mirror/proxy: ____ · allow-listed repos for CAST AI images: ____
  - Component scope: ____ (CAST AI agent / cluster-controller / workload-autoscaler / rebalancer / live-migration images)
  - Policy needs: signature, attestation (SBOM/SLSA?), expiry handling, emergency break-glass: ____
  - Contact for policy JSON: ____ · Ticket severity / target date: ____

- **Risks / watch-outs**
- Sep-30 incident is the elephant: never propose full Karpenter replacement as step 1; any option-4 retry needs min-CPU ≥16 in all node templates + gradual rebalance.
- JVM workloads: apply ~30-min startup-delay policy before rebalancing to avoid spikes.
- Leadership's "two tools" objection — position option 2+3 as *enhance, not maintain twice*.
- IAM permission boundaries (CloudDevBoundary) — Terraform install path, not CLI.
- Written security summary may not arrive before the call — the live-capture template is the fallback.

- **Tonight's prep checklist**
1. Open CAST AI console → org `APM0414470 - SiBase X` → export provisioned vs requested vs actual CPU/mem for the 4 clusters.
2. Pre-fill the ticket template; keep it open during the call.
3. Skim Sep-30 note for incident facts if challenged on option 4.
4. Have the Terraform onboarding module link + Hypercare ticket process (email inbox → ticket ID, reply-all) ready.
5. Confirm who's attending from the security team.

- **Sources**
Granola: [Sep 28 — 4 options](https://notes.granola.ai/d/f078d18a-babf-4fcc-8bda-6f0d64eefa1a) · [Sep 30 — Switch out Karpenter incident](https://notes.granola.ai/d/7e2eb50d-5e20-4e4b-89a1-8c276cb22e0b) · [DI FA vLab Follow-Up #2](https://notes.granola.ai/d/afa6a7a8-f9cf-401b-ad26-ead243fcaaaf) · [DI FA vLab Weekly](https://notes.granola.ai/d/097f7ceb-33b5-4884-a461-9650f012b979) · [Follow Up Session #1](https://notes.granola.ai/d/44d132c8-c218-4add-b842-08900b4c8ba3) · [Hypercare ticket process](https://notes.granola.ai/d/22f0f422-0418-453d-bf05-8503ceeceedf). No SiBase-named note exists — verified by direct query.
Repo: cluster-cost-analysis/helios-recon-2026-10-12/ENTERPRISE-SEP26-NET-SAVINGS.md (line 258: SiBase X 4 clusters unmanaged) · brain/notes/Karpenter + CAST AI Coexistence.md · KARPENTER-CASTAI-CLM-LEARNINGS.md · .kimchi/docs/karpenter-castai-eks-analysis.md · brain/notes/Siemens Fleet.md · brain/notes/Siemens People.md.
API: GET `/v1/organizations` (200 — org ids above); per-cluster gap numbers to be pulled from the console before the call.

---

### 17:00 — Cast AI Cluster Score Review

- **Attendees & roles** — Ebrahim Ramadan (CAST AI CE, Siemens account). Expected per Oct 9 pattern: Sergej Petrovski (Siemens, REST API/automation driver), Ahmed Khaldi (CAST AI TAM, /scorecards script owner). Confirm invite: Bosko Corak (Siemens orchestrator), Carl Gridley (CAST AI account).

- **Objective / definition of success** — Leave the call with (1) a locked top-5–10 red-cluster list, each with named DRI + date; (2) intentional opt-out clusters (e.g., GSW) explicitly flagged so low scores aren't read as failures; (3) status/date for Sergej×Ahmed /scorecards automation; (4) Helios cost-string investigation closed; (5) everyone aligned that September numbers are quoted on the RESTATED basis.

- **Background & history**
  - **Oct 8–9** — First score review (Sergej, Ahmed, Ebrahim): Siemens clusters max ~7.9, most 2–3 (Poor/Red); 7+ agreed as realistic ceiling given instance/disk constraints. Console 10-08 snap: CPS main 4.9 / test 6.2.
  - **Oct 9** — SI GSW Exchange: no confirmed net savings on Helios/Intec once costs+fees counted; WOOP ruled out for R&D (on-prem parity).
  - **Oct 12** — VR API (V1 beta) adopted as single source of truth; totalSavings == autoscalerSavings (WOOP already inside — never sum); same day: exclude Karpenter/Enterprise Suite; don't publish unexplained outliers.
  - **Oct 13–15** — CSU-6233 fix merged (k8s-andreas ×170/×35 baseline bug); September fleet savings **restated $320,348.65 → $86,106.22** across 36 clusters; corrections still landing today (HAFAS override 09:26Z).

- **Key numbers** — Score buckets: 7–10 Healthy / 4–6 Concerning / 0–3 Poor. Distributed Sept report: **$14,746.76 Workload-Autoscaler savings, 36 clusters** (report separately from Node Realized). Sept fee basis: 8,275.94 billable vCPU. Helios: unit cost −14% (baseline→now), util ≈9.8% of requested, net VR fee-marginal; classic $18,878 vs VR $6,668 both reproducible. CPS: realized +$11,690 Sept (VR); WOOP line −$80.91 by design (requests raised).

- **Top priority clusters** (live EU API, pulled 2026-10-15 ~20:00; numeric score is console-only)

| Cluster (org) | Signal today | Main culprit | Remediation | DRI suggestion |
|---|---|---|---|---|
| ngm-vsinteg-eks / ngm-vsdev-eks (SI GSW CLO) | CPU OP 93%; evictor OFF; **never rebalanced** | Evictor off + no rebalancer | Evictor dry-run → first manual rebalance | Siemens NGM owner via Sergej's mapping; CAST: Ahmed |
| clo-master-eks (SI GSW CLO) | OP 69%; evictor OFF; never rebalanced | Same | Same | same |
| ngm-data-eks (SI GSW CLO) | OP 90%; VR **−$325.39** Sept; last plan Aug 27 | Stale rebalance; oversized base | Re-run plan; right-size intended capacity | same |
| ngm-helios-eks (SI GSW CLO) | OP 26%, util 9.8%; evictor ON, plans generated but **never executed** | Rebalance never executed | Controlled rebalance pilot (cuts cost AND €5/vCPU fee basis) | Siemens decision (flag opt-out risk) |
| ngm-integ-eks (SI GSW CLO) | OP 36%; woopAdopted=true but 0/4,566 workloads managed (attribution bug, drafted today) | WOOP metering confusion | CAST engineering attribution query; keep WOOP line at $0 | CAST: Ahmed/Aleksy |
| eleX01p (IT IPS) | VR **−$3,266.77** on $12,914 actual | True negative (actual > projected) | Root-cause with owner; add to negative-watch list | Siemens IT IPS owner |
| dema-platform-services (CPS) | Console 4.9; WOOP −$80.91 (by design); autoscaler policy off, plans manual (10-12) | Policy off + WOOP optics | Explain WOOP line; road-to-full-mode checklist | Philipp Steinberg / CAST: Ebrahim |

- **Talking points** — 1) Score is a health radar, not a punishment metric; the three culprits (Evictor off, WOOP 0%, no rebalance schedule) are configuration, not defects. 2) Biggest fleet lever: helios/integ run ~10% of requested — executing rebalances cuts spend and the per-vCPU fee. 3) WOOP savings stay a **separate line**; Node Realized already includes workload savings. 4) Quote September on the restated basis with pull timestamps. 5) Negative-by-design cases (CPS upsizing) are honest accounting, not lost money. 6) POC: score-alerting automation exists and can demo (signals re-derived from public APIs).

- **Questions Ebrahim should ask** — 1) Lock the top-10 red list + DRI + date per cluster? 2) Which clusters are intentional Evictor/node-AS opt-outs (GSW)? Get them annotated. 3) /scorecards automation: is Ahmed's snippet integrated into Sergej's script; when do daily owner alerts go live; who owns the owners mapping? 4) Helios: agree the cost-string investigation is closed (unit-price −14% story) and decide on the rebalance pilot? 5) Confirm restated September totals are the only quoted ones; confirm reporting cadence/basis (€5 vs 5% CPS, $5.70 legacy sheet)? 6) Agree 7+ ceiling + per-subscore targets?

- **Risks / watch-outs** — Score not workload-complexity-normalized: compare against own trend. Numeric 0–10 score not in public API (console-only); don't promise exact-score API pulls. VR recomputed on read — restatements still landing today. Never mix SI GSW €5/vCPU with CPS 5%-of-gross fee. Do not resurface withdrawn ROI PDFs ($526,923). No spot/WOOP pitches to GSW R&D; no list prices to management. alliander-demo savings are model-only (read-only cluster).

- **Tonight's prep checklist** — 1) Screenshot console score tiles for the top-10 (API can't), timestamp them. 2) Re-run `castai-terraform-1/score-alerting-poc` scan for fresh findings. 3) Re-pull Sept VR totals (post-restatement) and freeze with timestamp. 4) Pre-fill DRI column using owners.py-style mapping. 5) One-pager: Helios closeout + WOOP/node savings separation rule. 6) Verify fee math per contract before quoting net.

- **Sources** — Granola: [Oct 9 score review](https://notes.granola.ai/d/ebb1cc5a-255d-4c89-82fb-f5599e5b93bf), [CPS alignment](https://notes.granola.ai/d/e129a1f4-3c68-4ede-a082-c94ea1cca096), [Oct 9 SI GSW Exchange](https://notes.granola.ai/d/a736d7c7-7322-4eee-886d-c5894d1a9053), [Oct 12 urgent call #2](https://notes.granola.ai/d/150ba07d-75f8-47f5-b324-e4aff6d780b0), [Oct 12 methodology](https://notes.granola.ai/d/f96617c9-cbc2-4cd9-ac27-0b2ae683d501), [scorecard automation](https://notes.granola.ai/d/aef4d918-b647-4128-8618-db1518eff974). Repo: .kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md, .kimchi/docs/2026-10-05-cps-negative-savings-case.md, .kimchi/docs/2026-10-08-cps-negative-savings-refresh.md, .kimchi/docs/2026-10-12-cps-rebalancer-node-diversity.md, .kimchi/docs/castai-api-savings-endpoints.md, scratch/siemens-review/EVIDENCE-PACK.md, castai-terraform-1/score-alerting-poc/. API (GET-only, EU, 2026-10-15): `/v1/organizations`, `/v1/kubernetes/external-clusters`, `/v1/cost-reports/organization/clusters/efficiency`, `/v1/kubernetes/clusters/{id}/policies`, `/workload-eviction/v1/clusters/{id}/config`, `/v1/kubernetes/clusters/{id}/rebalancing-plans`. Note: numeric Cluster Score is console-only (verified against public spec — no scorecard paths).

---

*Generated with one research subagent per meeting (5 parallel agents): Granola notes + engagement repo docs + read-only CAST AI EU API. No cluster or API state was modified at any point.*
