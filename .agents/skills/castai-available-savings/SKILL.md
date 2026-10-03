---
name: castai-available-savings
description: Calculate, validate, and explain CAST AI Available Savings for Kubernetes clusters using the CAST AI estimated-savings APIs, current versus optimized cost, and Workload Rightsizing, Spot, and ARM scenarios. Use when asked for available/potential savings, current vs optimal CAST AI cost, savings percentage, estimated-savings API analysis, savings history, or a customer-facing savings summary. Do not confuse Available Savings with Realized Savings/baseline calculations.
---

# CAST AI Available Savings

Calculate CAST AI **Available Savings** accurately and explain where the potential savings come from.

## Core rule

Treat **Available Savings** and **Realized Savings** as different concepts:

- **Available Savings** = estimated future/potential savings from optimizing the cluster's current or historical configuration.
- **Realized Savings** = modeled savings already achieved after CAST AI management, using CAST AI's baseline methodology.

Never use the Realized Savings baseline formula to manufacture an Available Savings number.

For Available Savings, prefer CAST AI's report/API values as the source of truth and independently verify the arithmetic when current and optimized costs are available.

## Official CAST AI sources

Use these as authoritative references:

- Available Savings report:
  https://docs.cast.ai/docs/available-savings
- Current Available Savings API:
  `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings`
  API index: https://api.cast.ai/
- Available Savings history API:
  `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings-history`
  https://docs.cast.ai/reference/clusterreportapi_getclustercosthistory
- Realized Savings/baseline formulas:
  https://docs.cast.ai/docs/savings-baseline
- API authentication:
  https://docs.cast.ai/docs/api-access

## Inputs

Collect or resolve:

1. `cluster_id` — required.
2. CAST AI API region:
   - US: `https://api.cast.ai`
   - EU: `https://api.eu.cast.ai`
   - India: `https://api.india.cast.ai`
3. API key from environment, preferably:
   `CASTAI_API_KEY`
4. Optional enterprise child organization ID:
   `CASTAI_ORGANIZATION_ID`
5. Analysis mode:
   - `current` — current Available Savings snapshot.
   - `history` — savings over a time range.
6. For history:
   - `from_date`
   - `to_date`
7. Pricing:
   - discounted/effective pricing by default;
   - listing pricing only when explicitly requested and supported by the endpoint/report.

Never ask the user to paste an API key into chat if the local environment can provide it.

## Authentication

Use `X-API-Key`.

Example shell setup:

```bash
export CASTAI_API_KEY='...'
export CASTAI_API_BASE_URL='https://api.eu.cast.ai'
```

Build headers without printing the secret:

```bash
HEADERS=(-H "X-API-Key: ${CASTAI_API_KEY}" -H "accept: application/json")

if [[ -n "${CASTAI_ORGANIZATION_ID:-}" ]]; then
  HEADERS+=(-H "X-CastAI-Organization-Id: ${CASTAI_ORGANIZATION_ID}")
fi
```

## Workflow

### 1. Validate prerequisites

Before calculating:

- Confirm `cluster_id`.
- Confirm the correct API region.
- Confirm an API key is available.
- Confirm the cluster/report has usable data.
- Remember that the Available Savings report requires at least one CAST AI-supported node type.

If the cluster contains only unsupported node types, stop and explain that the report cannot produce a valid savings estimate.

### 2. Get the current Available Savings report

Use:

```bash
curl -sS \
  "${CASTAI_API_BASE_URL}/v1/cost-reports/clusters/${CLUSTER_ID}/estimated-savings" \
  "${HEADERS[@]}" | jq .
```

This endpoint is the preferred source for the **current Available Savings estimate**.

Do not assume response-field names from memory. Inspect the returned JSON and identify the fields representing:

- current/real cluster cost;
- estimated optimal/optimized cost;
- total estimated/available savings;
- total savings percentage, if supplied;
- Workload Rightsizing opportunity;
- Spot opportunity;
- ARM opportunity;
- current/optimized resource configuration;
- report status or unsupported-resource indicators.

If CAST AI already returns an explicit total savings value, preserve it as the primary reported value and use the formulas below as a cross-check.

### 3. Calculate the current savings cross-check

When current cost and optimized cost are present:

```text
available_savings_amount = current_cost - optimized_cost
available_savings_percent =
    (available_savings_amount / current_cost) * 100
```

Only calculate the percentage when `current_cost > 0`.

Do not silently force negative deltas to zero. If:

```text
optimized_cost > current_cost
```

flag it as an anomaly or scenario with no positive available savings and inspect the API response/configuration.

### 4. Get Available Savings over time

Use:

```bash
curl -sS \
  --get \
  "${CASTAI_API_BASE_URL}/v1/cost-reports/clusters/${CLUSTER_ID}/estimated-savings-history" \
  "${HEADERS[@]}" \
  --data-urlencode "fromDate=${FROM_DATE}" \
  --data-urlencode "toDate=${TO_DATE}" \
  --data-urlencode "useListingPrices=false" | jq .
```

The history endpoint provides real cluster cost and estimated optimal cost over time.

If listing prices are explicitly requested:

```text
useListingPrices=true
```

Keep the pricing basis consistent across all values in one comparison.

### 5. Calculate period savings correctly

For each sample/day `i`:

```text
savings_i = current_cost_i - optimal_cost_i
```

For the whole period:

```text
period_current_cost = Σ current_cost_i
period_optimal_cost = Σ optimal_cost_i

period_available_savings =
    period_current_cost - period_optimal_cost

period_available_savings_percent =
    (period_available_savings / period_current_cost) * 100
```

Use **ratio-of-sums** for the period percentage.

Do **not** calculate the headline period percentage by averaging daily savings percentages:

```text
WRONG:
avg((current_i - optimal_i) / current_i)
```

That method gives every day equal weight regardless of spend and can distort the result.

### 6. Handle Workload Rightsizing, Spot, and ARM correctly

The Available Savings report can show scenario cards for:

- Workload Rightsizing
- Spot Instances
- ARM support

Treat these as optimization scenarios/opportunities.

Do not blindly calculate:

```text
total = rightsizing + spot + arm
```

unless the CAST AI API/report explicitly states that the returned components are additive or provides a combined scenario.

Reasons:

- the same workload/capacity can be affected by more than one optimization;
- Spot and ARM can overlap with optimized instance selection;
- rightsizing changes demand and therefore can change the capacity to which Spot/ARM assumptions apply.

Preferred behavior:

1. Report CAST AI's total Available Savings as the headline.
2. Report each optimization card separately as an opportunity.
3. Only report a summed breakdown if CAST AI returns a combined/cumulative model.

### 7. Workload Rightsizing

When CAST AI returns workload rightsizing potential:

- report the projected savings amount and percentage;
- identify CPU and memory request reduction when available;
- distinguish recommendation/potential from already-realized savings.

If more workload detail is needed, query:

```text
GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary?includeCosts=true
```

Do not invent workload savings from CPU utilization alone.

### 8. Spot opportunity

When the report provides Spot savings:

- state whether the scenario covers all workloads or only Spot-friendly workloads;
- preserve CAST AI's eligibility model;
- do not assume every workload can safely run on Spot;
- do not extrapolate generic cloud Spot discounts into a CAST AI savings figure.

### 9. ARM opportunity

When ARM support is modeled:

- report the selected percentage of CPUs/workloads modeled for ARM if returned/known;
- preserve CAST AI's calculated savings result;
- state that workload architecture compatibility and scheduling constraints matter;
- do not assume x86 workloads can run on ARM.

### 10. Read-only vs CAST AI-managed clusters

For a read-only cluster, emphasize:

- estimated total savings potential;
- current cluster cost;
- optimization opportunities/recommendations.

For a CAST AI-managed cluster, also inspect/report:

- progress toward recommended configuration;
- detailed current-vs-optimized configuration;
- remaining available savings.

Do not treat remaining Available Savings on a managed cluster as the same thing as savings already realized.

## Output format

Use this concise structure by default:

```markdown
# CAST AI Available Savings — <cluster>

**Period:** <current snapshot | from → to>
**Pricing:** <discounted/effective | listing>
**Management:** <read-only | CAST AI-managed>

| Metric | Value |
|---|---:|
| Current cost | $X |
| Estimated optimized cost | $Y |
| Available savings | $Z |
| Available savings | P% |

## Optimization opportunities
| Area | Potential | Notes |
|---|---:|---|
| Workload rightsizing | ... | ... |
| Spot | ... | all workloads / spot-friendly only |
| ARM | ... | modeled ARM share |

## Validation
- API total: ...
- Derived current − optimal: ...
- Difference: ...
- Status: MATCH / INVESTIGATE

## Key observation
<1–3 sentences explaining the biggest opportunity and any caveat>
```

For a historical period, also include:

```markdown
Formula used:
Savings % = Σ(Current Cost − Optimal Cost) / Σ(Current Cost) × 100
```

## Validation rules

Apply all of these:

1. `current_cost >= 0`
2. `optimal_cost >= 0`
3. percentage is undefined when current cost is zero
4. all compared costs use the same pricing basis
5. all historical values use the same time range
6. preserve API units and currency
7. do not mix hourly, daily, and monthly rates without explicit normalization
8. do not mix Available Savings with Realized Savings
9. do not add Workload + Spot + ARM unless CAST AI says they are additive
10. if API total and derived total differ, show both and investigate instead of hiding the mismatch

A practical mismatch check may use:

```text
difference = api_savings - (current_cost - optimal_cost)
```

If the difference is material, inspect:
- aggregation/window boundaries;
- pricing basis;
- unsupported node types;
- rounding;
- scenario settings;
- report freshness.

## Realized Savings guardrail

If the user asks for **Realized Savings**, switch mental models.

CAST AI's Realized Savings uses a baseline model based on:

- CPU overprovisioning factor
- RAM overprovisioning factor
- CPU unit cost
- RAM unit cost
- baseline period

The published high-level equations include:

```text
actual cost = actual CPU cost + actual RAM cost

realized savings = projected cost - actual cost
```

The projected cost calculation uses CAST AI's baseline methodology and is not the Available Savings formula.

Use:
`GET /v1/cost-reports/clusters/{clusterId}/savings`

and consult:
https://docs.cast.ai/docs/savings-baseline

## Error handling

### 401
Explain that the API key is missing/invalid. Verify `CASTAI_API_KEY` and region.

### 403
Explain that the key lacks required permissions or organization access. For an enterprise parent key, verify `X-CastAI-Organization-Id`.

### 404
Check:
- cluster ID;
- API region;
- child organization context.

### Empty/no report
Check:
- supported node types;
- cluster/report readiness;
- requested date window;
- whether the cluster has cost data.

### Suspiciously large savings
Do not accept it automatically. Check:
- current vs optimal units;
- pricing mode;
- time window;
- duplicate aggregation;
- whether daily/hourly/monthly values were mixed.

## Example prompts that should trigger this skill

- "Calculate CAST AI available savings for cluster `abc-123`."
- "How much can Helios still save with CAST AI?"
- "Compare current vs optimized CAST AI cost for the last 7 days."
- "Calculate the Available Savings percentage from this estimated-savings JSON."
- "Show CAST AI potential savings for Workload Rightsizing, Spot, and ARM."
- "Validate whether this CAST AI savings number is correct."
- "Use ratio-of-sums for the CAST AI Available Savings history."
- "Why does CAST AI show 42% available savings when my calculation shows 38%?"

## Example calculation

Given:

```text
current cost   = 10,000
optimized cost = 6,200
```

Then:

```text
available savings = 10,000 - 6,200
                  = 3,800

available savings % = 3,800 / 10,000 × 100
                    = 38%
```

For history:

```text
Day 1: current 100, optimal 60
Day 2: current 900, optimal 720
```

Correct period result:

```text
current total = 1,000
optimal total = 780
savings       = 220
savings %     = 22%
```

Do not average the daily percentages `(40% + 20%) / 2 = 30%`, because that ignores the different cost weights.

## Security

- Never print, log, commit, or echo `CASTAI_API_KEY`.
- Never place API keys directly in `SKILL.md`.
- Prefer read-only API permissions for analysis.
- Do not perform cluster changes as part of a savings calculation.
- Treat the skill as analysis/reporting unless the user explicitly requests an optimization change.
