# CFR (new) — Rebalancer plan explainability: binding constraints, instance compare, planner assumptions (2026-10-16)

**Draft only — a human reviews, files in Jira project `CFR`, and posts the CSU-6246 link comment.**
Author: Ebrahim Ramadan (CAST AI, CS) · References: CSU-6246 · RCA bundle `.kimchi/docs/2026-10-14-cps-rebalancer-rca/` · node-diversity note `.kimchi/docs/2026-10-12-cps-rebalancer-node-diversity.md`

Precedent for filing: CFRs live in the `CFR` Jira project on castai.atlassian.net (CFR-480 NASDAQ tags, CFR-533 SAP, CFR-646 Deloitte, CFR-1263 LVMH, CFR-1388 enterprise rollup, CFR-1452 Kakao, CFR-1536 Siemens org structure). CID-196 is the cross-customer demand record, not the filing target for an account-specific console ask.

---

## 1. Paste-ready Jira ticket body

**Summary:** Rebalancer: make instance-selection reasoning visible — binding constraint per choice, instance compare view, and surfaced max-pods assumptions

**Type:** Customer Feature Request · **Component:** Console / Rebalancer (Node Autoscaling) · **Priority:** Medium (customer-trust blocker on production change approval)
**Customer:** Siemens — CPS Platform (Philipp Steinberg, PO; Luka Kroeger, platform engineer)
**Source:** CSU-6246 (link: relates to) · Cluster `5dc3bf31-a263-4c6b-88bb-e95b6403aa51` · Org `5e413e89-eb67-48fb-b81c-6172baa988ed` (EU) · Plan `5e132d41-d02e-4030-a6f7-d2ea9fe498a3`
**Environment:** AWS eu-central-1 EKS · 68 nodes (61–63× t3a.xlarge + 5× r8id.4xlarge across Oct 12–14) · 2,375 pods · ~256 requested vCPU / 1,129 GiB · Calico CNI (Calico IPAM, VXLAN overlay)

### TL;DR for triage

A **correct** Rebalancer plan looked wrong to a deep-reviewing customer because the plan's reasoning is invisible: `1× c8in.large ($67.91/mo)` was selected over the apparently cheaper `c5a.large ($38.13/mo)` for a 55-pod group — correct because c5a.large's planner max-pods is 29 (→ 2 nodes, $76.26/mo) vs c8in.large's 78 (→ 1 node). The customer opened a support ticket instead of approving a rebalance, and the investigation revealed the planner's pod limit was an **ENI-derived fallback that never physically applied on their cluster** (Calico/VXLAN overlay). The customer paused production rebalances pending trust; ~$3.7k/mo of savings were unblocked only after two weeks of manual archaeology. Engineering explicitly invited this CFR on CSU-6246.

### Problem

**A. Correct decisions are invisible.** The plan view shows per-instance prices ($67.91 vs $38.13) but never names why the pricier pick wins: which constraint bound (here: max pods), how many nodes the cheaper type would need, or the total-cost comparison. Support outcome: CSU-6246, three engineering questions, ~2 engineer-days across CS + rebalancer eng, and a customer quoting "random selection" in an alignment meeting.

**B. Planner assumptions are invisible — and can be silently wrong.** The max-pods figure came from the generic ENI formula `NUM_MAX_NET_INTERFACES × (NUM_IP_PER_INTERFACE − 1) + 2`, used because neither the EKS bootstrap nor the CAST AI node config set an explicit max-pods. On this cluster pod IPs come from Calico IPPools over VXLAN — the ENI limit never applied. Side effects were absurd and unnoticed: t3a.xlarge and t3a.2xlarge **both** capped at 58 pods; r8id.4xlarge at 394. The customer's own fix — `max_pods_per_node_formula = "math.least(NUM_CPU * 16, 250)"` + kubelet maxPods + min-4-vCPU templates — doubled pod density headroom, and their next plan dropped compute from **$7,895/mo (61 instances / 244 vCPU) → $4,420/mo (28 instances / 196 vCPU)**; total cluster spend **$12,585 → $8,310/mo**. Nobody inside or outside CAST AI could see which assumption the plan was reasoning about until the ticket was manually root-caused.

### Requested improvements

1. **"Why this choice?" explainer in the plan view.** Per node group / instance pick: name the binding constraint (e.g. *Max pods*) and show the costed comparison: *"1× c8in.large ($67.91/mo) beats 2× c5a.large ($76.26/mo) — 55-pod group exceeds c5a.large planner max pods (29); c8in.large allows 78."*
2. **Instance compare view** (customer's own suggestion, Philipp Steinberg): for any two candidate types, show optimizer-relevant properties side by side — planner max pods, price (per-vCPU/h and per-node/mo), network bandwidth, EBS bandwidth, vCPU/RAM — with the deciding value highlighted and the group-cost outcome row ("nodes needed → total cost").
3. **Surface the effective max-pods assumption per instance type, with provenance.** Show the value the planner used *and its source*: node-config `max_pods_per_node_formula` → explicit kubelet maxPods → ENI fallback, and warn when the fallback is in effect on a cluster whose CNI does not use VPC pod IPs (Calico, Cilium overlay, Weave). The plan view must show the assumption **as used at plan time**, not just the value after a fix.
4. **Show total plan/group cost next to per-instance price** in the composition table, so a single premium per-instance pick is not misread as expensive for the plan.
5. **Label price units in the composition table.** Rows today mix per-vCPU-hourly ($0.047) and per-node-monthly ($67.91) on one line with unlabeled units — the customer had to reverse-engineer this themselves, which materially fed the "random" perception.

### Acceptance criteria (testable)

- **AC-1:** Given a plan where a more expensive per-instance type wins on a non-price constraint, the plan view names that constraint and shows the costed comparison (nodes × price for both options), without opening a support ticket.
- **AC-2:** Given any two instance types in a plan's candidate set, a user can open a compare view showing planner max pods, price (both bases), network, EBS, vCPU/RAM, with the deciding property highlighted.
- **AC-3:** Given a plan, each instance type's effective planner max pods is displayed with its source (`node-config formula` / `kubelet maxPods` / `ENI fallback`) as it was at plan generation; when the ENI fallback is in effect on a non-VPC-CNI cluster, a warning is shown on the plan.
- **AC-4:** The composition table shows per-group and total plan cost alongside per-instance price; price columns carry unit labels ($/vCPU·h vs $/node·mo).
- **AC-5 (validation set):** AC-1..AC-4 explain both recorded cases without eng help: (a) c8in.large vs c5a.large (max pods), and (b) c8i-flex.8xlarge ($712.30) vs c5a.8xlarge ($610.00) — the customer's second, still-open question (handed back to engineering Oct 16; note Flex picks are governed by the separate `flex_instances_enabled` toggle, not Spot).

### Why it matters

- **Engineering invited this CFR** verbatim on CSU-6246: *"This is expected and correct, but I do understand that our UI experience doesn't really make this decision clear. If you have ideas of how this could be presented better in the UI please do let us know via CFR!"*
- **Trust gates production change.** This customer reviews deeply (2,375 pods; ~$3.7k/mo at stake) and paused all rebalances until the plan was proven correct. Template changes and prod rebalances resume only when plans are self-explanatory.
- **Prevalence.** Any cluster on a non-VPC CNI (Calico, Cilium overlay, Weave) without explicit kubelet maxPods silently plans against the ENI fallback. Every Siemens rebalancer review (~240 onboarded clusters and growing) and every future "cheaper-per-instance lost" case generates this ticket again.
- **The fix the customer built themselves unlocked $8,310 − $12,585 = $4,275/mo** — value that was invisible because the assumption was invisible.
- Precedents: CFR-646 (Deloitte) and CFR-1452 (Kakao) show console-UX CFRs from one account generalize; this ask additionally carries a named, engaged customer champion who suggested the compare view himself.

### Proposed ticket split (optional but recommended)

File as one CFR with two workstreams, or split: **(i)** console explainability (asks 1, 2, 4, 5) and **(ii)** planner-assumption provenance + fallback warning (ask 3). Workstream (ii) is arguably a defect class, not just UX: the planner reasoned about a pod limit that did not exist on the cluster. If split, link the two.

### Attachments to include

- Console shots 2026-10-14: `01-rebalance-plan-log.png` (16-run log incl. −11% plan), `02-plan-5e132d41-diverse-c8in-detail.png` (failed-plan drawer), `03-available-savings.png` in `.kimchi/docs/2026-10-14-cps-rebalancer-rca/console-shots/`
- `evidence-plan-5e132d41-annotated.png`, `evidence-plan-timeline-pin.png` in `.kimchi/docs/2026-10-14-cps-rebalancer-rca/`
- UI mockups (this package): `outbox/cfr-mockup-1-before.png`, `cfr-mockup-2-why-explainer.png`, `cfr-mockup-3-compare-view.png`, `cfr-mockup-4-assumptions.png`
- Post-fix plan in console: $12,585 → $8,310/mo (Oct 15, customer-verified)

### Reference UI patterns to steal from (online examples)

- **Vantage Instances — [instances.vantage.sh](https://instances.vantage.sh/)**: the canonical cloud instance compare table — dense property grids with filterable columns; pattern for ask #2.
- **AWS Compute Optimizer recommendations**: each recommendation carries a "Finding / Finding reason" field (e.g. *under-provisioned/over-provisioned* with the metric behind it); pattern for ask #1's named binding constraint.
- **GCP Recommender insight cards**: every machine-type/rightsizing recommendation states its basis ("Based on CPU utilization in the last N days…"); pattern for provenance line in ask #3.
- **Azure Advisor**: per-recommendation "Why am I seeing this?" + impact category badge; pattern for the explainer affordance placement.
- **Kubecost right-sizing**: request-sizing rows show current vs recommended with the utilization basis; pattern for costed comparisons in ask #1.
- **CAST AI docs precedent for labeling**: Available Savings is already documented as an *estimated potential* — extend the same labeling discipline to plan assumptions (ask #3).

(Patterns above are stable public patterns in these tools for years; worth a 10-minute design-team skim before scoping, not a spec.)

### Timeline (evidence)

| Date (2026) | Event |
|---|---|
| Oct 12 | Customer notices Available Savings (~37%, ~$4,293/mo) vs rebalance plan mismatch; 4 plans generated Oct 12 (08:45–12:13 UTC), savings $525–$3,726/mo (+ 1 more early Oct 13, −$883/mo negative) |
| Oct 14 | Cluster-side investigation: c8in.large $0.155/h OD vs c5a.large $0.087/h (1.78×), Spot disabled, both offered in all 3 AZs (verified Oct 14) — capacity didn't explain the pick. CSU-6246 opened with 3 questions |
| Oct 14 | Luka Kroeger's root-cause find: Calico/VXLAN overlay → ENI limit never applied physically; fallback formula in effect; fix `math.least(NUM_CPU*16, 250)` applied to node configs (test + prod) + kubelet maxPods; min 4 vCPU on templates |
| Oct 15 | Engineering answers: Q1 — ENI-based max pods differ (c8in networking-optimized: 78 vs 29), 55 pods → 2× c5a vs 1× c8in; Q2 — binding constraint was max pods (ENI-derived); Q3 — expected behavior, CFR invited |
| Oct 15 | Philipp Steinberg: proposes instance compare view; asks the open c8i-flex.8xlarge vs c5a.8xlarge question |
| Oct 15 | Post-fix plan verified: $7,895 → $4,420/mo compute (61/244 → 28/196 instances/vCPU); $12,585 → $8,310/mo total |
| Oct 16 | CS confirmed answers on CSU-6246; open c8i-flex question handed back to engineering |

---

## 2. Paste-ready link comment for CSU-6246 (post after CFR is filed; replace `CFR-xxxx`)

> Following up as promised: I've filed **CFR-xxxx — "Rebalancer: make instance-selection reasoning visible — binding constraint per choice, instance compare view, and surfaced max-pods assumptions"** and linked it to this ticket. It captures all three confirmed answers plus Philipp's compare-view suggestion, the Calico/ENI fallback finding, and the pre/post numbers ($12,585 → $8,310/mo). The open c8i-flex.8xlarge vs c5a.8xlarge question is listed in the CFR as a second validation case for the explainer — pending your team's answer there. cc @Philipp @Luka for visibility once the product team picks it up.

---

## 3. Verify before filing (against this repo's evidence package)

| # | Claim in this draft | Status |
|---|---|---|
| 1 | "4 plans Oct 12 + 1 Oct 13" — **replaces the user's draft line "5 plans Oct 12"**; RCA table (`deliverable-3`) documents 4 on Oct 12 (c15d34a9, 106f0905, 5e132d41, 5ada1f8b) and d44d1095 on Oct 13. Confirm which count CSU-6246 used. | ⚠ changed from draft |
| 2 | ENI max pods c8in.large=78, c5a.large=29 (3×9+2, 4×19+2) | ✓ RCA agent-b-pricing |
| 3 | Price decoding: $67.91/$38.13 are console monthly (plan pricing cache $0.0930/$0.0522 per node·h; AWS OD $0.15498/$0.08700; CAST ref ≈ 0.6× list). If eng asks "why don't monthly figures match OD×730", the unit-decode table is in `.kimchi/docs/2026-10-12-cps-rebalancer-node-diversity.md` §3. | ✓ |
| 4 | "68 nodes" (Oct-14 basis; Oct-12 basis was 66 — both seen; fleet was churning) | ✓ dated basis kept |
| 5 | Post-fix $7,895→$4,420 / $12,585→$8,310 | customer-reported Oct 15 — not in the RCA bundle; keep phrased as customer-verified |
| 6 | c8i-flex.8xlarge $712.30 vs c5a.8xlarge $610.00 still unanswered | ✓ handed back Oct 16 |

## 4. Related but deliberately NOT in this CFR (avoid scope creep)

- Available Savings "theoretical potential" labeling vs feasible plans (RCA Q4 — estimator proposes infeasible 8-node layout). Mention on CSU-6246 only if asked; risky to fold in — it could swallow the focused explainability ask.
- Plan lifecycle attribution (`canceledByUser` at ~60 min on never-triggered plans; RCA Q3) — separate engineering question, not a feature request.
- Public-API plan list returning `configurations:null` (RCA Q2) — docs gap, separate.
