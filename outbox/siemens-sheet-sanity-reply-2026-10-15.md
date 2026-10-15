# DRAFT — Slack reply to Aleksy (Siemens savings sheet sanity check) — 2026-10-15
# Status: DRAFT ONLY — human review & send required. Basis: live api.eu.cast.ai pulls this hour,
# see scratch/siemens-review/EVIDENCE-PACK.md + sept2026-verified-per-cluster.tsv

@Aleksy Zaleński ran the sanity check against the live API (full fleet, Sept 1 – Oct 1 UTC window). TL;DR: sheet is directionally solid and the totals are conservative — a few things to flag before it goes out:

✅ Verified:
• Census 267 is exact. (A 268th cluster appeared today at 10:38 UTC, after your pull — no Sept data on it.)
• Connected split 19/8/12/17 matches inventory exactly (56 connected clusters in CAST AI).
• KENT with WOOP $8,477 and Read-only WOOP $888 reproduce from the API to the dollar.
• $66,425 vs $26,408 Sept fee ≈ 2.5× gross ROI — "~2×" is safe, even conservative.

⚠️ Flag/fix before sharing:
1. Sept savings were restated by the platform 5× this week (fleet total moved $320K → $86K between Oct-12 and today; last correction landed **today 09:26 UTC**). Anyone working from an earlier pull has stale numbers. Recommend a fresh re-pull the morning you send.
2. "Read-only, no Cast AI: $0" → better as "N/A (monitoring only — no optimization possible)". No savings data exists for those clusters; also 3 connected clusters (incl. dev-sec) have no Sept reporting — "no data" ≠ "$0".
3. The −$152 (Connected, WOOP only) is real: WOOP upsized some workloads (dema −$81, aks-dios-weu-test −$91, etc.). Add a one-line note or Siemens will ask why a savings line is negative.
4. Please confirm which savings basis the Node Autoscaler tabs use. Sept classic (realized) = $59,991 fleet; value-realization model = $77K connected / $88K fleet. Your $57,212 sits just under classic — conservative, good — but let's state the basis in the sheet, because per cluster the two diverge a lot (helios: $6.7K model vs $18.9K realized; sim: $11.5K model vs $0.4K realized).
5. Fee: $26,408 is an estimate (committed + avg overages ÷3 across the quarterly bucket); Sept billable usage also just recomputed to 8,275.94 vCPU (was 8,632 last week). Label it "estimated pending quarterly true-up".

I have all 68 savings-carrying clusters verified side-by-side (model vs realized) — happy to share the per-cluster table or walk through any row.
