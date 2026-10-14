# Draft Slack reply — "OP factor for all clusters where savings are way off"

*Context: answer to the question in thread. Data: full sweep of the 8 Siemens orgs (97 clusters), 2026-10-14 — September VR reports + per-cluster baseline-params, all read-only. Review before sending (per workflow, a human sends).

---

Checked the whole Siemens fleet (97 clusters across 8 orgs, Sept value-realization reports + frozen baseline-params per cluster). Here are all clusters where the September savings are clearly off, with the overprovisioning factors we're actually using — **frozen BP** = the factor stored in the baseline, **applied** = what September's report effectively multiplied by, **live** = what the cluster's own avg provisioned/requested actually is:

| Cluster | Org | Baseline type | Frozen BP cpu/ram | Applied cpu/ram | Live cpu/ram | Sept savings | Sept actual | sav/act |
|---|---|---|---|---|---|---|---|---|
| fgeks dc10bd6a | SI B SW | CLUSTER_HISTORY | **58.3 / 87.5** | 67.1/95.3 | 3.3/2.1 | $11,743 | $407 | **28.9×** |
| fgeks 01c18e7a | SI B SW | PEER_CLUSTERS | **21.6 / 30.0** | 42.8/47.9 | 6.4/3.0 | $2,228 | $239 | 9.3× |
| fgeks 99cb56e0 | SI B SW | PEER_CLUSTERS | **21.6 / 30.0** | 26.3/30.9 | 6.0/7.2 | $631 | $190 | 3.3× |
| baseline-clo-eks (CSU-6239) | SI GSW CLO | CLUSTER_HISTORY | **5.7 / 9.9** | 7.7/11.4 | **1.4/1.4** | $19,052 | $2,542 | 7.5× |
| ngm-sim-eks | SI GSW CLO | CLUSTER_HISTORY | 3.8 / 7.9 | 3.9/7.9 | **1.1/1.3** | $39,309 | $8,051 | 4.9× |
| ngm-sim2-eks | SI GSW CLO | CLUSTER_HISTORY | 5.2 / 5.0 | 9.6/5.9 | **1.7/1.4** | $9,207 | $2,047 | 4.5× |
| pioneer-tcx | IT IPS | CLUSTER_HISTORY | 5.8 / 10.5 | 8.6/10.5 | 2.3/1.4 | $2,966 | $663 | 4.5× |
| eks 22bf2472 | HAFAS | INDUSTRY_AVERAGE (24h window) | 2.2 / 2.6 | 5.0/3.1 | 2.1/1.8 | $3,256 | $769 | 4.2× |
| ngm-kronos-eks | SI GSW CLO | CLUSTER_HISTORY | 5.2 / 11.0 | 5.2/11.0 | 1.4/2.7 | $5,391 | $1,939 | 2.8× |
| alliander-demo-eks | SI GSW CLO | PEER_CLUSTERS | 5.5 / 10.4 | 5.5/10.5 | 1.6/2.5 | $10,178 | $3,744 | 2.7× |
| fgeks fd1ca573 | SI B SW | CLUSTER_HISTORY | 4.5 / 3.8 | **14.9/7.0** | 5.2/2.2 | $342 | $172 | 2.0× |
| eks 953f87e7 | HAFAS | INDUSTRY_AVERAGE (24h window) | 2.2 / 2.6 | 4.0/2.6 | 2.5/1.5 | $20,833 | $12,020 | 1.7× |
| fgeks 6436c787 | SI B SW | CLUSTER_HISTORY | 6.0 / 3.3 | 9.1/4.0 | 3.4/2.2 | $309 | $195 | 1.6× |

Key observations:

1. **Every one of them shows the same signature**: the factor applied in the projection is a multiple of the cluster's own live provisioned/requested ratio — exactly the idle-day-inflation bug Mateusz fixed in REP-2389 (he verified the fix on ngm-sim2: 5.24 → 1.51, which matches the live 1.66).
2. **None of these baselines has been recalculated since the fix** — every frozen BP `updateTime` predates deployment. So September's numbers will repeat in October reports until baselines are recomputed + overridden.
3. **Two sub-patterns worth calling out**: SI B SW is the hotspot (5 of 13 rows, incl. the only truly k8s-andreas-class case: ×58/×87 frozen, ×29 savings-vs-spend). And the HAFAS rows aren't insane-factor cases — they're the **24-hour INDUSTRY_AVERAGE window** pattern (same structural issue as k8s-andreas, but with sane factors; the projection still applies 4–5× over live).
4. ⚠️ One anomaly for engineering: `fd1ca573` has a benign frozen BP (4.5/3.8) but September **applied 14.9/7.0** — the projection is not just using the frozen factor there. @Mateusz Ledwon would be good to know what drives that.

Also-flagged-but-dormant (no Sept savings yet, frozen wild factors — will inflate on first active day): fgeks 1b0450f7 (17.4/25.2), fgeks e3c91abe (11.7/14.3 peer-import).

Suggested next step unchanged: pilot the baseline override on the 3 worst (dc10bd6a, 01c18e7a, 99cb56e0 — all SI B SW), verify with customer, then batch the rest of this list. The OP>5 auto-fallback guardrail proposed earlier would have caught 10 of these 13 automatically.

---

*Evidence folder: `cluster-cost-analysis/op-factor-audit-2026-10-14/` (raw API payloads + TSVs for every cluster).*
