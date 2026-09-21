# CAST AI API — v2 DELTA Matrix (expansion families + v1 revalidation)

**Source of truth:** `docs/openapi/castai-openapi.json` — OpenAPI 3.0.1, **423 paths / 522 operations** (matches v1 snapshot, re-verified 2026-09-21 programmatically; spec unchanged since v1 snapshot).
**Scope:** v2 expansion families only. v1 coverage (`docs/api-matrix.md`) stands unless a correction is listed in §4.
**Posture:** READ-ONLY (GET family below + the pre-approved read-type POST query endpoints from v1; no new POST approved by this delta).

**Legend**
- *OrgHdr* = send `X-CastAI-Organization-Id: <child-org-id>` when using an enterprise-scoped key (per v1 §0; the header itself is not declared in the spec).
- *EXACT* = endpoint exists with verified path/method/params/schema. *PARTIAL* = exists but cannot fully serve the requested data. *MISSING* = no such endpoint in the 423-path snapshot (never assumed).
- Money = USD; `$/hr` hourly strings (proto3). CPU = cores unless `*Milli`; RAM = GiB (`*Gib*`) or bytes (`*Bytes`); storage = GiB or bytes per suffix; `*Percent` = double 0–100.

---

## 1. TASK 1 — v1 revalidation (12 load-bearing endpoints): **12/12 PASS — zero drift**

| # | Path | Result |
|---|------|--------|
| 1 | `GET /v1/organizations` | OK — `UsersAPI_ListOrganizations`, no params, stable |
| 2 | `GET /v1/kubernetes/external-clusters` | OK — `ExternalClusterAPI_ListClusters`, no params, stable |
| 3 | `GET /v1/cost-reports/organization/clusters/summary` | OK — opt `useListingPrices`; no required params |
| 4 | `GET /v1/cost-reports/organization/clusters/report` | OK — REQ `startTime`,`endTime`; opt `useListingPrices` |
| 5 | `GET /v1/cost-reports/organization/clusters/efficiency` | OK — REQ `startTime`,`endTime`; +`page.*`,`sort.*` |
| 6 | `GET /v1/cost-reports/organization/overview` | OK — REQ `startTime`,`endTime` only |
| 7 | `GET /v1/workload-autoscaling/organizations/{organizationId}/components/workload-autoscaler` | OK — `GetOrganizationAgentStatuses`, no params, stable |
| 8 | `GET /v1/kubernetes/external-clusters/{clusterId}/nodes` | OK — 15 opt query params as v1-documented |
| 9 | `GET /v1/kubernetes/clusters/{clusterId}/policies` | OK — no params, stable |
| 10 | `GET /v1/kubernetes/clusters/{clusterId}/agent-status` | OK — no params, stable |
| 11 | `GET /v1/cost-reports/clusters/{clusterId}/savings` | OK — REQ `startTime`,`endTime`; opt `stepSeconds`,`useListingPrices`, stable |
| 12 | `GET /v1/cost-reports/clusters/{clusterId}/estimated-savings` | OK — `GetSavingsRecommendation`, path param only, stable |

None deprecated; operationIds identical to v1 matrix. **No implementation change forced by Task 1.**

---

## 2. TASK 2 — v2 family matrix

### a. Realized savings — **EXACT** (per-cluster only)

| Feature family | Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|---|
| Realized savings | `/v1/cost-reports/clusters/{clusterId}/savings` | GET | Cluster; OrgHdr Yes | `items[]{timestamp, downscalingSavings(string USD/interval), spotSavings(USD)}`, `summary{totalCost, totalSavings}` (both string USD over window) + `clusterId`. **No downscaling+spot subtotal field — totalSavings is the combined figure.** | none | REQ `startTime`,`endTime` (RFC3339); opt `stepSeconds` (int32), `useListingPrices` | stable | Cluster drill-down Savings tab: realized-savings KPI + downscaling-vs-spot stacked chart | 30 min |
| Org realized savings | — | — | — | **MISSING** — no org-level realized-savings endpoint (reconfirmed v2). Enterprise KPI must stay N/A/estimated at Tier-1 (architecture §9.5 stands). Background roll-up = §3.9 `clusters/active` pre-filter + per-cluster `/savings` sum. | | | | | |

### b. Estimated savings history — **EXACT**

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/cost-reports/clusters/{clusterId}/estimated-savings-history` | GET | Cluster; OrgHdr Yes | `clusterId` + `items[]{createdAt(ts), current, optimizedSpotInstances, optimizedLayman, optimizedSpotOnly}` — each block `{costPerHour (double USD/hr), totalNodeCount, spotNodeCount, totalCpu (cores), spotCpu, totalRamGib, spotRamGib}` — all doubles | none | **REQ `fromDate`, `toDate`** (date-time format, NOT date-only); opt `useListingPrices` | stable | Savings tab: current-vs-3-modeled-optima time series | 6 h (history) |

Snapshots appear event-driven (agent-reported), interval between `createdAt` points is not guaranteed — chart as scatter/line, not fixed-step.

### c. Organization efficiency incl. STORAGE and WASTE — **EXACT**

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/cost-reports/organization/efficiency` | GET | Org; OrgHdr Yes | `items[]{timestamp, cpuResources{provisioned,requested,used (cores), overprovisionedPercent}, cpuCost{cost, perUnitProvisioned/Requested/Used (USD)}, ramResources{...GiB}, ramCost{...}, storageResources{provisioned,claimed,requested (GiB), overprovisionedPercent}, storageCost{cost, perGibProvisioned/perGibClaimed/perGibRequested (USD)}, onDemand{cpu+ram res+cost}, spot{...}, fallback{...}}` | none | REQ `startTime`,`endTime`; opt `stepSeconds`, `useListingPrices` | stable | Org efficiency trend chart per offering | 30 min |
| `/v1/cost-reports/organization/efficiency/summary` | GET | Org; OrgHdr Yes | Flat rollup: `cpuResources`, `cpuCost`, `ramResources`, `ramCost`, `storageResources{provisioned, claimed, requested, overprovisionedPercent}`, `storageCost{cost, perGib*}`, **`totalWaste (double USD)`** — `totalWaste` exists ONLY here (not in `/efficiency` series) | none | REQ `startTime`,`endTime`; opt `useListingPrices` | stable | Tier-1 optional flag `+efficiency/summary`: waste KPI card, overprovisioned % KPIs | 30 min |
| `/v1/cost-reports/organization/clusters/efficiency` | GET | Org; OrgHdr Yes | Per-cluster rows: `clusterId`, **`wasted{cpu, ram, storage}` (doubles USD — waste incl. storage)**, `onDemandResources/spotResources/fallbackResources{cpuResources{provisioned,requested,used,overprovisionedPercent}, ramResources{...}}`, `storageResources{...}`, `cpuCost/ramCost{cost,perUnit*}`, `storageCost{cost,perGib*}`, `cpuOverprovisionedPercent`, `ramOverprovisionedPercent`, `storageOverprovisionedPercent`; envelope `nextCursor`,`count` (string uint64) | cursor `page.limit`,`page.cursor`; `sort.field`,`sort.order` | REQ `startTime`,`endTime`; opt `useListingPrices` | stable | Waste leaderboard join (v1 §3.3) | 30 min |

### d. Workload Autoscaler detail — **EXACT** (all 3 endpoints verified)

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/workload-autoscaling/clusters/{clusterId}/workloads-summary` | GET | Cluster; OrgHdr Yes | `totalCount, optimizedCount, hpaOptimizedCount, vpaOptimizedCount, hpaVpaOptimizedCount, apiManagedCount, annotationManagedCount` (int32), `recommendedCpuCores, requestedCpuCores, cpuCoresDifference` (cores), `recommendedMemory, requestedMemory, memoryDifference`, `originalRequestedCpuCores/MemoryGibs`, `usageCpuCores, usageMemoryGibs`, **`costsPerHour{requested, recommended, originalRequested}` (USD/hr, only when `includeCosts=true`)** | none | none; opt `includeCosts` bool | stable | WA tab KPI strip (per-cluster, Tier-2) | 15 min |
| `/v1/workload-autoscaling/clusters/{clusterId}/workloads` | GET | Cluster; OrgHdr Yes | Envelope **`workloads[]` (NOT `items[]`) + `nextCursor`**. Per workload: `id, clusterId, organizationId, name, namespace, kind, version, group, isCustom, labels[], annotations[], podCount, matchingPodCount, scaledPodCount, replicas, scalingPolicyId/Name`, `scalingPolicyOrigin` ENUM `ORIGIN_UNSET|DEFAULT|ASSIGNMENT_RULES|ANNOTATIONS|API`, `suggestedScalingPolicyId/Name`, `managedBy` ENUM `API|ANNOTATIONS`, `hasNativeHpa`, `error`,`errorTitle`, `woopHpaUnsupportedReason`, `isJobLike`, `createdAt/updatedAt`; `containers[]{name, resources{limits,requests}{cpuCores,memoryGib}, recommendation{...}, originalResources{...}, firstSeenResources{...}, runtime ENUM UNSPECIFIED|JVM|GPU}`; `recommendation{confidence, replicas, estimatedThresholdReachedAt, hpaSpec{minReplicas,maxReplicas,targetCpuUtilizationPercentage,metrics[],behavior{...}, managedByCastai}, events[], deployed, origins[]}`; **`costsPerHour{requested,recommended,originalRequested}` per workload**; `recommendationStatus{type ENUM UNKNOWN|WAITING|APPLIED|STOPPED, appliedPods, totalPods, lowConfidence, stopReason{type ENUM …OOMKILL, message}, error{type,message}, earliestActiveRecommendationAt}`; `deployedRecommendation{applyType ENUM UNKNOWN|IMMEDIATE|DEFERRED}`; `hpaSpec{...}`, `hpaState{...}`, `predictionInsights{...}`, `systemOverrides{...}`, `workloadOverrides/workloadConfigV2{...}` | cursor (`page.limit` string-uint64, `page.cursor`), `sort.field`,`sort.order` | none | WA tab workloads table with recommendation columns + drill | 15 min |
| `/v1/workload-autoscaling/clusters/{clusterId}/workloads-summary-metrics` | GET | Cluster; OrgHdr Yes | `items[]{timestamp, cpuRequestCores, memoryRequestGibs, cpuOriginalRequestCores, memoryOriginalRequestGibs, cpuRecommendationCores, memoryRecommendationGibs, cpuUsageCores, memoryUsageGibs, cpuFirstSeenRequestCores, memoryFirstSeenRequestGibs}` (doubles; cores/GiB) | none | opt `fromTime`,`toTime` (date-time, both optional) | stable | WA tab request-vs-recommendation-vs-usage chart | 15 min |

Filters on `/workloads`: `workloadIds[]/workloadNames[]/namespaces[]/scalingPolicyNames[]/kinds[]/configuredBy[]` (all string[]), `managementOptions[]` ENUM `UNDEFINED|READ_ONLY|MANAGED`, `recommendationStatusType` ENUM `STATUS_UNKNOWN|STATUS_WAITING|STATUS_APPLIED|STATUS_STOPPED`, `recommendationIsLowConfidence`, `workloadHasError`, `workloadHasCustomMetrics` (bools), `anyContainerWithRuntime` ENUM `RUNTIME_UNSPECIFIED|JVM|GPU`, `searchQuery`. "Scaling mode" per workload = `managedBy` + `scalingPolicyOrigin` + `recommendationStatus.type` (+ `workloadConfigV2` for vertical/horizontal mode flags — drill on demand).

### e. Node operational state — **PARTIAL** (state fields verified; no explicit per-node managed/lifecycle flag)

`/v1/kubernetes/external-clusters/{clusterId}/nodes` — state-relevant per-node fields (exact names, identical in list and `GET .../nodes/{nodeId}`):

| Field | Type | Semantics |
|---|---|---|
| `state.phase` | string | Node provisioning/health phase. **Free string — no enum in response schema**; known values come from the request-side `nodeStatus` filter enum: `unknown, pending, creating, ready, not_ready, draining, deleting, deleted, interrupted, cordoned` |
| `unschedulable` | bool | Cordoned flag (kubectl cordon) |
| `taints[]{key,value,effect}` | array | Taints (detect e.g. eviction/spot taints by key) |
| `spotConfig{isSpot, price(string USD/hr)}` | object | Spot membership; NO separate lifecycle enum on the node — request-side `lifecycleType` filter ENUM `on_demand|fallback|spot` implies server-side classification, not echoed per node |
| `addedBy` | string | Who added the node (e.g. castai agent) — **no enum/doc; the only per-node managed-ness hint** |
| `role` | ENUM `master|worker|NODE_TYPE_MASTER|NODE_TYPE_WORKER|NODE_TYPE_INVALID` | master/worker |
| `labels{map}`, `annotations{map}` | objects | k8s labels/annotations (use castai-managed labels if present — not spec-guaranteed) |
| `resources{cpuAllocatableMilli, memAllocatableMib, cpuCapacityMilli, memCapacityMib, cpuRequestsMilli, memRequestsMib, bandwidthCapacityMbps}` | int32 | capacity/allocatable/requests |
| `instancePrice` | string USD/hr | node hourly price |
| `nodeInfo{...}`, `gpuInfo{gpuDevices[]}`, `network{publicIp,privateIp}`, `id,name,instanceId/Name,instanceType,zone,subnetId,providerId,instanceArchitecture,instanceLabels,nodeConfigurationId,createdAt,joinedAt,cloud` | | inventory |

**PARTIAL because:** no `castaiManaged`/`lifecycle`/`interrupted`/`draining` boolean fields exist per node. Derivation rules: cordon ← `unschedulable`; draining/interrupted/etc ← `state.phase` string match; spot ← `spotConfig.isSpot`; castai-managed counts only exist cluster-aggregated in §v1 3.1 (`nodeCount*Castai`), per-node managed-ness must be inferred (addedBy/labels) or joined from cluster summary — **mark derived columns "derived"**. Filters: `nodeStatus`, `lifecycleType`, `removalDisabled`, `unschedulable`(bool), `nodeTemplate*/nodeConfiguration*(Name/Version)`, `nodeId,nodeName,instanceType,zone`, `excludeDeleting`(bool), `page.*`. Cursor pagination; envelope `items[] + nextCursor`.

### f. Problematic resources — **EXACT** (+ richer unscheduled-pods than v1 documented)

| Endpoint | Method | Scope/OrgHdr | Key fields | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/kubernetes/clusters/{clusterId}/problematic-nodes` | GET | Cluster; OrgHdr Yes | `clusterId`, `nodes[]{nodeId, name, problems[] (free-text strings)}`, `hasProblems` (bool) | none | none | stable | Issues tab: node problem list + badge | 10 min |
| `/v1/kubernetes/clusters/{clusterId}/problematic-workloads` | GET | Cluster; OrgHdr Yes | `controllers[]{name, kind, problems[]}`, `standalonePods[]{name, problems[]}`, `hasProblems`; opt `aggressiveMode` (bool: excludes controllerless/job/removal-disabled pods) | none | none | stable | Issues tab: workload problems | 10 min |
| `/v1/kubernetes/clusters/{clusterId}/unscheduled-pods` | GET | Cluster; OrgHdr Yes | `items[]{name (controller), namespace, type, unscheduledPods[]{name, cpuRequested(string cores), ramRequested(string), message, events[]{message, action, reason, reportingController, firstTimestamp, lastTimestamp}}}` — **DELTA vs v1: pod-level `events[]` (k8s event reason/age) and cpu/ram request strings verified present** | none | none | stable | Issues tab: pending pods with failure reasons (e.g. insufficient cpu) | 10 min |

### g. OOM / workload event metrics — **EXACT** (two cost-report endpoints + WA event enum)

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/cost-reports/organization/workload-event-metrics` | GET | Org; OrgHdr Yes | `series[]{eventType (k8s reason string e.g. "OOMKilled"), items[]{timestamp, eventCount (string uint64), byContainer[]{container, eventCount}, byWorkload[]{workloadName, workloadType, namespace, container, eventCount}}, managedBy}` | none | REQ `startTime`,`endTime`; opt `stepSeconds` (int32; **0=auto; allowed: 30,300,600,900,3600,86400**), `groupByManagedBy`(bool), `timeZone` (IANA, default Etc/UTC) | stable | Org OOM/event timeline + top workloads by OOM | 30 min |
| `/v1/cost-reports/clusters/{clusterId}/workload-event-metrics` | GET | Cluster; OrgHdr Yes | Same series shape + `clusterId`; extra opt param `bucketTimestamp` (date-time → single-bucket workload breakdown) | none | same as org variant | stable | Cluster drill-down OOM timeline | 30 min |
| `/v1/workload-autoscaling/clusters/{clusterId}/workload-events` (+`/{eventId}`, `/workload-events-summary`) | GET | Cluster; OrgHdr Yes | WA-side lifecycle events; list cursor-paginated; summary → `totalCount`,`items[]{type,count,percent}` | cursor on list (`page.*`) | opt `fromDate`,`toDate` (date-time) + workload filters (`workloadId/Name/Namespace/Kind`) | stable | WA tab event feed | 15 min |

**Event-type typing (both families):**
- cost-reports event-metrics: `eventTypes[]` = **free-form k8s reason strings** ("OOMKilled" is the documented example) — **NOT an enum**; unknown values ⇒ **HTTP 400**. Validate against a local allow-list before sending (OOMKilled, FailedScheduling, BackOff, Killing, Evicted, …).
- WA workload-events `type[]` = **closed enum (26 values)** incl. `EVENT_TYPE_OOM_KILL`, `EVENT_TYPE_SURGE`, `EVENT_TYPE_MEMORY_PRESSURE_EVICTION`, `EVENT_TYPE_CPU_PRESSURE`, `EVENT_TYPE_HPA_MAXED_OUT`, `EVENT_TYPE_HPA_ALMOST_MAXED_OUT`, `EVENT_TYPE_UNBOUND_MEMORY_GROWTH`, `EVENT_TYPE_STARTUP_FAILURE`, `EVENT_TYPE_UNSCHEDULABLE_RECOMMENDATION`, `EVENT_TYPE_RECOMMENDED_{POD_COUNT,REQUESTS}_CHANGED`, `EVENT_TYPE_SYSTEM_OVERRIDE_{TRIGGERED,RESET}`, `EVENT_TYPE_WORKLOAD_AUTOSCALER_{INSTALLED,UNINSTALLED}`, policy CRUD events, etc.

### h. Notifications — **EXACT**

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/notifications` | GET | Org; OrgHdr Yes | `items[]{id, name, organizationId, severity ENUM UNSPECIFIED|CRITICAL|ERROR|WARNING|INFO|SUCCESS, details, message, timestamp (RFC3339), createdAt, ackAt, ackedBy, isExpired, clusterMetadata{id,name,providerType,project}, operationMetadata{id,type,category}}`; envelope `nextCursor, previousCursor, count (int32), countUnacked (int32), hasAny (bool)` | cursor (`page.limit`,`page.cursor`) + `sort.field`,`sort.order` | none (sort by `timestamp` desc) | stable | Per-org alerts feed (flagged), unacked badge, per-cluster Issues tab via `filter.clusterId` | 5 min |
| `/v1/notifications/{id}` | GET | Org; OrgHdr Yes | single notification detail | n/a | n/a | stable | alert detail drawer | 5 min |

Filters: `filter.severities[]` (same enum), `filter.isAcked`(bool), `filter.isExpired`(bool), `filter.notificationId`, `filter.notificationName`, **`filter.clusterId`**, `filter.clusterName`, `filter.operationId`, `filter.operationType`, `filter.project`. `POST /v1/notifications/ack` exists — **never call** (write). Slack/webhook config paths under `/v1/notifications/*` are write/admin — out of scope.

### i. Node count history — **EXACT**

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/cost-reports/clusters/{clusterId}/node-count-history` | GET | Cluster; OrgHdr Yes | `items[]{timestamp, nodeCountOnDemand, nodeCountSpot, nodeCountFallback, nodeCountUnknown (int64), source ENUM DATA_SOURCE_UNSPECIFIED|ONEOFF|CLOUDCONNECT|AGENT}` + `sources[]{source, firstCollectedAt, lastCollectedAt}` + `lastSnapshotAt`. Split is exactly onDemand/spot/fallback/unknown (no separate castai-managed split; see §v1-3.1 for current managed counts) | none | REQ `startTime`,`endTime`; opt `stepSeconds`, `timeZone` (IANA) | stable | Cluster drill-down nodes-over-time stacked area; source badge (agent vs cloud) | 6 h |

### j. Idle resources — **PARTIAL** (idle **disks** only; no idle CPU/RAM/idle-nodes endpoint)

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/cost-reports/idle-resources/disks` | GET | **Org scope (no clusterId anywhere)**; OrgHdr Yes | `idleDisks[]{name, integrationId, cloud ENUM aws/gcp/azure(+case variants/invalid/unknown), region, zone, project, lastAttach, lastDetach, createdAt, type, status ENUM UNSPECIFIED_DISK_STATUS|UNATTACHED, storageSizeBytes (string int64), storageCostMonthly (string USD/month)}` | **DELTA: response envelope is `nextPage{limit,cursor}` — NOT `nextCursor`** (v1 text said "cursor-paginated"; exact field name corrected here) | none | stable | Waste tab: unattached-disk list + monthly cost | 30 min |

No other `idle*` path exists in the 423-path snapshot. Idle node-resource cost is only available as `includeIdleResourceCosts=true` (fair-distribution) on cost-report endpoints, not as an idle-resource listing.

### k. Allocation groups — **EXACT** (full family verified; read the CRUD/list ops only)

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/cost-reports/allocation-groups` | GET (POST = **write, never call**) | Org; OrgHdr Yes | `items[]{id, name, filter{clusterIds[], labels[]{label,value,operator ENUM Equal|NotEqual|Exists|DoesNotExist}, namespaces[], labelsOperator ENUM OR|AND, nodeLabels[]{label,value,operator}, nodeLabelsOperator}, updatedAt}`; opt query `clusterIds[]` (empty = all) | none | none | stable | Group list for the business-dimension picker | 30 min |
| `/v1/cost-reports/allocation-groups/{id}` | GET | Org; OrgHdr Yes | same single-object shape | n/a | n/a | stable | group detail/drill | 30 min |
| `/v1/cost-reports/allocation-group-summaries` | GET | Org; OrgHdr Yes | `items[]{groupName, groupId, summary{totalCostOnDemand/Spot/SpotFallback, cpuCount, ramGib, gpuCount, tpuCount, cpuCost, ramCost, gpuCost, tpuCost, workloadCount, requestedCpuHours, requestedRamGibHours, requestedGpuHours, requestedTpuHours, requestedStorageGibHours} (numeric STRINGS), versions[]}`; opt `clusterIds[]`, `groupId`, `useListingPrices`, `includeIdleResourceCosts` | none | REQ `startTime`,`endTime` | stable | Business-unit cost table (v1 §3.9) | 30 min |
| `/v1/cost-reports/allocation-group-totals` | GET | Org; OrgHdr Yes | `items[]{groupName, groupId, items[]{totalCost(string USD), timestamp}, versions[]}` + `nextCursor`, `count`(string) | cursor `page.*` | REQ `startTime`,`endTime` | stable | Business-unit cost trend | 30 min |
| `/v1/cost-reports/allocation-group-costs` | GET | Org; OrgHdr Yes | timed variant of summaries: `items[]{groupName, groupId, items[]{...summary fields per timestamp…, timestamp}, versions[]}` | none | REQ `startTime`,`endTime` | stable | per-group cost breakdown over time | 30 min |
| `/v1/cost-reports/allocation-groups/efficiency/summary` **(delta: newly documented)** | GET | Org; OrgHdr Yes | `items[]{groupName, groupId, workloadCount, requests{cpu(string), memoryGib}, usage{...}, waste{cpu, memoryGib (strings USD? — amounts; units not annotated)}, costImpact{onDemand, spot, spotFallback}, totalCostImpact(string USD), versions[]}` + `topItems[]{..., costImpactHistory[]{timestamp, costImpact}}`; opt `clusterIds[]` | none | REQ `startTime`,`endTime` | stable | Business-unit waste ranking | 30 min |
| `/v1/cost-reports/allocation-groups/{groupId}/workload-costs` `/workload-efficiency` `/datatransfer-costs/workloads` | GET | Org; OrgHdr Yes | per-group workload breakdowns | varies | REQ window | stable | group drill | 30 min |
| `/v1/metrics/allocation-groups` **(delta: newly documented)** | GET | Org; OrgHdr Yes | **Prometheus text format** scrapable group metrics; opt `clusterIds[]` | n/a | none | stable | optional TSDB ingestion (NOT Streamlit UI) | n/a |

**Business metadata mapping:** groups have only `id`, `name`, `updatedAt` + `filter` — **no description/labels/annotations/business-metadata fields on the group object itself** (verified in both GET and create-body schemas). Mapping to business units happens through `filter.labels`/`filter.namespaces`/`filter.nodeLabels` selectors (i.e. groups select workloads by k8s labels/annotations). `clusterIds[]` on the report endpoints works as cluster-set filtering independent of group membership (param doc: "Leave empty for the full list"). There is **no `/v1/allocation-groups` family** outside `/v1/cost-reports/*` and `/v1/metrics/allocation-groups`.

### l. Node pricing per cluster — **EXACT**

| Endpoint | Method | Scope/OrgHdr | Key fields + units | Pagination | Time params | Stability | Dashboard use | Cache TTL |
|---|---|---|---|---|---|---|---|---|
| `/v1/pricing/clusters/{clusterId}/nodes` | GET | Cluster; OrgHdr Yes | `nodes[]{id, name, provider, region, basePrice (string USD/hr), totalRegularPrice, totalPrice (discounted USD/hr), discounts[]{type, amount, commitment{id}, discount{id}}, components[]{type ENUM CPU|MEMORY|GPU|EXTENDED_MEMORY|TPU, amount, unit ENUM COUNT|MIB|GIB|MILLI_COUNT, price{unit, basePricePerUnit, totalPricePerUnit}, gpu{name}, tpu{name}}, extensions[]{type ENUM LOCAL_SSD|GPU, price, localSsd{sizeGib}, gpu{manufacturer,name,count,countUnit}}, pricingPeriod{startTime,endTime}}` | none | opt `nodeIds[]`, `pricingAsOf` (date-time), `pricingPeriod.startTime/endTime` | stable | Nodes-tab per-node cost attribution column (join on node `id`) | 30 min |
| `/v1/pricing/clusters/{clusterId}/nodes/{nodeId}` | GET | Cluster; OrgHdr Yes | single-node pricing | n/a | same | stable | node detail drawer | 30 min |
| `/v1/pricing/nodes` | GET | **Org scope**; OrgHdr Yes | org-wide node pricing (opt `nodeIds[]`; empty = all) | none | same | stable | optional fleet pricing pull | 30 min |

### m. Storage — **EXACT** (complete field inventory)

Cluster/node storage usage lives in exactly these spec locations:
1. `GET /v1/cost-reports/clusters/{clusterId}/nodes/storage` — per-node **ephemeral-storage**: `nodes[]{nodeName, allocatableBytes, usedBytes, requestedBytes, totalBytes}` (string int64 bytes, no time window — point-in-time), stable — **nodes-tab storage column**.
2. Org fleet: `organization/clusters/summary` → `storageProvisioned/Requested/Claimed`, `storageCostHourly` (per cluster); `organization/clusters/report` → `clusters[].summary.storage*`; `organization/efficiency(+summary)` → `storageResources{provisioned,claimed,requested,overprovisionedPercent}` + `storageCost{cost,perGib*}` (§2c).
3. Cluster reports: `resource-usage` → `items[].storage{Claimed,Provisioned,Requested}`; `cost` → `storageGib/storageCost/totalStorageCost`; `efficiency` → `storage*Gib`, `storageOverprovisioning(Percent)`, `costPerStorageGib*`; `summary` → `storage{Claimed,Provisioned,Requested}`, `storageCostHourly`.
4. Overview (agent/agentless `resourceTimeseries[]` → `storage{Claimed,Provisioned,Requested}Gib`; **DELTA: org `overview` `clusters[].sourceData[].agentMetrics` also carries `storage{Provisioned,Requested,Claimed}`** when data source = agent).
5. Idle disks → `storageSizeBytes`, `storageCostMonthly` (§2j). Estimated-savings → `currentConfiguration.provisionedStorageBytes`. Allocation groups → `requestedStorageGibHours`.
6. GPU/instance-family storage metadata (instance types `storageInfo`, block-storage limits) exists under reservations/inventory — not dashboard-dashboard grade.

---

## 3. TASK 3 — rate limits re-scan

- **Zero `429` response codes, zero `Retry-After` headers, zero header parameters** declared anywhere in the snapshot (response codes present: 200/201/202/204/302/400/401/404/500; `components.headers` empty).
- The only `rateLimit` strings (8) belong to **`aioptimizer.v1` LLM/AI-optimizer domain schemas** (model rate limiting for CAST AI's LLM product — `ModelRateLimit`, `isRateLimited`, `RateLimitConfig`) — unrelated to management-API quotas.
- One "too many" string lives in `ERROR_IMMEDIATE_APPLY_BLOCKED` (workload-autoscaler immediate-apply circuit breaker) — unrelated.
- **Conclusion: unchanged from v1.** Rate limits remain undocumented → keep shipped posture (8 workers, exp backoff honoring any Retry-After, treat 429 adaptively if observed).

---

## 4. Corrections / deltas vs v1 `api-matrix.md` (apply these when editing v1 docs later)

1. **idle-resources/disks pagination field**: response carries `nextPage{limit, cursor}`, not `nextCursor` (v1 §6 text was generic).
2. **unscheduled-pods schema is richer** than v1 row: pod-level `events[]{reason, message, firstTimestamp, lastTimestamp}`, `cpuRequested`, `ramRequested` (§2f).
3. **org `overview` has `clusters[].sourceData[]`** (`info{source, first/lastCollectedAt}`, `cloudMetrics{...}`, `agentMetrics{cpu/ram/gpu/storage/costHourly}`) + cluster-level `slo` and ALB metrics (`albRequestCount, alb5xxCount, albTarget5xxCount, albTargetResponseTimeP50/P95/P99, albHealthyHostCount, albUnhealthyHostCount`) — not in v1 §3.6 field list.
4. **page.limit max not documented**: this snapshot contains no 1–500 range text for `page.limit` anywhere (v1 §0.1 claimed "shared component documents 1–500"). Treat 500 as an operational choice, not a spec contract.
5. **`/workloads` envelope is `workloads[]`, not `items[]`** (v1 §7.2 said "Items:") — normalizer must read `workloads`.
6. **Newly documented for the dashboard**: `allocation-groups/efficiency/summary`, `/v1/metrics/allocation-groups` (Prometheus), `/pricing/nodes` org variant, per-workload `costsPerHour`/`hpaSpec`/`recommendationStatus` details, WA workload-events 26-value enum (`EVENT_TYPE_OOM_KILL`), event-metrics `byContainer/byWorkload` splits + `bucketTimestamp`.
7. All 31 v2-family paths re-checked: **none deprecated**; only v1-known deprecations remain (`/v1/savings/*`, reservations, pod-mutations, gpu-metrics-exporter-script).

---

## 5. v2 endpoint inventory used by this delta (31 GET paths — all stable)

Total verified GET endpoints this round: 31 (listed inline above with operationIds). All schemas extracted via `tmp_agent2/spec_tool.py` from the local snapshot; no live API calls were made (spec-only verification; live smoke deferred to integration workstream).
