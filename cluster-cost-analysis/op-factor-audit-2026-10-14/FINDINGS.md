# Fleet-wide over-provisioning-factor & savings-anomaly audit — 2026-10-14

*Trigger: Slack thread — k8s-andreas $5.5k/day savings on ~$55/day spend (CSU-6233, CSU-6239, REP-2389).
Question: "are there more cases like this?" Answer: **yes — systemic. 22 of 33 savings-active clusters are flagged; one full org (SI B SW) is the hotspot.***

All calls read-only GET/POST-report against `https://api.eu.cast.ai` (key: read-only scopes). Method per AGENTS.md §2: 97 clusters → 97 single-GET subagents in 12 waves; raw payloads in `raw/`, machine tables in `bp-results.tsv` / `vr-flags.tsv` / `anomalies.tsv`.

## Scope

- 8 Siemens-family orgs visible to this key: **SI GSW CLO** (22 clusters), **SI B SW** (10), **Siemens Dev** (8), **DI IT DEX CLD** (1), **IT IPS** (25), **HAFAS H&O** (13), **SFS IT CDO** (16), **CPS** (2) = **97 clusters**.
- `Siemens-test` org returns **403** with this key — not covered. `k8s-andreas` (the original case) lives outside the visible orgs; could not be re-checked directly.
- Data: Sept-2026 value-realization report per org (33 clusters with savings activity) + per-cluster `baseline-params` (37 with baselines, 60 without/404).

## Detection flags

| Flag | Threshold (from thread) |
|---|---|
| `OP>5` | cpu or ram over-provisioning factor > 5 (Aleksy's proposed auto-fallback line) |
| `applied≥2×live` | factor applied in savings projection vs actual avg provisioned/requested in same window (the REP-2389 idle-day-inflation signature) |
| `savings>actual` | totalSavings > actualCost in Sept (k8s-andreas was 68×) |
| `PEER_CLUSTERS` / `INDUSTRY_AVERAGE` | non-own-history baseline types |
| `window<?d` | baseline window shorter than a week (k8s-andreas was 24 h) |

## Tier 1 — Critical: savings mathematically impossible / factor insane

| Org | Cluster (id) | BP type | BP cpu/ram | Sept applied cpu/ram | Sept live cpu/ram | Sept actual $ | Sept savings $ | sav/act | Note |
|---|---|---|---|---|---|---|---|---|---|
| SI_B_SW | fgeks dc10bd6a | CLUSTER_HISTORY | **58.3 / 87.5** | 67.1 / 95.3 | 3.3 / 2.1 | 407 | **11,743** | **28.9×** | the thread's "×58" case — still unfixed in Sept report; BP frozen 2026-03-31 |
| SI_B_SW | fgeks 01c18e7a | PEER_CLUSTERS | **21.6 / 30.0** | 42.8 / 47.9 | 6.4 / 3.0 | 239 | 2,228 | 9.3× | imports the 21.6× peer profile |
| SI_B_SW | fgeks 99cb56e0 | PEER_CLUSTERS | **21.6 / 30.0** | 26.3 / 31.0 | 6.0 / 7.3 | 190 | 631 | 3.3× | same imported peer profile |

## Tier 2 — Inflated factor (same REP-2389 signature: applied ≫ live), savings materially overstated

| Org | Cluster | BP type | BP cpu/ram | Applied cpu/ram | Live cpu/ram | sav/act | Note |
|---|---|---|---|---|---|---|---|
| SI_GSW_CLO | baseline-clo-eks 02810f4b | CLUSTER_HISTORY | 5.66 / 9.88 | 7.7 / 11.5 | **1.4 / 1.4** | 7.5× | = thread CSU-6239 (hibernation); BP frozen 2025-12-03 |
| SI_B_SW | fgeks fd1ca573 | CLUSTER_HISTORY | 4.5 / 3.8 | 14.9 / 7.0 | 5.2 / 2.2 | 2.0× | BP 4.5 benign but Sept **applied** 14.9 — applied≠BP, worth a question to engineering |
| SI_GSW_CLO | ngm-kronos-eks | CLUSTER_HISTORY | 5.25 / 11.00 | 5.3 / 11.0 | 1.5 / 2.7 | 2.8× | stale baseline, never refreshed since 2025-12-03 (known from earlier recon) |
| IT_IPS | pioneer-tcx | CLUSTER_HISTORY | 5.83 / 10.45 | 8.6 / 10.5 | 2.3 / 1.4 | 4.5× | BP frozen 2026-05-13 |
| SI_GSW_CLO | alliander-demo-eks | PEER_CLUSTERS | 5.45 / 10.44 | 5.5 / 10.5 | 1.6 / 2.5 | 2.7× | peer profile far above own live 1.6/2.5 |
| SI_GSW_CLO | ngm-sim2-eks 8bd361b0 | CLUSTER_HISTORY | 5.24 / 5.02 | 9.6 / 5.9 | **1.7 / 1.4** | 4.5× | = thread case Mateusz verified: fix yields 1.51/2.15 |
| SI_GSW_CLO | ngm-sim-eks | CLUSTER_HISTORY | 3.84 / 7.88 | 3.9 / 7.9 | **1.1 / 1.3** | 4.9× | RAM factor ~6× live; $39.3k Sept savings vs live-OP basis would be a fraction of that |
| SI_B_SW | fgeks 6436c787 | CLUSTER_HISTORY | 6.02 / 3.34 | 9.1 / 4.0 | 3.4 / 2.2 | 1.6× | |

## Tier 3 — Structural, not (yet) catastrophic

- **24 h INDUSTRY_AVERAGE windows** — same shape as k8s-andreas Bug #1, but sane factors: HAFAS `eks` ×3 clusters (2026-08-14→15 cpu 2.20, 2026-08-24→25 cpu 2.18, 2026-09-14→15 cpu 2.20; live ≈ 2.1–3.6) and DI_IT_DEX_CLD `gspkafka-k8s-dev` (2025-09-16→17). Pattern to fix, no dollar damage today.
- **PEER_CLUSTERS import 2.43/4.64** on 4 IT_IPS AKS clusters (dios prod/test, eagle-kafka01, kafka-test) — modestly above live (1.2–1.5), one (kafka-test) actually shows *negative* savings because live (6.3/7.2) exceeds the peer import.
- **Reverse cases (savings under-reported):** `ngm-data-eks` (BP 7.95/16.57 ‹ live 11.5/23.0 → −$327), `iec-tcx-flat`, `kafka-test`. Same idle-day math in the other direction.
- **Sleeping time bombs** (frozen wild baseline, no Sept VR activity — SIP B SW blue-green clones currently `failed`): fgeks **1b0450f7** CLUSTER_HISTORY **17.4 / 25.2**, fgeks **e3c91abe** PEER **11.7 / 14.3**. If these clusters return, savings reports inflate on day one.

## Healthy reference points

SI GSW CLO's two flagship NGM clusters are clean: `ngm-helios-eks` 1.60/2.17 and `ngm-integ-eks` 2.20/3.47 (both CLUSTER_HISTORY, matching manual calcs in earlier recons). `Siemens_Dev` fleet clean (max 2.81). SFS_IT_CDO (16 AKS clusters) has **zero baselines** — no VR-style savings can be reported at all.

## Cross-check vs the REP-2389 fix

- `ngm-sim2-eks` BP cpu 5.24 → Mateusz's fixed formula yields 1.51 ≈ live 1.66 ✓ (fix math validated against live data).
- **But** every Tier-1/2 BP `updateTime` predates the fix deployment (latest relevant recalc: fgeks 6c94cd80 today 2026-10-14 — healthy 4.32/3.61). dc10bd6a's ×58/×87 baseline was frozen 2026-03-31 and **has not been recomputed since the fix**. Until baselines are recalculated, Sept-style inflated savings persist in current reports.

## Recommendations (maps to the thread's action plan)

1. **Pilot override on the 3 worst:** dc10bd6a (58/87), 01c18e7a + 99cb56e0 (peer-imported 21.6/30.0) — all in SI B SW. Recalculate with the fixed formula, verify with customer, then batch the Tier-2 list.
2. **Auto-guardrail (Aleksy's proposal) works:** an `OP>5 → fallback` rule alone catches 10 of the 12 worst rows; adding `applied ≥ 2× live` catches the rest (incl. pioneer-tcx, ngm-sim-eks).
3. **Ask engineering why applied ≠ BP on fgeks fd1ca573** (BP 4.53 but Sept applied 14.94) — suggests the projection also uses intra-window dynamics, not just the frozen factor.
4. **Fix the 24 h-window pattern** (HAFAS ×3, gspkafka) — same code path as k8s-andreas Bug #1; minimum observation period before INDUSTRY_AVERAGE is trusted.
5. **SFS_IT_CDO has no baselines** — if Siemens wants VR savings there, none exist to compute; that is a gap, not an error.

## Raw artifacts

`raw/` (97 baseline-params + 8 VR + 8 inventories), `bp-results.tsv` (97 rows), `vr-flags.tsv` (33 rows), `anomalies.tsv` (22 flagged rows, ranked), `fleet.tsv`, `merge.py`.
Note: 404 on baseline-params = cluster has no baseline record (verified prior recon; not an endpoint error).
