# SI GSW Savings Analysis

Case memory for the Cast.ai Exchange / SI GSW net-cost-benefit question
(meetings 30 Sep + 9 Oct 2026; analysis pulled live 2026-10-02).

## Case context

- Siemens (Gerolf Reinwardt, SI GSW R&D DC IQS) challenges whether CAST AI saves
  money on dynamic R&D clusters once their **actual discounted cloud bill**
  (Cloudability/SAP adjusted-amortized) + **€5/provisioned-vCPU fee** are counted.
  Management wants a yes/no.
- Workload autoscaling is **out of scope for R&D** (on-prem, no-internet driver);
  teams right-size their own charts, CAST stays recommendation-only there.
- Agreed next step: Siemens exports Cloudability views; we answer "are savings
  real now" first, recommendations second.

## Identifiers (verified live)

| What | Value |
|---|---|
| Org SI GSW CLO | `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` (of 130 orgs on enterprise key) |
| ngm-helios-eks | `419c39e4-66bf-4d61-b833-4562968a61c7`, region eu-central-1, onboarded 2025-09-30 |
| ngm-integ-eks | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f`, onboarded 2025-09-30 |
| ngm-kronos-eks | `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0`, optimizing since 2025-11-06 |
| Keys | Root `.env` key = MCP default-org (0 clusters). Fleet work needs `projects/castai-billing-export/.env` enterprise key + `X-CastAI-Organization-Id` header |

## Key findings (all API-verified, see report for tables)

1. Downscaling savings are real every month: helios $19–24k/mo, integ $17–26k/mo
   (list prices) vs CAST's static baseline.
2. Net at customer rates: `net = savings × d − fee`, d = their rate vs list
   (0.48–0.58 inferred). Helios ≈ break-even to +5%; integ +23–32%; kronos
   small-positive. `d` gets fixed by the Cloudability export — that's the one
   missing input, don't guess it in front of the customer.
3. June→July helios increase = workload growth (vCPU 1531→1787, weekday peaks
   ~2000→~2650), NOT fee mechanics. Meanwhile integ HALVED overnight Jun 30→Jul 1
   (3728→1266 vCPU) — workload removal.
4. Restart/"saved vCPU accrual" concern: savings are per-interval vs static
   baseline and cannot re-accrue. BUT deploy waves raise the fee basis
   (€5 × avg provisioned vCPU; helios swings 600→2654 vCPU daily). Real node-hours.
5. Rebalancer eviction: plans generate **hourly**; each job executes or is
   "skipped" by threshold; full runs ~03:00/~21:00 UTC but `started` events occur
   off-window by design (`feature: scheduledRebalancing`, per-plan IDs). Exact
   incident trigger needs the pod timestamp; audit v2 retention 90 days.

## API gotchas learned (cost/savings/audit/billing)

- `/v1/cost-reports/clusters/{id}/cost|savings`: **max 93 days** per call at
  `stepSeconds=86400` — chunk longer windows (e.g., Apr→Jul + Jul→Oct).
- Item numeric fields are **strings** — always `tonumber` in jq before add/div.
- Monthly list cost formula: `(ΣcostOnDemand + ΣcostSpot + ΣcostSpotFallback +
  ΣstorageCost) × 24` (all item fields are hourly averages; calibrated against
  org-report totalCost to <0.1%).
- `avgCpuCount` in summary = avg provisioned vCPU = Gerolf's "billable CPUs"
  (1806/876 confirmed exactly) = the €5 fee basis.
- `/v2/audit/events`: response is `.events[]` (not .items); **no `occurredAt`
  sort field** (400); `filter.clusters` + `filter.domains=autoscaler` + fromDate/
  toDate work; 90-day retention.
- `/v1/billing/platform-usage-detail` requires a `feature` param whose valid enum
  is NOT in the OpenAPI spec (AUTOSCALER etc. all rejected). Fee basis from
  avg-provisioned-vCPU reproduces the invoice math, so not blocking.
- Enterprise key + child org: `X-CastAI-Organization-Id` header; `GET
  /v1/organizations` lists 130 orgs (Siemens tree).
- OpenAPI spec: `https://api.eu.cast.ai/v1/spec/openapi.json` (2.2 MB, works on EU).

## Files

- Report (meeting deliverable): `labs/si-gsw-sep30-meeting/savings-analysis-helios-integ-kronos.md`
- Earlier August numbers: `labs/si-gsw-sep30-meeting/august-api-numbers.md`
- Efficiency analysis / workload waste list: `labs/si-gsw-sep30-meeting/helios-efficiency-analysis.md`
- Raw API data (14 files, 2026-10-02): `labs/si-gsw-sep30-meeting/data/2026-10-02/`
  (cost/savings daily chunks per cluster, audit events, org list)

## Open items

- [ ] Cloudability export from Siemens → fix `d`, final net table.
- [ ] Eviction incident timestamp → exact audit trace.
- [ ] Spot trial scope on ngm-sim2 (prod-like) for measured before/after.
- [ ] Billing `feature` enum value (nice-to-have; fee math already reproduced).
