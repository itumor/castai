# Cost Atlas — CAST AI optimization, counted every way

Fleet-wide React dashboard over the CAST AI EU Analytics API: 129 organizations, 239 clusters,
12 months of telemetry, and **six ways to compute "savings"** — shown side by side, never blended,
all auditable in-app and in the export.

```bash
npm run dev      # http://localhost:5180 (vite dev)
npm run build    # production bundle (dist/)
npm run data     # rebuild dataset from data/raw snapshots
```

## The method ladder (every method, every month, all exports)

**Default: TR (frozen CPU+RAM prices)** — operational standard for routine FinOps & reporting:
dual-resource sensitivity (no RAM:CPU distortion), robust & deterministic (no regression, no gates),
defensible & auditable (vendor-independent, dispute-free counterfactual).

| id | tier | name | one-line formula |
|----|------|------|------------------|
| M0 | 1 | naive flat-demand | gross = first-full-month daily-avg × days − actual |
| TR30D | 3 | rolling 30-day baseline | baseline(m) = 30 × trailing ≤30-telemetried-day avg; gross = baseline − actual — short-horizon pulse, self-absorbing (steady state ≈ 0), fleet-wide (cost feed only) |
| WMAX | 5 | WA-aware counterfactual | C_base(T) = Σ_t Δt[max(R_orig,R_cur)·O·max(p_base,p_cur)] CPU+RAM — per WOOP hour (~60d window); WA-reduced workloads keep original demand, growing workloads keep current (CAST AI's documented higher-of approach) |
| REQ | 5 | **Siemens C/D demand-unit** (docs 05/06) | u_cpu = Σ baseline cpuCost ÷ Σ baseline req-core·day (O absorbed); adjREQ = u_cpu×max(R_orig,R_cur) + u_mem×max(R_mem_orig,R_mem_cur); gross vs actual **compute** only — provisioner-agnostic, post-switch days |
| TRW | 5 | **best of TR ✚ WMAX** | V_ref = max(V, O_cpu×max(R_orig,R_cur)), M_ref = max(RAM, O_mem×max(mem_orig,mem_cur)) → TR prices on floored quantities — anti-self-absorption ✚ frozen prices ✚ fleet-wide TR-degradation |
| M1 | 2 | frozen vCPU price | p = ΣC/ΣV (pre-switch, frozen) · gross = p×V(t) − actual |
| TR | 3 | frozen CPU+RAM prices | gross = p_cpu×V + p_mem×RAM + c_other − actual |
| M2 | 4 | two-factor OLS | fit C = a·V + b·RAM + c pre-switch (gated: corr<0.9, R²≥0.7, CI≤25%, bounds) |
| M4 | 5 | three-layer WOOP attribution | G = L_W (demand) + L_N (packing) + L_P (price/family), telescopes exactly |
| CAST | ref | CAST AI realized | projected − actual, counterfactual at current prices — reference only |

Fleet status (2026-09-26 snapshot): M1/TR on 214 clusters · M4 on 22 · CAST reference on 50 ·
M2 unidentified fleet-wide; last-30-day WMAX/REQ pulses exported per cluster (sheet `last30-wmax-req`)

## Baseline coverage ladder (doc-01 hierarchy, implemented 1:1)
Every one of the **239 clusters** carries a baseline — the CAST AI document hierarchy applied transparently:

| rung | pedigree | how |
|---|---|---|
| 1 | own cluster history | frozen from pre-switch era (38 confident; 21 SHORT<21d flagged; ≥7-day minimum per CAST's own observation rule) |
| 1r | read-only whole-history | 176 non-switched clusters: own whole-history prices (identity-style reference) |
| 2 | `PEER_FROZEN(n=…;same-org pooled prices)` | 17 clusters (e.g. onboarded-after-switch aks-dios) — pooled ratio-of-sums prices from same-org donors |
| 3 | `FLEET_PRICEBOOK_POOL` | 8 zero-history/zero-spend clusters — fleet-wide pooled pricebook |
 (RAM/CPU ratios are near-constant — collinearity gate honestly rejects it;
shown as "gates failed", not hidden).

## Architecture

```
data/raw/                         read-only API snapshots (124 MB)
  inventory/                      129 orgs + 239 clusters + parentage (discover_fleet.py)
  orgs/<orgId>/                   org daily-cost series (authoritative, gapless),
                                  monthly clusters/report, org value-realization
  clusters/<clusterId>/           deep tier: cost + resource-usage + value-realization daily,
                                  WOOP component/summary/metrics, policies, rebalancing
                                  plans, filtered audit sweeps (85d retention limit)
scripts/
  discover_fleet.py               org+cluster enumeration (per-org X-CastAI-Organization-Id)
  collect_tierA.py --slice k n    fleet-wide light collection (4 slices, ~700 calls)
  collect_tierB.py --clusters ids deep per-cluster collection (~80 calls/cluster)
  build_dataset_v2.py             methodology engine → dataset2.json + per-cluster ts/*.json
src/                              v2 React app (filters → charts → ledger → events → method docs)
docs/DATA_DICTIONARY.md           field-by-field provenance and quirks
```

Telemetry tiers (decided by what the API actually exposes per cluster):

- **Deep tier (46):** daily cost + vCPU/RAM + requests/usage (pre-WOOP era included), WOOP original
  requests, audit events, rebalances, policies → all methods M0–M4 + events.
- **Fleet tier (193):** org daily-cost (authoritative, continuous — no 60-day hole) + per-cluster
  monthly report (avg vCPU/RAM, cost splits) + per-cluster monthly value-realization → M0/M1/TR
  monthly + CAST reference.

## Hard rules (enforced in the pipeline, explained in the app)

1. **Never blend** our methods with CAST AI's realized series. Side by side only;
   ±30% reconciliation band flagged per month (CROSSCHECK_OUT_OF_BAND). Fleet-wide, the two
   measures currently disagree almost everywhere — that disagreement *is the finding*.
2. **No silent interpolation.** Months without telemetry are excluded from savings math
   (ESTIMATED_NO_DATA). A silent day inside the org daily-cost coverage window is an IDLE $0 day,
   and is labeled as such, not filled.
3. **Price vintage frozen**: p comes only from *pre-switch* telemetry (switch from baseline-params,
   value-realization first-savings month, or firstOperationAt). Future months compare against the
   frozen price — workload growth increases the baseline, it does not dilute it.
4. **Start/end-labeled buckets** corrected per endpoint; today's partial day dropped.
5. **Fee**: CAST AI subscription = **€5 per provisioned vCPU-month** (frozen FX 1€ = $1.10 ⇒ $5.50,
   prorated by telemetried days; `net = gross − fee`, fee applies even on negative-gross months).
   Reference fleet position under this model: fees $296k vs M1 gross $57.7k ⇒ **net −$231k M1 fleet-wide**.

## Collection posture

Read-only. GETs + report-generation POSTs (`:runValueRealizationTimelineReport`) only, against
`https://api.eu.cast.ai`, key from `.env` (enterprise read-only scope). Retry with backoff on 429/5xx;
Cloudflare requires a curl user-agent. See `AGENTS.md` §2.

## Reference numbers (validated anchors)

- CPS `dema-platform-services`: baseline 2025-10-21→11-23 (34d), p=$0.9929/vCPU·d, κ0 n/a (era-1
  used-series empty), o0=2.70, M4 telescoping ≤$0.009/day.
- CPS org spans four clusters (dema ×2 + cps-prod/test) — the monthly org report reveals the
  Dec-2025→Jul-2026 continuum lives under the cps-* names; per-cluster views keeps it honest.
- CAST AI realized (main): Jul $2,567 · Aug $9,950 · Sep $9,705 — displayed next to our
  M1 (Aug gross −$2,217 — price drift, spot off) and stays unblended by design.
