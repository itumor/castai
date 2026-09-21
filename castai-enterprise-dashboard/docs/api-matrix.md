# CAST AI API — Endpoint Capability Matrix (Enterprise Dashboard contract)

**Source of truth:** local OpenAPI 3.0.1 spec `docs/openapi/castai-openapi.json` (423 paths / 522 operations), extracted programmatically on 2026-09-21. Every row cites the spec `operationId` and path. Cross-checks against public docs are marked **[docs]**.
**Target scale:** 1 enterprise org ("Siemens AG", verified: 129 total orgs, 122 children of `8b69b8da-00d6-47e6-8af0-a36ab02b9847`), ~1,000 clusters, ~10k nodes. Base URL verified: `https://api.eu.cast.ai`.
**Posture:** READ-ONLY. Only GET endpoints (plus explicitly noted read-type POST *query* endpoints that only fetch reports — document/allowed; never execute mutations).

---

## 0. Auth & organization scoping — CRITICAL

- Spec security schemes (`components.securitySchemes`): `ApiKeyAuth` = header **`X-API-Key`**; `BearerAuth` = JWT. Dashboard uses `X-API-Key`.
- **`X-CastAI-Organization-Id` header is NOT declared anywhere in the OpenAPI spec** (verified: zero occurrences of `X-CastAi`, `Organization-Id`, etc.; **no header parameters are declared on any operation at all**).
  - **[docs]** Per <https://docs.cast.ai/docs/api-access> and <https://docs.cast.ai/docs/permissions-users-orgs-and-sso>: an **Enterprise API key** (Owner/Viewer) can target resources in a child organization by sending header **`X-CastAI-Organization-Id: <child-org-id>`** in addition to `X-API-Key`. API keys scoped directly to a child org work without the header (<https://docs.cast.ai/docs/enterprise-organizations>).
  - **Implementation rule:** treat the header as a *gateway-level* concern applicable to every org-scoped GET below ("OrgHdr: Yes"). Required only when the key is enterprise-scoped; omit for child-scoped keys. Call `GET /v1/organizations` (enterprise context) first, then fan out per child org with the header set.
- Verified live: `GET /v1/organizations` with a read-only key returns all 129 orgs; Enterprise org has `type=ORGANIZATION_TYPE_ENTERPRISE`; children have `type=ORGANIZATION_TYPE_CHILD` and `parentId=<enterprise-id>`; `ORGANIZATION_TYPE_DEFAULT` orgs also exist (filter or show separately).

## 0.1 Conventions seen across the spec

- **Pagination:** cursor-based where present. Query params `page.limit` (**string**, shared component documents 1–500) and `page.cursor` (string token; empty = from start). Response carries `nextCursor` (+ often `count` as `string(uint64)`). Several list endpoints have **no pagination at all** (notably `GET /v1/kubernetes/external-clusters`, `GET /v1/organizations`, and `GET /v1/cost-reports/organization/clusters/summary` — full lists returned; see §12(d)).
- **Time windows:** `startTime`/`endTime` (RFC3339 strings, usually REQUIRED on reports), `stepSeconds` optional (event metrics allow 30/300/600/900/3600/86400, 0=auto), `timeZone` (IANA, default `Etc/UTC`) on newer endpoints. `fromDate`/`toDate` and `fromTime`/`toTime` variants exist (noted per endpoint).
- **Money:** amounts are mostly **strings or numbers in USD** (proto3 JSON); `*CostHourly*` = USD/hour; node `instancePrice`/`totalPrice` = USD hourly; `storageCostMonthly` = USD/month. `useListingPrices` (bool, optional) toggles listing vs discounted prices on most cost endpoints.
- **Resources:** CPU in **cores** (or millicores when named `*Milli`), RAM in **bytes / GiB / MiB** depending on field suffix (`ramGib*`, `mem*Mib`, `ram*Bytes`); GPU/TPU in counts. Efficiency `*Percent` are doubles 0–100.
- **Sorting:** `sort.field` + `sort.order` (enum `ASC|asc|DESC|desc`, default asc) on paginated report endpoints.
- **Rate limits:** the spec documents **ZERO `429` responses and ZERO `Retry-After` headers** across all 423 paths (verified by string scan). Treat limits as undocumented → conservative fan-out, exponential backoff on 429/5xx, observe at runtime (see §9).

---

## 1. Organization discovery & Enterprise→child hierarchy

### 1.1 `GET /v1/organizations` — `UsersAPI_ListOrganizations` — stable
- Summary: list user organizations; empty args = caller's orgs; sorted by join date (first = default org).
- Params: **none**. Pagination: **none** (full array; verified — no parameters and no cursor fields declared).
- OrgHdr: No (this call *establishes* the hierarchy; call in enterprise context).
- Response `organizations[]` fields: `id` (uuid string), `name`, `createdAt` (date-time), `parentId` (string; **beta** per description), `type` (enum `ORGANIZATION_TYPE_DEFAULT | ORGANIZATION_TYPE_ENTERPRISE | ORGANIZATION_TYPE_CHILD`), `childOrderId` (int, order of child by created_at), `organizationMember` (bool), `internal` (bool), `blockEscalatedPrivilege` (bool), `role`.
- Feeds: org picker, enterprise→child mapping, per-org fan-out key. **1 call per refresh.**

### 1.2 `GET /v1/organizations/{id}` — `UsersAPI_GetOrganization` — stable
- Path `id` (REQ). Response adds `billingType`, `metadata.partnerTenantId`, `metadata.parentOrganizationId` beyond list fields. Single-org detail only; the list call suffices for hierarchy.

### 1.3 Enterprise billing usage (enterprise-scoped; no OrgHdr needed)
- `GET /v1/billing/enterprise/platform-usage-report` — `BillingAPI_GetEnterprisePlatformUsageReport` — stable. **No params.** Response: `features[]{feature, displayName, usage(double), unit, credits{total,used,remaining,resetFrequency,startDate,endDate,provider}, freeOfCharge{isFreeOfCharge,...}, creditsApplied, creditPeriods[], freeOfChargePeriods[]}` + `subscriptions[]{provider, startDate, endDate}`. Current month, aggregated across child orgs.
  - **Semantic warning (answers §12c): this is FEATURE/LICENSE usage (e.g. `phase2`, `woop` seats/CU), NOT dollar cost of clusters.** Good for entitlement/license KPI cards; it does **not** replace per-org money fan-out.
- `GET /v1/billing/enterprise/platform-usage-detail` — `BillingAPI_GetEnterprisePlatformUsageDetail` — stable. REQ `period.from`, `period.to` (`YYYY-MM-DD`), `feature` (e.g. `"phase2"`, `"woop"`). Response `detail{totalUsage, unit, credits{...}, dailyUsages[]{day, value}, entities[]{entityId, entityName, entityType, usage, dailyUsages}, ...}` — per-child-org feature-usage breakdown **without fan-out**.
- Related: `GET /v1/billing/subscription-details/{organizationId}`, `GET /v1/billing/platform-usage-report` (single org).

---

## 2. Clusters (inventory)

### 2.1 `GET /v1/kubernetes/external-clusters` — `ExternalClusterAPI_ListClusters` — stable
- Summary: lists clusters for current user's organization.
- Params: **none**. Pagination: **none** (verified — no query params; response envelope `{items[]}` has **no `nextCursor`**). One call returns ALL clusters of the org in scope.
- OrgHdr: **Yes** — one call per child org (≈122 calls per full sweep).
- Response `items[]` (cluster object) — complete field list from spec:
  `id`, `name`, `organizationId`, `credentialsId`, `createdAt` (date-time), `region{name, displayName}`, `status`, `agentSnapshotReceivedAt`, `agentStatus`, `providerType`, `deletedAt`, `tags`, `eks{...}`, `gke{...}`, `kops{...}`, `aks{...}`, `openshift{...}`, `anywhere{...}`, `selfHostedWithEc2Nodes{...}`, `oke{...}`, `subnets`, `zones`, `clusterNameId`, `reconcileError`, `allRegionZones`, `sshPublicKey`, `providerNamespaceId`, `kubernetesVersion`, `managedBy`, `firstOperationAt`, `reconciledAt`, `reconcileInfo`, `isPhase2`, `castwareInstallMethod`, `attributes`.
  - `status` documented values: `connecting`, `ready`, `warning` (**autoscaling does NOT work** in warning), `failed`, `deleting`.
  - `agentStatus` documented values: `waiting-connection`, `online`, `non-responding`, `disconnected`, `disconnecting` (computed from last snapshot timestamp).
  - `providerType` is **free text** (no enum) — normalize for facets. `eks{clusterName, region, accountId, assumeRoleArn, subnets, securityGroups, instanceProfileArn, dnsClusterIp}`, `gke{clusterName, region, projectId, location,...}`, `aks{region, nodeResourceGroup, subscriptionId,...}`.
  - **No autoscaler/WOOP status fields in the list object** (see §12e).
- Feeds: cluster table columns (name, org via `organizationId`, provider, region, k8s version, status, agent status, created, managedBy, phase2); join key `id` → all `clusterId` path params. Filter out `deletedAt != null` (implemented: deleted clusters are blacklisted from the fleet id-union in `services/cluster_service._org_rows`).

### 2.2 `GET /v1/kubernetes/external-clusters/{clusterId}` — `ExternalClusterAPI_GetCluster` — stable
- Path `clusterId` (REQ). Same cluster object (single). Drill-down header only; prefer the list for sweeps.

### 2.3 `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` — `ExternalClusterAPI_ListNodes` — stable
- Path `clusterId` (REQ). Query (all opt): `page.limit`, `page.cursor`, filters `nodeId`, `nodeStatus` (enum `unknown|pending|creating|ready|not_ready|draining|deleting|deleted|interrupted|cordoned`), `instanceType`, `lifecycleType` (`on_demand|fallback|spot`), `removalDisabled`, `unschedulable`, `zone`, `nodeConfigurationName/Version`, `nodeTemplateName/Version`, `nodeName`, `excludeDeleting` (bool).
- Pagination: **cursor** (`nextCursor`).
- Response `items[]`: `id`, `name`, `state{phase}`, `cloud`, `role`, `instanceType`, `zone`, `subnetId`, `providerId`, `createdAt`, `joinedAt`, `addedBy`, `instanceArchitecture`, `instancePrice` (string USD/hr), `labels`, `taints`, `annotations`, `unschedulable`, `spotConfig`, `gpuInfo`, `nodeConfigurationId`, `resources{cpuAllocatableMilli, memAllocatableMib, cpuCapacityMilli, memCapacityMib, cpuRequestsMilli, memRequestsMib, bandwidthCapacityMbps}`, `network{publicIp, privateIp}`, `nodeInfo{kernelVersion, osImage, containerRuntimeVersion, kubeletVersion, operatingSystem, architecture}`, `instanceId/Name/Labels`.
- Feeds: node table in cluster drill-down. Cost: **per cluster** — lazy-load on drill-down only.

---

## 3. Organization-level cost reporting (`/v1/cost-reports/organization/*`)
All OrgHdr: **Yes** (one call per child org, per refresh). All stable (no deprecated markers in the family).

### 3.1 `GET /v1/cost-reports/organization/clusters/summary` — `ClusterReportAPI_GetClustersSummary` — **THE fleet table source**
- Params: `useListingPrices` (opt). **No time window, no pagination** — current-state snapshot, ONE ROW PER CLUSTER.
- Response `items[]` per cluster (complete spec field list): `clusterId`, node counts (`nodeCountOnDemand`, `nodeCountSpot`, `nodeCountOnDemandCastai`, `nodeCountSpotCastai`, `nodeCountSpotFallbackCastai`, `unknownNodeCount`), per-offering CPU/RAM/GPU/TPU triplets (`cpuProvisioned|Allocatable|Requested{OnDemand,Spot,SpotFallback}`, same for `ram*`, `gpu*` — plus `gpuUsed*`/`gpuIdle*`/`gpuNotUsed*` per offering), cost split (`costHourlyOnDemand/Spot/SpotFallback`, per-resource `cpuCostHourly*`, `ramCostHourly*`, `gpuCostHourly*`, `tpuCostHourly*`, `storageCostHourly`), `podCount`, `unschedulablePodCount`, `cpuUsed`, `ramUsed`, `storageProvisioned/Requested/Claimed`, **`clusterScore`**.
- Feeds: **cluster table columns: nodes (OD/spot), spot %, provisioned/requested CPU+RAM, $/hr, pending pods, score — in ONE call per org.** Lacks `clusterName` (join on `clusterId` with §2.1) and lacks efficiency/waste (join §3.3). All numerics are **strings**.

### 3.2 `GET /v1/cost-reports/organization/clusters/report` — `ClusterReportAPI_GetOrganizationClustersCostReport`
- REQ `startTime`, `endTime`; opt `useListingPrices`. No pagination. One row per cluster over a period.
- Response: org `summary{totalCost, cpuCost, ramCost, costOnDemand, costSpot, costFallback, gpuCost, storageCost, tpuCost, cpu/ram/gpu/tpu/storage Requested/Provisioned/Allocatable, totalCostPercentChange}`; `clusters[]{clusterId, clusterName, clusterDeletedAt, summary{totalCost, cpuCost, ramCost, costOnDemand, costFallback, costSpot, cpu/ram/gpu/storage/tpu Requested|Provisioned|Allocatable, totalCostPercentChange}}` (per-cluster period rollup incl. **clusterName**); `topClustersCost[]`; `totalDailyCost[]{timestamp, value}`; `previousPeriodStart/End`.
- Feeds: KPI cards (period total cost, Δ% vs previous period), cost-by-cluster chart, daily trend. No node counts here — pair with §3.1 for nodes.

### 3.3 `GET /v1/cost-reports/organization/clusters/efficiency` — `ClusterReportAPI_GetOrganizationClustersEfficiencySummary`
- REQ `startTime`, `endTime`; opt `page.*`, `sort.*`, `useListingPrices`. **Cursor-paginated**, one row per cluster.
- Response `items[]{clusterId, wasted{cpu, ram, storage} (doubles, USD), onDemandResources{cpuResources{provisioned,requested,used,overprovisionedPercent}, ramResources{...}}, spotResources{...}, fallbackResources{...}, storageResources{...}, cpuCost{cost, perUnitProvisioned, perUnitRequested, perUnitUsed}, ramCost{...}, storageCost{...}, cpuOverprovisionedPercent, ramOverprovisionedPercent, storageOverprovisionedPercent}`; `nextCursor`, `count`.
- Feeds: waste leaderboard, "overprovisioned %" columns — join on `clusterId`.

### 3.4 `GET /v1/cost-reports/organization/efficiency` (+ `/efficiency/summary`) — `ClusterReportAPI_GetOrganizationEfficiencyReport` / `...Summary`
- REQ `startTime`, `endTime`; opt `stepSeconds`, `useListingPrices`. No pagination.
- `efficiency` → series `items[]{timestamp, cpuResources{...}, cpuCost{...}, ramResources, ramCost, storageResources, storageCost, onDemand, spot, fallback}`.
- `efficiency/summary` → rollup: `cpuResources{provisioned, requested, used, overprovisionedPercent}`, `cpuCost{cost, perUnitProvisioned/Requested/Used}`, RAM analog, storage (`claimed`), `totalWaste` (double USD).
- Feeds: org efficiency KPI (used/requested/provisioned donut), total-waste card, trend chart.

### 3.5 `GET /v1/cost-reports/organization/daily-cost` — `ClusterReportAPI_GetClustersCostReport`
- REQ `startTime`, `endTime`; opt `useListingPrices`. `items[]{clusterId, intervals[]}` — per-cluster daily series. Feeds stacked-area cost by cluster.

### 3.6 `GET /v1/cost-reports/organization/overview` — `OrganizationOverviewAPI_GetOrganizationOverview`
- REQ `startTime`, `endTime`. One-call org overview merging agent / cloud-connect / snapshot sources.
- Response: `clusters[]{clusterId, clusterName, provider, region, kubernetesVersion, status, state, nodeCount, podCount, spotNodeCount, onDemandNodeCount, cpuProvisioned/Requested, ramProvisioned/Requested, avgCpuUtilization, avgRamUtilization, costHourly, spotCostHourly, onDemandCostHourly, optimalCostHourly, gpuProvisioned, sources[], primarySource}`; `latestSyncTime`; `agent{summary{totalClusters, totalNodes, avgCpu/RamUtilization, totalCostHourly, totalCpu/Ram/GpuProvisioned, spot/onDemandNodeCount, spot/onDemandCostHourly, providers, rightsizedCostHourly, potentialSavingsHourly, bySource}, resourceTimeseries[]}` + same under `agentless`.
- Feeds: KPI strip + cluster table in one call **when coverage allows**; `potentialSavingsHourly` = estimated-savings KPI (see §12a). Caveat: rows may exist with only `agentless`/cloud data; check `sources`/`primarySource` and `noDataReason`-style gaps.

### 3.7 `GET /v1/cost-reports/organization/cost-comparison` — `PlatformImpactReportAPI_GetCostComparisonReport`
- REQ `startTimeA`, `startTimeB`; opt `rangeDays`, `clusterIds` (array; empty=all). Response `summary{savingsPer*(*|Percent), workloadOptimizationSavings, clusterGrowthRate, workloadGrowthRate, workloadOptimizationEnabledDate}`, full `periodA{}`/`periodB{}` blocks with series. Feeds platform-impact page. **clusterIds[] filter = batch aggregation without per-cluster calls.**

### 3.8 `GET /v1/cost-reports/organization/workload-event-metrics` — `WorkloadReportAPI_GetOrganizationWorkloadEventMetrics`
- REQ `startTime`, `endTime`; opt `stepSeconds`, `eventTypes[]` (k8s reasons e.g. `OOMKilled`), `groupByManagedBy`, `timeZone`. Response `series[]{eventType, items[], managedBy}`. Org-wide event/OOM timeline.

### 3.9 Tier-1 aggregation helpers (read-type POST + allocation groups) — requested by Performance agent
- **`POST /v1/cost-reports/clusters/active`** — `ClusterReportAPI_GetActiveClusters` — stable, READ-SEMANTICS POST. Body `{startTime(date-time), endTime, timeZone}` → `{clusterIds[]}`. **Batch metrics-existence filter: call once per org before any per-cluster fan-out to skip clusters with no metrics in the window** (saves calls and avoids empty/404 responses).
- **`GET /v1/cost-reports/allocation-group-summaries`** — `AllocationGroupAPI_GetAllocationGroupCostSummaries` — stable. REQ `startTime`, `endTime`; opt **`clusterIds[]` (array — empty = full list)**, `groupId`, `useListingPrices`, `includeIdleResourceCosts`. Response `items[]{groupName, groupId, summary{...}, versions[]}`. Candidate for batch cost aggregation over cluster sets.
- **`GET /v1/cost-reports/allocation-group-totals`** — `AllocationGroupAPI_GetAllocationGroupTotalCostTimed` — stable. REQ `startTime`, `endTime`; opt **`clusterIds[]`**, `page.limit`, `page.cursor`, `useListingPrices`, `includeIdleResourceCosts`. Response `items[]{groupName, groupId, items[] (timed totals), versions[]}`, `nextCursor`, `count`. Timed total-cost series over arbitrary cluster subsets.
- Supporting: `GET /v1/cost-reports/allocation-groups` (list groups), `GET /v1/cost-reports/allocation-groups/{id}`, `GET /v1/cost-reports/allocation-group-costs`. **Caveat:** allocation groups are user-defined objects; `clusterIds[]` on summaries/totals works without pre-created groups (empty groupId = full list), making these usable as generic batch-cost endpoints — validate behavior on first live call.
- GPU family (if needed later): `POST /v1/cost-reports/workloads/gpu-report|gpu-summary|gpu-utilization|gpu-wasted-cost`, `POST /v1/cost-reports/workloads/metadata`; label facets `POST /v1/cost-reports/node-labels/{names,values}`, `POST /v1/cost-reports/workload-labels/{names,values}`, `POST /v1/cost-reports/namespaces`.

---

## 4. Cluster-level cost reporting (`/v1/cost-reports/clusters/{clusterId}/*`)
All OrgHdr: **Yes** (header carries child org; `clusterId` is globally unique). All stable. Lazy-load per selected cluster — **never sweep all endpoints × 1k clusters on page load**.

| Endpoint (GET) | operationId | Params (REQ bold) | Key response fields | Feeds |
|---|---|---|---|---|
| `/overview` | `ClusterReportAPI_GetClusterOverview` | **startTime, endTime**; stepSeconds, useListingPrices | `clusterName, provider, region, kubernetesVersion, status, state, cpu/ram Provisioned+Requested, avgCpu/RamUtilization, costHourly, optimalCostHourly, sources[], agent{summary{totalNodes, spot/onDemandNodeCount, rightsizedCostHourly, potentialSavingsHourly, ALB metrics...}, resourceTimeseries[]}, agentless{...}` | Drill-down header + utilization tab |
| `/summary` | `ClusterReportAPI_GetClusterSummary` | useListingPrices | per-offering node counts + CPU/RAM provisioned/allocatable/requested, `podCount`, `unschedulablePodCount`, `costHourly*`, `nodesSummaries[]` | Composition tab |
| `/resource-usage` | `ClusterReportAPI_GetClusterResourceUsage` | **startTime, endTime**; stepSeconds | series `{timestamp, cpu/ram Provisioned/Requested/Used, gpu*, storage*}` | Usage-over-time charts |
| `/cost` | `ClusterReportAPI_GetClusterCostReport` | **startTime, endTime**; stepSeconds, useListingPrices | per-offering cost/count series + `summary{totalCost, avg*, totals per offering}` | Cost tab |
| `/efficiency` | `ClusterReportAPI_GetClusterEfficiencyReport` | **startTime, endTime**; stepSeconds, useListingPrices | overprovisioning series + `summary{*OverprovisioningPercent, costPerCpu/Ram/Storage*}` + `current{...}` | Efficiency tab |
| `/cost-anomalies` | (same API) | time range | detected cost anomalies | Alerts tab (optional) |
| `/node-templates` | — | — | node template report | Config tab (optional) |
| `/nodes/storage` | — | — | per-node ephemeral storage metrics | Nodes tab (optional) |

---

## 5. Savings — realized vs estimated (answers §12a)

**REALIZED savings (actually achieved, over a window):**
### 5.1 `GET /v1/cost-reports/clusters/{clusterId}/savings` — `ClusterReportAPI_GetClusterSavingsReport` — stable
- REQ `startTime`, `endTime`; opt `stepSeconds`, `useListingPrices`. Response `items[]{timestamp, downscalingSavings, spotSavings}` + `summary{totalCost, totalSavings}` (USD). **This is the only realized-savings endpoint; it is per-cluster — no org-level equivalent.** Org-wide realized KPI = sum over clusters (background job, pre-filter via §3.9 `clusters/active`), or use §3.6 overview as estimated proxy.

**ESTIMATED / potential savings (modeled, current-state or simulated):**
### 5.2 `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings` — `ClusterReportAPI_GetSavingsRecommendation`
- No params besides path. Point-in-time evaluation of current state. Response `recommendations`, `currentConfiguration{nodes[]{instanceType, cpuCores, ramBytes, gpu, price, cpuPrice, ramPrice, spot, fallback, master, infra, nodeName, az, os}, totalPrice{hourly, monthly}, workloads[]{ownerType, replicas, currentNodes, currentNodeType, recommendedNodeType, workloadName/Namespace/Type}, provisionedStorageBytes}`, `lastUpdatedAt`, `isRebalancingRecommended`. On-demand per-cluster only.

### 5.3 `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings-history` — `ClusterReportAPI_GetClusterCostHistory`
- REQ `fromDate`, `toDate`; opt `useListingPrices`. `items[]{createdAt, current, optimizedSpotInstances, optimizedLayman, optimizedSpotOnly}` — real vs modeled-optimal series.

### 5.4 `GET /v1/cost-reports/clusters/{clusterId}/rightsizing-summary` — `ClusterReportAPI_GetRightsizingSummary`
- No params. `rightsizingRecommendation{summary{cpuCoresDifference, ramBytesDifference, efficiency, cpuEfficiency, memoryEfficiency}}` — workload rightsizing potential.

### 5.5 Org-level estimated-savings fields (cheap proxies)
- `organization/overview` (§3.6): per-cluster + summary `optimalCostHourly`, `rightsizedCostHourly`, **`potentialSavingsHourly`** = estimated, not realized.
- `organization/cost-comparison` (§3.7): `workloadOptimizationSavings`, `savingsPer*` = modeled platform-impact metrics.

### 5.6 Deprecated savings traps (do NOT use)
`GET /v1/savings/commitments`, `GET|POST /v1/savings/assignments`, all `/v1/organizations[/…]/reservations*` — `deprecated: true` in spec. Optional read-only commitment coverage: `GET /savings/v1beta/organizations/{organizationId}/commitments/{commitmentId}:getUsageHistory` (v1beta). All other `/savings/*` verbs are writes.

---

## 6. Nodes & health (all stable)

| Endpoint | operationId | Notes |
|---|---|---|
| `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` | `ExternalClusterAPI_ListNodes` | §2.3 — node table (paginated, filterable). |
| `GET /v1/kubernetes/external-clusters/{clusterId}/nodes/{nodeId}` | `ExternalClusterAPI_GetNode` | Single-node detail. |
| `GET /v1/kubernetes/clusters/{clusterId}/problematic-nodes` | `AutoscalerAPI_GetProblematicNodes` | `{nodes[]{nodeId, name, problems[]}, hasProblems}` — fleet health flag. |
| `GET /v1/kubernetes/clusters/{clusterId}/problematic-workloads` | `AutoscalerAPI_GetProblematicWorkloads` | opt `aggressiveMode`; `{controllers[]{name,kind,problems[]}, standalonePods[], hasProblems}`. |
| `GET /v1/kubernetes/clusters/{clusterId}/unscheduled-pods` | `ClusterReportAPI_GetClusterUnscheduledPods` | `items[]{name, namespace, type, unscheduledPods}` — pending-pods KPI. |
| `GET /v1/pricing/clusters/{clusterId}/nodes` | `PricingAPI_GetPricingForClusterNodes` | opt `nodeIds[]`, `pricingAsOf`, `pricingPeriod.startTime/endTime`; `nodes[]{id, name, provider, region, basePrice, totalRegularPrice, discounts[], totalPrice, components[], pricingPeriod}` (USD). |
| `GET /v1/pricing/nodes` | `PricingAPI_GetPricingForOrganizationNodes` | Org-wide node pricing by `nodeIds[]` or all. OrgHdr: Yes. |
| `GET /v1/cost-reports/clusters/{clusterId}/node-count-history` | `ClusterReportAPI_GetClusterNodeCountHistory` | **startTime, endTime**; stepSeconds, timeZone. `items[]{timestamp, nodeCountOnDemand/Spot/Fallback/Unknown, source}` — agent+cloud merged server-side, agent wins. |
| `GET /v1/cost-reports/idle-resources/disks` | `IdleResourcesAPI_ListIdleDisks` | Cursor-paginated; `idleDisks[]{name, cloud, region, zone, project, lastAttach/Detach, type, status, storageSizeBytes, storageCostMonthly}`. Org-scope waste tab. |

---

## 7. Autoscaling

### 7.1 Node autoscaler
- `GET /v1/kubernetes/clusters/{clusterId}/policies` — `PoliciesAPI_GetClusterPolicies` — stable. Response: `enabled`, `unschedulablePods{enabled, headroom{cpuPercentage,memoryPercentage,enabled}, headroomSpot{...}, nodeConstraints{minCpuCores,maxCpuCores,minRamMib,maxRamMib,enabled}, podPinner{enabled,status}, diskGibToCpuRatio, customInstancesEnabled}`, `clusterLimits{enabled, cpu{minCores,maxCores}}`, `spotInstances{enabled, maxReclaimRate, spotBackups{...}, spotDiversityEnabled, spotDiversityPriceIncreaseLimitPercent, spotInterruptionPredictions{enabled,type}}`, `nodeDownscaler{enabled, emptyNodes{enabled,delaySeconds}, evictor{enabled, dryRun, aggressiveMode, scopedMode, cycleInterval, status, nodeGracePeriodMinutes, ignorePodDisruptionBudgets, cleanupKarpenterNodes, softTainting, ...}}`, `isScopedMode`, `nodeTemplatesPartialMatchingEnabled`, `defaultNodeTemplateVersion`. **Per-cluster only — no org/list-level equivalent (see §12e).** (PUT exists — never call.)
- `GET /v1/kubernetes/clusters/{clusterId}/agent-status` — `ClusterReportAPI_GetClusterAgentStatus` — stable. `statuses[]{name, status, totalPods, runningPods, totalRestarts, lastRestartTime, nonRunningPodNames}` — per castware component health.

### 7.2 Workload Autoscaler (WOOP) — current family `/v1/workload-autoscaling/*` (all stable)
- **`GET /v1/workload-autoscaling/organizations/{organizationId}/components/workload-autoscaler`** — `WorkloadOptimizationAPI_GetOrganizationAgentStatuses` — **ORG-LEVEL LIST: all clusters' WA agent status in ONE call per org.** `clusterAgentStatuses[]{clusterId, status, currentVersion, latestVersion, castAgentCurrentVersion, inPlaceResizeEnabled, installedAt, updatedAt, workloadAutoscalerReplicaCount, resourceQuotasAffectingOptimization, psiMetricsSupported, hpaSupportedFromCastAgentVersion, nativeHpaSupportedFromVersion, hpaConvertersSupportedFromVersion, metricsExporterVersion}`. Feeds fleet WA coverage/version-drift columns.
- `GET /v1/workload-autoscaling/clusters/{clusterId}/components/workload-autoscaler` — `GetAgentStatus` — single-cluster variant (same fields).
- `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads` — `ListWorkloads` — **cursor-paginated**, sortable; filters `workloadIds/Names[]`, `namespaces[]`, `scalingPolicyNames[]`, `kinds[]`, `managementOptions[]`, `configuredBy[]`, `searchQuery`, `recommendationStatusType` (`STATUS_UNKNOWN|WAITING|APPLIED|STOPPED`), `recommendationIsLowConfidence`, `workloadHasError`, `workloadHasCustomMetrics`, `anyContainerWithRuntime` (`RUNTIME_UNSPECIFIED|JVM|GPU`). Items: `id, name, namespace, kind, labels, annotations, podCount, matchingPodCount, scaledPodCount, replicas, scalingPolicyId/Name/Origin, suggestedScalingPolicyId/Name, recommendation{...}, workloadOverrides, workloadConfigV2, containers[], managedBy, hasNativeHpa, error/errorTitle, createdAt/updatedAt`.
- `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary` — `GetWorkloadsSummary` — opt `includeCosts`. `totalCount, optimizedCount, hpaOptimizedCount, vpaOptimizedCount, hpaVpaOptimizedCount, apiManagedCount, annotationManagedCount, recommendedCpuCores vs requestedCpuCores, cpuCoresDifference, recommendedMemory vs requestedMemory, memoryDifference, costsPerHour{requested, recommended, originalRequested} (USD/hr), usageCpuCores, usageMemoryGibs`. **Best per-cluster WA KPI call.**
- `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads-summary-metrics` — `GetWorkloadsSummaryMetrics` — opt `fromTime`, `toTime`. Series `{timestamp, cpuRequestCores, cpuRecommendationCores, cpuUsageCores, memory*Gibs, *OriginalRequest*, *FirstSeenRequest*}`.
- `GET /v1/workload-autoscaling/clusters/{clusterId}/policies` — `ListWorkloadScalingPolicies` — `items[]{id, name, isDefault, isReadonly, applyType, assignmentRules, recommendationPolicies{...}, hpaSettings, isCastware, isOpsPilot, hasWorkloadsConfiguredByAnnotations}`.
- `GET /v1/workload-autoscaling/clusters/{clusterId}/workloads/{workloadId}` (+ `/spec`, `/native-vpa-spec`, `/recommendation-manifest`, `/gpu-metrics`) — workload drill-down.
- `GET /v1/workload-autoscaling/clusters/{clusterId}/workload-events` (+`/{eventId}`, `/workload-events-summary`) — events; summary gives `totalCount`, `items[]{type, count, percent}` (opt `fromDate/toDate`, workload filters, `type[]`).
- Mixed maturity extras: `POST /v1alpha/workload-autoscaling/clusters/{id}/workloads/metrics:query`, `GET /v1beta/workload-autoscaling/clusters/{id}/hpas:analyze`, `/v1beta/.../custom-metrics*`, `/v2/...` workload PATCH/PUT (**writes — never call**).

---

## 8. Workload cost, efficiency, events, notifications

### 8.1 `POST /v1/cost-reports/clusters/{clusterId}/workload-cost-summaries` — `WorkloadReportAPI_GetWorkloadCostSummaries` — stable (read-type POST)
- REQ `startTime`, `endTime`; opt `page.*`, `sort.*`, `labelsToInclude[]`, `useListingPrices`, `includeIdleResourceCosts`. Body filter `{labels[]{label,value}, labelsOperator, workloadNames[], workloadTypes[], namespaces[]}`.
- Response `items[]{workloadName, workloadType, namespace, cost(per-offering), labels[]}`, `nextCursor`, `count`, `noDataReason`, `previousPeriodStart/End`. **Top-N workloads by cost** (paginated).

### 8.2 `GET|POST /v1/cost-reports/clusters/{clusterId}/workload-efficiency` — `WorkloadReportAPI_GetClusterWorkloadEfficiencyReport`
- REQ `startTime`, `endTime`; opt `filter.workloadNames[]`, `filter.workloadTypes[]`, `filter.namespaces[]`, `filter.labelsOperator` (`OR|AND`), `page.*`, `sort.*`, `useListingPrices`.
- Response `items[]{workloadName, workloadType, namespace, requests{...}, usage{...}, waste{...}, costImpact{onDemand/spot/spotFallback}, totalCostImpact}`, `topItems[]{..., costImpactHistory[]}`, `metricsServerAvailable`, `noDataReason`, cursor fields. Workload waste table.

### 8.3 `POST /v1/cost-reports/clusters/{clusterId}/namespace-cost-summaries` — `NamespaceReportAPI_GetClusterNamespaceCostReportSummaries`
- REQ `startTime`, `endTime`; opt page/sort/`useListingPrices`/`includeIdleResourceCosts`; body `{namespace}`. `items[]{namespace, cost}` + cursor. Namespace cost breakdown. (`GET .../namespaces/{namespace}` = single-namespace daily breakdown.)

### 8.4 Single-workload family (all stable, REQ time range)
- `GET .../namespaces/{ns}/{workloadType}/{workloadName}/cost` — `GetSingleWorkloadCostReport`: `costMetrics[]` series (per-offering cpu/ram/gpu/storage costs+counts, pod counts, uptime minutes) + `summary{totalCost, totalCostOnDemand/Spot/SpotFallback, totalStorageCost, avg*}` + `labels[]`.
- `GET .../efficiency` — `GetClusterWorkloadEfficiencyReportByName`: opt `includeCurrent`, `includeHistory`; `containers[]{name, current, items[]}`, `waste{cpu, memoryGib}`, `costImpact{...}`, `currentPodCount`, `metricsServerAvailable`.
- `GET .../events` — `GetSingleWorkloadEvents`: same shape as §8.5 but workload-scoped.
- Also: `/gpu-summary`, `/datatransfer-costs`, `/traffic-destinations(-histories)`.

### 8.5 `GET /v1/cost-reports/clusters/{clusterId}/workload-event-metrics` — `WorkloadReportAPI_GetClusterWorkloadEventMetrics`
- REQ `startTime`, `endTime`; opt `stepSeconds` (0=auto; 30/300/600/900/3600/86400), `eventTypes[]` (unknown ⇒ 400), `groupByManagedBy`, `timeZone`, `bucketTimestamp` (single-bucket workload breakdown). `series[]{eventType, items[], managedBy}`. §3.8 = org-wide variant.

### 8.6 Notifications — `GET /v1/notifications` — `NotificationAPI_ListNotifications` — stable
- Query: `page.*`, `sort.*`, `filter.severities[]`, `filter.isAcked`, `filter.notificationId/Name`, **`filter.clusterId` / `filter.clusterName`**, `filter.operationId/Type`, `filter.project`, `filter.isExpired`.
- Response `items[]{id, name, organizationId, severity, details, message, timestamp, createdAt, ackAt, ackedBy, isExpired, clusterMetadata{...}, operationMetadata{...}}`, `nextCursor`, `count`, **`countUnacked`**, `previousCursor`, `hasAny`.
- Feeds: per-org alerts feed, unacked badge. `GET /v1/notifications/{id}` for detail. `POST /v1/notifications/ack` — **never call**.

---

## 9. Rate-limit / call-volume implications
- Spec documents **no** limits (see §0.1). Assume per-key quotas exist; observe 429 at runtime with backoff+jitter.
- **Cheapest full-fleet sweep (SHIPPED v1 bundle, per refresh):** `GET /v1/organizations` (1) → per org: `external-clusters` (1), `organization/clusters/summary` (1), `organization/overview` (1), `organization/clusters/report` (1), WA org agent statuses (1) ⇒ **≈1 + 5×126 ≈ 631 calls/refresh**. The per-org report payloads are carried out on `FleetResult.reports` and reused for the daily-cost trend (0 additional calls). Concurrency 8, cache 15 min. (`clusters/efficiency`, `notifications`, `clusters/active` are v1-flagged/omitted at Tier-1.)
- **Per-cluster drill-down:** 5–10 calls per opened cluster, lazy per tab. Never fleet-fan-out `/estimated-savings`, `/savings`, `/nodes`, `/policies`.
- **Background aggregates:** pre-filter with `POST /v1/cost-reports/clusters/active`; batch cluster sets via `allocation-group-summaries/totals` `clusterIds[]` or `organization/cost-comparison` `clusterIds[]`.
- **Pagination at scale:** use `page.limit=500` (max per shared component) and loop `nextCursor` to exhaustion (or cap); 10k nodes ÷ 500 ≈ 20 pages per full node sweep.
- **Enterprise shortcut:** `/v1/billing/enterprise/platform-usage-detail` gives per-child usage without fan-out (feature units, not dollars).

## 10. Maturity notes
- `deprecated: true` in the families above: only §5.6, `GET /v1/kubernetes/clusters/{clusterId}/gpu-metrics-exporter-script`, and the `pod-mutations` family.
- Beta/mixed: `parentId` on org items ("beta"); `/savings/v1beta/*`, `/v1beta|v1alpha|v2/workload-autoscaling/*`; `POST /v1/cost-reports/clusters/{clusterId}/reporting-capabilities` (read-type capability probe, optional).
- Read-type POSTs documented here: `clusters/active`, `workload-cost-summaries`, `namespace-cost-summaries`, `workload-efficiency` (POST variant), `datatransfer-costs` (POST variant), GPU + label metadata POSTs. **Every other non-GET is forbidden.**

## 11. Risks & unknowns
1. Key scope (enterprise vs per-child) not yet exercised against a child org — smoke-test one read-only child call with `X-CastAI-Organization-Id` before bulk fan-out.
2. Rate limits undocumented (zero 429/Retry-After in spec) — operational discovery needed.
3. Proto3 JSON string numerics (`"123.45"`); parse defensively (`float(x) or 0`); `count` fields are `string(uint64)`.
4. `organization/overview` coverage depends on connection mode (agent vs cloud-connect vs snapshot) — expect partial rows; honor `sources`/`primarySource`/`noDataReason`.
5. `providerType` free text — normalize (EKS/GKE/AKS/OKO/OpenShift/Anywhere…).
6. Allocation-group `clusterIds[]` behavior without pre-created groups assumed from param docs — validate once live.

## 12. Definitive answers to UX agent's open questions (spec evidence)

**(a) Realized vs estimated savings.** REALIZED: `GET /v1/cost-reports/clusters/{clusterId}/savings` (`ClusterReportAPI_GetClusterSavingsReport`) — `summary.totalSavings`, `items[].downscalingSavings/spotSavings`. Per-cluster only. ESTIMATED: `.../estimated-savings` (current-state modeled optimum: `currentConfiguration.totalPrice` vs `recommendations`), `.../estimated-savings-history` (`current` vs `optimizedSpotInstances/optimizedLayman/optimizedSpotOnly`), `.../rightsizing-summary` (`rightsizingRecommendation.summary`), org `overview` (`potentialSavingsHourly`, `rightsizedCostHourly`, `optimalCostHourly`), org `cost-comparison` (`workloadOptimizationSavings`, `savingsPer*`). **UI rule: label "Savings (realized)" only for §5.1 data; everything else says "estimated/potential".**

**(b) One-row-per-cluster table source.** None of the three alone carries everything; they are complements joined on `clusterId`:
- `organization/clusters/summary` = the **base table**: node counts (OD/spot/fallback + CAST AI-managed split), pod counts, provisioned/allocatable/requested CPU+RAM+GPU+TPU per offering, `$costHourly*` per offering/resource, `cpuUsed/ramUsed`, `clusterScore`. Current snapshot, no time window, no pagination, no `clusterName`.
- `organization/clusters/efficiency` = adds **efficiency/waste columns** (`wasted{cpu,ram,storage}`, `*OverprovisionedPercent`), period-based, paginated.
- `organization/clusters/report` = adds **period cost + Δ% + `clusterName`** (no node counts).
Recommended composition: `summary` × `efficiency` × `report` joined client-side on `clusterId` (+ `external-clusters` for name/provider/region/status).

**(c) Is `/v1/billing/enterprise/platform-usage-report` usable as enterprise-level money aggregation?** **No.** It reports **feature/license consumption** (`features[]{feature, usage, unit, credits{...}}` — e.g. `phase2`/`woop` units and credits) for the current month, and `platform-usage-detail` breaks that down per child org (`entities[]`). It answers "how much of each CAST AI feature is being consumed," not "what do clusters cost." Keep per-org `cost-reports` fan-out for dollars; use billing endpoints for entitlement/license KPIs only.

**(d) Pagination of `GET /v1/organizations` and `GET /v1/kubernetes/external-clusters`.** **Both are UNPAGINATED: zero parameters, no envelope cursors.** `GET /v1/organizations` declares no params; response is `{organizations[]}` with no cursor field. `GET /v1/kubernetes/external-clusters` declares no params; response is `{items[]}` with no `nextCursor`. Full lists per call — safe at 129 orgs / up to ~1k clusters per org; still cache and handle large bodies.

**(e) List-level automation/WA/node-autoscaler status for table columns.**
- **Agent connectivity: LIST-LEVEL YES** — `agentStatus` + `status` (warning ⇒ autoscaler halted) are fields on every cluster object from `GET /v1/kubernetes/external-clusters` (one call/org). Column ships.
- **Workload Autoscaler status: ORG-LEVEL LIST YES** — `GET /v1/workload-autoscaling/organizations/{organizationId}/components/workload-autoscaler` returns per-cluster `clusterAgentStatuses[]` (status, versions, inPlaceResizeEnabled) in **one call per org**. Column ships (join on `clusterId`).
- **Node-autoscaler config/enabled: PER-CLUSTER ONLY** — `enabled`, spot/evictor settings live in `GET /v1/kubernetes/clusters/{clusterId}/policies` (per-cluster, unpaginated). No org-level or list-field equivalent exists in the spec; proxies `status!=warning/failed` and `isPhase2` exist in the cluster list but are NOT the enabled flag. Ship this column as lazy per-cluster calls (drill-down or background top-N only), otherwise **N/A at table level**.
