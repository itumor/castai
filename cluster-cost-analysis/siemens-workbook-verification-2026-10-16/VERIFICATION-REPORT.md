# Siemens savings workbook — API verification
**Date:** 2026-10-16 · **Subject:** `Siemens savings report Sep16-Oct15.xlsx` (Aleksy's Google Sheet export, posted on Slack 16 Oct ~13:52) · **Period in workbook:** 2026-09-16 → 2026-10-15 (inclusive; verified = API window `startTime=2026-09-16T00:00:00Z`, `endTime=2026-10-16T00:00:00Z` exclusive, Etc/UTC) · **Pull timestamp:** 2026-10-16 ~15:00 EEST

## Sources used (all read-only GET + read-style report POSTs)
1. `POST /reporting/v1beta/organizations/{orgId}/clusters:runValueRealizationReport` — per-cluster `cost{actualCost, projectedCost, autoscalerSavings, workloadAutoscalerSavings, totalSavings, hibernationSavings}`, `cpu.provisionedCores`, `baselineType`, adoption flags. All 57 Siemens child orgs, window above, `managedOnly=false` (default variant also pulled — **identical results**, so `managedOnly` filtering is a non-factor here).
2. `GET /v1/billing/platform-usage-detail?period.from&period.to&feature=phase2|woop` — billing usage with `entities[]` per-cluster breakdown (`entityId`, `usage`). 19 fee-carrying orgs × {Sep 1–30, Sep 16–Oct 15}.
3. `GET /v1/cost-reports/clusters/{id}/cost` (stepSeconds=86400) — billing-grade `summary.avgCpuCount` spot-verified on 41 clusters.

Workbook structure: 7 sheets, 267 unique clusters across 57 orgs (206+9+8+13+9+14+20 rows, 12 fully-empty phantom rows at the bottom of sheet 1 — harmless).

---

## 1. Verdict on Aleksy's Slack summary — **consistent with the workbook ✓**

Recomputed from the cells: gross **$66,519.22** (claimed $66.5K ✓), fee **$38,525.05** ($38.5K ✓), net **$27,994.16** ($28.0K ✓), 267 unique clusters ✓, 37 negative-net rows ✓. Every category figure matches (20/$24,228/$19,102; 14/$32,576/$11,301; 8/$7,993/−$127; 8/$836/−$33; 9/$885/−$1,381; 13/−$450; 195/−$418). Internal arithmetic clean on all 267 rows: `fee = 4.0 × billable_vcpu` (0 violations), `netto = savings − fee` (category-consistent; WOOP columns handled correctly — never double-added). The takeaway bullets (Node-AS categories = $30.4K net; 2 of 20 Node+WOOP negative) also recompute correctly.

## 2. Everything that re-derives **exactly** from the live API

| Workbook column | API source | Result |
|---|---|---|
| `workload_autoscaler_savings` | VR report `cost.workloadAutoscalerSavings` | **Exact to the cent on every one of the 70 WOOP rows** (Σ $16,946 of WOOP savings, zero drift) |
| `billable_vcpu` (majority of charged rows) | `GET /v1/billing/platform-usage-detail` → per-cluster `entities[].usage` | **Exact to 3 decimals on 38 of 59 charged rows** — e.g. helios 1662.079, integ 1152.308, sim 344.123, sim2 78.895, baseline-clo 103.081, kronos 70.131, dema 458.039, Botanica pair 55.123/21.658. **This proves the workbook's fee basis is the live billing usage figure** |
| KENT + No-Cast + most small rows | same billing endpoint | matches via either phase2 or woop feature column (see §4 issue 3 for the exceptions) |

## 3. Where the workbook is **stale** vs today's API (VR is recomputed on read)

`totalSavings` / `autoscalerSavings` per cluster differ from Aleksy's pull. Screened across the 76 baseline-carrying clusters:

| Cluster (org) | WB totalSavings | API now | Δ | Why |
|---|---|---|---|---|
| dema-platform-services (CPS) | $0 (classified WOOP-only) | **$13,530** (baseline now PEER_CLUSTERS, autoscalerAdopted=true) | +$13.5K | post-pull baseline/(re)creation |
| alliander-demo-eks (SI GSW CLO) | $0 (classified read-only-no-Cast) | **$8,771** (PEER_CLUSTERS) | +$8.8K | same |
| pioneer-tcx (IT IPS) | $835 | **$4,484** | +$3.6K | **hibernationSavings $3,569 now lands inside `totalSavings`** (342 hibernated hours) |
| aks-dios-weu-prod/test (IT IPS) | $0 | $2,985 / $1,508 | +$4.5K | PEER_CLUSTERS baseline |
| eagle-kafka01 (IT IPS) | $0 | $1,562 | +$1.6K | PEER_CLUSTERS |
| console-eks-integ (Pillar#1) | $8.5 | $1,355 | +$1.3K | CLUSTER_HISTORY recalc |
| fgeks-blue-eks-cluster (SI B SW) | $0.5 | $414 | +$0.4K | |
| k8s-andreas (SMO Railigent X) | $0 | $450 | +$0.5K | **post-CSU-6233-fix recalculation is live** (cluster now CLUSTER_HISTORY, sane factors) — expected consequence of the merged fix |
| Posit (DI SW PRS AMER SLC) | −$16 | −$590 | −$574 | INDUSTRY_AVERAGE recalc, honestly negative now |
| ngm-sim2 / helios / integ | 2,652 / 5,455 / 10,404 | 2,570 / 5,543 / 10,348 | ±1.6–3.1% | normal recomputation drift |

Aggregate effect on Aleksy's category table if rebuilt from today's API (same classification):
- Node+WOOP: gross $24.2K → **$30.0K** (+$5.8K)
- Node-only: gross $32.6K → **$32.0K** (−$0.6K drift)
- All WOOP categories' gross: unchanged (exact, see §2)
- `managedOnly` param: **zero effect** — not the cause of any diff.

## 4. Issues found (by severity)

**4.1 · KENT fee basis is likely understated ~$3.0K (needs decision before sending).**
For 3 KENT clusters the workbook used the **phase2** billing column instead of **woop**: k8s `d0c7a7a5` WB 456.331 vs woop-usage 868.647; k8s `cf62a8e1` WB 343.577 vs 660.181; k8s `7eb37770` WB 26.253 vs 52.030. The woop-basis billing ≈ full provisioned CPU (validates against `avgCpuCount`); the phase2-basis is ~half. Aleksy's own message says WOOP-only clusters are billed on **full provisioned CPU** — if that's correct, KENT fee = **$11,139** not $8,120, and KENT net flips **−$127 → −$3,146**. Echoes open item: "WOOP-vs-phase2 metering double-attribution" (CPS dema shows the *same* ~474 CPU under **both** features in September — that question is now unavoidable).

**4.2 · The $4/vCPU rate is unverified against contracts.** Mechanically the fee column is 100% consistent (4 × usage). But documented rates in our records: SI GSW **€5/vCPU** (invoice-verified 2 Oct), CPS **5% of positive gross**, UC21 sheet used **$5.7**. A single blanket $4 across 57 child orgs needs per-contract confirmation — this is Aleksy's open question to billing and the workbook does **not** resolve it.

**4.3 · Guy's $26,408 (September) does NOT reconcile with usage × $4.** Reconstructing September with the same per-cluster classification: **~$40.2K at $4** (vs workbook's period-fee $38.5K). $26,408 ⇒ effective blended rate ≈ **$2.6/vCPU**. So either (a) rate per contract isn't $4, (b) invoiced figures include free-of-charge windows/credits not visible in `platform-usage-detail` (all rows show `isFreeOfCharge=false`, `creditsApplied=0`), or (c) the $26,408 is a subset (e.g. GSW + a few orgs, or excl. WOOP double-head). Get Billing's actual September line items before quoting either number to Siemens.

**4.4 · Minor feature-selections:** siemenstest-siemenstest-1 took phase2 (3.013) while woop basis is 7.798 (+$19); CDM-EKS-Cluster took phase2 (3.930) while woop basis is 0.061 (−$15.6); iemc-cluster-dev 0.008 vs 0.074 (+$0.26). SI B SW org wasn't in the 19-org billing sweep (8 small `fgeks-blue` rows, ~$226 combined) — pull if needed.

**4.5 · Classification vs API reality drifted.** The sheet puts dema-platform-services in "WOOP only" (correct per its WOOP-savings column which is exactly right), but the VR model now also attributes $13.5K autoscaler savings to it (PEER_CLUSTERS baseline, post-WOOP-enablement window). Decide explicitly whether to show it — if yes, quote with pull timestamp; if no, be ready to answer why the console shows it.

## 5. What's safe to tell Aleksy now

1. Your workbook's arithmetic and Slack summary are internally correct, and the two most audit-sensitive columns (`workload_autoscaler_savings`, `billable_vcpu` for the majority) match the live APIs exactly.
2. Re-pull the VR columns the hour before sending — values recomputed on read and have moved (mostly *up*; Node+WOOP is now $30.0K gross, which actually strengthens the story).
3. Decide KENT fee basis (§4.1) before the customer sees a number that billing may charge differently.
4. The $26,408 September fee and the $4 rate both need the per-contract rate card; workbook ≠ invoice (§4.2–4.3).
5. Hibernation savings are now inside `totalSavings` (§3) — new field since your pull; don't be surprised by pioneer-tcx / rproxysbox.

## Artifacts
- `cluster-verification.csv` — all 267 clusters × {workbook values, billing period/Sept usage (both features), current VR values, baselineType, status}
- `billing_entities.json`, `billing_usage.json` — raw billing pulls (19 orgs × 2 features × 2 periods)
- `vr-pull-sep16-oct15/` — raw VR JSON per org (57 files, both `managedOnly` variants)
