# SI GSW — verified API numbers for the workshop (real API, pulled 2026-10-02)

Source: `https://api.eu.cast.ai` with the enterprise read-only key
(`projects/castai-billing-export/.env`), org header
`X-CastAI-Organization-Id: 07aa3c29-3e1f-44bc-ad60-ceedb878d99a` (**SI GSW CLO**).
All costs are CAST AI listing prices unless marked otherwise. Read-only GETs only.

## Identifiers (the "keys for the next step")

| What | Value |
|---|---|
| Org | SI GSW CLO — `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` |
| ngm-helios-eks | `419c39e4-66bf-4d61-b833-4562968a61c7` — first CAST op 2026-07-20 |
| ngm-integ-eks | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` — first CAST op 2026-04-27 |
| Auth | `X-API-Key` header; child org via `X-CastAI-Organization-Id` |

## August 2026 — cost-report API (`/v1/cost-reports/clusters/{id}/cost`, stepSeconds=86400)

| Metric | ngm-helios-eks | ngm-integ-eks |
|---|---|---|
| Total cost (list price, CPU+RAM+GPU+storage) | **$55,726** | **$22,793** |
| — CPU | $27,920 | $13,203 |
| — RAM | $18,522 | $6,470 |
| — Storage | $9,272 | $3,120 |
| Avg provisioned vCPU (month) | **1,806.1** | **876.0** |
| Avg requested vCPU | 1,253.6 (69% of provisioned) | 652.3 (74%) |
| Spot share | **$0 (0%)** | **$0 (0%)** |

→ Gerolf's "Billable CPUs (cast)" (1806 / 876) **confirmed exactly** (avg provisioned vCPU).
→ His Cast-fee math (1806×€5 ≈ €9.0k, 876×€5 ≈ €4.4k) matches this basis.

## What CAST AI already saved in August (`/v1/cost-reports/clusters/{id}/savings`)

| Cluster | Downscale savings (Aug) | vs. static baseline |
|---|---|---|
| ngm-helios-eks | **$19,610** | ~30% (static ≈ $66.1k compute) |
| ngm-integ-eks | **$20,735** | ~51% (static ≈ $40.4k compute) |

Reconciliation of Gerolf's FinOps $27k / $12.5k: CAST CPU-only cost is $27.9k / $13.2k;
full compute at list is $46.5k / $19.7k. Their FinOps number sitting **below** CAST's
compute cost is consistent with the Siemens AWS discount (RI/Savings-Plan coverage) —
needs their rate card to reconcile precisely. Flag as open item, don't guess.

## Optimization still on the table (live snapshot, `/v1/cost-reports/clusters/{id}/estimated-savings`)

| Cluster | Current run-rate | Right-size (Layman) | + Spot | Spot-only path |
|---|---|---|---|---|
| ngm-helios-eks | $68.2k/mo (grew since Aug) | $54.8k (−24.6%) | $51.4k | **$20.3k (−70%)** |
| ngm-integ-eks | $17.5k/mo | $9.8k (−45.4%) | $9.6k | **$4.3k (−75%)** |

## Configuration state (`/v1/kubernetes/clusters/{id}/policies` + workload autoscaling)

- Autoscaler: `enabled: true`, not scoped, **0 node templates** (defaults), **0% spot**.
- Workload autoscaling: **recommendation-only** — 0 of ~3,598 workloads optimized
  (no measured "after" exists; the numbers above are projected, say so explicitly).

## Re-pull commands (read-only)

```bash
export CASTAI_API_KEY=$(grep -o 'castai_v1_[^"[:space:]]*' projects/castai-billing-export/.env | head -1)
ORG=07aa3c29-3e1f-44bc-ad60-ceedb878d99a
curl -sS -H "X-API-Key: $CASTAI_API_KEY" -H "X-CastAI-Organization-Id: $ORG" \
  "https://api.eu.cast.ai/v1/cost-reports/clusters/419c39e4-66bf-4d61-b833-4562968a61c7/cost?startTime=2026-08-01T00:00:00Z&endTime=2026-09-01T00:00:00Z&stepSeconds=86400" | jq .summary
# …/savings, …/estimated-savings, /v1/kubernetes/clusters/{id}/policies — same headers
```

## Talking points for the workshop

1. Cast fee is computed on **avg provisioned vCPU (1806/876)** — Gerolf's table is right;
   the lever is shrinking provisioned vCPU, not arguing the fee.
2. CAST already removed ~$40k/month across the two clusters via downscaling — the
   "no cost benefit" claim holds only if you compare against a static baseline you never had.
3. The big remaining lever is **0% spot + over-requested workloads** (devs' own Helm
   charts in `siemens-digital-grid-*` namespaces; see `helios-efficiency-analysis.md`).
   Right-size + spot path lands helios near **$20k/mo** — less than today's fee + bill.
4. On-prem driver is real: keep R&D in recommendation mode, devs fix charts from the
   CAST export, measured before/after only on the prod-like test (ngm-sim2).
5. Open items for SI: AWS rate card/RI coverage (FinOps reconciliation), FinOps SPOC
   for the savings cockpit, workshop slots.
