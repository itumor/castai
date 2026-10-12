# DRAFT — EMAIL (do not send before human review)
**To:** case-thread recipients / savings review group
**Subject:** September CAST AI savings — what's in the workbook, what's trusted, what we excluded

---

Hi all,

following up on today's savings review call — here is what's going on in the September workbook, and what the columns mean.

**What the workbook contains** ([sheet](https://docs.google.com/spreadsheets/d/1DBWHW0QmZCG1ZYr8P73ycQOAUd7n7uUVDGISiaCWIdo/edit?usp=sharing)):
- **Org roll-up** — savings/fees/nets per sub-organization (17 orgs with September economics, both fee rates $5.00 and $5.70 per provisioned vCPU).
- **All clusters** — 267 clusters across all sub-orgs with actual cost, projected cost, gross savings, billable vCPU, fees and net — exactly the rows you filtered to ~$300K / 34 positive clusters.
- **Baseline & onboarding** — the new evidence tab we agreed was missing: per cluster it shows **Baseline type, Baseline start date, Baseline end date, the CPU and RAM factors the baseline calculation uses, first CAST operation date, and first rebalance date** — all pulled from the CAST AI APIs, no manual assembly.
- **Notes & provenance** — which CAST AI APIs each number came from, date/time of every pull, and the definitions.

**The one concept that explains everything: the baseline type**
Every savings number says "what you would have paid without CAST AI vs what you pay now". How trustworthy that is depends on where the "before" comes from:
- **CLUSTER_HISTORY — this is the real one.** CAST AI measured *your own cluster's* behavior before it took over management. Trusted data — our reference tier. Use these rows.
- **PEER_CLUSTERS — borrowed from your organization.** No own history available, so CAST AI applied the measured behavior of *sibling clusters* in our account. Directionally right, cluster-specific confidence is limited — treat as estimate.
- **INDUSTRY_AVERAGE — outside our org.** CAST AI fleet-wide default. Lowest confidence, and it breaks on unusual clusters (we have one carrying a ×170 factor). Do not report those rows.

**What we did about the concerns from the call**
- **Karpenter / Enterprise Suite (the $158K cluster etc.)**: mechanically identifiable in the data (not standard node autoscaler, no baseline record, no first CAST operation). Removed from the report until CAST AI verifies the calculation — 6 clusters.
- **SIGSW sanity case (ngm-sim, $39K savings vs ~$8.8K spend)**: confirmed as apples-to-bananas — its baseline froze in June and the workload grew afterwards, so old overprovisioning factors get applied to new demand. Kept visible, flagged, not in the headline.
- **Disconnected clusters**: 2 rows, $0.07 of fee noise — excluded.

**Where that leaves the number** (September, net of CAST AI fee):
- All clusters as shipped in the workbook (positives filter): **~$300K**
- After removing Karpenter/Enterprise Suite: **~$131K**
- Recommended defensible headline (CLUSTER_HISTORY-class clusters only): **~$121K**
- Ultra-conservative floor (also minus ngm-sim pending CAST answer): **~$83K**
- For reference vs the previously expected $38K: that traces to the GSW portfolio alone without the flagged clusters (~$33.6K) — the enterprise view is bigger because it now covers all sub-orgs, not because numbers got inflated.

**Next steps**
- Cast AI engineers join a call tomorrow: Karpenter-VR legitimacy, stale-baseline behavior, and the fleet-wide answers so this doesn't need manual checking per cluster.
- Karpenter/Enterprise-Suite clusters stay excluded from the cockpit and reports until verified.
- Align with Bosko on the messaging to Mark: I'm proposing the **~$121K** headline with the baseline-type table as the one-slide explanation.

Happy to walk anyone through the sheet.
Ebrahim

---

*Basis: CAST AI Value-Realization report + baseline-params + billing APIs, all sub-orgs, September 2026 (Berlin window), pulls of 2026-10-12. Companion docs: BASELINE-TYPES.md, VERIFICATION-AND-SCENARIOS.md, APIS-USED.md in the same folder as this draft.*
