# Executive Meeting Prep Pack — Thu 2026-10-16

**Prepared by the CAST AI Superteam (supervisor merge) · Wed 2026-10-15 evening**
**Meetings: M1 09:30 · M2 10:30 · M3 12:30 · M4 15:00 · M5 17:00**

> **Provenance / data basis:** live CAST AI pull was BLOCKED tonight — AWS token invalid (`InvalidClientTokenId`) + `CASTAI_ORG_ID` unset (AGENTS.md §1 preflight failed; lead ruled no waiver). M1/M2 are repo-memory/memory-only (no live data needed). M3/M4/M5 use repo memory + email-context figures, each marked inline. If credentials are restored tonight, mcp-ops re-pulls and delta updates ship immediately.
> **Read-only discipline held:** zero live API calls, zero mutations, zero customer-facing sends. No secrets/PII in this pack.

---

## M1 09:30 — Cast AI & Siemens: CAST AI Org Structure (Sergej Petrovski)

### Strategic context
- Third touch of this thread: Aug 10 "per-team, for now" → Oct 2 prep (`.kimchi/docs/siemens-org-structure-options-2026-10-02.md`) → Oct 14 internal sync. Sergej is finalizing the FLAT model: Siemens AG on top, ~126 child orgs, no new BU hierarchy layer — matches CFR-1536 consensus (BU tagging + auto-scoped user groups) and Sergej's stated position (verify before quoting).
- The BU dimension moves to properties: mandatory "BU" tag + proposed "Application ID" free-text starting "APM" → access scoping (e.g. BU=DI analysts) rides tags, not structure.
- Fleet growing fast (111 orgs Sep 11 → 130 Oct 2): decisions now set per-org governance cost at 600–1,000-org scale.

### Key talking points
- BU-by-property works TODAY with verified primitives: Enterprise User Groups + per-child-org Viewer/Analyst bindings; new clusters auto-visible when the org is in scope — same pattern that closed the Christoph/SMO-IT-IN-COP blank-reporting case (`.kimchi/docs/reply-christoph-smo-it-in-cop-access-reporting.md`).
- Analyst role (Sep 8: best fit for FinOps champions) verified in RBAC matrix: full cost monitoring, read-only elsewhere. Enterprise roles stay all-or-nothing (documented limitation) — never give champions Enterprise Viewer.
- Path 1 (John's portal: extra API call at org creation auto-assigning BU user groups by tag) = the "birth certificate" pattern from the Oct 2 doc — governance atomically at birth, kills "forgot to add" drift. Bulk RBAC API exists for the 126-org backfill (RBAC-as-code fully documented).
- Path 2 (fine-grained SA, one SA scoped to multiple child orgs — Renata's roadmap) collapses per-org key sprawl; aligns with the one-key-per-child-org finding (`.kimchi/docs/castai-mcp-security.md`) and the pending MCP key-scoping decision.
- IdP/SCIM group sync (Entra documented) can ride Siemens AD membership → no per-user maintenance; needs existing SSO connection (Siemens status unverified).

### Questions to ask
- Which property store is authoritative — native CAST org metadata or portal-side mapping? Is "Application ID"/"APM" a CAST-native field (affects automation)?
- Aleksy: does the user-group role-binding API flow expose all IDs (group, role, child-org) in one pass, or is a lookup chain needed? Any blockers?
- Renata: fine-grained SA timeline — and will one SA bind to a SUBSET of child orgs (the primitive enterprise roles can't express)?
- Who owns the bulk-API tag backfill for the 126 existing orgs, and what CI enforces BU/APM format on new orgs?
- Siemens enterprise SSO + SCIM status — gateway to zero-touch membership? Console/API scale ceiling at ~1,000 child orgs (open verification item since Oct 2)?

### Risks
- Free-text "APM" ID → garbage-in: tag-scoped access breaks silently without birth-time validation/allow-list.
- Console bypass: Enterprise Owners can always create orgs manually; without a reconciliation loop, untagged bypass orgs accumulate (load-bearing risk, Oct 2 doc §A.1).
- Clusters can NEVER transfer between orgs — any later restructure = disconnect/reconnect of ~230 clusters; freeze structural ambitions now.
- If fine-grained SA slips, path-1 is the only route — don't gate BU rollout on the roadmap item.

### Action items
- Sergej: confirm final flat structure (close CFR-1536) + mandatory BU taxonomy (allowed values) and APM/Application-ID format.
- Aleksy: confirm no missing IDs block the user-group role-binding API flow; report Schedule Manager role availability in the Siemens EU tenant.
- Renata: deliver fine-grained multi-child-org SA engineering timeline.
- John: portal pipeline design (BU-tag → auto user-group assignment at org creation) + 126-org backfill plan.

### Tonight's prep checklist
- Re-read Option A + §7 verification list in `siemens-org-structure-options-2026-10-02.md`; CFR-1536 row in `2026-10-15-siemens-savings-escalation-briefing.md`; Christoph reply as the working BU-viewer precedent.
- Print one-pager of verified RBAC facts: Analyst scope, enterprise-role all-or-nothing, SCIM sync, RBAC-as-code.
- CC Sergej on anything touching the REST API flow (standing pref, Oct 13).

---

## M2 10:30 — 1:1 IT DF COL UC 2 Weekly Follow-up (Conceptboard test-cluster onboarding; Samuel Frunza-Hincu hands-on, Fan Yang/Accenture organizer)

### Strategic context
- Anchors (verified Sep 25, labs/putrolepolicy-403/CASE): org IT DF COL UC 2 (2b9d9744-f37d-4a22-b9c6-2f1857a5417d, EU → console.eu.cast.ai / api.eu.cast.ai); cluster siemenstest-siemenstest-1 (EKS eu-west-1); acct 951463557399; deployer role siemenstest-siemenstest-ir-admin.
- Stage 1 done: cost-monitoring onboarding succeeded — agent online, 5 nodes, telemetry flowing since Sep 25. Stage 2 (cluster optimization + workload autoscaler) NOT yet green.
- Blocker pattern: Sep 25 iam:PutRolePolicy 403 (verified identity-policy gap, NOT SCP/boundary) → Oct 9: CLI install issues resolved, but 3 new denials from manually-built policies (GetInstanceProfile, TagInstanceProfile, GetCallerIdentity); dev config walkthrough done; prod postponed until "test validated"; final Helm run was progressing.

### Key talking points
- Stop piecemeal IAM grants — twice bitten. Ask for ONE consolidated statement on the deployer role: iam:PutRolePolicy/GetRolePolicy/DeleteRolePolicy (Sep 25 fix) + the Oct 9 denials, scoped to arn:aws:iam::951463557399:role/cast-*; request Samuel's role policy JSON to diff. Terraform path needs the same — no workaround.
- Confirm exact Oct 9 action names from the error output before encoding: "ec2:TagInstanceProfile" looks off — instance profiles are IAM objects (expect iam:TagInstanceProfile). Get the verbatim log lines from Samuel.
- Helm final run: did it finish green? Green criteria: Features = Cost monitoring + Cluster optimization + Workload autoscaler; cluster ready/online in console; castai-agent pods healthy. Any residual 403 → fresh support bundle.
- Endorse dev-first; make the prod gate concrete (see questions). Console invite for Samuel still pending since Sep 25 (org-admin action — our key is read-only). Token hygiene: plaintext token emailed Sep 25 → rotate after stabilization; old token stays valid ≥60 min; if 401 → update castai-credentials secret + restart components per rotation runbook.

### Questions to ask
- What concretely validates "test validated"? (agent green N days? recommendations generated — telemetry has 3 weeks of history now? node-config/policy dry-run exercised on dev?)
- Timeline to prod once validation is signed off — target date this week, or does a miss push to the next weekly slot?
- Who reviews & sends the drafted PutRolePolicy reply (REPLY-to-samuel.md staged since Sep 25, awaiting human send) — and should it be updated first to also cover the 3 Oct 9 actions so the guidance isn't half-stale?

### Risks
- Manually-built policies drifting again — piecemeal fixes already failed twice; each missed grant costs a full weekly slot.
- No console access (containerized K9s env) hides CAST AI-side state and slows debug; region note still unresolved (calendar says us-east-1 vs verified eu-west-1 — don't "fix" without `aws eks describe-cluster --region eu-west-1`).
- Prod slip: "test validated" undefined = indefinite gate; a stale/rotated token in Helm values could 401 the finishing run.

### Action items
- Samuel: apply the consolidated IAM statement; share the deployer-role policy JSON; finish the Helm run to green (fresh support bundle if any 403 persists); confirm which cluster token is in use.
- Accenture/org-admin: send Samuel's console invite to org IT DF COL UC 2 (we cannot — read-only key).
- Human (Ebrahim): review/update + send REPLY-to-samuel.md; agree the validation checklist + prod date on this call.

### Tonight's prep checklist
- Re-read labs/putrolepolicy-403/{CASE,REPLY-to-samuel,MEETING-PREP-followup4}.md — command sheet ready: sts get-caller-identity (expect 951463557399 / ir-admin), eks describe-cluster --region eu-west-1, iam simulate-principal-policy for PutRolePolicy, kubectl get pods -n castai-agent.
- Tabs open: console.eu.cast.ai org IT DF COL UC 2 → cluster; docs.cast.ai; eks-role-iam TF module page (for security questions); `.kimchi/docs/rotate-token-manual-commands.md` in case of 401.

---

## M3 12:30 — SIEMENS x Cast AI | SMO Railigent X | Alignment & Next Steps (Christoph Goebels, Andreas Schieb)

> live pull blocked: AWS token invalid + CASTAI_ORG_ID unset — figures from email context, not re-verified tonight + repo-memory Oct-15 pull

### Strategic context
- Org SMO Railigent X (f15f33b9): 8 managed Karpenter clusters + dormant rhx-test; CAST node autoscaling deliberately OFF (Karpenter owns nodes).
- Headline: September WA savings $8,513.97 across 8 clusters WITHOUT node autoscaling (from email context).
- Cross-check: from repo memory (Oct-15 pull, not re-verified tonight) Σ = $8,476.96 for the same 8 → Δ $37.01 (~0.4%); VR is recomputed-on-read — quote figures with pull timestamp.

### Per-cluster Sept WA savings (from repo memory, Oct-15 pull)
k8s`d0c7a7a5` $2,701.54 · k8s`4952c4ce` $2,406.55 · k8s`cf62a8e1` $1,807.99 · k8s`f8dd5b4f` $434.66 · staging`ae3e22a4` $424.54 · k8s-andreas`d03690cb` $334.21 · k8s`7eb37770` $201.31 · k8s`5771ec22` $166.16 → **Σ $8,476.96**

### Cleanliness proof
- 7/8 are Case B (woopAdopted=true, autoscalerAdopted=false, no baseline → autoscalerSavings=$0): WOOP is the ONLY track ⇒ immune to the CSU-6233 baseline bug by construction.
- **K8S-ANDREAS (raise proactively):** $158K on ~$700 spend (from email context) = INDUSTRY_AVERAGE baseline frozen on a 24h window (×170 CPU factor); CSU-6233 fix merged + savings recalculated; cluster excluded from node-level reporting; restated $158,738.12 → $444.49 (from repo memory, Oct-15 pull) — its Sept WOOP $334.21 above is legitimate savings, not a bug artifact.

### Key talking points
1. $8.5K Sept from request right-sizing alone — the cleanest value proof in the fleet.
2. Value concentrated: top-3 clusters ≈ 82% of the total (expansion headroom on the small rows).
3. Anomaly known → fixed → recalculated → excluded = reporting hygiene, not a value gap.
4. Next lever: ONE non-prod node-AS/rebalancing pilot with an agreed success criterion.

### Questions to ask
- Which non-prod cluster hosts the pilot + success criterion/date?
- WOOP coverage expansion beyond the 8 — what blocks it?
- Time-off POCs/dates + escalation route?
- WOOP agent upgrade (v1.2.5→v1.14.1 on 7/9 clusters) — window owner?
- Does the Sept WOOP figure feed the management report on the VR basis?

### Risks
- Never sum WOOP+node savings (WOOP already inside totalSavings); cite k8s-andreas on the restated basis only.
- Karpenter-mode consoles show limited WOOP trend (pre-answer the question).
- 28 pending Azure clusters still on the CASTAI_IMPERSONATE workaround; WOOP agent drift on 7/9 clusters.

### Action items + tonight's checklist
- Re-verify all figures vs API once preflight restored; quote VR-basis numbers only for management.
- Draft pilot proposal w/ guardrails + rollback; confirm attendee list + time-off window; rehearse the 30-sec k8s-andreas summary.

---

## M4 15:00 — 1:1 APM0414470 SiBase X Follow-up #3

> live pull blocked: AWS token invalid + CASTAI_ORG_ID unset — figures from email context, not re-verified tonight

### Strategic context
1. SiBase X = 4 read-only/unmanaged EKS clusters, eu-central-1 (from repo memory, Oct-12 sweep); $0 managed to date → this deal IS the read-only→managed conversion story.
2. Meeting context: big provisioned-vs-actual gap = the ROI argument. Node autoscaling closes provisioned→requested; workload autoscaling closes requested→actual. Reference anchor: integration-cluster rebalance −51% provisioned vCPU (114→56).
3. Sep-28 Fabian framing — 4 options: 1) Karpenter alone, 2) Karpenter+WA, 3) Karpenter+node-autoscaling add-on (Spot→OD fallback), 4) full CAST AI replacing Karpenter. Leadership dread: "managing 2 tools."
4. Security gate: written image-signing/verification requirements summary pending → ticket action is on the line for this call.

### Key talking points
5. Recommend Option 2+3 pilot: Karpenter stays SOLE provisioner + coexistence layer (kent.enabled=true: Agent, Kentroller, WA, Pod Mutator, Spot Handler) — CAST AI's documented supported pattern.
6. Red line: standard CAST node autoscaler alongside Karpenter = dual provisioners, undefined behavior — that's Option 4 territory only, post-pilot.
7. WA starts deferred mode — recommendations only, no writes against manual requests.
8. Sep-30 candor: full-switch rebalance (−51% vCPU) failed on undersized 2–4 vCPU nodes (no min-CPU floor) → ~25-min disruption, rollback. Any Option-4 retry preconditions: min-CPU ≥16 in ALL node templates + JVM ~30-min startup-delay policy (boot spikes ≠ steady state).
9. Switch mechanics: if Karpenter scales to 0 in any test, keep ≥1 base system node — controller nodeAffinity `karpenter.sh/nodepool DoesNotExist` (clm-learnings pitfall).

### Questions to ask
10. Signing: Cosign / Notary / Sigstore keyless? verify at CI, admission, or both? Key mgmt (KMS / keyless OIDC / BYOK)?
11. Admission: Kyverno or Gatekeeper — enforce vs audit? Registry allow-list — must CAST AI images route via mirror?
12. Pilot: which non-prod cluster, who signs off scale-down, metrics ($/requested vCPU, bin-packing density, Spot-fallback stability), review date?

### Risks
13. Leading with Option 4 reopens Sep-30's wound — sequence 2+3 → pilot data → 4.
14. "Two tools" objection → one provisioner + one optimization layer, not parallel stacks.
15. Signing ticket slips → pilot blocked at security review exactly when infra is ready.

### Action items
16. Log ticket `[APM0414470 SiBase X] Container image signing & admission-control requirements` today (capture live in-call if the written summary hasn't landed); ticket status = open question on the call.
17. Utilization pull (provisioned/requested/actual) for the 4 clusters once mcp-ops credentials restored — savings endpoints returned HTTP 400 on all 4 (unmanaged) → utilization/inventory is the right live lens, not savings.
18. Close on pilot option + cluster + metrics + owners + review date.

### Tonight's prep checklist
19. Confirm security-team attendee; keep ticket template open during call; Terraform-module install path ready (CloudDevBoundary IAM boundary blocks CLI); Hypercare ticket process at hand; re-skim Sep-30 incident facts for Option-4 challenges.
20. Sources: `brain/notes/Karpenter + CAST AI Coexistence.md` · `.kimchi/docs/karpenter-castai-clm-learnings.md`.

---

## M5 17:00 — Cluster Score Review (Sergej Petrovski, Ahmed Khaldi — Oct-9 cadence)

> live pull blocked: AWS token invalid + CASTAI_ORG_ID unset — figures from email context, not re-verified tonight + repo-memory Oct-15 pull

### Strategic context
- September Value-Realization: $14,746.76 WA savings across 36 clusters (from email context) — WA reported SEPARATELY from Node Autoscaler savings: totalSavings == autoscalerSavings, WOOP already inside — never sum the two lines.
- Source of truth = Value Realization API v1 beta (Oct-12 decision; `.kimchi/docs/castai-api-savings-endpoints.md`: reporting spec at api.eu.cast.ai/spec/ → reporting, not legacy v1).
- From repo memory (Oct-15 pull, not re-verified tonight): September fleet savings RESTATED $320,348.65 → $86,106.22 across 36 clusters post-CSU-6233 fix; corrections were still landing Oct-15 (e.g. HAFAS override 09:26Z) — freeze all quotes with pull timestamps.
- Scores (from email context, Oct-9 review): max 7.9, most clusters 2–3 Red; 7+ = realistic ceiling given instance/disk constraints. Numeric Cluster Score is console-only (verified: not in public spec) — screenshot tiles, don't promise API score pulls.

### Three culprits = the uplift lever (from email context)
- Evictor disabled · WA at 0% · Rebalancer never run — all configuration, not defects; each maps to a fix (evictor dry-run → enable; WOOP opt-in expansion; schedule the first manual rebalance).
- Priority targets (from repo memory, Oct-15 ~20:00): ngm-vsinteg/ngm-vsdev + clo-master-eks (evictor OFF, never rebalanced, OP 69–93%); ngm-helios (plans generated but never executed, util ~10% — execution cuts spend AND the €5/vCPU fee basis); ngm-data (Sept VR −$325.39, stale Aug-27 plan); ngm-integ (woopAdopted=true while 0/4,566 workloads managed — attribution bug to CAST engineering).

### Negative-net list @ €5/vCPU·mo
- Contract rule on record: SI GSW fee = €5 × avg provisioned vCPU·month (invoice-verified); CPS = 5% of positive gross — never mix. Net = realized savings − fee.
- September true negatives (from repo memory, Oct-15 pull): eleX01p −$3,266.77 · Posit −$596.55 · ngm-data −$325.39 · kafka-test −$207.00 · dev-cluster −$53.08; fee-only inside-baseline rows (Pillar#1) also land net-negative.
- Basis caution: fee is EUR vs savings USD — agree FX basis before quoting net to management.

### Key talking points
- Score = health radar, not punishment — the three culprits are the fleet's cheap uplift; biggest lever = execute helios/integ rebalances.
- WA savings stay a separate line (double-count prevention per the Sept Value-Realization report); quote September only on the restated basis.
- Negative-by-design cases (CPS upsizing: +$11,689.75 realized, WOOP −$80.91 by design — `.kimchi/docs/2026-10-05-cps-negative-savings-case.md`) are honest accounting, not lost money.

### Questions to ask
- Lock top-10 red-cluster list with named DRI + date each? Intentional opt-outs (e.g. GSW) annotated so low scores aren't read as failures?
- /scorecards automation owner + daily-alert go-live? Helios cost-string investigation closed (unit price −14%) + rebalance pilot decision?
- Restated September = the only quoted basis, and fee basis €5 vs legacy $5.70 sheet? 7+ ceiling + per-subscore targets agreed?

### Risks
- VR recomputed-on-read — restatements were still landing today; score not workload-complexity-normalized — compare each cluster vs its own trend.
- Never mix €5/vCPU (GSW) and 5% (CPS) fee contracts; no spot/WOOP pitches to GSW R&D (on-prem parity); no list prices to management; withdrawn ROI PDFs ($526,923) stay withdrawn; alliander-demo savings are model-only (read-only cluster).

### Action items + tonight's checklist
- Screenshot console score tiles w/ timestamp (API can't); re-pull Sept VR totals once preflight restored + freeze timestamps.
- Pre-fill DRI column from owner mapping; verify fee math per contract before quoting net; one-pager: Helios closeout + WOOP/node savings separation rule.

---

## Team provenance (internal)
- M1: docs-keeper (task-6) · M2: support-triage (task-7) · M3: cost-analyst (task-8) · M4: cluster-health (task-9) · M5: cost-analyst (task-10) · Live pull: mcp-ops (task-11 — preflight blocked, zero live calls, fallback active; lead ruled no §1 waiver).
- If AWS credentials + `CASTAI_ORG_ID` are restored tonight: mcp-ops re-runs preflight → datasets A (Railigent WA per-cluster), B (SiBase X resource-usage), C (score/VR tables) → delta updates to M3/M4/M5 ship immediately, and corrected figures get logged to `.kimchi/docs` by docs-keeper.
