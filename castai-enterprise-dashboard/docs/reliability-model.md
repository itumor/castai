# CAST AI Enterprise Dashboard — Reliability / Issues Model (v2)

Agent 7 deliverable. Every field mapping below cites the OpenAPI snapshot
`docs/openapi/castai-openapi.json` (schema name / operation param). Baseline
fleet (docs/baseline-fleet.csv, 2026-09-21): **241 clusters / 57 orgs / 3,542
nodes / 198 agent-online / 43 partial-disconnected.** Largest cluster = 326
nodes ⇒ every nodes fetch fits ONE page at `page.limit=500` today.

---

## 1. Node state breakdown

### 1.1 What the node object really carries (`externalcluster.v1.Node`)

| Field | Type | Notes |
|---|---|---|
| `state.phase` | string (free) | Provisioning/lifecycle phase. Authoritative value set = the `nodeStatus` **filter enum** on the same op: `node_status_unspecified, unknown, pending, creating, ready, not_ready, draining, deleting, deleted, interrupted, cordoned` |
| `unschedulable` | bool | k8s cordon flag — independent of `phase` |
| `taints[]` | `{key,value,effect}` | No semantic enum |
| `role` | enum `master/worker` (+INVALID) | Not a health signal |
| `spotConfig.isSpot` | bool | Only node-level "lifecycle" signal — **no `lifecycle` field on Node** (`lifecycleType` is a filter param only); fallback is NOT derivable per node |
| `addedBy` | string, no enum, no description | Unverified as managed-by proxy |
| `createdAt` / `joinedAt` | date-time | `joinedAt` empty ⇒ never joined k8s |
| `kubeletStatus` / conditions | — | **NOT IN SPEC** |

`GET /v1/metrics/nodes` (Prometheus text, `clusterIds[]` filter) and
`external-clusters/filters/nodes` (facet values only) were evaluated and
**rejected** as state sources (untyped text / no counts).

### 1.2 Column mapping

| v2 column | Spec source | Value |
|---|---|---|
| `nodes_ready` | `state.phase=="ready"` | count, client-side classify |
| `nodes_not_ready` | `state.phase=="not_ready"` | count |
| `nodes_creating` | `phase=="creating"` | count |
| `nodes_pending` | `phase=="pending"` | count |
| `nodes_deleting` | `phase=="deleting"` | count |
| `nodes_draining` | `phase=="draining"` | count |
| `nodes_cordoned` | `phase=="cordoned"` **OR** `unschedulable==true` | count (union — CAST AI may not mirror the cordon into `phase`) |
| `nodes_interrupted` | `phase=="interrupted"` | count (spot reclaim) |
| `nodes_detached` | — | **N/A** — no such phase exists; closest are `unknown` (agent lost track) and `deleted` (excluded via `excludeDeleting`) |
| `nodes_cast_managed` | **node level: N/A** (no field). **cluster level: YES, already Tier-1** from org summary: `nodeCountOnDemandCastai + nodeCountSpotCastai + nodeCountSpotFallbackCastai` | count |
| `nodes_cloud_managed` | cluster level = `nodes_total − nodes_cast_managed` (`unknownNodeCount` = "unsupported instance type", NOT unknown state) | count |

### 1.3 Tier decision

`ExternalClusterAPI_ListNodes` is per-cluster, cursor-paginated, and the
response has **no `count` field** (`{items, nextCursor}` only) — server-side
counting is impossible; one filtered call per state would cost 10×. Optimal:
ONE unfiltered fetch per cluster (`page.limit=500`), classify client-side.

- **DEFAULT: Tier-2** (drill-down Nodes/Issues tab, 1 call, cached 10 min) — already implemented in `load_cluster_nodes`.
- **OPT-IN fleet batch** (`CASTAI_ENABLE_NODE_STATE_SWEEP`, env flag, manual arming): `nodes_ready/not_ready` only. Call math: 198 online clusters × 1 call = **198 calls ≈ 25 s @ 8 workers**, cache 15 min. Disconnected clusters skip (would 4xx/empty). This stays out of default Tier-1 to preserve the `≤ 2 + 5×N` budget assertion.

## 2. Problematic resources

### 2.1 Verified schemas

| Endpoint | Response (exact) | Reason fields |
|---|---|---|
| `GET /v1/kubernetes/clusters/{id}/problematic-nodes` | `{clusterId, nodes[]{nodeId, name, problems: string[]}, hasProblems}` — no pagination | `problems[]` = free-text strings, no typed reason/message split |
| `GET /v1/kubernetes/clusters/{id}/problematic-workloads` | `{clusterId, controllers[]{name, kind, problems: string[]}, standalonePods[]{name, problems: string[]}, hasProblems}`; opt `aggressiveMode` | same free-text `problems[]` |
| `GET /v1/kubernetes/clusters/{id}/unscheduled-pods` | `{clusterId, items[]{name, namespace, type, unscheduledPods[]{name, cpuRequested, ramRequested, message, events[]{message, action, reason, reportingController, firstTimestamp, lastTimestamp}}}}` | per-pod `message` + event `reason` |

Counts: `problematic_nodes_count = len(nodes[])`;
`problematic_workloads_count = len(controllers[]) + len(standalonePods[])`.
No count fields exist — count == full fetch, so "count-only batch" is **not
cheaper** than full payload; the batch should therefore populate the drill-down
cache too.

### 2.2 Tier decision — RECOMMENDATION

Keep detail **Tier-2**. Add the counts to the SAME opt-in sweep as §1.3 (one
background pass = nodes + problematic-nodes + problematic-workloads =
3 × 198 = **594 calls ≈ 60–90 s @ 8 workers**, cache 15 min). Do NOT make this
Tier-1 default (would ~2.3× page-load cost). `unschedulable_pods` is already
real at Tier-1 via org summary `unschedulablePodCount`.

### 2.3 BUG found (v1)

`optimization_service._pod_count` does `int(it.get("unscheduledPods"))` but
`unscheduledPods` is an **array of pod objects** — the conversion always raises
`TypeError`, so drill-down `unscheduled_pod_count` is **always None**. Fix:
`len(it.get("unscheduledPods") or [])`. Rich pod details should be surfaced.

## 3. OOM kills

### 3.1 Endpoints (both verified)

- ORG: `GET /v1/cost-reports/organization/workload-event-metrics` — REQ `startTime,endTime`; `stepSeconds ∈ {30,300,600,900,3600,86400}, 0=auto`; `eventTypes[]` = k8s reason strings (e.g. `OOMKilled`; unknown ⇒ 400); `groupByManagedBy`; `timeZone`.
- CLUSTER: `GET /v1/cost-reports/clusters/{clusterId}/workload-event-metrics` — same + `bucketTimestamp` (single-bucket workload breakdown).
- Response: `series[]{eventType, items[]{timestamp, eventCount(string), byContainer[], byWorkload[]{workloadName, workloadType, namespace, container, eventCount}}, managedBy}`.

### 3.2 Can ONE org call produce per-cluster OOM? — **NO**

**No `clusterId` field exists anywhere in the org response** (verified
recursively through `WorkloadEventSeries → items → byWorkload`). Org call =
fleet/org totals only. Per-cluster OOM requires the per-cluster endpoint
(198 calls/window online fleet).

(`byWorkload` claims "populated only when include_workload_details is true"
but no such query param is declared — spec inconsistency; treat as UNKNOWN.)

### 3.3 Definitions & recommendation

- `oom_kills_24h` / `oom_kills_7d` **per cluster: Tier-2** (Issues tab; 1 call per window, `eventTypes=["OOMKilled"]`).
- **Fleet KPI at Tier-1 (the real win):** per org 2 calls (24h window + 7d window, `stepSeconds` auto/86400) = **+2 × 57 = 114 calls** (vs 241–482 for cluster fan-out that still can't be attributed cheaper). Aggregate `Σ series[eventType=OOMKilled].items[].eventCount`. Ship behind `CASTAI_ENABLE_OOM_METRICS` flag, KPI cards "OOM kills (24h / 7d, fleet)". Per-cluster attribution in table = N/A (hover → drill-down).
- Proposal evaluation: **adopt for fleet totals; reject for per-cluster columns.**

## 4. Notifications (`GET /v1/notifications`, `NotificationAPI_ListNotifications`)

Verified: `filter.severities[] ∈ {UNSPECIFIED, CRITICAL, ERROR, WARNING, INFO, SUCCESS}`;
`filter.isAcked`, `filter.clusterId`, `filter.clusterName`, `filter.isExpired`;
item = `{id, name, organizationId, severity, details, message, timestamp, createdAt, ackAt, ackedBy, isExpired, clusterMetadata{id,name,providerType,project}, operationMetadata{id,type,category}}`;
response adds **`count`, `countUnacked`, `hasAny`, cursors**.

### Definitions (Tier-1 per org, extends existing `CASTAI_ENABLE_NOTIFICATIONS` flag 1→3 calls, all `page.limit=1` exact-count reads, +114 calls @57 orgs)

- `unacknowledged_notifications` = `countUnacked` (unfiltered, `filter.isExpired=false`)
- `critical_notifications` = `count` with `severities=[CRITICAL,ERROR]`
- `warning_notifications` = `count` with `severities=[WARNING]`

Per-cluster drill-down: `filter.clusterId=<id>`, `isExpired=false`, sort newest, paginate ≤200 items.

## 5. `issue_count` and `cluster_has_issues`

```
issue_count = problematic_nodes_count
            + problematic_workloads_count
            + unschedulable_pods            # Tier-1 summary.unschedulablePodCount
            + oom_kills_24h                 # NA unless Tier-2/batch fetched
            + critical_notifications        # per-cluster only when fetched
```
Plain sum, NO weights, pairwise-complete (skip pd.NA; all-NA ⇒ NA, never 0).

```
cluster_has_issues = (issue_count > 0)
    OR status ∈ {warning, failed}
    OR (agent_status ∈ {non-responding, disconnected} AND status ∈ {ready, connecting})
```
Hibernated/hibernating clusters are EXCLUDED from attention (expected-state).
"Needs attention" filter = `cluster_has_issues == True`; the data-backed subset
(issue_count>0) is shown as a second toggle "Issues (count > 0)" so users can
distinguish signal-less disconnects from real workload problems.

## 6. Agent & component health

Tier-1 `agent_health` per cluster — computed from fields ALREADY fetched
(external-clusters `agentStatus`/`status`/`agentSnapshotReceivedAt` + org WA
payload `status/currentVersion/latestVersion/updatedAt`):

| Value | Condition |
|---|---|
| `healthy` | agentStatus=online AND (WA status=RUNNING or WA absent) |
| `degraded` | agentStatus=non-responding OR status=warning OR wa version drift (`currentVersion != latestVersion`, both present) |
| `offline` | agentStatus ∈ {disconnected, disconnecting} OR status=failed |
| `provisioning` | status=connecting OR agentStatus=waiting-connection |
| `hibernated` | status ∈ {hibernating, hibernated, resuming} |
| `unknown` | data missing |

`agent_last_seen` = `agentSnapshotReceivedAt`; `agent_version`/`agent_latest_version` from WA payload.
`component_health`: **Tier-2 only** — `agent-status` `statuses[]{name, status(free string), totalPods, runningPods, totalRestarts, lastRestartTime, nonRunningPodNames}`; cluster aggregate = worst component (`runningPods < totalPods` or restarts>0 ⇒ degraded). No versions/lastSeen per component in spec (UNKNOWN).

## 7. Drill-down Issues tab payload (exact shape the UI renders)

```json
{
  "available": true, "org_id": "…", "cluster_id": "…", "generated_at": "<ISO>",
  "summary": {
    "issue_count": 0, "agent_health": "healthy|degraded|offline|provisioning|hibernated|unknown",
    "problematic_nodes": 0, "problematic_workloads": 0, "unscheduled_pods": 0,
    "oom_kills_24h": null, "oom_kills_7d": null,
    "critical_notifications": 0, "warning_notifications": 0, "unacked_notifications": 0
  },
  "items": [
    {"kind": "node",            "resource": "<node name>", "id": "<nodeId>", "namespace": null, "reason": "<problems[i]>", "severity": "error", "timestamp": null},
    {"kind": "workload",        "resource": "<name>", "controller_kind": "<kind|standalonePod>", "namespace": null, "reason": "<problems[i]>", "severity": "error", "timestamp": null},
    {"kind": "pod_unscheduled", "resource": "<pod name>", "workload": "<items[i].name>", "workload_type": "<type>", "namespace": "<ns>", "reason": "<message>", "severity": "warning", "timestamp": "<events[-1].lastTimestamp>"},
    {"kind": "oom",             "resource": "<workloadName>", "workload_type": "<type>", "namespace": "<ns>", "container": "<c>", "reason": "OOMKilled", "count": 0, "severity": "critical", "timestamp": "<last bucket timestamp>"},
    {"kind": "notification",    "id": "<nid>", "resource": "<name>", "namespace": null, "reason": "<message>", "severity": "<CRITICAL|ERROR|WARNING|INFO>", "timestamp": "<createdAt>", "acked": false},
    {"kind": "agent_component", "resource": "<component name>", "namespace": "castai-agent", "reason": "<runningPods>/<totalPods> running, <totalRestarts> restarts", "severity": "warning", "timestamp": "<lastRestartTime>"}
  ],
  "node_states": {"ready": 0, "not_ready": 0, "creating": 0, "pending": 0, "deleting": 0, "draining": 0, "cordoned": 0, "interrupted": 0, "unknown": 0},
  "errors": {"<endpoint>": "<sanitized reason>"}
}
```

UI sorts by severity rank (critical>error>warning>info) then timestamp desc;
renders one table with kind filter chips. `errors` drives the per-endpoint
warning banner; partial data NEVER blanks the tab.

## 8. Call-math summary (baseline 57 orgs / 241 clusters / 198 online)

| Feature | Pattern | Calls | Tier |
|---|---|---|---|
| Node states | 1× per online cluster (limit 500, 1 page @≤326 nodes) | +198 | opt-in sweep |
| Problematic counts | +2× per online cluster | +396 (594 combined w/ nodes) | opt-in sweep |
| OOM fleet KPI | 2× per org (24h, 7d) | +114 | Tier-1 flag |
| OOM per cluster | 1×/window/cluster | +198/window | Tier-2 |
| Notifications 3-count | +3× per org (limit=1 filter reads) | +171 | Tier-1 flag |
| Notifications drill | paginated ≤200 per cluster | 1–2 | Tier-2 |
| Agent health | already-fetched fields | +0 | Tier-1 |

## 9. Test requirements

Unit: phase-classifier (all 11 enum values + unknown/empty); cordoned union
with `unschedulable`; issue_count pairwise-NA math; `_pod_count` list-length
fix (regression: array payload); notification count plumbing with limit=1;
severity mapping; issue-tab payload builder merges partial failures.
Contract: fixture JSON per endpoint (problems as string[], unscheduledPods as
array). Integration: sweep math test — online-only filter, cache TTL, flag-off
= zero calls. Live smoke: one online cluster — counts match console.
