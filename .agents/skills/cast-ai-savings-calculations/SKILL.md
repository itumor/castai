---
name: cast-ai-savings-calculations
description: >
  Calculate, explain, validate, and troubleshoot CAST AI Savings Report numbers.
  Use when asked about CAST AI realized savings, actual cost, projected cost,
  baseline calculations, CPU/RAM overprovisioning factors, baseline unit costs,
  workload autoscaler savings, listing vs discounted pricing, savings validation,
  or why Savings Report values differ from manual calculations.
---

# CAST AI Savings Calculations

Use this skill as the authoritative workflow for calculating and validating CAST AI
Savings Report values from cluster metrics and baseline data.

## What this skill covers

Use this skill to:

- calculate actual cost;
- calculate projected cost without CAST AI;
- calculate realized savings;
- calculate workload autoscaler savings;
- explain how CAST AI baseline selection works;
- determine whether a cluster should have a baseline;
- validate daily or period-level Savings Report numbers;
- explain listing-price vs discounted-price behavior;
- investigate discrepancies between UI/API numbers and a manual calculation;
- prevent double-counting workload-autoscaler savings.

Do not invent missing baseline parameters, workload demand, prices, or costs.
If required inputs are missing, identify exactly which fields are needed.

---

# 1. Core terminology

## Provisioned

Provisioned resources are CPU or RAM allocated on cluster nodes.
This is capacity the customer pays for.

## Requested

Requested resources are workload CPU/RAM requests.

For savings projection, requested demand is measured in:

- CPU: core-hours
- RAM: GiB-hours

## Original requested demand

The workload request before workload rightsizing.

## Current requested demand

The workload request currently observed.

## Baseline

The baseline represents how the cluster would have behaved without CAST AI
optimization.

A baseline consists of:

1. CPU overprovisioning factor
2. RAM overprovisioning factor
3. CPU baseline unit cost in currency/core-hour
4. RAM baseline unit cost in currency/GiB-hour
5. baseline start/end period
6. baseline type

The baseline factors are fixed after selection unless manually changed.

---

# 2. Baseline selection logic

CAST AI evaluates baseline methods in this order:

1. Cluster history
2. Peer clusters
3. Industry average

Use the first method with sufficient data.

## Cluster history

Use when the cluster has at least 7 days of history between:

- initial CAST AI connection; and
- CAST AI taking over active node management.

Active node management is associated with more than 20% of nodes becoming
CAST AI-managed.

Label:

`Cluster history`

## Peer clusters

Use when the cluster lacks enough own history but the organization has other
clusters with a valid Cluster history baseline.

Average the eligible peer clusters':

- CPU overprovisioning factors;
- RAM overprovisioning factors;
- CPU unit costs;
- RAM unit costs.

Label:

`Peer clusters`

## Industry average

Use when:

- there is not enough own-cluster history; and
- there are no eligible peer baselines.

This uses CAST AI fleet-wide averages.

Label:

`Industry average`

Treat this as the least cluster-specific baseline.

## No baseline yet

A cluster should not have a baseline until both are true:

- the cluster is at least 14 days old;
- CAST AI is actively managing it.

If no baseline exists:

- realized savings = 0 for calculation purposes;
- the cluster may be absent from the Savings Report rather than displayed with zero.

## Overridden baseline

A CAST AI representative may:

- override individual baseline parameters; or
- recalculate the baseline over a custom date range.

Label:

`Overridden`

Once manually overridden, do not assume automatic recalculation will replace it.

---

# 3. Required calculation inputs

Collect the following before calculating savings.

## Baseline inputs

```text
baseline_start
baseline_end
baseline_type

cpu_overprovisioning_factor
ram_overprovisioning_factor

baseline_cpu_unit_cost
baseline_ram_unit_cost
```

## Per-day CPU inputs

```text
original_requested_cpu_core_hours
current_requested_cpu_core_hours
current_effective_cpu_unit_cost
actual_cpu_cost
```

## Per-day RAM inputs

```text
original_requested_ram_gib_hours
current_requested_ram_gib_hours
current_effective_ram_unit_cost
actual_ram_cost
```

## Workload autoscaler input

```text
workload_autoscaling_active = true | false
```

## Pricing mode

```text
price_mode = discounted | listing
```

When validating an existing report, also capture:

```text
reported_actual_cost
reported_projected_cost
reported_realized_savings
reported_workload_autoscaler_savings
reported_total_savings
```

---

# 4. Actual cost

Actual cost is the real cost of provisioned resources.

Formula:

```text
actual_cost =
    actual_cpu_cost
  + actual_ram_cost
```

There is no counterfactual modeling in this value.

When calculating a multi-day period:

```text
period_actual_cost =
    sum(daily_actual_cost)
```

---

# 5. Projected cost

Projected cost estimates the cost without CAST AI.

Calculate CPU and RAM independently.

## CPU projected cost

For a day on or after the baseline period ends:

```text
selected_cpu_demand =
    max(
        original_requested_cpu_core_hours,
        current_requested_cpu_core_hours
    )

selected_cpu_price =
    max(
        current_effective_cpu_unit_cost,
        baseline_cpu_unit_cost
    )

projected_cpu_cost =
    selected_cpu_demand
    * cpu_overprovisioning_factor
    * selected_cpu_price
```

For a day before the baseline period ends:

```text
projected_cpu_cost = actual_cpu_cost
```

## RAM projected cost

For a day on or after the baseline period ends:

```text
selected_ram_demand =
    max(
        original_requested_ram_gib_hours,
        current_requested_ram_gib_hours
    )

selected_ram_price =
    max(
        current_effective_ram_unit_cost,
        baseline_ram_unit_cost
    )

projected_ram_cost =
    selected_ram_demand
    * ram_overprovisioning_factor
    * selected_ram_price
```

For a day before the baseline period ends:

```text
projected_ram_cost = actual_ram_cost
```

## Total projected cost

```text
projected_cost =
    projected_cpu_cost
  + projected_ram_cost
```

For a multi-day period:

```text
period_projected_cost =
    sum(daily_projected_cost)
```

Always calculate projection at the daily grain first when validating a report,
then sum the daily results. Do not average the raw inputs over a whole period and
apply the formula once unless explicitly asked for an approximation.

---

# 6. Why MAX() is used

The projection deliberately uses the higher demand and higher price.

## Demand rule

```text
max(original_requested, current_requested)
```

This means:

- if rightsizing lowered requests, use the larger original request;
- if current demand grew above the original request, use current demand.

Never assume the no-CAST-AI cluster would run leaner than the workload demand
represented by these two values.

## Price rule

```text
max(current_effective_unit_cost, baseline_unit_cost)
```

This prevents the no-CAST-AI counterfactual from being priced below the
historical baseline rate.

For example, if CAST AI introduced lower-cost Spot capacity and therefore reduced
the current effective unit price, projection still uses the higher baseline rate.

---

# 7. Realized savings

For a cluster with a valid baseline and a day after the baseline window:

```text
realized_savings =
    projected_cost
  - actual_cost
```

For days inside the baseline window:

```text
projected_cost = actual_cost
realized_savings = 0
```

For a cluster without a baseline:

```text
realized_savings = 0
```

When validating a period:

```text
period_realized_savings =
    sum(daily_projected_cost - daily_actual_cost)
```

Do not create savings inside the baseline period.

---

# 8. Workload Autoscaler savings

Calculate workload-autoscaler savings independently for CPU and RAM.

Only count it when workload autoscaling was actually active on that day.

## CPU

```text
workload_autoscaler_cpu_savings =
    (
        original_requested_cpu_core_hours
        - current_requested_cpu_core_hours
    )
    * max(
        current_effective_cpu_unit_cost,
        baseline_cpu_unit_cost
    )
```

## RAM

```text
workload_autoscaler_ram_savings =
    (
        original_requested_ram_gib_hours
        - current_requested_ram_gib_hours
    )
    * max(
        current_effective_ram_unit_cost,
        baseline_ram_unit_cost
    )
```

## Combined

```text
workload_autoscaler_savings =
    workload_autoscaler_cpu_savings
  + workload_autoscaler_ram_savings
```

If workload autoscaling was inactive:

```text
workload_autoscaler_savings = 0
```

Important:

- this calculation is independent of the baseline period;
- workload-autoscaler savings may accrue inside the baseline window;
- do not silently clamp negative values to zero unless the user or API semantics
  explicitly require it. Use the documented formula first and flag unexpected
  negative values for investigation.

---

# 9. Avoid double counting

Do not calculate report total savings as:

```text
realized_savings + workload_autoscaler_savings
```

The workload-autoscaler effect is already reflected in reduced current workload
demand used by the projection model.

For report reconciliation, treat workload-autoscaler savings as an explanatory
component, not an additional amount to stack on top of the report's autoscaler
savings.

When the report exposes:

```text
Actual cost
Projected cost
Autoscaler savings
Workload autoscaler savings
Total savings
```

interpret:

```text
Actual cost =
    actual_cpu_cost + actual_ram_cost

Projected cost =
    projected_cpu_cost + projected_ram_cost

Workload autoscaler savings =
    workload_autoscaler_cpu_savings
  + workload_autoscaler_ram_savings

Realized/node autoscaler savings =
    projected_cost - actual_cost

Total savings =
    report autoscaler savings
```

Do not add workload-autoscaler savings again unless CAST AI documentation/API
semantics explicitly change.

---

# 10. Discounted vs listing prices

The Savings Report can use:

- discounted/effective prices; or
- listing/on-demand list prices.

## Discounted mode

Default behavior.

Actual/current costs reflect effective prices such as:

- negotiated rates;
- Spot prices;
- configured price adjustments.

## Listing mode

Actual/current costs use list prices.

Important rules:

1. Listing prices are unavailable for report periods starting before
   2025-08-06. In that case, use discounted pricing behavior.

2. Baseline unit costs remain based on discounted historical pricing.

3. The projection still applies:

```text
max(current_unit_price, baseline_unit_price)
```

Therefore switching the report to listing mode can raise current/actual values
while the baseline rate remains the historical discounted rate.

When investigating a discrepancy, verify the report's pricing mode first.

---

# 11. Historical-data safeguards

When validating older periods, account for these behaviors.

## Original request gaps

Some older data may have missing/zero original workload requests.
The report can substitute current requests as a fallback.

## Implausibly large values

Abnormally large request values may be excluded and replaced with a sane fallback.

## Data before October 2025

The report may use the earliest reliable original-request snapshot rather than
assuming the original request was zero.

Do not automatically treat these safeguards as calculation errors.

---

# 12. Older-cluster baseline limitation

For clusters created before node-level monitoring became available in
February 2025, the baseline window may be less precise.

The baseline period may end when CAST AI took over credentials rather than when
CAST AI took over active node management.

Flag this when reviewing a legacy cluster with an unexpected baseline.

---

# 13. Daily scenario matrix

Use this matrix when explaining whether savings should accrue.

| Day position | Workload autoscaling active | Realized savings | Workload autoscaler savings |
|---|---:|---:|---:|
| Inside baseline | No | 0 | 0 |
| Inside baseline | Yes | 0 | Can accrue |
| After baseline | No | Can accrue | 0 |
| After baseline | Yes | Can accrue | Can accrue |

---

# 14. Calculation workflow

When asked to calculate savings, follow this order.

## Step 1 — Identify scope

Determine:

- cluster;
- organization if relevant;
- date range;
- currency;
- price mode;
- daily vs aggregate data.

## Step 2 — Validate baseline eligibility

Check:

- baseline exists;
- baseline type;
- baseline start/end;
- cluster age;
- active-management status;
- manual override status.

If no baseline exists, explain that realized savings cannot be calculated from
the normal baseline model.

## Step 3 — Normalize units

Ensure:

- CPU demand is in core-hours;
- RAM demand is in GiB-hours;
- CPU price is currency/core-hour;
- RAM price is currency/GiB-hour;
- actual costs use the same currency.

Never multiply instantaneous cores by an hourly unit price unless the duration
has first been converted into core-hours.

## Step 4 — Calculate each day separately

For each day:

1. determine whether the day is before/inside/after the baseline window;
2. select CPU demand with `max(original, current)`;
3. select RAM demand with `max(original, current)`;
4. select CPU price with `max(current, baseline)`;
5. select RAM price with `max(current, baseline)`;
6. calculate projected CPU cost;
7. calculate projected RAM cost;
8. calculate actual cost;
9. calculate realized savings;
10. if workload autoscaling was active, calculate workload-autoscaler savings.

## Step 5 — Aggregate

Sum daily values:

```text
actual
projected
realized
workload-autoscaler
```

Do not average daily savings when the user asks for total savings.

## Step 6 — Reconcile

If the user's reported number differs, check in this order:

1. date range/time zone;
2. baseline start/end;
3. baseline type;
4. baseline override;
5. daily vs aggregate calculation;
6. original vs current workload requests;
7. overprovisioning factor;
8. discounted vs listing price mode;
9. baseline price floor;
10. Spot/effective current pricing;
11. missing historical original requests;
12. workload-autoscaler active dates;
13. cluster management status;
14. legacy pre-February-2025 baseline behavior;
15. rounding.

Do not explain a discrepancy as "rounding" until larger causes are excluded.

---

# 15. Validation invariants

Use these checks to detect obvious mistakes.

## Invariant A

Inside the baseline period:

```text
projected_cost == actual_cost
realized_savings == 0
```

## Invariant B

Projected demand cannot be lower than both original and current demand:

```text
selected_demand = max(original, current)
```

## Invariant C

Projected unit price cannot be lower than both current and baseline unit price:

```text
selected_price = max(current, baseline)
```

## Invariant D

If workload autoscaling is inactive:

```text
workload_autoscaler_savings == 0
```

## Invariant E

Do not add workload-autoscaler savings again to Total savings.

## Invariant F

For a cluster without a baseline, do not present normal realized savings as a
valid calculated report value.

---

# 16. Preferred output format

When the user provides numbers, return a compact audit table.

Example:

| Metric | CPU | RAM | Total |
|---|---:|---:|---:|
| Actual cost | $X | $Y | $Z |
| Selected demand | X core-h | Y GiB-h | — |
| Baseline factor | X | Y | — |
| Selected unit price | $X/core-h | $Y/GiB-h | — |
| Projected cost | $X | $Y | $Z |
| Realized savings | — | — | $Z |
| Workload autoscaler savings | $X | $Y | $Z |

Then show:

```text
Realized savings = projected - actual
```

Include an `Assumptions / checks` section with:

- baseline type and end date;
- price mode;
- workload-autoscaler state;
- missing or substituted data;
- any discrepancy from a reported UI/API value.

For a multi-day analysis, also provide:

```text
Date | Actual | Projected | Realized | WAS savings
```

and a period total.

---

# 17. Example

Inputs for one post-baseline day:

```text
CPU:
  original requested = 1,000 core-hours
  current requested = 800 core-hours
  overprovisioning factor = 1.8
  current unit price = $0.020/core-hour
  baseline unit price = $0.031/core-hour
  actual CPU cost = $30

RAM:
  original requested = 4,000 GiB-hours
  current requested = 3,500 GiB-hours
  overprovisioning factor = 1.4
  current unit price = $0.003/GiB-hour
  baseline unit price = $0.004/GiB-hour
  actual RAM cost = $18

workload autoscaling active = true
```

CPU projection:

```text
selected CPU demand = max(1000, 800) = 1000
selected CPU price = max(0.020, 0.031) = 0.031

projected CPU =
  1000 * 1.8 * 0.031
  = $55.80
```

RAM projection:

```text
selected RAM demand = max(4000, 3500) = 4000
selected RAM price = max(0.003, 0.004) = 0.004

projected RAM =
  4000 * 1.4 * 0.004
  = $22.40
```

Totals:

```text
actual cost =
  30 + 18
  = $48.00

projected cost =
  55.80 + 22.40
  = $78.20

realized savings =
  78.20 - 48.00
  = $30.20
```

Workload-autoscaler explanatory savings:

```text
CPU WAS =
  (1000 - 800) * 0.031
  = $6.20

RAM WAS =
  (4000 - 3500) * 0.004
  = $2.00

WAS savings =
  6.20 + 2.00
  = $8.20
```

Do not report:

```text
$30.20 + $8.20 = $38.40 total savings
```

That would double count the workload-rightsizing impact.

---

# 18. Example trigger prompts

This skill should trigger for requests such as:

- "Calculate CAST AI realized savings for this cluster."
- "Validate the CAST AI Savings Report."
- "How is CAST AI projected cost calculated?"
- "Why is my savings number different from projected minus actual?"
- "Calculate savings from these CPU and RAM metrics."
- "Check the CAST AI baseline calculation."
- "What baseline should this cluster use?"
- "Calculate workload autoscaler savings."
- "Why are listing-price savings different from discounted savings?"
- "Reconcile these CAST AI UI savings numbers with the API."
- "Analyze historical savings for Helios, Intec, and Kronos."
- "Is Siemens actually saving money with CAST AI?"
- "Show the formula behind the CAST AI savings number."

---

# 19. Non-goals

This skill does not automatically:

- invent cloud-provider discounts;
- infer missing CAST AI API fields;
- estimate savings from CPU utilization alone;
- substitute provisioned vCPU for workload requested core-hours;
- add workload-autoscaler savings on top of realized savings;
- decide whether a savings baseline is commercially acceptable.

If the user wants a hypothetical forecast, clearly label it as a scenario rather
than a Savings Report reproduction.

---

# 20. Troubleshooting skill triggering

Recommended path:

```text
Project-scoped:
.claude/skills/cast-ai-savings-calculations/SKILL.md

User-scoped:
~/.claude/skills/cast-ai-savings-calculations/SKILL.md
```

If Claude Code does not trigger this skill:

1. Confirm the file is named exactly `SKILL.md`.
2. Confirm the YAML frontmatter parses correctly.
3. Keep the skill directory name stable.
4. Use a prompt containing terms such as:
   - CAST AI savings
   - realized savings
   - projected cost
   - baseline
   - workload autoscaler savings
5. Avoid creating another skill with an overly broad description such as
   "calculate cloud costs", which may compete semantically with this skill.

---

# 21. Calculation-quality rule

When exact source numbers are available, show enough intermediate values that
another engineer can reproduce the result.

For each result, preserve:

```text
selected demand
selected price
baseline factor
actual cost
projected cost
realized savings
workload-autoscaler savings
```

Prefer reproducible arithmetic over a narrative-only answer.
