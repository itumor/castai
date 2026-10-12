# API surface used for the September-2026 enterprise savings report
*Prepared 2026-10-12 · all calls read-only · base URL `https://api.eu.cast.ai` · auth `X-API-Key: $CASTAI_API_KEY` on every request*

| # | API (search term in [API Reference](https://docs.cast.ai/reference)) | Method + path | Purpose in this report | Essentials / quirks verified live | Key response fields |
|---|---|---|---|---|---|
| 1 | organizations → "organizations" | `GET /v1/organizations` | Enumerate the 8/enterprise: found 130 orgs (1 ENTERPRISE parent, 3 DEFAULT, 126 CHILD) — the sweep's scope | Parent org id `8b69b8da-…9847` must be sent as header for parent-scale aggregation (see #5) | `organizations[]{id,name,organizationType,organizationMember}` |
| 2 | external-cluster/inventory → "external clusters" | `GET /v1/kubernetes/external-clusters` | Per-org cluster inventory (267 rows across 30+ orgs): names, regions, AWS `accountId`, class markers | **Requires `X-CastAI-Organization-Id: {orgId}`** per child org (parent org returns 0 items) | `items[]{id,name,providerType,region.name,eks.accountId,isPhase2,firstOperationAt,managedBy,status,createdAt}` |
| 3 | reporting value-realization → "value realization report" | `POST /reporting/v1beta/organizations/{orgId}/clusters:runValueRealizationReport?startTime=…&endTime=…&timeZone=Europe%2FBerlin`, body `{}` | THE savings source: per-cluster actual / projected / gross savings (62 rows) | Read-semantics POST. **Returns HTTP 200 with EMPTY items unless `X-CastAI-Organization-Id` matches the path org id** — the day's biggest footgun. Window used: `2026-08-31T22:00:00Z→2026-09-30T22:00:00Z` (= Sept, Berlin) | `items[]{clusterId,clusterName,baselineType,baselinePeriodStart/EndTime,cost{actualCost,projectedCost,totalSavings,capacitySavings,committedUsageDiscountSavings}}` |
| 4 | cost-reports savings (classic) → "cluster savings" | `GET /v1/cost-reports/clusters/{clusterId}/savings?startTime=2026-09-01T00:00:00Z&endTime=2026-10-01T00:00:00Z&stepSeconds=86400` | Classic/mechanism basis: 49 clusters' September totalCost/totalSavings + daily items | Returns **400 "cluster is read-only"** for non-phase2/enterprise(Karpenter)-style clusters; `summary` has only totalCost/totalSavings — downscaling vs spot split lives in `items[]` | `summary{totalCost,totalSavings}`, `items[]{date,downscalingSavings,spotSavings,…}` |
| 5 | billing usage → "platform usage detail" | `GET /v1/billing/platform-usage-detail?period.from=2026-09-01&period.to=2026-09-30&feature=phase2` | Fee basis: billable provisioned-vCPU per cluster (56 entities, Σ 8,632.345) | Dates must be `YYYY-MM-DD`. **Aggregates enterprise-wide when `X-CastAI-Organization-Id` = PARENT org id**; entityName = cluster UUID at parent level. woop feature overlaps inside the same pool — use one feature per fee calc | `detail.entities[]{entityName,usage,pricingUnits}`, `totalUsage` |
| 6 | reporting baseline-params → "baseline params" | `GET /reporting/v1beta/organizations/{orgId}/clusters/{clusterId}/baseline-params` | Baseline verification layer: type, window, factors, unit prices, update time (57/71 clusters) | Org-scoped: send `X-CastAI-Organization-Id`. **404 = cluster has no baseline record** (≈ SMO Railigent/Karpenter fleet) | `baselineType, baselinePeriodStartTime/EndTime, cpuOverprovisioningFactor, memoryOverprovisioningFactor, costPerCpuCoreHourly, costPerMemoryGibHourly, updateTime` |
| 7 | rebalancing plans → "rebalancing plans" | `GET /v1/kubernetes/clusters/{clusterId}/rebalancing-plans` | First-rebalance evidence per cluster (69/71 successful) | Cluster-scoped (org header accepted); 400 for read-only/ghost clusters | `items[]{rebalancingPlanId,createdAt,state,…}`, `nextCursor` |
| 8 | audit → "audit" | `GET /v1/audit?clusterId={id}&fromDate=2026-07-01T00:00:00Z&toDate=…` | Event-level proof of first CAST operation (used for helios takeover evidence) | Windowed; keep spans moderate | event list with timestamps/types |

### Companion verified links
- API Reference home: <https://docs.cast.ai/reference> — search the terms in column 2
- Reality-of-VR guide: [Realized savings](https://docs.cast.ai/docs/savings-report) (verified fetchable)
- Karpenter Enterprise suite docs: <https://docs.cast.ai/docs/karpenter-enterprise>

### Example calls (copy/paste, key stays in env)
```bash
# 1+2 inventory for a child org
curl -sS -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: 07aa3c29-3e1f-44bc-ad60-ceedb878d99a" \
  "https://api.eu.cast.ai/v1/kubernetes/external-clusters" | jq '.items[].name'

# 3 VR report (header MUST match path org)
curl -sS -X POST -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: 07aa3c29-3e1f-44bc-ad60-ceedb878d99a" \
  -H "Content-Type: application/json" -d '{}' \
  "https://api.eu.cast.ai/reporting/v1beta/organizations/07aa3c29-3e1f-44bc-ad60-ceedb878d99a/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe%2FBerlin" \
  | jq '.items[] | {clusterName, baselineType, actual: .cost.actualCost, projected: .cost.projectedCost, savings: .cost.totalSavings}'

# 4 classic savings
curl -sS -H "X-API-Key: $CASTAI_API_KEY" \
  "https://api.eu.cast.ai/v1/cost-reports/clusters/419c39e4-66bf-4d61-b833-4562968a61c7/savings?startTime=2026-09-01T00:00:00Z&endTime=2026-10-01T00:00:00Z&stepSeconds=86400" \
  | jq '.summary'

# 5 enterprise billing (parent-org header = aggregation switch)
curl -sS -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: 8b69b8da-00d6-47e6-8af0-a36ab02b9847" \
  "https://api.eu.cast.ai/v1/billing/platform-usage-detail?period.from=2026-09-01&period.to=2026-09-30&feature=phase2" \
  | jq '.detail | {totalUsage, n: (.entities|length)}'

# 6 baseline params (404 ⇔ no baseline)
curl -sS -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: 07aa3c29-3e1f-44bc-ad60-ceedb878d99a" \
  "https://api.eu.cast.ai/reporting/v1beta/organizations/07aa3c29-3e1f-44bc-ad60-ceedb878d99a/clusters/419c39e4-66bf-4d61-b833-4562968a61c7/baseline-params" \
  | jq '{baselineType, baselinePeriodEndTime, cpuOverprovisioningFactor}'
```
