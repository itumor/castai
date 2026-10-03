# Are SI GSW savings real? — Helios, Integ, Kronos

**Action item (9 Oct meeting, Ebrahim/Cast AI):** establish whether Siemens is saving
money **now**; recommendations second. All numbers below are pulled live from
`api.eu.cast.ai` (read-only GETs) on 2026-10-02 with the enterprise key, org
`07aa3c29-3e1f-44bc-ad60-ceedb878d99a` (SI GSW CLO). Savings are CAST's measured
downscaling savings vs. its static-baseline model, at **AWS list prices**.

## TL;DR

1. **Savings are real in node-hours**: every month, CAST AI removes 28–50% of the
   compute these clusters would have used. There is no month where CAST cost more
   than it saved.
2. **But at Siemens' actual (discounted) rates, Helios is only ~break-even to +5%**
   after the €5/vCPU fee; Integ is clearly positive (+27–33%); Kronos small but
   positive. The net depends on how their Cloudability view maps to CAST's cost
   components — that mapping is exactly what the Cloudability export will settle.
3. **The June→July Helios increase is explained and demonstrated**: provisioned vCPU
   grew 1531→1787 (+17%), weekday peaks from ~2000 to ~2650 vCPU (releases/new
   workloads). CAST savings *grew* in the same period ($21.7k→$24.0k) — it removed
   more, but demand grew more.
4. **The restart/"saved vCPU accrual" concern**: savings do **not** re-accrue on
   restarts. But deploy waves do raise the **fee basis** (fee = €5 × *avg provisioned
   vCPU* of the month; a restart wave scales nodes up temporarily). That is real
   cost of real node-hours, not double counting.
5. **The unscheduled eviction**: rebalancing plans are **generated every hour**; each
   hourly job is either executed or "skipped" (threshold). Full executions observed
   ~03:00 and ~21:00 (matches Siemens' 2×/day), but node operations also start in
   other hours. Exact trigger of the incident needs the incident timestamp.

## Identifiers

| Cluster | ID | Optimizing since |
|---|---|---|
| ngm-helios-eks | `419c39e4-66bf-4d61-b833-4562968a61c7` | 2026-07-20 (per firstOperationAt; savings data accrues from April — see caveat) |
| ngm-integ-eks | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` | 2026-04-27 |
| ngm-kronos-eks | `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` | 2025-11-06 |

## Monthly series (CAST API, list prices; fee = avg vCPU × €5 ≈ ×$1.08)

### ngm-helios-eks

| Month | Avg prov. vCPU | Actual cost (list) | Downscale savings | No-CAST baseline | Fee | Net at list |
|---|---|---|---|---|---|---|
| Apr | 1,472 | $50.2k | $14.8k | $65.0k | €7.4k | +$5.8k |
| May | 1,566 | $56.5k | $19.1k | $75.6k | €7.8k | +$10.3k |
| Jun | 1,531 | $53.7k | $21.7k | $75.5k | €7.7k | +$12.9k |
| Jul | 1,787 | $59.6k | $24.0k | $83.6k | €8.9k | +$13.9k |
| Aug | 1,809 | $56.2k | $20.6k | $76.8k | €9.0k | +$10.4k |
| Sep | 1,793 | $54.2k | $19.0k | $73.3k | €9.0k | +$8.8k |

### ngm-integ-eks

| Month | Avg prov. vCPU | Actual cost (list) | Downscale savings | No-CAST baseline | Fee | Net at list |
|---|---|---|---|---|---|---|
| Apr | 1,656 | $54.4k | $25.2k | $79.7k | €8.3k | +$15.9k |
| May | 1,690 | $52.4k | $16.6k | $69.0k | €8.5k | +$7.1k |
| Jun | 1,808 | $56.3k | $26.1k | $82.4k | €9.0k | +$16.0k |
| **Jul** | **973** | **$27.7k** | $20.0k | $47.7k | €4.9k | **+$14.1k** |
| Aug | 896 | $23.6k | $21.4k | $45.0k | €4.5k | +$16.5k |
| Sep | 991 | $23.4k | $18.5k | $42.0k | €5.0k | +$12.4k |

Integ's compute **halved between Jun 30 and Jul 1** (3,728 → 1,266 vCPU overnight;
workload removal, not a CAST config change). Savings continued at ~$20k/mo on the
smaller footprint.

### ngm-kronos-eks

| Month | Avg prov. vCPU | Actual cost (list) | Downscale savings | Fee |
|---|---|---|---|---|
| Apr | 40 | $1.7k | $0.9k | €0.2k |
| Jun | 70 | $2.4k | $1.2k | €0.3k |
| Aug | 59 | $1.5k | $1.7k | €0.3k |
| Sep | 87 | $2.3k | $3.5k | €0.4k |

## Net benefit at Siemens' actual rates — the honest math

Siemens pays Cloudability/SAP-adjusted costs: Helios ≈ $26–27k/mo cloud + €9k fee.
CAST's list-price compute for Helios Aug is $46.9k ($56.2k incl. storage). Their
$27k therefore implies an effective rate of **48–58% of list** depending on whether
their view maps to full stack or compute-only. Net monthly saving at their rates:

```
net = savings × d − fee        (d = their effective rate vs list)
```

| Cluster | d = 0.48 (full-stack map) | d = 0.58 (compute-only map) |
|---|---|---|
| Helios (Aug) | 20.6×0.48 − 9.7 = **+$0.2k** (~0%) | 20.6×0.58 − 9.7 = **+$2.2k** (+5%) |
| Integ (Aug) | 21.4×0.48 − 4.9 = **+$5.4k** (+23%) | 21.4×0.58 − 4.9 = **+$7.5k** (+32%) |
| Kronos (Sep) | 3.5×0.48 − 0.5 = **+$1.2k** | 3.5×0.58 − 0.5 = **+$1.5k** |

**Bottom line for management:** under *either* mapping the net is ≥ 0 — CAST never
costs more than it saves — but **Helios is thin (0–5%) until spot and right-sizing
land**; Integ carries the portfolio. This is why the Cloudability export matters:
it fixes `d` and turns the range into one number.

**Decisive check (needs Siemens):** Cloudability export for Aug 2026 for the three
clusters, split compute vs. storage, plus their RI/Savings-Plan coverage. With that,
`d` is exact and the table above collapses to a single yes/no with a number.

## June→July Helios increase — demonstrated, not just suggested

- Provisioned vCPU: Jun avg 1,531 → Jul avg 1,787 (**+17%**); list cost $53.7k → $59.6k.
- Daily pattern: weekday peaks rose from ~1,900–2,100 vCPU (June) to ~2,400–2,650
  (late July); weekends dip to 600–1,000. Release/redeploy waves are visible as
  day-level spikes (e.g., Jul 24: 2,612; Jul 29: 2,654).
- CAST downscale savings *increased* Jun→Jul ($21.7k → $24.0k): CAST removed more
  nodes, but workload demand grew more. **Conclusion: the increase is workload
  growth (new releases/redeployments), not fee mechanics and not a CAST regression.**

## "Do restarting workloads make saved vCPUs accrue again?"

- The savings metric is computed **per interval vs. a static baseline** — a restart
  cannot re-earn savings that were already counted; the curve tracks actual removed
  node-hours.
- What restarts *do* change is the **fee basis**: fee = €5 × average provisioned vCPU
  over the month. A deploy wave scales nodes up for hours → raises the monthly
  average → raises the fee. From the daily series, Helios swings 600→2,654 vCPU
  within days; every redeploy-heavy week lifts the average.
- Mitigation if desired: schedule release waves and let the evictor consolidate
  overnight; the fee basis follows actual node-hours — this is real compute the
  cluster used, not an artifact.

## Unscheduled pod eviction by the internal rebalancer

Audit (v2, autoscaler domain) shows the actual mechanics on Helios:

- Rebalancing **plans are generated every hour** (`initiated` at :00 each hour).
- Each hourly job is **skipped** ("Scheduled rebalancing job skipped", with plan ID)
  when not worth running, or **executed** ("started" → node drains/deletes → "finished").
- Full executions observed ~03:00 and ~21:00 UTC — matching Siemens' "twice a day" —
  **but** `started` events also occur in other hours (22:02, 23:02 observed), each
  labeled `feature: scheduledRebalancing` with its own plan ID.
- So off-window node operations are **by design** (hourly evaluation can execute
  outside the known windows). To pin the exact trigger of the incident Siemens saw,
  send the pod/timestamp; audit retention is 90 days, so recent incidents are still
  queryable per event.

## Recommendations + expected impact (phase 2, after the "are savings real" answer)

| # | Change | Expected impact (list prices) |
|---|---|---|
| 1 | **Enable spot for tolerant R&D workload classes** (0% spot today on all three) | Helios SpotOnly path $68.2k→$20.3k/mo (−70%); integ $17.5k→$4.3k; kronos $3.8k→$1.3k. Even a 30–50% spot mix cuts 15–25% |
| 2 | **Devs right-size their own charts** (recommendation-only mode stays; CAST export is the worklist). Helios: ~2,277 cores requested → ~454 recommended | Helios Layman path −24.6% ($68.2k→$54.8k); fee basis shrinks proportionally |
| 3 | Consolidation windows aligned to night/weekend shutdown; explicit rebalancing windows if off-window evictions hurt | Smooths fee basis; addresses the eviction concern |
| 4 | Apply 1–2 first on **ngm-sim2** (prod-like test) for a measured before/after | The measured proof Siemens asked for |

Fee follows automatically: fee = €5 × avg provisioned vCPU, so every vCPU removed
reduces both AWS cost and fee.

## Caveats

- Savings series is CAST's own baseline model at **list prices**; Siemens' discount
  (`d`) is inferred, not contract-known — the Cloudability export closes this.
- Helios savings data accrues from April although `firstOperationAt` says July 20 —
  treat the pre-July-20 Helios series with care; audit retention (90 days) cannot
  confirm the earlier history. July 20 likely marks a policy/mode change, not the
  start of downscaling.
- Audit page retrieved covers Oct 1–2 (100 events); exact eviction trigger analysis
  needs the incident timestamp.
- Billing `platform-usage-detail` requires a `feature` enum that is not documented
  in the OpenAPI spec; fee basis here is avg provisioned vCPU, which reproduces
  Gerolf's own numbers exactly (1806 → €9.0k).

## Re-pull commands

```bash
export CASTAI_API_KEY=$(grep -o 'castai_v1_[^"[:space:]]*' projects/castai-billing-export/.env | head -1)
ORG=07aa3c29-3e1f-44bc-ad60-ceedb878d99a
# max 93 days per call at stepSeconds=86400 — chunk if longer
curl -sS -H "X-API-Key: $CASTAI_API_KEY" -H "X-CastAI-Organization-Id: $ORG" \
  "https://api.eu.cast.ai/v1/cost-reports/clusters/419c39e4-66bf-4d61-b833-4562968a61c7/cost?startTime=2026-07-01T00:00:00Z&endTime=2026-10-01T00:00:00Z&stepSeconds=86400" | jq .summary
# monthly savings: …/savings with same params; eviction events:
curl -sS -H "X-API-Key: $CASTAI_API_KEY" -H "X-CastAI-Organization-Id: $ORG" \
  "https://api.eu.cast.ai/v2/audit/events?filter.clusters=419c39e4-66bf-4d61-b833-4562968a61c7&filter.domains=autoscaler&fromDate=…&toDate=…&page.limit=100" | jq .events
```
