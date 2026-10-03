---
name: castai-realized-savings-calculator
description: >
  Calculate, validate, reproduce, or explain CAST AI Realized Savings / Savings Report
  results from cluster cost, request, baseline, and autoscaler data. Use when asked about
  realized savings, projected cost, actual cost, savings baseline, baseline spend,
  autoscaler savings, workload autoscaler savings, or why CAST AI Savings Report numbers
  differ from a manual calculation. Do not use this skill for Available Savings / future
  optimization potential unless the user explicitly wants to compare it with Realized Savings.
---

# CAST AI Realized Savings Calculator

Use this skill to reproduce CAST AI's **Realized Savings** methodology as faithfully as possible from supplied API, CSV, JSON, dashboard, or metric data.

## Authoritative references

- Realized Savings Report: https://docs.cast.ai/docs/savings-report
- Savings calculations / baseline methodology: https://docs.cast.ai/docs/savings-baseline
- Available Savings, only for distinguishing realized vs potential savings: https://docs.cast.ai/docs/available-savings

Treat CAST AI's current documentation and API fields as authoritative if they differ from examples in this skill.

## Core principles

1. **Realized savings are counterfactual savings**, not merely a comparison with an old bill.
2. Calculate at the smallest reliable time grain available, preferably **per cluster per day**, then aggregate.
3. Calculate CPU and RAM separately, then add them.
4. For projected demand, use the **greater of original requested and current requested resource-hours**.
5. For projected unit price, use the **greater of current effective unit price and baseline unit price**.
6. Before the baseline period ends, projected cost equals actual cost, so realized savings are zero for that day.
7. Do **not** add Workload Autoscaler savings on top of Realized Savings when node autoscaling is enabled. Its effect is already reflected in Realized Savings.
8. Never invent a baseline, overprovisioning factor, unit price, adoption rate, or missing request data.
9. Do not silently clamp negative values unless CAST AI's source/API explicitly does so. Flag anomalies instead.
10. Distinguish **calculation eligibility** from **UI visibility/adoption thresholds**.

## Terminology

- **Provisioned**: CPU or RAM allocated on nodes; this is capacity being paid for.
- **Current requested**: resource requests after CAST AI Workload Autoscaler rightsizing.
- **Original requested**: resource requests before rightsizing.
- **Baseline**: fixed reference model representing pre-optimization cluster behavior.
- **Realized savings**: projected no-CAST-AI cost minus actual cost.
- **Workload Autoscaler savings**: modeled savings from reducing workload requests.
- **Node autoscaler adoption**: percentage of nodes managed by CAST AI.
- **Workload Autoscaler adoption**: percentage of workloads managed in VPA mode.

## Minimum input model

Prefer one record per cluster per day.

```yaml
cluster:
  id: string
  name: string
  date: YYYY-MM-DD

baseline:
  exists: true|false
  source: cluster_history|peer_clusters|industry_average|overridden|unknown
  period_end: YYYY-MM-DD
  cpu_overprovisioning_factor: number
  ram_overprovisioning_factor: number
  cpu_unit_cost_per_core_hour: number
  ram_unit_cost_per_gib_hour: number

demand:
  original_requested_core_hours: number
  current_requested_core_hours: number
  original_requested_gib_hours: number
  current_requested_gib_hours: number

actual:
  cpu_cost: number
  ram_cost: number
  current_cpu_unit_cost_per_core_hour: number
  current_ram_unit_cost_per_gib_hour: number

autoscaling:
  node_autoscaler_adoption_pct: number|null
  workload_autoscaler_adoption_pct: number|null
  vpa_active: true|false

pricing:
  mode: discounted|listing
```

If current effective unit cost is not supplied, derive it only when the source provides compatible actual resource cost and provisioned resource-hours:

```text
current CPU unit cost = actual CPU cost / provisioned CPU core-hours
current RAM unit cost = actual RAM cost / provisioned RAM GiB-hours
```

Mark any derived unit cost explicitly. Do not derive it when the denominator is zero, missing, or measured over a different interval.

## Baseline validation

CAST AI's baseline model contains:

- CPU overprovisioning factor
- RAM overprovisioning factor
- CPU unit cost
- RAM unit cost
- baseline time window

Automatic baseline priority is:

1. Cluster history
2. Peer clusters
3. Industry average

A cluster-history baseline requires at least **7 days of pre-optimization history** before CAST AI takes over active node management. Active node management is associated with more than **20% of nodes becoming CAST AI-managed**.

A cluster generally needs to be at least **14 days old** and actively managed before an automatic baseline is computed.

If no baseline exists, report:

```yaml
calculation_status: no_baseline
realized_savings: null
reason: Cluster is not reportable in Realized Savings yet.
```

Do not present a missing-baseline cluster as a normal `$0 savings` row, because CAST AI's report semantics can omit it entirely.

## Exact calculation workflow

For every cluster/day:

### 1. Actual cost

```text
actual cost = actual CPU cost + actual RAM cost
```

### 2. Decide whether the day can accrue realized savings

If the day is **before** the baseline period end:

```text
projected CPU cost = actual CPU cost
projected RAM cost = actual RAM cost
realized savings = 0
```

If the day is **on or after** the baseline period end, continue with the projected-cost formulas below.

### 3. Select projected demand

CPU:

```text
projected CPU demand =
  max(original requested core-hours, current requested core-hours)
```

RAM:

```text
projected RAM demand =
  max(original requested GiB-hours, current requested GiB-hours)
```

Do not use the smaller current request after rightsizing to reconstruct the no-CAST-AI counterfactual.

### 4. Select projected unit price

CPU:

```text
projected CPU unit price =
  max(current effective $/core-hour, baseline $/core-hour)
```

RAM:

```text
projected RAM unit price =
  max(current effective $/GiB-hour, baseline $/GiB-hour)
```

This prevents the counterfactual from being priced below either the current effective rate or the historical baseline rate.

### 5. Calculate projected CPU cost

```text
projected CPU cost =
  max(original requested core-hours, current requested core-hours)
  × CPU overprovisioning factor
  × max(current effective $/core-hour, baseline $/core-hour)
```

### 6. Calculate projected RAM cost

```text
projected RAM cost =
  max(original requested GiB-hours, current requested GiB-hours)
  × RAM overprovisioning factor
  × max(current effective $/GiB-hour, baseline $/GiB-hour)
```

### 7. Calculate total projected cost

```text
projected cost = projected CPU cost + projected RAM cost
```

### 8. Calculate realized savings

```text
realized savings = projected cost - actual cost
```

Also expose the resource components:

```text
CPU realized savings = projected CPU cost - actual CPU cost
RAM realized savings = projected RAM cost - actual RAM cost
```

If a component is negative, preserve it and flag it for review unless the authoritative API/report applies a documented normalization.

### 9. Calculate Workload Autoscaler savings when requested

Only count a day when VPA / Workload Autoscaler was active.

CPU:

```text
WA CPU savings =
  (original requested core-hours - current requested core-hours)
  × max(current effective $/core-hour, baseline $/core-hour)
```

RAM:

```text
WA RAM savings =
  (original requested GiB-hours - current requested GiB-hours)
  × max(current effective $/GiB-hour, baseline $/GiB-hour)
```

Total:

```text
workload autoscaler savings = WA CPU savings + WA RAM savings
```

If VPA was not active that day:

```text
workload autoscaler savings = 0
```

Workload Autoscaler savings can be calculated for dates inside the baseline window when VPA was active.

### 10. Never double-count

When node autoscaling is enabled, Workload Autoscaler impact is already reflected in the realized-savings counterfactual through original-vs-current requested demand.

Therefore:

```text
CAST AI total savings = realized savings
```

Do **not** calculate:

```text
realized savings + workload autoscaler savings
```

unless the user explicitly asks for a non-CAST analytical view, in which case label it clearly as a custom metric and warn that it double-counts overlapping savings.

## Aggregation

For a selected period:

```text
period actual cost = sum(daily actual cost)
period projected cost = sum(daily projected cost)
period realized savings = sum(daily realized savings)
period WA savings = sum(daily WA savings)
```

For organization-level reporting, sum eligible cluster/day values.

Do not average daily savings dollars. Sum them.

When comparing clusters, preserve:

- cluster name / ID
- baseline source
- baseline window
- actual cost
- projected cost
- realized savings
- Workload Autoscaler savings
- node autoscaler adoption
- Workload Autoscaler adoption
- pricing mode
- data-quality warnings

## Adoption thresholds and report visibility

Treat thresholds as visibility/reporting conditions, not as replacements for the cost formulas.

- Realized Savings card/section: node autoscaler manages at least **20% of nodes**.
- Workload Autoscaler savings card/section: Workload Autoscaler manages at least **20% of workloads in VPA mode**.
- Organization view can show the corresponding card when at least one cluster meets the relevant threshold.

If adoption is below the threshold, return the computed data if the user explicitly requested a raw calculation, but label it:

```yaml
report_visibility: below_cast_ai_display_threshold
```

Do not imply that CAST AI's UI should display the card.

## Pricing-mode rules

Default to **discounted/effective pricing** when reproducing actual customer spend.

If the user selects listing prices:

- Actual/current costs can use listing prices.
- Baseline unit cost remains based on discounted historical pricing.
- The projected-price rule still uses `max(current price, baseline price)`.
- Listing-price data is unavailable before **2025-08-06**; a range beginning before that date falls back to discounted pricing.

Always state which pricing mode was used.

## Historical data-quality safeguards

When validating older periods, be aware that CAST AI documents safeguards around original request history:

- Some older workload data could contain zero original-request values; current requests can be substituted by CAST AI for those historical points.
- Implausibly large request values can be replaced with a sane fallback.
- For ranges beginning before October 2025, CAST AI can use the earliest reliable original-request snapshot rather than assuming zero.

If the provided raw data appears affected, flag it. Do not fabricate CAST AI's internal fallback value.

## Required output format

Unless the user requests another format, return:

### Summary

```text
Cluster: <name>
Period: <start> → <end>
Baseline source: <source>
Pricing mode: <discounted|listing>

Actual cost: $X
Projected no-CAST-AI cost: $Y
Realized savings: $Z
Derived realized savings rate: Z / Y × 100 = P%

Workload Autoscaler savings: $W
Note: WA savings are not added to Realized Savings when node autoscaling is enabled.
```

### Calculation breakdown

| Metric | CPU | RAM | Total |
|---|---:|---:|---:|
| Original requested resource-hours | ... | ... | — |
| Current requested resource-hours | ... | ... | — |
| Baseline overprovisioning factor | ... | ... | — |
| Baseline unit cost | ... | ... | — |
| Current effective unit cost | ... | ... | — |
| Projected unit cost used | ... | ... | — |
| Projected cost | ... | ... | ... |
| Actual cost | ... | ... | ... |
| Realized savings | ... | ... | ... |
| Workload Autoscaler savings | ... | ... | ... |

### Validation notes

List any of:

- no baseline
- date is inside baseline period
- node autoscaler adoption below 20%
- Workload Autoscaler adoption below 20%
- VPA inactive
- missing original requests
- missing current unit cost
- mixed time grains
- incompatible units
- listing-price fallback
- historical data-quality concern
- negative savings component
- user-supplied value does not match CAST AI report/API

## Sanity checks

Before finalizing:

1. All resource quantities are resource-hours, not instantaneous cores/GiB.
2. CPU and RAM intervals are aligned.
3. Currency and pricing mode are consistent.
4. Baseline and current unit costs use the same resource units.
5. Projected demand used `max(original, current)`.
6. Projected price used `max(current, baseline)`.
7. Baseline-window days produce zero realized savings.
8. VPA savings are counted only when VPA was active.
9. WA savings were not added on top of realized savings.
10. Period totals are sums of daily/interval values.
11. Missing baseline is reported as not reportable, not silently treated as an ordinary zero.
12. Any manual or derived values are clearly labeled.

## Worked example

Input:

```yaml
baseline:
  exists: true
  period_end: 2026-07-01
  cpu_overprovisioning_factor: 1.50
  ram_overprovisioning_factor: 1.20
  cpu_unit_cost_per_core_hour: 0.030
  ram_unit_cost_per_gib_hour: 0.0035

demand:
  original_requested_core_hours: 1000
  current_requested_core_hours: 800
  original_requested_gib_hours: 4000
  current_requested_gib_hours: 3500

actual:
  cpu_cost: 28.00
  ram_cost: 14.50
  current_cpu_unit_cost_per_core_hour: 0.025
  current_ram_unit_cost_per_gib_hour: 0.0040

autoscaling:
  node_autoscaler_adoption_pct: 80
  workload_autoscaler_adoption_pct: 75
  vpa_active: true
```

Calculation:

```text
Projected CPU cost
= max(1000, 800) × 1.50 × max(0.025, 0.030)
= 1000 × 1.50 × 0.030
= $45.00

Projected RAM cost
= max(4000, 3500) × 1.20 × max(0.0040, 0.0035)
= 4000 × 1.20 × 0.0040
= $19.20

Projected total = $64.20
Actual total = $28.00 + $14.50 = $42.50
Realized savings = $64.20 - $42.50 = $21.70

WA CPU savings
= (1000 - 800) × 0.030
= $6.00

WA RAM savings
= (4000 - 3500) × 0.0040
= $2.00

WA savings = $8.00
CAST AI total savings = $21.70, NOT $29.70
```

## Example prompts that should trigger this skill

- "Calculate CAST AI realized savings for this cluster."
- "Why does CAST show $18k realized savings while my calculation shows $24k?"
- "Reproduce the CAST AI Savings Report from this JSON."
- "Calculate projected cost from the CAST baseline."
- "Calculate realized savings for Helios for August."
- "Compare actual vs projected cost for these CAST AI clusters."
- "Validate our realized savings formula."
- "How much of these savings came from Workload Autoscaler?"
- "Check whether we're double-counting VPA savings."

## Requests that should not use this skill by default

- "How much could this read-only cluster save?"
- "Calculate Available Savings from optimization recommendations."
- "Estimate potential savings from Spot/ARM before enabling CAST AI."

Those are **Available Savings / potential-savings** tasks and should use a separate skill.

## If data is incomplete

Do not guess. Return a compact missing-input checklist.

For Realized Savings after the baseline period, the critical fields are:

1. Baseline period end
2. CPU overprovisioning factor
3. RAM overprovisioning factor
4. Baseline CPU unit cost
5. Baseline RAM unit cost
6. Original and current CPU request-hours
7. Original and current RAM request-hours
8. Actual CPU and RAM cost
9. Current effective CPU and RAM unit price

For Workload Autoscaler savings, also require whether VPA was active for each interval.

If the user provides CAST AI API output, map existing API fields to these concepts first, show the mapping, and then calculate.
