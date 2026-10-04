# Merged costed impact — NGM 3 clusters (helios / integ / kronos)

**Built:** 2026-10-04, from three independent per-cluster models (`ngm-*-costed-impact.md`, this folder) computed off the live 30d window Sep-5→Oct-4 (denominators: **helios $51,650.08 · integ $23,770.39 · kronos $2,177.32 → fleet $77,597.79**).

**Methodology rules enforced in all three models:**
- **Frozen vs bill basis never blended.** Frozen baseline prices ($0.9823 / $1.0427 / $1.2030 per vCPU·day) are ≈2–2.4× the live discounted rate (~$0.50/vCPU·day); every frozen row carries a bill-equivalent. Estimated-savings ceilings (Layman/SpotInstances/SpotOnly) are **listing-basis** and used as ordering checks only.
- Rows are per-lever and can overlap; **totals are sequential/overlap-adjusted**, naive sums are flagged non-additive.
- Storage price derived from the clusters' own bills: **$0.0939/GiB·mo** (helios $8,746÷93,146 GiB; integ $1,856÷19,768; kronos cross-check agrees).

## Per-change table — conservative → realistic, $/mo (% of that cluster's bill)

| Change | helios | integ | kronos | Effort (d) | Risk |
|---|---|---|---|---|---|
| maxPods 55 → ENI formula (P0 bug fix) | $0 (correctness) | $0 | $0 | 0.1 | Low |
| Root disks 100→50 + diskCpuRatio 1 | **$1,474–1,514 (2.9%)** | $293–486 (1.2–2.0%) | $126** (5.8% @50% rotation) | 0.2 | Low |
| maxCpu 16→24/32 + minCpu 4 (packing) | $1,460–2,919 bill-eq (2.8–5.7%)* | $323–821 (1.4–3.5%) | ≈$0 (small fleet) | 0.5 | Low-Med |
| Exclude c5a/c5ad + newest-gen | **+$0–42 cost — NOT a saving** (c5a→c6a is +$0.0015/hr; value = price/perf + pool depth) | n/a mix | ≈$0 | 0.3 | Low |
| +eu-central-1c subnets | $0 (fixes live InsufficientCapacity; adds pod IP space) | $0 (same; shared /17s with kronos) | $0 | 1–2 (VPC) | Low |
| Evictor → CAST-managed + sized (10m/5 big clusters; keep 1m/20 kronos) | $0 enabling — gates WOOP/spot | $0 (converged OD curve proven by `achievedSavingsBelowThreshold` failures) | $0 | 0.5 + PDB audit 1–2 | Med |
| Rebalancing (helios graceful; integ/kronos floor 5→2%) | $0 | $0 (micro-wins only) | $0 | 0.1 | Low |
| **WOOP / rightsizing** (40%→60% capture) | **$6,911–10,366 bill-eq (13.4–20.1%)** [frozen $13.7k–20.5k] | **$5,797–8,696 (24.4–36.6%)** — named: reindexation-crons 55.7 cores + reset-offset 34.3 cores @ ~0 use | $804–1,206 (36.9–55.4%) — NOT tiny; idle-standby requests drive the 50–100-node weekday fleet | 3–10 (incl. tenant-namespace acceptance) | Med |
| **Spot** | Phase-3 pilot: **$5,389–8,083 (10.4–15.6%)** [ceiling SpotOnly −$48.4k listing] | **NEW spot-batch: $3,662–7,646 (15.4–32.2%)** (−62.8% observed; EDP-basis caveat: $2.2k/$4.6k if discount excludes spot) | Phase-2 flip: **$814–1,046 current-basis (37.4–48.1%)** [frozen-ceiling $1,294–1,664] | 2–5 | Med-High (gated) |
| **Hibernation** | never (prod) | **keep OFF — validated: bursts run AT NIGHT** (715-node weekday-midnight avg; hibernate = cancelling tests) | **weekend pilot: $341 (15.7%) cons / $282 over 3-node floor** + ~$50 root-EBS side-effect | 1–2 (prereqs) | Med |
| Golden AMI name-pattern + AL2023 | $0 direct; enables kubeReserved reality + CLM | $0 direct | already AL2023 ✓ | 5–10 | Med |
| IMDSv2 / drain / prediction-type / clusterLimits | $0 rows (IMDSv2 already compliant) | $0 rows | $0 rows (limits 1500 caps ceiling at $54k/mo) | 0.1–0.2 | Low |

## Totals (sequential, overlap-adjusted, bill-basis)

| Cluster | Conservative $/mo (%) | Realistic $/mo (%) | Dominant levers |
|---|---|---|---|
| helios | **≈ $13.8k (26.8%)** | **≈ $19.4k (37.6%)** | WOOP → packing → spot pilot → disks |
| integ | **≈ $9.1k (38.3%)** | **≈ $14.6k (61.5%)** | spot-batch + WOOP crons (overlap-adj. −$1.0k/−$3.0k) |
| kronos | **≈ $1.2–1.6k (55–75%)** — defensible first-90d claim | — | hibernation + spot + WOOP-stack (heavy overlap → use the stack, don't sum rows) |
| **Fleet** | **≈ $24.5k/mo (31.6% of $77.6k)** | **≈ $36.1k/mo (46.5%)** | — |

## What the deep pass corrected vs the first rough table

1. **c5a exclusion is not a saving** — it's a +$0–42/mo cost on price alone; justify via price/perf + capacity-pool depth, or drop it.
2. **Frozen-basis rows overstate bill impact ~2×** ($0.9823 vs live ~$0.4973/vCPU·day; ≈40% EDP + credits) — WOOP helios is $6.9–10.4k/mo on the bill, not $13.7–20.5k.
3. **Weekend-snapshot trap**: Oct-4 estimated-savings ran on a 27-node Sunday fleet — spot ceilings quoted earlier (−64/−58/−84%) were from that snapshot; use the Oct-2 weekday pulls (−$48.4k helios SpotOnly) as ceilings.
4. **Integ bursts run at night** → hibernation there was correctly rejected; this also invalidated "snapshot×price" disk models (naive calc exceeded the entire storage bill — rejected).
5. **Kronos WOOP is not tiny** (idle standby drives its weekday 50–100-node fleet) but kronos's frozen baseline has n=37 low-confidence; spot+WOOP rows overlap heavily — claim the stack ($1.2–1.6k), never the row sum.

## Open verification items (before quoting to customer)

- EDP/Siemens discount scope on **spot** pricing (needs CUR/FinOps) — moves integ spot between $2.2k and $7.6k/mo.
- WOOP acceptance needs tenant-namespace sign-off in 4× `it-287129-*` + argo namespaces (political, not technical).
- Spot pilot on helios remains gated on: evictor managed, PDB audit, evictGracefully verified.
- Kronos frozen baseline n=37 days — treat kronos % as directional.

*Per-cluster derivations, formulas and node-level inputs: `ngm-helios-eks-costed-impact.md`, `ngm-integ-eks-costed-impact.md`, `ngm-kronos-eks-costed-impact.md`.*
