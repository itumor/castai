# Meeting 5 — Cast AI Cluster Score Review — 5:00 PM

Friday 2026-10-16, 17:00 Europe/Riga · Prepared 2026-10-15 evening (all data read-only; live GET pulls timestamped below; nothing modified anywhere).

---

## 1. Meeting snapshot

**Purpose (from email context + Oct 9 precedent):** go through the Siemens cluster list, assess the Cluster Score per cluster, and analyze savings *potential vs realized* — including reconciling the September Value-Realization report Ebrahim distributed ($14,746.76 Workload Autoscaler savings across 36 clusters, explicitly kept separate from Node Autoscaler savings to prevent double-counting).

**Participants (confirmed = attended the Oct 9 session of this exact thread):**

| Name | Email | Side | Role in this thread |
|---|---|---|---|
| Ebrahim Ramadan | ebrahim@cast.ai | Cast AI | Customer engineer, Siemens account; savings methodology + Sept VR report owner |
| Ahmed Khaldi | ahmed.khaldi@cast.ai | Cast AI | TAM; owner of the /scorecards script + score-alerting POC; Helios cost-string investigation |
| Sergej Petrovski | sergej.petrovski@siemens.com | Siemens | REST API power user, score-report author (his ~50-cluster report triggered this); standing request 2026-10-13: CC him on ALL API-related threads |

**Likely but unverified (invite not seen):** Bosko Corak (bosko.corak@siemens.com, Siemens orchestrator), Carl Gridley (Cast AI account side).

---

## 2. Where we stand — verified facts

- **Oct 9 baseline (Granola 899a37f7 + ebb1cc5a, Oct 9, summary + full transcript read):** Siemens clusters score poorly — max seen **7.9**, many at 2–3 (Sergej's red bucket = "very bad"). Sergej's report covers ~50 node-optimization-enabled clusters, red-flagging clusters where **savings < Cast AI payment**. Example quoted on the call: Helios with **$19,492 savings last month** still red-flagged by that rule.
- **Three recurring culprits for low scores, seen live in console Oct 9** (transcript, ebb1cc5a): Evictor (node downscaling) not enabled; CPU overprovisioning (example shown: 44%); Rebalancer schedule disabled. Agreed: score directly correlates with savings potential; **7+ is the realistic ceiling** given instance-family/disk constraints ("sometimes they want specific instance families, sometimes disks... complexities that make it not easy to optimize 100%").
- **Intentional opt-outs exist and must be annotated, not treated as failures** (transcript): "Some customers really don't want Evictor or node autoscaling" — e.g. GSW's stance. WOOP is **ruled out for all Siemens R&D clusters** (on-prem parity requirement; Granola a736d7c7, Oct 9 SI GSW Exchange).
- **Subscores are console + console-API only**: overall score was said on the call to be in the `/summary` API; subscores (Scorecards: Cost efficiency / Resilience / Operations split, "Opportunities for Improvement") live in the console UI and the console-internal `GET https://console.eu.cast.ai/api/v1/cost-reports/clusters/{id}/scorecards` which requires a browser session cookie — **no API-key auth** (repo: .kimchi/docs/cluster-score-schedule-api/working-endpoints.md). Ahmed committed to send his score-to-recommendation script to Sergej as a TXT (action item below). Resilience=0 on some clusters is because the reliability-matrix component isn't installed — Cost efficiency is the subscore Siemens cares about.
- **Live correction tonight (GET pull 2026-10-15T17:00:56Z / 20:00:56 EEST): the overall numeric Cluster Score IS publicly GET-able** — `GET https://api.eu.cast.ai/v1/cost-reports/clusters/{id}/summary` returns `summary.clusterScore` (string). Pulled 64 of 65 clusters across SI GSW CLO (22), CPS (2), IT IPS (24), SFS IT CDO (16); fleet max = **ngm-sim-eks 7.9 exactly** — matches Sergej's Oct 9 observation, so the field maps to the console score (formal side-by-side console comparison still open — do it live in the meeting). This **invalidates** the "numeric score is console-only" assumption in our repo notes (working-endpoints.md, score-alerting-poc README, today-20:00 master prep §17:00).
- **What is NOT GET-able:** the subscore split. The reporting spec (`https://api.eu.cast.ai/spec/reporting/openapi.yaml`, pulled 2026-10-15) carries a `ClusterScoreAPI` with GET `/reporting/v1beta/organizations/{orgId}/clusters/{clusterId}/restrictions` and `/restriction-details` — verified live (HTTP 200 on ngm-helios, returns a per-workload restriction catalogue, e.g. `missing_probes` in `kasten-io` and `siemens-digital-grid-avg` namespaces). This is the **reason catalogue** behind low scores, not numeric subscores. The only numeric efficiency-score payload sits behind **POST** `:runOptimizationsReport` — POST is forbidden by this engagement's read-only rule, so marked blocked.
- **Deep-red clusters are largely read-only-connected** (live, 2026-10-15T17:01:33Z): classic savings `GET /v1/cost-reports/clusters/{id}/savings` returns **HTTP 400 "cluster is read-only"** for ngm-vsinteg-eks, ngm-vsdev-eks, clo-master-eks, hermes-val-eks, shire-qa-eks, ngm-data-eks — no node-autoscaling engine on these, which explains both their 1.1–2.5 scores and "no savings" lines in Sergej's report.
- **Evictor state verified live** (`GET /workload-eviction/v1/clusters/{id}/config`, 2026-10-15T17:02:59Z): ngm-vsinteg-eks **enabled:false**; ngm-helios-eks and ngm-integ-eks **enabled:true**; clo-master endpoint returned HTTP 500 (state unverified via this endpoint).
- **Rebalancer right now:** latest plan per cluster (GET `/v1/kubernetes/clusters/{id}/rebalancing-plans`, 17:01:33Z): **ngm-integ-eks and ngm-kronos-eks are actively draining nodes this minute** (plans created 17:00:11Z / 17:00:06Z, status `draining_nodes`); eleX01p and iec-tcx-flat last plans 2026-09-29 status `error`; ngm-data-eks last plan 2026-08-27 status `error`; kafka-test and the five read-only clusters have **zero plans ever**. **All 13 deep-pulled clusters return `isRebalancingRecommended: true`** (estimated-savings, 17:02Z).
- **September methodology is settled (Granola f96617c9 Oct 12 15:30 + 150ba07d Oct 12 17:00):** Value-Realization V1 beta is the single source of truth; `totalSavings == autoscalerSavings` (WOOP already inside — never sum); Karpenter/Enterprise-Suite clusters excluded; never publish unexplained outliers; Siemens rule = savings counted only first 12 months per cluster; cost basis = CPU+RAM at contracted discounted prices.
- **September was RESTATED after the CSU-6233 baseline-bug fix** (k8s-andreas ×170/×35 overprovisioning from a 24h INDUSTRY_AVERAGE window; fix merged by Mateusz Ledwoń): fleet September VR savings **restated $320,348.65 → $86,106.22 across 36 clusters**; corrections were still landing 2026-10-15 (HAFAS override 09:26Z). Source: outbox master prep + email-body (compiled 2026-10-15 ~20:15) — original report artifact is Ebrahim's distributed September VR report (unverified here beyond those references).
- **The $14,746.76 Workload-Autoscaler line (36 clusters, September)** is part of that distributed report and must continue to be quoted **separately** from Node Realized Savings (source: email context + outbox email-body.txt). WOOP savings live *inside* the per-cluster totalSavings; the separate line is for visibility only.
- **Negative-net-savings mechanics documented** (repo: .kimchi/docs/2026-10-05-cps-negative-savings-case.md, 2026-10-08-cps-negative-savings-refresh.md): CPS dema-platform-services realized **+$11,689.75** September VR while its WOOP line is **−$80.91** — negative *by design* (WOOP raised under-provisioned requests); the fleet's fee basis: **SI GSW = €5 per avg-provisioned vCPU-month** (invoice-verified 1,806→€9,030; Sept basis 8,275.94 billable vCPU → €41,379.70 at €5 — the €5/$5.70 per-vCPU fee is what pushed low-score, low-savings clusters net-negative in Sergej's view); **CPS = 5% of positive gross** — never mix.
- **Helios "unit cost −14%" story verified** (repo: cluster-cost-analysis/helios-recon-2026-10-12/ + today-20:00 master prep): baseline 1.60×/2.17×, provisioned −520 vCPU July→Sept, utilization ≈9.8% of requested; classic $18,877.78 vs VR $6,667.82 both reproducible; net is fee-marginal.
- **Live rebalance = the score's biggest single lever:** executing recommended rebalances raises the score (rebalancer subscore), captures the Layman potential (below), and shrinks the €5/vCPU fee basis.

---

## 3. Key numbers & facts to quote

**Live Cluster Score table** — `GET /v1/cost-reports/clusters/{id}/summary → summary.clusterScore`, pulled 2026-10-15T17:01:09–17:01:33Z (20:01 EEST), 65 clusters pulled, 64 with scores; buckets per Sergej's Oct 9 convention (Red/Poor 0–3, Yellow/Concerning 4–6, Green/Healthy 7–10):

| Cluster (org) | Score | Bucket | Key failing signal (live GET, tonight) | Sept realized (classic GET) | Potential (Layman) |
|---|---:|---|---|---|---|
| ngm-sim-eks (SI GSW) | **7.9** | Green | — (fleet max; baseline 06-03 stale per audit) | n/a (VR $11,476.95*) | — |
| baseline-clo-eks (SI GSW) | 7.4 | Green | CSU-6239 hibernation-inflated baseline | $1,350.90* | — |
| ngm-sim2-eks (SI GSW) | 6.6 | Yellow | youngest; fix validated here | $435.43* | — |
| ngm-integ-eks (SI GSW) | 5.8 | Yellow | OP 36%; **rebalancing now (17:00Z)**; WOOP attribution open | $18,512.46 | $17,058/mo (56.1%) |
| pioneer-tcx (IT IPS) | 5.4 | Yellow | OP 62.6%** | $300.68* | — |
| ngm-helios-eks (SI GSW) | 4.8 | Yellow | util ≈9.8%; rebalance recommended, never executed | **$18,877.78** | **$23,082/mo (32.2%)** |
| dema-platform-services-test (CPS) | 8.3 | Green | WOOP covers 77/97 workloads | $213.33-month→Sept realized +$202.02 (classic n/a†) | — |
| dema-platform-services (CPS) | 4.4 | Yellow | WOOP line −$80.91 by design; 0 spot | $1,249.10 | $5,431/mo (43.2%) |
| ngm-demo-eks (SI GSW) | 2.9 | Red | — | — | — |
| ngm-test-eks (SI GSW) | 2.6 | Red | — | — | — |
| ngm-data-eks (SI GSW) | 2.5 | Red | OP 89.8%; VR −$325.39*; last plan **08-27, error** | 400 read-only | $1,481/mo (87.7%) |
| workbench-preprodeu-eks (SI GSW) | 2.5 | Red | — | — | — |
| kafka-test (IT IPS) | 2.5 | Red | OP 84%; **0 plans ever**; classic $0 Sept | $0.00 | $305/mo (75.7%) |
| bx-edex-dev-eu (IT IPS) | 2.4 | Red | — | — | — |
| shire-demo-eks (SI GSW) | 2.1 | Red | — | — | — |
| eleX01p (IT IPS) | 1.9 | Red | **VR −$3,266.77 on $12,913.98 actual**; OP 54.8%; last plan 09-29 error | $6.65 | $9,254/mo (66.9%) |
| shire-qa-eks (SI GSW) | 1.4 | Red | read-only engine; OP 55.0% | 400 read-only | $54/mo (19.9%) |
| clo-master-eks (SI GSW) | **1.1** | Red | OP 68.6%; evictor state unverified (500); **never rebalanced** | 400 read-only | $525/mo (71.9%) |
| hermes-val-eks (SI GSW) | **1.1** | Red | OP 30.1%; never rebalanced; read-only | 400 read-only | $1,361/mo (88.7%) |
| ngm-vsdev-eks (SI GSW) | **1.1** | Red | OP 93.1%; evictor OFF; never rebalanced | 400 read-only | $1,409/mo (89.4%) |
| ngm-vsinteg-eks (SI GSW) | **1.1** | Red | OP 93.1%; **evictor OFF** (live); never rebalanced | 400 read-only | $1,409/mo (89.4%) |
| iec-tcx-flat (IT IPS) | **1.1** | Red | **VR −$419.99 on $1,106.38 actual**; OP 62.6%; last plan 09-29 error | $0.00 | $791/mo (70.5%) |
| cloudcore02 (IT IPS) | — | — | **status=failed** (no score possible) | — | — |

\* from `scratch/siemens-review/sept2026-verified-per-cluster.tsv` (restated verified September, repo). \*\* eleX01p OP 54.8% is its live pull; pioneer-tcx not in tonight's deep-pull — OP% cited from earlier pulls, re-verify. † CPS realized figures are VR-basis from the CPS case docs (classic endpoint undercounts there — cloud-connect telemetry stale since 09-16). Full 64-row table available if needed; remainder: alliander-demo 3.4, iands-sales2 4.0, ngm-kronos 3.8, onboard-delivery 3.9, onboard-sales1 3.6, shire-dev 3.4 (SI GSW); eleX01 5.1/4.4, eleX01in 4.6, eagle-kafka01 4.2, staging-sec 3.6, aks-neobot ×2 3.2, dev-sec 3.2, shared01 2.9, bx-edex-int/prod 2.7, cloudcore01 2.7, mof-staging 2.7, aks-dios 2.3/2.0, ea-admin 2.2, aks-n8n 2.1/2.0, mof 2.1 (IT IPS); SFS IT CDO AKS fleet 2.4–4.2 (rg-cdo-p lowest 2.4); SMO Railigent X k8s-andreas not re-pulled tonight (VR post-fix $444.49 on $753.83 actual per TSV).

| Item | Value | Source |
|---|---|---|
| Fleet max score (Oct 9 report → tonight's pull) | 7.9 → **still 7.9** (ngm-sim-eks) | Granola 899a37f7/ebb1cc5a; API 17:01Z |
| Fleet score distribution | 1 green-ish (7.9) + 1 (7.4) + 1 ×8.3 (CPS test); bulk 1.1–5.8 | API 17:01Z |
| Sept fleet VR savings, restated | **$320,348.65 → $86,106.22** (36 clusters) | outbox master prep/email-body (post-CSU-6233) |
| Sept Workload-Autoscaler line | **$14,746.76** across 36 clusters — separate line, never summed into Node Realized | Ebrahim's distributed Sept VR report / email-body.txt |
| Sept fee basis (SI GSW) | 8,275.94 billable vCPU ≈ **€41,379.70 @ €5/vCPU-mo** | outbox master prep + invoice-verified €5 rate |
| Helios: classic vs VR Sept | $18,877.78 (GET live) vs $6,667.82 VR (TSV) | both verified |
| Helios potential | $23,082/mo Layman rebalancing (32.2%); rebalance also cuts fee basis | GET estimated-savings 17:02Z |
| eleX01p / iec-tcx-flat Sept VR | **−$3,266.77** on $12,913.98 / **−$419.99** on $1,106.38 | verified TSV + classic $6.65 / $0.00 live |
| CPS dema main Sept | realized +$11,689.75; WOOP line −$80.91 (by design) | repo CPS case docs + TSV |
| Score→savings correlation quote (verbatim, Sergej, Oct 9) | "I am pretty sure that if the score will be improved, then it will be much, much, much better also for saving." | Granola ebb1cc5a transcript |
| 7+ ceiling quote (verbatim, Ebrahim, Oct 9) | "If we reach the score of 7... we're already in a very good state... constraints... specific instance families... disks..." | Granola ebb1cc5a transcript |

---

## 4. Open action items (owner → item → status)

- **Ahmed Khaldi →** send cluster-score recommendations script to Sergej as TXT in chat (maps scorecards subscores → docs → generic recommendations) — committed Oct 9 · status unverified — ask in meeting.
- **Ahmed + Sergej →** integrate the /scorecards pull into Sergej's automation so recommendations flow to cluster owners automatically — Sergej assigned Oct 9 ("Review Cast AI console score and subscores... use the shared script") · **score-alerting POC exists** (castai-terraform-1/score-alerting-poc: cron scan, rules.py six sub-metrics, owners.py DRI mapping, dedup 24h, 17 offline tests) · POC predates tonight's score-GET discovery — should now read `clusterScore` directly instead of injected console scores.
- **Ahmed →** Helios cost-string investigation (Sergej's strings; time blocked Oct 9 1–2 PM) · status unverified — close verbally.
- **Ahmed →** CFR for cross-organization search in new UI · status unverified.
- **Ebrahim →** pull baseline date + first-rebalance per cluster (Oct 12 urgent #2) · **DONE** — table in .kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md §6.
- **Ebrahim →** September extract on restated basis ($86.1K story) before Mark · in progress; verify the Oct-12 draft email was sent.
- **Aleksy Zaleński + Carl + Ebrahim →** SALP-129: RCA for flagged clusters, cluster-by-cluster savings walkthrough, get-well plan (~2–3 days SA) · In Progress per Jira summary (user-supplied; not re-verified).
- **Cast AI engineering →** baseline-recalculation plan fleet-wide (PATCH baseline-params / POST :recalculate exist) — stale pre-fix baselines will repeat September anomalies in October · open.
- **Siemens (Fan/Cloudability owners) →** Cloudability rate-card export to pin the discount factor · open since Oct 9.
- **Sergej →** cluster-owner mapping for the DRI column (owners.py-style) · open.

---

## 5. Questions to ask in the meeting (verbatim)

1. "We verified last night that the overall Cluster Score is now GET-able per cluster from the public API — `/v1/cost-reports/clusters/{id}/summary` returns `clusterScore`, and our fleet max is still exactly 7.9. Sergej, does this unblock your automation, or do you additionally need the Cost/Resilience/Operations subscore split, which is still console-only?"
2. "Can we lock tonight's top-10 red list — clo-master, hermes-val, ngm-vsinteg, ngm-vsdev and iec-tcx-flat all at 1.1, eleX01p at 1.9, shire-qa 1.4, kafka-test 2.5, ngm-data 2.5, kronos 3.8 — each with a named DRI and a target date?"
3. "Six red clusters return HTTP 400 'cluster is read-only' on the savings API — vsinteg, vsdev, clo-master, hermes-val, shire-qa, ngm-data. Are those intentional read-only onboardings? If yes, let's annotate them so red reads as a posture choice, not a failure."
4. "ngm-integ and ngm-kronos are literally draining nodes as of 5:00 PM today. Can we use these two as the pilot evidence for enabling scheduled rebalancing on the other red clusters?"
5. "Helios: rebalance has been recommended for weeks, never executed — the estimate is $23.1K a month on the Layman path, and every rebalance also shrinks our €5-per-vCPU fee basis. What is the decision — pilot, maintenance window, owner?"
6. "eleX01p is VR-negative $3,267 in September on $12.9K of spend. Is that cluster's workload still comparable to its frozen baseline, or do we re-baseline it before it goes in front of Mark?"
7. "Confirm we all quote September on the restated basis only — $320.3K down to $86.1K across 36 clusters — with pull timestamps, and keep the $14.7K Workload Autoscaler line visibly separate, never summed?"
8. "The score-alerting POC runs read-only on an 8 AM cron and alerts the cluster owner with named sub-metrics — shall we demo it tomorrow and agree the owners mapping as the delivery mechanism?"
9. "Resilience and Operations show zero where the reliability matrix isn't installed — do we tell owners to ignore that subscore for now, or do we install the matrix?"
10. "Ahmed — is the Helios cost-string thread with Sergej's strings fully closed, or is any part still open?"

---

## 6. Risks / watch-outs

- **Don't quote pre-restatement September numbers.** VR is recomputed on read; corrections were still landing today. Every number in the meeting needs a pull timestamp.
- **Score ≠ punishment.** Several reds are intentional opt-outs (GSW: no Evictor/no WOOP on R&D, on-prem parity). Get the annotation agreed, or the DRI conversation turns adversarial.
- **clusterScore↔console mapping:** the summary field matches Sergej's "max 7.9" observation exactly, but a formal console side-by-side is still pending — do one live in the meeting before promising score-automation accuracy. Subscores remain console-only; do NOT promise subscore API automation with API keys.
- **Fee-mixing:** SI GSW €5/provisioned-vCPU-month vs CPS 5%-of-gross vs the legacy $5.70 UC21 sheet — mixing these once more will relitigate the whole trust debate.
- **eleX01p/iec-tcx-flat negative VR optics:** these are honest counterfactual negatives (VR semantics), not "money lost" — but they are the two names most likely to be quoted back at us; have the re-baseline answer ready (question 6).
- **cloudcore02 (IT IPS) is in `failed` status** — no score; separate hygiene item, don't let it derail.
- **Baseline staleness risks October repeat:** every flagged baseline pre-dates the CSU-6233 fix (fleet audit 10-14); September anomalies recur in October until recalculated/overridden — ask who triggers recalculation.
- **WOOP-attribution question on ngm-integ** (woopAdopted=true, 0/4,566 workloads managed) is open with engineering; keep the WOOP line at $0 quotes for integ until resolved.
- **Never resurface** the withdrawn ROI PDFs ($526,923 / $357,285 figures) in any customer-facing context.
- **No spot or WOOP pitch to GSW R&D** (ruled out Oct 9); no list prices to management — Siemens billed basis only (≈0.500–0.503 × CAST price sheet).
- **Classic-vs-VR dual numbers** (Helios $18,877.78 vs $6,667.82) will be quoted by the audience interchangeably; the accepted answer is: V1 beta VR is official, both are reproducible, the delta is September's workload decrease.

---

## 7. Tonight's prep checklist

1. ✅ Done: live score pull (64 clusters, 4 orgs, 17:01Z), potential vs realized pairing, read-only-classification of the deep-red six, evictor states.
2. Re-pull the same score table ~30 min before the call (scores are recomputed); freeze with timestamp and bring the CSV/screen.
3. Open the console Cluster Score page for Helios + one red cluster; confirm the console number equals the API `clusterScore` (closes the mapping question).
4. Screenshot the console score pages (incl. "Opportunities for Improvement") for the top-10 reds — subscores are console-only, no other way to show them.
5. Prepare the score-alerting POC demo: `config.example.json → config.json`, owners mapping pre-filled for the top-10, run one `scan --dry-run` and save the report (17 offline tests already green); update it to read `clusterScore` from the summary API instead of injected console scores.
6. Re-freeze the September restated totals ($86.1K / $14.7K lines) with timestamp from the post-HAFAS-override state; confirm the Oct-12 restated-basis email went out.
7. Verify fee math per contract before any net quote (€5/vCPU × 8,275.94 Sept billable vCPU).
8. CC Sergej on any API-related follow-up mail after the meeting (standing request 2026-10-13).

---

## 8. Sources

- **Granola:** [899a37f7 (Oct 9, Ahmed's capture)](https://notes.granola.ai/d/899a37f7-94af-4daf-8729-293277155a5f) + [ebb1cc5a (Oct 9, Ebrahim's capture, full transcript read)](https://notes.granola.ai/d/ebb1cc5a-255d-4c89-82fb-f5599e5b93bf) — "Optimisation KPI of onboarded Clusters"; [f96617c9 (Oct 12 urgent #1, V1-beta decision)](https://notes.granola.ai/d/f96617c9-cbc2-4cd9-ac27-0b2ae683d501); [150ba07d (Oct 12 urgent #2, $300K/$158K/$38K)](https://notes.granola.ai/d/150ba07d-75f8-47f5-b324-e4aff6d780b0); [7e8970e5 (Oct 8 FinOps daily, $70,303.78 vs $6K)](https://notes.granola.ai/d/7e8970e5-5c48-4ff5-bbd0-d5ce4984ee0c); [a736d7c7 (Oct 9 SI GSW Exchange)](https://notes.granola.ai/d/a736d7c7-7322-4eee-886d-c5894d1a9053).
- **Repo:** .kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md; .kimchi/docs/2026-10-05-cps-negative-savings-case.md; .kimchi/docs/2026-10-08-cps-negative-savings-refresh.md; .kimchi/docs/case-smo-it-in-cop-access-blank-reporting.md (RBAC/blank-reporting pattern: org-without-clusters ⇒ blanks — same class as score/reporting access questions); .kimchi/docs/cluster-score-schedule-api/{README,working-endpoints,test-results}.md; scratch/siemens-review/sept2026-verified-per-cluster.tsv (69-row restated September); castai-terraform-1/score-alerting-poc/ (Ahmed's POC); brain/notes/Siemens People.md (Sergej CC rule).
- **Outbox:** outbox/meeting-prep/meeting-prep-2026-10-16.md + email-body.txt (2026-10-15 ~20:15 compile — restated September totals, fee basis, prioritized red-cluster table).
- **Live CAST AI EU API (GET-only, all pulls 2026-10-15 16:59:50Z–17:02:59Z UTC = 19:59–20:02 EEST):** `GET /v1/organizations` (131 orgs; enterprise Siemens AG 8b69b8da); `GET /v1/kubernetes/external-clusters` per org (SI GSW CLO 22, CPS 2, IT IPS 24, SFS IT CDO 16); `GET /v1/cost-reports/clusters/{id}/summary` (clusterScore — 64 pulls); `GET /v1/cost-reports/clusters/{id}/savings?startTime=2026-09-01T00:00:00Z&endTime=2026-09-30T23:59:59Z` (Sept classic); `GET /v1/cost-reports/clusters/{id}/efficiency` (OP%); `GET /v1/cost-reports/clusters/{id}/estimated-savings` (Layman/SpotInstances/SpotOnly potential + isRebalancingRecommended); `GET /v1/kubernetes/clusters/{id}/rebalancing-plans`; `GET /workload-eviction/v1/clusters/{id}/config`; `GET /reporting/v1beta/organizations/{orgId}/clusters/{id}/restrictions` (restriction catalogue); spec checks: `GET /v1/spec/openapi.json` (no score paths), `GET /spec/reporting/openapi.yaml` (ClusterScoreAPI; numeric score only behind POST :runOptimizationsReport — blocked, POST forbidden).
