# Number-by-Number API Verification — Siemens CAST AI Savings Report (041026-084335)

Verification date: 2026-10-04 ~08:55 UTC. All calls GET-only against https://api.eu.cast.ai,
SI GSW CLO org (07aa3c29-…), report window Sep 2 – Oct 2, 2026 UTC.

Legend: ✅ verified live API · ✓ internal arithmetic · ⚠️ stale/current-snapshot differs · ❓ not verifiable via this API key

## 1. Core financials (window Sep 2 – Oct 2, 2026)

| # | Report figure | Live API value | Δ | Status |
|---|---|---:|---:|---|
| 1 | Helios actual compute cost $44,587.18 | $44,588.13 (cost summary, CPU+RAM, storage excluded, 100% on-demand) | −0.95 | ✅ |
| 2 | Integ actual compute cost $22,387.68 | $22,388.83 | −1.15 | ✅ |
| 3 | Kronos actual compute cost $1,929.80 | $1,929.83 | −0.03 | ✅ |
| 4 | Helios realized savings $18,804.12 | $18,803.17 (savings API, Σ 30 daily items) | +0.95 | ✅ |
| 5 | Integ realized savings $18,416.84 | $18,415.69 | +1.15 | ✅ |
| 6 | Kronos realized savings $3,474.88 | $3,474.85 | +0.03 | ✅ |
| 7 | Spot savings $0.00 (all clusters) | $0.00 × 3 | 0 | ✅ |
| 8 | Combined actual $68,904.66 | Σ rows 1–3 | 0 | ✓ |
| 9 | Combined realized $40,695.84 | Σ rows 4–6 | 0 | ✓ |

Δ ≤ $1.15 = report generated at a slightly shifted window boundary (midnight UTC); ratios affected < 0.006%. Materially identical.

## 2. Derived financials

| # | Report figure | Check | Status |
|---|---|---|---|
| 10 | Helios realized rate 29.66% | 18,804.12 / (44,587.18+18,804.12) = 29.664% | ✅ |
| 11 | Integ projected $40,804.52 / rate 45.13% | 22,387.68+18,416.84 = 40,804.52; rate 45.134% | ✓/✅ |
| 12 | Kronos projected $5,404.68 / rate 64.3% | 1,929.80+3,474.88 = 5,404.68; rate 64.294% | ✓/✅ |
| 13 | Combined remaining opportunity $22,919.25/mo | 17,387.42+2,590.01+2,941.82 = 22,919.25 | ✓ |
| 14 | Node adoption 288/295 = 97.63% | arithmetic exact | ✓ |
| 15 | Node adoption 68/75 = 90.67% | arithmetic exact | ✓ |
| 16 | Node adoption 9/10 = 90.0% | arithmetic exact | ✓ |
| 17 | Workload-autoscaler savings $0.00, WOOP-optimized 0 workloads | live workloads-summary: optimizedCount = 0 on all 3 clusters | ✅ |
| 18 | Integ "258.5 → 106.8 cores, −58.7%" | (258.5−106.8)/258.5 = 58.68% | ✓ |

## 3. Fee / billing basis (already verified 2026-10-04 earlier, re-confirmed)

| # | Report figure | Live value | Status |
|---|---|---:|---|
| 19 | Billable vCPUs Helios 1,786.38 / Integ 1,005.88 / Kronos 86.59 / Sum 2,878.85 | billing API phase2 Sep-2026: 1,786.383 / 1,005.878 / 86.591 / 2,878.852 | ✅ exact |
| 20 | Fees €8,931.92 / €5,029.39 / €432.95 / €14,394.26 @ €5 | recomputed | ✓ exact |
| 21 | USD conversions $9,818.85 / $5,528.81 / $475.95 / $15,823.61 @ 1.0993 | recomputed | ✓ exact |
| 22 | Net savings $8,985.27 / $12,888.03 / $2,998.93 / $24,872.23 | recomputed | ✓ exact |
| 23 | €5.70 alternative €16,409.45 → net $22,656.93 | recomputed ($22,656.93; note summary line said $22,657) | ✓ |
| 24 | Addendum: org billable 3,400.82 vCPUs incl. baseline-clo-eks 109.91, sim 347.67, sim2 64.38 → €17,004.09 @€5; €19,384.66 @€5.70 | billing API: 109.907 + 347.673 + 64.383 + 2,878.852 = 3,400.815 | ✅ exact |

## 4. Items that are NOT window-verifiable today (fleet changed after Oct 2)

⚠️ **Important finding for the send:** the clusters' CURRENT state (snapshot 2026-10-04 08:52 UTC) differs sharply from the report's September window data:

| Cluster | Report (Sept window) | Live now | Note |
|---|---|---|---|
| Helios nodes | 295 (288 managed) | **27 nodes, 296 provisioned vCPUs** | matches the report's own rightsizing model target (295→24 nodes) — the rightsizing appears to have already been applied or the deployment wave ended |
| Integ nodes | 75 | **12 nodes, 142 vCPUs** | |
| Kronos nodes | 10 | **3 nodes, 14 vCPUs** | |
| Workloads | 3,591 / 1,128 / 264 | 3,592 / **342** / 264 | Integ workload count changed materially |
| Modeled monthly remaining opportunity | $22,919.25 | **≈ $2,502.57/mo** (helios 1,330.68 + integ 858.60 + kronos 313.29, estimated-savings API, Layman scenario, updated 2026-10-04) | ⚠️ ~89% of the modeled remaining opportunity is no longer visible in the current snapshot |

- Rows: available-savings scenario table (Helios $17,387.42/25.67% … SpotOnly $49,466.62/73.04%; Integ $2,590.01…$9,401.83/64.81%; Kronos $2,941.82…$3,062.02/96.41%) — internally consistent (implied scenario bases $67.7k / $14.51k / $3.18k), but **not re-verifiable** from the live API because it now models the post-change fleet: ❓ for re-issue freshness, ⚠️ if the reader interprets them as current.
- "Actual usage ~236 vCPUs across trio" — current usage is only 12.57 vCPUs total (9.93 + 2.26 + 0.38), utilization 2.6–4.4% CPU. September's 236 is not verifiable from any endpoint this key can reach: ❓ (qualitatively consistent: usage << requests/provisioned).
- Historical rightsizing $5,719.25 / 12.83% and Kronos 21.65%: ❓ no endpoint reachable.
- Kronos "requests 7.6, uses 0.75": current 6.06 / 0.38 — same order, point-in-time drift: ⚠️ minor.

## 5. Bottom line

- Every September-window monetary figure in the report **checks out against the live API to within $1.15** (window-boundary rounding).
- The fee/billing section is exact (2,878.85 billable vCPUs; €14,394.26; net +$24,872.23).
- **Caution before sending:** the "remaining rightsizing opportunity $22,919.25/month" and node counts describe Sep 2–Oct 2. The live cluster state as of 2026-10-04 shows the fleets already scaled down dramatically (helios 295→27 nodes) with only ~$2.5k/month of modeled remaining opportunity. If this scale-down is the executed rightsizing pilot (P1 recommendation), the report should say so; otherwise Fabian/Finance may ask why current CAST AI shows a much smaller fleet than the report.
