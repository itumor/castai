---
name: castai-savings-reconciliation
description: Audit CAST AI savings claims and discrepancies across the console, Value Realization/reporting API, legacy cost reports, and invoices. Use for baseline methodology, realized versus available/potential savings, WAS attribution, 20 percent adoption gates, gross versus net, and implausible cost numbers.
---

# CAST AI savings audit and reconciliation

## Non-negotiables
- State **cluster IDs (or redacted aliases), reporting period with timezone, currency, cost basis, API/UI source, version when available, and aggregation** before making numerical claims.
- Do not label forecast/potential savings as realized, nor net as gross. Never infer invoiced savings or CAST AI fees from a chart alone.
- Treat one product's report methodology as distinct from others until verified by authoritative current docs/schema.
- A baseline is a modeled counterfactual, **not a historical AWS invoice**. Investigate unrealistic baseline values instead of repeating them as fact.

## Procedure
1. Inventory data streams: Available savings/estimated optimizations, Realized Savings, Cost comparison, cluster cost report, Value Realization reporting API, legacy endpoints, fees/billing and cloud invoice if available.
2. Pin exact dates, resolution (daily average vs instant peak), UTC/local timezone, provider/region, USD/EUR rate, discounted/list rate and excluded expenses. Avoid mixing hourly and daily totals.
3. Validate component adoption, baseline type/source, baseline period end, readiness gates, and any zero-savings transitional period **for the exact report in question**. Current Realized Savings docs describe node reporting with at least 20% managed nodes and workload impact with at least 20% workloads under VPA; verify that these gates apply to the requested metric before using them.
4. Reconcile modeled baseline cost with observed actual costs and optimization history; inspect outliers (large baseline against tiny recent spend), workload growth, interruption discounts, holidays/weekends, scale-to-zero and price adjustments.
5. Reconcile WAS impact without double counting: when node and workload autoscaling are enabled, workload optimization can already be reflected in node realized savings per product docs. Attribute carefully rather than summing every card.
6. Quantify deltas as `absolute_delta = A - B` and `relative_delta = (A - B)/B` only when B is nonzero and both measures are genuinely comparable. A suggested investigation threshold (e.g. 5%) is **user policy**, not CAST AI platform behavior unless verified.
7. Define fee/net calculation explicitly: only use `net = relevant gross savings - applicable fees` when the contract/metric definitions support it; no assumed fee rate.
8. Produce a reconciliation table including `Metric | Period | Source | Value | Assumptions | Comparable? | Explanation/Next check` and cite evidence for every claim.

## Guardrails
Investigate with read-only data and obtain explicit human approval before changing report configuration, credentials, billing settings, or sending customer-facing financial conclusions. Never invent undocumented baseline API fields or response types. Use the relevant reporting OpenAPI specification and inspect the response before proposing endpoint-specific queries. Avoid outputting proprietary customer cost data beyond the approved support context.

## Output
**Methodology & scope** → **Reconciliation table** → **Confirmed cause vs open hypothesis** → **Evidence needed** → **Customer-friendly explanation**.

## References
- [Realized savings](https://docs.cast.ai/docs/savings-report)
- [Available savings](https://docs.cast.ai/docs/available-savings)
- [Cost comparison](https://docs.cast.ai/docs/cost-comparison)
- [Cluster cost report](https://docs.cast.ai/docs/cluster-total-compute-cost)
- [CAST AI Swagger root](https://api.cast.ai/v1/spec/)
