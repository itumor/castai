# Meeting 3 — SIEMENS x Cast AI | SMO Railigent X — 12:30 PM

**Friday 2026-10-16, 12:30 (Europe/Riga)** · Series: Siemens account cadence · Compiled Thu 2026-10-15 ~20:05 Riga · All sources read-only (Granola notes, repo docs, live GET-only CAST AI EU API).

---

## 1. Meeting snapshot

**Purpose (from Ebrahim's email context, unverified):** review the already-onboarded SMO Railigent X clusters; align the September Workload Autoscaler (WOOP) value story; agree points of contact during an upcoming time-off window; define next steps. No Granola note exists yet for this meeting — attendee list below merges the email context with the SMO-RI-CSX-CS weekly-series roster.

**Confirmed / likely participants:**

| Name | Side | Email | Basis |
|---|---|---|---|
| Christoph Goebels | Accenture (embedded at Siemens) — meeting organizer | christoph.goebels@accenture.com · christoph.goebels.ext@siemens.com | Email context (set up the meeting); Granola roster everywhere |
| Andreas Schieb | Siemens (SMO — Railigent X cluster owner/lead) | andreas.schieb@siemens.com | Email context; verified via cluster tags on k8s-andreas (`owner`, `TeamName: railigent-devops-enabler`, `org:unit: SMO CS DS MAC-DOP DEV`, `InvoiceTo: DE-K8SX`) — `outbox/savings-cases-2026-10-08/raw/d03690cb/01-cluster.json` |
| Fan Yang | Accenture | f.m.yang@accenture.com | Oct-14 SMO-RI weekly (Granola 056db3bf) — runs the Azure onboarding track |
| Fabian Jennrich | Accenture | fabian.jennrich@accenture.com | Siemens cadence-call roster |
| Tahmid Shibly | Accenture | tahmid.shibly@accenture.com | Siemens cadence-call roster |
| Sunil Bandi | Siemens (SMO-RI-CSX) | sunil.bandi@siemens.com | Oct-14 weekly — drove the Azure test-cluster connect |
| Georgi Markov | Siemens (FT RPD SWA) | georgi.markov@siemens.com | Oct-14 weekly |
| John Doyle | Siemens (IT IPS TE) | john.doyle@siemens.com | Oct-14 weekly |
| Ashwini Hebbar / Ashik N / Snigdha Athaiya | Siemens (SMO-RI-CSX-CS) | …@siemens.com | Oct-14 weekly roster (Granola 056db3bf) |
| Ebrahim Ramadan | Cast AI (customer engineer, host) | ebrahim@cast.ai | — |
| Ahmed Khaldi | Cast AI (TAM) | ahmed.khaldi@cast.ai | Weekly-series note-taker |

Coverage/escalation model on record (Aug–Sep planning, Granola 642192a4 Sep 1): Ebrahim covers Mon/Fri slots, mid-week covered by a substitute; Ebrahim CC'd on all invites as fallback; escalation Aleksy Zaleński (SA) → Carl Gridley (account). Whose time off this meeting covers is **unverified** — confirm live (Question 3).

---

## 2. Where we stand — verified facts

**Estate (live API, pulled 2026-10-15 17:00–17:03 UTC):**
- Org **SMO Railigent X** = `f15f33b9-20ad-4128-8289-da529844d3f0`, child org of the Siemens AG tree; exists live (`GET /v1/organizations`, 131 orgs, pull 17:00Z).
- **10 clusters** (`GET /v1/kubernetes/external-clusters` + `X-CastAI-Organization-Id`, pull 17:01Z): 9 EKS (7 in eu-central-1, 2 in ap-south-1) all `ready`/`online`, 7 of them literally named `k8s` (distinguish by id), plus `staging`, `k8s-andreas`; **`rhx-test` (anywhere provider) is `disconnected` since 2026-06-20** — never installed (`agentStatus=disconnected`, 0 cost items).
- **Node management is 100% Karpenter/read-only across the org.** `GET /v1/cost-reports/clusters/{id}/savings` returns **HTTP 400 "cluster is read-only" for all 10 clusters** (Sept window, pull 17:02Z) — expected, not an error; the classic node-savings API is unavailable on this estate by design.
- **No baseline records exist for 9 of 10 clusters** (`GET …/baseline-params` → nginx 404, pull 17:02Z) — consistent with WOOP-only operation (no node track to baseline against). Only k8s-andreas has one.

**k8s-andreas anomaly — fix verified live:**
- Oct 12: Siemens escalated $158,738 "savings" on $754 actual — root-caused to an INDUSTRY_AVERAGE baseline frozen over a 24h window (2026-04-15→16), locking **×169.58 CPU / ×35.44 RAM** overprovisioning factors (≈$4.8k/day phantom on a ~$26–55/day cluster). Filed as **CSU-6233**; fix **merged** (Mateusz Ledwoń), savings recalculated. Source: `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md`; `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md`.
- **Live re-pull 2026-10-15 17:02Z:** k8s-andreas baseline-params now `baselineType=CLUSTER_HISTORY`, **×1.8825 CPU / ×1.5051 RAM**, $0.0170575/CPU-core-hr, `updateTime=2026-10-14T12:29:20Z` — the recalculation is in production. Watch-out: the baseline window itself is still the same 24h (2026-04-15→16); factors are sane now, the window choice is unchanged.

**WOOP value story (the clean track — measured independently of nodes):**
- Per-cluster calendar-September WOOP dollars **cannot be pulled with GET-only calls**: the Value Realization report is POST-only (`:runValueRealizationReport`), and the classic savings GET 400s on all 10 clusters (verified above). **$8,513.97 across 8 clusters therefore stands as source = Ebrahim's email highlight, unverified-by-API.**
- Closest API-verified corroboration (POST VR report run by Ebrahim on 2026-10-08, window **2026-09-05→10-05**, raw: `outbox/savings-cases-2026-10-08/raw/org-railigentx/06-org-value-realization-30d.json`): **WOOP total $8,983.35 across 9 clusters ≈ 14.0% of $63,959.05 actual spend**. Per cluster: d0c7a7a5 $2,678.93 · 4952c4ce $2,267.45 · cf62a8e1 $1,816.26 · k8s-andreas $619.45 · ae3e22a4 (staging) $431.69 · f8dd5b4f $431.26 · 0e277bb2 $369.35 · 7eb37770 $200.99 · 5771ec22 $167.95. Excluding k8s-andreas → **$8,363.90 across the 8 pure-WOOP clusters** — consistent in magnitude with the email's $8,513.97 (different window: 30d vs calendar-Sept).
- **12-month cumulative WOOP savings: $28,900.31** (org timeline, same Oct-08 pull). WOOP track active since **2026-04** (first dollar coincides with k8s-andreas activation); node track since 2026-05. The same pull's 12m node figure ($707,231.59) is pre-fix and k8s-andreas-contaminated — **do not quote**.
- **September actual spend per cluster** (`GET /v1/cost-reports/clusters/{id}/cost`, 2026-09-01→10-01, pull 17:03Z): 4952c4ce **$26,732.92** (avg 1,041 vCPU) · d0c7a7a5 **$20,733.17** (862) · cf62a8e1 **$18,981.18** (655) · staging $1,925.37 (58.6) · k8s-andreas $1,449.83 (44.1) · 5771ec22 $949.14 (64.2) · 0e277bb2 $900.92 (26.6) · 7eb37770 $887.41 (53.3) · f8dd5b4f $875.01 (25.7) · rhx-test $0 (no items). **Org total: $73,434.94.**

**WOOP operational maturity (GET-only audit, 2026-10-05, `.kimchi/docs/woop-status-console-org-2026-10-05.md` + `console-org-woop-enablement-2026-10.md`):**
- **85–97% of workloads VPA-optimized** fleet-wide; CPU requests cut **−36%…−78%**. RAM **upsized** on d0c7a7a5 (+2.2%) and 4952c4ce (+50%) — VPA fixed under-provisioning; never sell RAM savings on these two.
- **Andreas Schieb is personally the activation driver**: the only human who ever flipped policies `readonly→managed` org-wide — k8s-andreas 2026-04-14 15:31 (single), then three 90-second bulk waves: 06-24 (4952c4ce), 07-02 (d0c7a7a5, f8dd5b4f, 7eb37770), 07-14 (5771ec22, cf62a8e1, 0e277bb2). Customer-workload applies began seconds after each flip (verified at payload level).
- **Agent drift: 7 of 9 clusters run WOOP agent v1.2.5 vs current v1.14.1** (13 minors behind; blocks scopedRecommendations ≥v1.11.0). staging + k8s-andreas on v1.10.0.
- 9 of 10 clusters run Karpenter (`SELF_HOSTED`); 8 of 9 carry `kent_enabled=true` (Karpenter Enterprise suite); 0e277bb2 is kent `NOT_SUPPORTED`. Rebalancing flakiness on staging/d0c7a7a5/5771ec22 noted Oct 5; CLM feature flapping org-wide (platform noise, support question open).
- Benchmark insight: 5771ec22 = Karpenter+WOOP with zero applied changes = natural control group; best effect clusters: k8s-andreas (applying since Apr 14), staging (since May 27).

**Siemens-side reporting rules already agreed (Granola 02150355 Sep 29 · 13c0a426 Oct 5 · f96617c9 + 150ba07d Oct 12):**
- Value Realization V1 beta = the official savings methodology (matches console; accounts for workload change).
- Oct-12 decision: **exclude Karpenter/Enterprise Suite clusters from node-level savings reports** (k8s-andreas effect). WOOP savings on these clusters are tracked **separately** and are the defensible proof point.
- **Never sum WOOP + node autoscaler savings** — VR `totalSavings == autoscalerSavings` (WOOP already inside). Siemens counts savings only for a cluster's **first 12 months** (Railigent X oldest connection 2026-02-04 → window ends ~2027-02-04).
- Enterprise September headline: ~$300K gross → exclude Karpenter/ES → **$131K**; CLUSTER_HISTORY-only → ~$121K net headline (all-Siemens). September Siemens report earlier quoted ~$59–60K gross / ~$19K net / ~$32K excl. negatives, with read-only Karpenter clusters contributing ~$10K attributed to WOOP; **use-case classification for WOOP-only Karpenter savings still unresolved** (UCs 20/515 don't cover it; new category may be needed — Bosko alignment).

**Adjacent track — SMO-RI-CSX-CS Azure onboarding (Granola 056db3bf Oct 14 + transcript):**
- First Azure test cluster connected live on the call after two root-caused blockers: (1) Windows single-quote vs double-quote around the org ID (typo-level fix — use double quotes on Windows); (2) app-registration/SPN flow unsupported → workaround = console script + `CASTAI_IMPERSONATE=true`, Linux/macOS only. Azure eventual-consistency retries are expected.
- **28 more Azure clusters pending** once the test cluster proves stable; workload + node autoscaling installed; reconcile + Cast node-pool creation up to ~30 min/cluster. Next: Fan to sync with Sunil next week (week of Oct 19).
- Live org check (17:03Z): SMO-RI-CSX-CS = `f2806a31-e339-4309-ba5a-e2518d1623d8`, **34 clusters (30 AKS + 4 EKS), 32 online**.
- Future default auth: managed identity (Siemens side) federated with Cast GCP service account — no keys, no app registrations; castctl + Terraform support **in progress, no GA date**.

**Commercial framing already on record:** SI + SMO onboarding positioned Cast AI as **20–30% savings on top of Karpenter** with read-only as the low-risk entry; autoscale priced at **€5/vCore/month** (Granola 0bf68990 Aug 17). Siemens pays for WOOP even where node savings aren't generated (Granola 18e3523c Sep 11) — exact WOOP-only fee basis for Railigent X **unverified** (Question 8).

---

## 3. Key numbers & facts to quote

| Item | Value | Source |
|---|---|---|
| September WOOP savings, SMO Railigent X | **$8,513.97 across 8 clusters** — **unverified-by-API** (GET-only pull impossible: VR report is POST-only; classic savings GETs 400 on all 10 clusters) | Ebrahim's email highlight |
| Corroborating WOOP figure | $8,983.35 across 9 clusters (30d window 2026-09-05→10-05) ≈ **14.0% of actual spend**; $8,363.90 excl. k8s-andreas | VR raw pull 2026-10-08: `outbox/savings-cases-2026-10-08/raw/org-railigentx/06-org-value-realization-30d.json` |
| 12-month cumulative WOOP savings | **$28,900.31** (clean track, active since 2026-04) | Same Oct-08 pull, `07-org-timeline-12m.json` |
| September actual spend, org total | **$73,434.94** (rhx-test $0) | GET `/v1/cost-reports/clusters/{id}/cost`, pull 2026-10-15 17:03Z |
| Top-3 spend clusters (Sept) | 4952c4ce $26,732.92 · d0c7a7a5 $20,733.17 · cf62a8e1 $18,981.18 (≈90% of org spend) | Same GET pull 17:03Z |
| WOOP 30d savings, top-3 | d0c7a7a5 $2,678.93 · 4952c4ce $2,267.45 · cf62a8e1 $1,816.26 | Oct-08 VR pull |
| VPA adoption / request effect | **85–97%** workloads optimized; CPU −36%…−78%; RAM **up** +2.2% (d0c7a7a5) / +50% (4952c4ce) | `.kimchi/docs/woop-status-console-org-2026-10-05.md` (Oct-05 pull) |
| k8s-andreas baseline, fixed | ×169.58 → **×1.88 CPU**, ×35.44 → **×1.51 RAM**, `CLUSTER_HISTORY`, recalculated 2026-10-14T12:29:20Z | GET baseline-params, pull 2026-10-15 17:02Z (before: `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md`) |
| k8s-andreas pre-fix phantom | $158,738 VR "savings" on $754 actual (≈$4.8k/day on a ~$26/day cluster) — excluded from all reports | Granola 150ba07d Oct 12; case doc |
| WOOP activation | Andreas Schieb, 4 flip events: 04-14 + 3 bulk waves 06-24 / 07-02 / 07-14 | `.kimchi/docs/console-org-woop-enablement-2026-10.md` (payload-verified) |
| WOOP agent currency | 7/9 clusters on **v1.2.5**; latest **v1.14.1** | `.kimchi/docs/console-org-woop-enablement-2026-10.md` |
| Classic savings API behavior | **HTTP 400 "cluster is read-only" on all 10 clusters** (expected on Karpenter/read-only estate) | GET `/v1/cost-reports/clusters/{id}/savings`, pull 17:02Z |
| Rule: never sum tracks | VR `totalSavings == autoscalerSavings`; WOOP already inside | `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md`; Granola f96617c9 |
| Rule: 12-month counting | Savings counted only first 12 months per cluster (oldest Railigent X connection 2026-02-04) | Granola 02150355 Sep 29 |
| Enterprise September headline | ~$121K net (all Siemens orgs, CLUSTER_HISTORY-only, fees deducted) | `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md` |
| Azure onboarding (SMO-RI-CSX-CS) | 1 test cluster connected Oct 14; **28 more pending**; `CASTAI_IMPERSONATE=true` + console script, Linux/macOS only | Granola 056db3bf Oct 14 + transcript |
| SMO-RI-CSX-CS live inventory | 34 clusters (30 AKS + 4 EKS), 32 online | GET external-clusters, pull 17:03Z |
| Railigent X inventory | 10 clusters: 9 EKS online (7×eu-central-1, 2×ap-south-1) + rhx-test disconnected | GET external-clusters, pull 17:01Z |

---

## 4. Open action items (owner → item → status)

| Owner | Item | Status |
|---|---|---|
| Fan Yang (Accenture) | Sync with Sunil to complete Azure test-cluster configuration | Scheduled — week of Oct 19 (Granola 056db3bf) |
| Sunil Bandi / SMO-RI-CSX team | Onboard remaining **28 Azure clusters** via console script + `CASTAI_IMPERSONATE=true` (Linux/macOS only) | In progress — first cluster live Oct 14 |
| Cast AI eng (Illia Litovchenko) | castctl native impersonation flow + Terraform support for managed-identity auth | In progress, no GA date (Oct-14 transcript) |
| Andreas Schieb (Siemens) | Nominate a non-prod cluster for CAST AI **node-autoscaling/rebalancing pilot** + success criteria | Open — proposal tomorrow (suggest `staging` or `f8dd5b4f` preprod) |
| Andreas Schieb / Railigent team | **WOOP agent upgrade v1.2.5 → v1.14.1** on 7 clusters (unlocks scopedRecommendations) | Open — owner to be named tomorrow |
| Railigent team | Offboard/clean up `rhx-test` (disconnected since 2026-06-20, never installed) | Open — recommend closure |
| Ebrahim | Re-verify Sept per-cluster WOOP dollars (VR report, calendar-Sept window) and reconcile $8,513.97 vs $8,363.90/30d | Open — needs POST VR (or console UI); GET-only was impossible today |
| Aleksy Zaleński (Cast AI SA) | SALP-129 savings-trust RCA + customer-facing cluster-by-cluster walkthrough; get-well plan with Carl + Ebrahim | In Progress (Jira, per Oct-15 briefing) |
| Bosko Corak + Ebrahim | Use-case/category classification for WOOP-only Karpenter savings (UC 20/515 don't cover; new category?) | Open (Granola 13c0a426 Oct 5) |
| Christoph Goebels | Time-off window: exact dates + point-of-contact matrix | Open — agenda item tomorrow |

---

## 5. Questions to ask in the meeting

1. "Can we walk through the eight clusters you have onboarded and confirm the September Workload Autoscaler number you are comfortable putting your name to — from our side it is $8,513.97, achieved with zero node autoscaling?"
2. "Which cluster do you nominate for the node-autoscaling pilot — our suggestion is `staging` (about $1,900/month of spend, agent already near-current) or the `f8dd5b4f` preprod cluster — and what does success need to look like after four weeks for you to take it to production?"
3. "For the upcoming time off: what are the exact dates, who is primary on your side, and if something breaks, do we route through Christoph and Fan or do you want a direct line to us?"
4. "Who owns the Workload Autoscaler agent upgrade window on your side? Seven of nine clusters are on v1.2.5; v1.14.1 unlocks scoped recommendations at no extra cost — it is the cheapest improvement available to you."
5. "k8s-andreas was recalculated on October 14 — the baseline factor dropped from 170× to 1.9× and the inflated figures are gone. Do you want a short walkthrough of which historical reports to disregard so nobody re-quotes them internally?"
6. "Do you want the September Workload Autoscaler figure included in the Siemens management report — and if so, on the Value-Realization basis, consistent with the October-12 decision to exclude Karpenter clusters from the node-level report?"
7. "Adoption is at 85–97% of workloads on the onboarded clusters — what blocks the remaining 3–15%, and should we raise the optimization aggressiveness on the non-prod clusters?"
8. "Can we confirm how the Workload-Autoscaler-only clusters are billed on your contract — per optimized vCPU or another basis — so the net number we quote next month is beyond dispute?"
9. "rhx-test has been disconnected since June 20 — shall we offboard it so your Railigent X dashboard shows only real estate?"

---

## 6. Risks / watch-outs

1. **$8,513.97 is email-sourced, unverified-by-API.** If challenged tomorrow, say the per-cluster table comes from the Value Realization report and offer to re-run it live — do not improvise a per-cluster split. Corroboration in hand: $8,983.35 (9 clusters) / $8,363.90 (8 clusters excl. k8s-andreas) over 2026-09-05→10-05.
2. **Never sum WOOP + node savings.** VR `totalSavings == autoscalerSavings`; the WOOP figure is already complete on its own. Summing destroyed credibility twice this month ($530K FY26 report, k8s-andreas $158K).
3. **Never quote k8s-andreas pre-fix node figures** ($150,024 30d / $707,232 12m — phantom, pre-CSU-6233-fix). The recalculated baseline is live since 2026-10-14 12:29Z, but the recalculated *savings* numbers were not pullable GET-only tonight — no new node figure may be quoted.
4. **Classic API 400s are expected, not an incident.** All 10 Railigent X clusters return "cluster is read-only" on the legacy savings endpoint — anticipate the question if anyone re-runs old scripts (Ralf/Sergej pattern).
5. Don't sell RAM savings on **4952c4ce (+50%)** and **d0c7a7a5 (+2.2%)** — VPA intentionally upsized memory there.
6. **Baseline window still 24h** on k8s-andreas (factors fixed, window not) — if asked for a cleaner baseline, the answer is a custom-period recalculation (`:recalculate` exists; needs CAST AI side).
7. WOOP savings views are limited in Karpenter mode ("Show Trend" proxy) — pre-answer the console-navigation question (Granola 18e3523c).
8. Rebalancing flakiness on staging and CLM org-wide config flapping (Oct-05 observations) are open platform questions — don't get drawn into promising dates.
9. The remaining 28-cluster Azure rollout depends on a workaround (`CASTAI_IMPERSONATE`), not GA functionality — no castctl/Terraform dates exist.
10. If the management-report discussion merges Railigent X with the enterprise headline (~$121K), keep the bases separate: WOOP-only number for this org, CLUSTER_HISTORY-only net for the enterprise.

---

## 7. Tonight's prep checklist

1. **Verify the $8,513.97.** Re-run the org VR report for the calendar-September window — `POST /reporting/v1beta/organizations/f15f33b9-20ad-4128-8289-da529844d3f0/clusters:runValueRealizationReport` with `{"clusterIds":[…9 online ids…]}`, headers `X-API-Key` + `X-CastAI-Organization-Id` (run from the console UI or under your own approval — POST is outside my read-only mandate; today I proved it cannot be done with GETs). Build the per-cluster table; reconcile vs the Oct-08 pull ($8,363.90 excl. k8s-andreas).
2. Save the Sept cost table above (§3) as the spend baseline for tomorrow — it is GET-verified with pull timestamp 2026-10-15 17:03Z.
3. Confirm with Christoph (Slack/email) the exact attendee list and the **time-off window dates + substitute names** — Granola holds no coverage note for this meeting.
4. Skim `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md` — be able to tell the bug story in 30 seconds: "24-hour industry-average window froze a 170× factor; fix merged; baseline recalculated October 14; WOOP track was never affected."
5. Draft the pilot one-pager: scope (`staging` ae3e22a4 or `f8dd5b4f` preprod), guardrails (no production clusters, no kent/Turbo changes), rollback (detach = return to Karpenter-only), success metric (node-level savings $ + disruption budget, 4-week review).
6. Prepare the agent-upgrade ask: list the 7 clusters on v1.2.5 (4952c4ce, d0c7a7a5, f8dd5b4f, 7eb37770, 5771ec22, 0e277bb2, cf62a8e1) and the v1.14.1 target.
7. Re-read this brief at 08:00; reload this page's numbers if any VR re-pull happens between now and then — **always quote VR numbers with their pull timestamp** (values recompute on read).
8. After the meeting: file a Granola note and update `brain/notes/Siemens Fleet.md` (currently stale, last refreshed 2026-09-11).

---

## 8. Sources

**Granola (meeting notes):**
- [056db3bf — CAST AI 1 to 1 | SMO-RI-CSX-CS Weekly Follow Up — Oct 14, 2026](https://notes.granola.ai/d/056db3bf-5b0d-45c6-b9c7-efb21a7ec49e) (summary + full transcript: quote fix, CASTAI_IMPERSONATE workaround, 28 clusters pending, Fan↔Sunil next week)
- [150ba07d — [Urgent] Cast AI: Cost and Savings Calculation — Oct 12, 2026 17:00](https://notes.granola.ai/d/150ba07d-75f8-47f5-b324-e4aff6d780b0) (k8s-andreas flag; exclude Karpenter/ES decision)
- [f96617c9 — [Urgent] Cast AI: Cost and Savings Calculation — Oct 12, 2026 15:30](https://notes.granola.ai/d/f96617c9-cbc2-4cd9-ac27-0b2ae683d501) (VR V1 beta = official methodology)
- [13c0a426 — cast.ai and siemens discounts — Oct 5, 2026](https://notes.granola.ai/d/13c0a426-6186-41c1-a765-29bcbbc663e0) (Sept report ~$59–60K gross/~$19K net; Karpenter ~$10K WOOP; classification gap)
- [18e3523c — WOOP + Karpenter model / HyperCat — Sep 11, 2026](https://notes.granola.ai/d/18e3523c-8468-4e6f-9db4-56bfd6e451ee) (read-only definition; WOOP on top of Karpenter; limited savings view)
- [02150355 — Cast.AI baseline scaling — Sep 29, 2026](https://notes.granola.ai/d/02150355-46dd-440d-b409-121f7890f4b8) (12-month rule; CPU+RAM basis; start date per cluster from API)
- [0bf68990 — Cast AI Onboarding Session SI + SMO — Aug 17, 2026](https://notes.granola.ai/d/0bf68990-f1d8-4833-992e-6ffa859e02c8) (20–30% on top of Karpenter; €5/vCore/mo)
- [642192a4 — Planning upcoming 2 weeks — Sep 1, 2026](https://notes.granola.ai/d/642192a4-eb91-4966-a402-bb64a61abbc1) (coverage model)
- Query-verified: **no Granola note mentions Andreas Schieb** and none contains "$8,513.97" (searched 90 days, folder 0dffa50d "Siemenes", 77 meetings Aug 1–Oct 16).

**Repo (read-only):**
- `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md` (enterprise headline ladder, business rules, CSU-6233/CSU-6239/SALP-129 state)
- `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md` (phantom-savings RCA)
- `.kimchi/docs/console-org-woop-enablement-2026-10.md` (enablement waves, Schieb flips, agent drift)
- `.kimchi/docs/woop-status-console-org-2026-10-05.md` (adoption 85–97%, request deltas, rhx-test, anomalies)
- `outbox/savings-cases-2026-10-08/CASES.md` + `raw/org-railigentx/06-*.json`, `07-*.json` (Case-B definition; 30d WOOP table; 12m totals)
- `outbox/savings-cases-2026-10-08/raw/d03690cb/01-cluster.json` (k8s-andreas tags → Andreas Schieb identity)
- `brain/notes/Siemens Fleet.md` (org/cluster counts, 2026-09-11 xlsx refresh — stale vs live)

**CAST AI API (EU, GET-only, pull timestamps UTC 2026-10-15):**
- `GET /v1/organizations` 17:00Z — SMO Railigent X `f15f33b9…`, SMO-RI-CSX-CS `f2806a31…`, 131 orgs
- `GET /v1/kubernetes/external-clusters` (org header) 17:01Z / 17:03Z — 10 Railigent X clusters; 34 SMO-RI-CSX-CS clusters (30 AKS/4 EKS, 32 online)
- `GET /v1/cost-reports/clusters/{id}/savings` 17:02Z — 400 "cluster is read-only" × 10 (expected)
- `GET /v1/cost-reports/clusters/{id}/cost` 17:03Z — September actual cost per cluster (org total $73,434.94)
- `GET /reporting/v1beta/organizations/…/clusters/{id}/baseline-params` 17:02Z — 404 × 9; k8s-andreas 200 with recalculated CLUSTER_HISTORY ×1.88/×1.51 (updateTime 2026-10-14T12:29:20Z)
- `GET /spec/` + `/spec/reporting/openapi.yaml` 17:01Z — VR reports confirmed POST-only → September WOOP-by-cluster dollars not pullable GET-only; $8,513.97 marked unverified-by-API accordingly
