"""Per-cluster drill-down lazy loaders (contract — implemented by Builder B3).

Each function performs ONE cached logical fetch for a single (org, cluster),
returning small plain dicts/DataFrames suitable for ui/ renderers. All miss-data
paths return {"available": False, "reason": ...} instead of raising.

Savings taxonomy (docs/data-model.md §4): estimated and realized savings are
NEVER mixed — they live in separate keys ("estimated" / "realized") so the UI
can label them correctly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from data.normalizers import parse_number
from services.enrichment_service import NODE_PHASES  # module-level helper only
from utils.errors import CastAIError, sanitize_message

# Pagination contract (docs/api-matrix.md §0.1): page.limit max is 500; loop
# nextCursor to exhaustion. Hard cap protects the UI (≤25k rows per dataframe).
_NODES_PAGE_LIMIT = 500
_NODES_HARD_CAP = 25_000

# --- Wave-C drill-down v2 constants -----------------------------------------
_DRILLDOWN_STEP = 86400              # daily buckets (historical-model §4)
_WA_WORKLOADS_CAP = 500              # autoscaler-model §4 page.limit max
_WORKLOAD_COSTS_CAP = 500
_PRICING_TOP_N = 20                  # Cost tab node-pricing table cap
_NOTIFICATIONS_LIMIT = 50            # reliability-model §4 drill-down page size
_OOM_WINDOW_DAYS = 7                 # one 7d call; 24h derived from its buckets
_FEED_ITEM_CAP = 200                 # merged issues feed cap (ux-v2 §5: ≤100 shown)

# Severity rank (reliability-model §7): critical > error > warning > info.
_SEVERITY_RANK = {"critical": 0, "error": 1, "warning": 2, "info": 3}

_NODE_COLUMNS = [
    "node_id", "node_name", "instance_type", "lifecycle", "node_state_phase",
    "zone", "cpu_capacity_cores", "cpu_allocatable_cores", "cpu_requested_cores",
    "mem_capacity_gib", "mem_allocatable_gib", "mem_requested_gib",
    "added_by", "unschedulable", "node_created_at", "joined_at",
]


def _reason(exc: BaseException, limit: int = 200) -> str:
    """Short sanitized reason string, safe for the UI."""
    return sanitize_message(str(exc))[:limit]


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}


def _fetch(client, method: str, *args: Any, errors: dict[str, str], **kwargs: Any) -> dict | None:
    """Call one client method failure-tolerantly; record sanitized errors."""
    try:
        return getattr(client, method)(*args, **kwargs)
    except CastAIError as exc:
        errors[method] = _reason(exc)
        return None


def load_cluster_overview(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    try:
        data = client.get_cluster_overview(org_id, cluster_id, start, end)
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    return {"available": True, "org_id": org_id, "cluster_id": cluster_id, "data": data}


def load_cluster_resources(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """Current composition (summary) + usage-over-time series."""
    errors: dict[str, str] = {}
    summary = _fetch(client, "get_cluster_summary", org_id, cluster_id, errors=errors)
    usage = _fetch(client, "get_cluster_resource_usage", org_id, cluster_id, start, end, errors=errors)
    if summary is None and usage is None:
        return _unavailable("; ".join(errors.values()) or "fetch failed")
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "summary": summary,  # None when that endpoint failed
        "usage": usage,
        "errors": errors,
    }


def load_cluster_cost(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    try:
        data = client.get_cluster_cost(org_id, cluster_id, start, end)
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    return {"available": True, "org_id": org_id, "cluster_id": cluster_id, "data": data}


def load_cluster_savings(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """Estimated AND realized savings, clearly separated (never summed together).

    NOTE (Wave-C): the drill-down Savings tab now uses
    :func:`load_cluster_realized_savings` + :func:`load_cluster_estimated_history`
    (2 calls, strict realized/estimated separation); this v1 3-call bundle is
    kept for compatibility with the ux-v2 §5 documented payload shape.

    estimated <- .../estimated-savings (current-state modeled optimum)
    realized  <- .../savings (achieved, windowed: start/end required)
    rightsizing <- .../rightsizing-summary (workload rightsizing potential)
    """
    errors: dict[str, str] = {}
    estimated = _fetch(client, "get_cluster_estimated_savings", org_id, cluster_id, errors=errors)
    realized = _fetch(client, "get_cluster_savings", org_id, cluster_id, start, end, errors=errors)
    rightsizing = _fetch(client, "get_cluster_rightsizing_summary", org_id, cluster_id, errors=errors)
    if estimated is None and realized is None and rightsizing is None:
        return _unavailable("; ".join(errors.values()) or "fetch failed")
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "estimated": estimated,  # None when that endpoint failed
        "realized": realized,
        "rightsizing": rightsizing,
        "errors": errors,
    }


def _sum_container_requests(containers: Any, key: str, *, recommend: bool) -> tuple[float | None, bool]:
    """Σ containers[].resources.requests[key] (or .recommendation.requests[key]
    when recommend=True). Returns (sum, any_value_seen) — a missing
    recommendation block yields (None, False), never 0-fabricated."""

    total = 0.0
    seen = False
    for container in containers or []:
        if not isinstance(container, dict):
            continue
        block = container.get("recommendation") if recommend else container.get("resources")
        if not isinstance(block, dict):
            continue
        requests = block.get("requests")
        if not isinstance(requests, dict):
            continue
        value = parse_number(requests.get(key))
        if value is not None:
            total += value
            seen = True
    return (total if seen else None), seen


_WA_WORKLOAD_COLUMNS = [
    "namespace", "name", "kind", "policy", "requested_cpu", "requested_mem_gib",
    "recommended_cpu", "recommended_mem_gib", "status", "low_confidence", "managed_by",
    "used",
]


def _wa_workload_frame(payload: Any) -> tuple[pd.DataFrame, bool]:
    """envelope workloads[] + nextCursor (api-delta-v2 §4.5). Per-workload
    "used" is NOT in the schema (autoscaler-model §4) — a fixed "N/A" sentinel
    column is emitted and the UI captions it."""

    truncated = bool((payload or {}).get("nextCursor"))
    rows: list[dict] = []
    for wl in (payload or {}).get("workloads") or []:
        if not isinstance(wl, dict):
            continue
        containers = wl.get("containers")
        req_cpu, _ = _sum_container_requests(containers, "cpuCores", recommend=False)
        req_mem, _ = _sum_container_requests(containers, "memoryGib", recommend=False)
        rec_cpu, _ = _sum_container_requests(containers, "cpuCores", recommend=True)
        rec_mem, _ = _sum_container_requests(containers, "memoryGib", recommend=True)
        status = wl.get("recommendationStatus") if isinstance(wl.get("recommendationStatus"), dict) else {}
        rows.append(
            {
                "namespace": wl.get("namespace"),
                "name": wl.get("name"),
                "kind": wl.get("kind"),
                "policy": wl.get("scalingPolicyName"),
                "requested_cpu": req_cpu,
                "requested_mem_gib": req_mem,
                "recommended_cpu": rec_cpu,
                "recommended_mem_gib": rec_mem,
                "status": status.get("type"),
                "low_confidence": status.get("lowConfidence"),
                "managed_by": wl.get("managedBy"),
                "used": "N/A",
            }
        )
    if not rows:
        return pd.DataFrame(columns=_WA_WORKLOAD_COLUMNS), truncated
    return pd.DataFrame(rows, columns=_WA_WORKLOAD_COLUMNS), truncated


def load_cluster_wa(client, org_id: str, cluster_id: str) -> dict:
    """WA rollup (includeCosts banner) + workload-level table, ONE 500-row
    page (autoscaler-model §3/§4). Node-autoscaler policies moved to
    :func:`load_cluster_na_policies` (their own v2 tab)."""

    errors: dict[str, str] = {}
    wa_summary = _fetch(client, "get_wa_workloads_summary", org_id, cluster_id, errors=errors)
    workloads_payload = _fetch(
        client, "get_wa_workloads", org_id, cluster_id, errors=errors,
        **{"page.limit": _WA_WORKLOADS_CAP},
    )
    if wa_summary is None and workloads_payload is None:
        return _unavailable("; ".join(errors.values()) or "fetch failed")
    summary = wa_summary if isinstance(wa_summary, dict) else None
    costs = summary.get("costsPerHour") if isinstance((summary or {}).get("costsPerHour"), dict) else {}
    total = parse_number((summary or {}).get("totalCount"))
    optimized = parse_number((summary or {}).get("optimizedCount"))
    coverage = (optimized / total) if (total is not None and total > 0 and optimized is not None) else None
    workloads, truncated = _wa_workload_frame(workloads_payload)
    s = summary or {}
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "wa_summary": summary,
        "wa_kpis": {
            "total": total,
            "optimized": optimized,
            "coverage": coverage,
            "cost_requested_hourly": parse_number(costs.get("requested")),
            "cost_recommended_hourly": parse_number(costs.get("recommended")),
            # v2-OPS: full GetWorkloadsSummaryResponse surface (all NA-safe;
            # costsPerHour is NULLABLE — the includeCosts-absent case keeps
            # every cost-derived value None and the UI says so, never fabricates)
            "cost_original_requested_hourly": parse_number(costs.get("originalRequested")),
            "optimized_vpa_count": parse_number(s.get("vpaOptimizedCount")),
            "optimized_hpa_count": parse_number(s.get("hpaOptimizedCount")),
            "optimized_both_count": parse_number(s.get("hpaVpaOptimizedCount")),
            "api_managed_count": parse_number(s.get("apiManagedCount")),
            "annotation_managed_count": parse_number(s.get("annotationManagedCount")),
            "cpu_cores_difference": parse_number(s.get("cpuCoresDifference")),
            "memory_difference": parse_number(s.get("memoryDifference")),
            "original_requested_cpu": parse_number(s.get("originalRequestedCpuCores")),
            "original_requested_memory_gib": parse_number(s.get("originalRequestedMemoryGibs")),
            "requested_cpu_cores": parse_number(s.get("requestedCpuCores")),
            "requested_memory_gib": parse_number(s.get("requestedMemory")),
            "recommended_cpu_cores": parse_number(s.get("recommendedCpuCores")),
            "recommended_memory_gib": parse_number(s.get("recommendedMemory")),
            "usage_cpu_cores": parse_number(s.get("usageCpuCores")),
            "usage_memory_gib": parse_number(s.get("usageMemoryGibs")),
        },
        "workloads": workloads,
        "workloads_truncated": truncated,
        "errors": errors,
    }


def load_cluster_na_policies(client, org_id: str, cluster_id: str) -> dict:
    """Node-autoscaler policy panels — 1 GET (…/policies). Evictor may nest
    under nodeDownscaler (same tolerance as the na_policies batch runner)."""

    try:
        payload = client.get_cluster_policies(org_id, cluster_id)
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    payload = payload if isinstance(payload, dict) else {}
    downscaler = payload.get("nodeDownscaler") if isinstance(payload.get("nodeDownscaler"), dict) else {}
    spot = payload.get("spotInstances") if isinstance(payload.get("spotInstances"), dict) else {}
    evictor = payload.get("evictor")
    if not isinstance(evictor, dict):  # evictor may nest under nodeDownscaler
        nested = downscaler.get("evictor")
        evictor = nested if isinstance(nested, dict) else {}
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "policies": {
            "enabled": payload.get("enabled"),
            "spot_instances_enabled": spot.get("enabled"),
            "evictor": {
                "enabled": evictor.get("enabled"),
                "dry_run": evictor.get("dryRun"),
                "status": evictor.get("status"),
            },
            "node_downscaler_enabled": downscaler.get("enabled"),
            "is_scoped_mode": payload.get("isScopedMode"),
            "default_node_template_version": payload.get("defaultNodeTemplateVersion"),
        },
        "errors": {},
    }


def wa_estimated_monthly_savings(
    cost_requested_hourly: Any, cost_recommended_hourly: Any
) -> float | None:
    """Estimated monthly WA savings = (requested − recommended) × 730.

    PURE. ``costsPerHour`` is nullable on the wire (includeCosts absent): when
    either side is missing/unparseable the answer is None — the UI renders the
    "N/A (includeCosts absent)" caption and NEVER fabricates a number. 730 is
    the repo-wide run-rate→monthly convention (docs/data-model.md §1.5).
    """

    try:
        requested = float(cost_requested_hourly)
    except (TypeError, ValueError):
        return None
    try:
        recommended = float(cost_recommended_hourly)
    except (TypeError, ValueError):
        return None
    import math

    from data.normalizers import HOURS_PER_MONTH  # deferred: heavy import

    delta = requested - recommended
    if not math.isfinite(delta):  # NaN/inf never surface as a number
        return None
    return delta * HOURS_PER_MONTH


def load_cluster_rebalance(client, org_id: str, cluster_id: str) -> dict:
    """Rebalancing for the drill-down NA tab — 2 failure-isolated GETs.

    Sources (spec-verified 2026-09-22):
      * ``/v1/rebalancing-schedules`` — ORG inventory. Schedules carry
        ``jobs[]`` entries; those are treated as OPAQUE (never read) — the
        schedule↔cluster linkage used here comes ONLY from the cluster-scoped
        jobs call below (its Job schema declares ``rebalancingScheduleId``),
        never from launchConfiguration NodeSelectors (label selectors carry no
        cluster id).
      * ``/v1/kubernetes/clusters/{clusterId}/rebalancing-jobs`` — cluster
        jobs ``{id, clusterId, rebalancingScheduleId, enabled, status,
        lastTriggerAt, nextTriggerAt}``; status is the closed enum
        ``JobStatus{Pending,InProgress,Finished,Failed,Skipped}``.

    Each side failing/absent leaves N/A parts; only BOTH failing makes the
    whole payload unavailable. A client missing the methods entirely (older
    stub) degrades the same way — this loader NEVER raises.
    """

    errors: dict[str, str] = {}

    def _safe(label: str, call) -> Any:
        try:
            return call()
        except Exception as exc:  # noqa: BLE001 - per-side isolation
            errors[label] = _reason(exc) if isinstance(exc, CastAIError) else str(exc)[:200]
            return None

    def _schedules() -> Any:
        getter = getattr(client, "get_rebalancing_schedules", None)
        if not callable(getter):
            raise CastAIError("client has no get_rebalancing_schedules")
        return getter(org_id)

    schedules_payload = _safe("rebalancing-schedules", _schedules)
    jobs_payload = _safe(
        "rebalancing-jobs",
        lambda: client.get(
            f"/v1/kubernetes/clusters/{cluster_id}/rebalancing-jobs", org_id=org_id
        ),
    )
    if schedules_payload is None and jobs_payload is None:
        return _unavailable("; ".join(errors.values()) or "fetch failed")

    schedules: list[dict] = []
    for raw in (schedules_payload or {}).get("schedules") or []:
        if not isinstance(raw, dict):
            continue
        cron = None
        if isinstance(raw.get("schedule"), dict):
            cron = raw["schedule"].get("cron")
        # NB: raw["jobs"] is deliberately NOT read (opaque by contract).
        schedules.append(
            {
                "id": raw.get("id"),
                "name": raw.get("name"),
                "cron": cron,
                "last_trigger_at": raw.get("lastTriggerAt"),
                "next_trigger_at": raw.get("nextTriggerAt"),
            }
        )
    name_by_id = {s["id"]: s["name"] for s in schedules if s.get("id")}

    jobs: list[dict] = []
    latest: dict | None = None
    latest_ts = None
    for raw in (jobs_payload or {}).get("jobs") or []:
        if not isinstance(raw, dict):
            continue
        schedule_id = raw.get("rebalancingScheduleId")
        entry = {
            "id": raw.get("id"),
            "schedule_id": schedule_id,
            "schedule_name": name_by_id.get(schedule_id),  # None when unmatched
            "status": raw.get("status"),
            "enabled": raw.get("enabled"),
            "last_trigger_at": raw.get("lastTriggerAt"),
            "next_trigger_at": raw.get("nextTriggerAt"),
        }
        jobs.append(entry)
        ts = pd.to_datetime(raw.get("lastTriggerAt"), errors="coerce", utc=True)
        if pd.notna(ts) and (latest_ts is None or ts > latest_ts):
            latest_ts = ts
            latest = entry
    # Never-triggered clusters: fall back to next-trigger ordering.
    if latest is None and jobs:
        def _next_key(entry: dict) -> pd.Timestamp:
            ts = pd.to_datetime(entry.get("next_trigger_at"), errors="coerce", utc=True)
            return ts if pd.notna(ts) else pd.Timestamp.max.tz_localize("UTC")

        latest = min(jobs, key=_next_key)

    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "schedules": schedules,
        "jobs": jobs,
        "latest_job": latest,  # None when the cluster has no job rows at all
        "errors": errors,
    }


def load_cluster_overprovision(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """Latest-window overprovisioned ABSOLUTES (cores/GiB trio) from the
    per-cluster efficiency report — ``GET /v1/cost-reports/clusters/{id}/
    efficiency`` (spec: ``GetClusterEfficiencyReportResponse``; the windowed
    ``items[]`` ReportItem carries per-lifecycle absolutes; latest item by
    timestamp is "current").

    ABSOLUTE overprovisioning exists ONLY on this per-cluster endpoint — the
    org efficiency summary carries percents only. Endpoint/method missing or
    failing -> {"available": False}; the caller renders a skip caption (never
    an error banner) because this is a conditional section."""

    try:
        payload = client.get(
            f"/v1/cost-reports/clusters/{cluster_id}/efficiency",
            org_id=org_id,
            params={"startTime": start, "endTime": end, "stepSeconds": _DRILLDOWN_STEP},
        )
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    payload = payload if isinstance(payload, dict) else {}
    items = [i for i in payload.get("items") or [] if isinstance(i, dict)]
    if not items:
        return _unavailable((payload.get("noDataReason")) or "no report items in window")

    def _ts(item: dict) -> pd.Timestamp:
        ts = pd.to_datetime(item.get("timestamp"), errors="coerce", utc=True)
        return ts if pd.notna(ts) else pd.Timestamp.min.tz_localize("UTC")

    latest = max(items, key=_ts)

    def _sum3(*keys: str) -> float | None:
        values = [parse_number(latest.get(k)) for k in keys]
        present = [v for v in values if v is not None]
        return sum(present) if present else None  # min_count=1, never re-based

    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "timestamp": latest.get("timestamp"),
        # Σ over the 3 lifecycles (min_count=1); storage has a single field.
        "cpu_overprovisioned_cores": _sum3(
            "cpuOverprovisioningOnDemand",
            "cpuOverprovisioningSpot",
            "cpuOverprovisioningSpotFallback",
        ),
        "ram_overprovisioned_gib": _sum3(
            "ramOverprovisioningOnDemand",
            "ramOverprovisioningSpot",
            "ramOverprovisioningSpotFallback",
        ),
        "storage_overprovisioned_gib": parse_number(latest.get("storageOverprovisioning")),
        "items_count": len(items),
        "errors": {},
    }


def _normalize_node(raw: dict) -> dict:
    resources = raw.get("resources") or {}

    def milli(name: str) -> Any:  # millicores -> cores, NA-safe
        try:
            return float(resources[name]) / 1000.0
        except (KeyError, TypeError, ValueError):
            return None

    def mib(name: str) -> Any:  # MiB -> GiB, NA-safe
        try:
            return float(resources[name]) / 1024.0
        except (KeyError, TypeError, ValueError):
            return None

    spot = (raw.get("spotConfig") or {}).get("isSpot")
    return {
        "node_id": raw.get("id"),
        "node_name": raw.get("name"),
        "instance_type": raw.get("instanceType"),
        # Per-node fallback flag does not exist in the schema (data-model §7.6).
        "lifecycle": "spot" if spot else "on_demand",
        "node_state_phase": (raw.get("state") or {}).get("phase"),
        "zone": raw.get("zone"),
        "cpu_capacity_cores": milli("cpuCapacityMilli"),
        "cpu_allocatable_cores": milli("cpuAllocatableMilli"),
        "cpu_requested_cores": milli("cpuRequestsMilli"),
        "mem_capacity_gib": mib("memCapacityMib"),
        "mem_allocatable_gib": mib("memAllocatableMib"),
        "mem_requested_gib": mib("memRequestsMib"),
        "added_by": raw.get("addedBy"),
        "unschedulable": raw.get("unschedulable"),
        "node_created_at": raw.get("createdAt"),
        "joined_at": raw.get("joinedAt"),
    }


def load_cluster_nodes(client, org_id: str, cluster_id: str) -> pd.DataFrame:
    """All nodes of one cluster as a DataFrame (cursor-paginated, capped)."""
    rows: list[dict] = []
    cursor = ""
    try:
        while True:
            params: dict[str, Any] = {"page.limit": str(_NODES_PAGE_LIMIT)}
            if cursor:
                params["page.cursor"] = cursor
            payload = client.get(
                f"/v1/kubernetes/external-clusters/{cluster_id}/nodes",
                org_id=org_id,
                params=params,
            )
            for item in payload.get("items") or []:
                if isinstance(item, dict):
                    rows.append(_normalize_node(item))
            if len(rows) >= _NODES_HARD_CAP:
                rows = rows[:_NODES_HARD_CAP]
                break
            cursor = payload.get("nextCursor") or ""
            if not cursor:
                break
    except CastAIError:
        # Contract: never raise to the UI; an unavailable node list is empty.
        return pd.DataFrame(columns=_NODE_COLUMNS)
    if not rows:
        return pd.DataFrame(columns=_NODE_COLUMNS)
    df = pd.DataFrame(rows, columns=_NODE_COLUMNS)
    return df


def load_cluster_issues(client, org_id: str, cluster_id: str) -> dict:
    """Merged cluster health: problematic nodes/workloads, pending pods, agents."""
    errors: dict[str, str] = {}
    p_nodes = _fetch(client, "get_problematic_nodes", org_id, cluster_id, errors=errors)
    p_workloads = _fetch(client, "get_problematic_workloads", org_id, cluster_id, errors=errors)
    unscheduled = _fetch(client, "get_unscheduled_pods", org_id, cluster_id, errors=errors)
    agents = _fetch(client, "get_cluster_agent_status", org_id, cluster_id, errors=errors)
    if p_nodes is None and p_workloads is None and unscheduled is None and agents is None:
        return _unavailable("; ".join(errors.values()) or "fetch failed")

    nodes_list = (p_nodes or {}).get("nodes") or []
    controllers = (p_workloads or {}).get("controllers") or []
    standalone = (p_workloads or {}).get("standalonePods") or []
    pod_items = (unscheduled or {}).get("items") or []

    def _pod_count(items: list) -> int | None:
        # Spec: UnscheduledWorkload.unscheduledPods is an ARRAY of pod objects
        # (reliability-agent finding: int(array) made this always None).
        total = 0
        seen = False
        for it in items:
            pods = it.get("unscheduledPods")
            if isinstance(pods, list):
                total += len(pods)
                seen = True
            elif isinstance(pods, (int, float)) and not isinstance(pods, bool):
                total += int(pods)
                seen = True
        return total if seen else None

    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "problematic_nodes": nodes_list,
        "problematic_node_count": len(nodes_list),
        "problematic_workloads": controllers + standalone,
        "problematic_workload_count": len(controllers) + len(standalone),
        "unscheduled_pods": pod_items,
        "unscheduled_pod_count": _pod_count(pod_items),
        "agent_components": (agents or {}).get("statuses") or [],
        "has_node_problems": bool((p_nodes or {}).get("hasProblems")),
        "has_workload_problems": bool((p_workloads or {}).get("hasProblems")),
        "errors": errors,
    }


# =============================================================================
# Wave-C drill-down v2 loaders (11-tab drill-down; one cached wrapper per
# loader in app.py). Same contract: never raise; {"available": False} on miss.
# =============================================================================


def _parse_iso(value: Any) -> datetime | None:
    """RFC-3339 -> aware datetime (UTC-pinned); None on anything unparsable."""

    if value is None or not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _fmt_rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


# --------------------------------------------------------------- node pricing
_PRICING_COLUMNS = [
    "node_name", "total_price_hourly", "base_price_hourly", "components_count",
    "provider", "region",
]


def load_cluster_node_pricing(client, org_id: str, cluster_id: str) -> dict:
    """Node pricing via get_cluster_node_pricing (1 GET). USD proto3 strings
    parsed to floats; table pre-sorted desc by totalPrice (top-N)."""

    try:
        payload = client.get_cluster_node_pricing(org_id, cluster_id)
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    rows: list[dict] = []
    period: dict | None = None
    for node in (payload or {}).get("nodes") or []:
        if not isinstance(node, dict):
            continue
        raw_period = node.get("pricingPeriod")
        if period is None and isinstance(raw_period, dict):
            period = raw_period
        rows.append(
            {
                "node_name": node.get("name") or node.get("id"),
                "total_price_hourly": parse_number(node.get("totalPrice")),
                "base_price_hourly": parse_number(node.get("basePrice")),
                "components_count": len(node.get("components") or []),
                "provider": node.get("provider"),
                "region": node.get("region"),
            }
        )
    rows.sort(
        key=lambda r: (r["total_price_hourly"] is None, -(r["total_price_hourly"] or 0.0))
    )
    top = pd.DataFrame(rows[:_PRICING_TOP_N], columns=_PRICING_COLUMNS)
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "pricing": top,
        "node_count": len(rows),
        "shown": len(top),
        "pricing_period": period,
        "errors": {},
    }


# -------------------------------------------------------------- notifications
def load_cluster_notifications(client, org_id: str, cluster_id: str) -> dict:
    """Cluster-filtered actionable notifications (CRITICAL|ERROR|WARNING,
    limit 50, isExpired=false) — 1 GET (reliability-model §4)."""

    try:
        payload = client.get_notifications(
            org_id,
            severities=["CRITICAL", "ERROR", "WARNING"],
            cluster_id=cluster_id,
            is_expired=False,
            limit=_NOTIFICATIONS_LIMIT,
        )
    except (CastAIError, ValueError) as exc:
        return _unavailable(_reason(exc))
    items: list[dict] = []
    for entry in (payload or {}).get("items") or []:
        if not isinstance(entry, dict):
            continue
        items.append(
            {
                "id": entry.get("id"),
                "name": entry.get("name"),
                "severity": str(entry.get("severity") or "INFO").upper(),
                "reason": entry.get("message") or entry.get("name"),
                "detail": entry.get("details"),
                "timestamp": entry.get("createdAt") or entry.get("timestamp"),
                "acked": bool(entry.get("ackedBy") or entry.get("ackAt")),
            }
        )
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "items": items,
        "count": _int((payload or {}).get("count")) if (payload or {}).get("count") is not None else None,
        "count_unacked": (payload or {}).get("countUnacked"),
        "truncated": bool((payload or {}).get("nextCursor")),
        "errors": {},
    }


# ------------------------------------------------------------------ OOM events
def load_cluster_oom_events(
    client,
    org_id: str,
    cluster_id: str,
    end: str,
    *,
    window_days: int = _OOM_WINDOW_DAYS,
) -> dict:
    """Cluster OOM kills — ONE 7d call (step 86400); the 24h tile is derived
    from the same daily buckets (>= end-24h). byWorkload rows feed the merged
    issues feed (reliability-model §3.3/§7)."""

    end_dt = _parse_iso(end) or datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=window_days)
    try:
        payload = client.get_cluster_workload_event_metrics(
            org_id,
            cluster_id,
            event_types=["OOMKilled"],
            start=_fmt_rfc3339(start_dt),
            end=_fmt_rfc3339(end_dt),
            step_seconds=_DRILLDOWN_STEP,
        )
    except (CastAIError, ValueError) as exc:
        return _unavailable(_reason(exc))
    cutoff_24h = end_dt - timedelta(hours=24)
    total_7d = 0
    total_24h = 0
    oom_items: list[dict] = []
    for series in (payload or {}).get("series") or []:
        if not isinstance(series, dict) or series.get("eventType") not in (None, "OOMKilled"):
            continue
        for item in series.get("items") or []:
            if not isinstance(item, dict):
                continue
            count = _int(item.get("eventCount"))
            total_7d += count
            bucket_ts = _parse_iso(item.get("timestamp"))
            if bucket_ts is not None and bucket_ts >= cutoff_24h:
                total_24h += count
            for w in item.get("byWorkload") or []:
                if not isinstance(w, dict):
                    continue
                wcount = _int(w.get("eventCount"))
                if wcount <= 0:
                    continue
                oom_items.append(
                    {
                        "workload": w.get("workloadName"),
                        "workload_type": w.get("workloadType"),
                        "namespace": w.get("namespace"),
                        "container": w.get("container"),
                        "count": wcount,
                        "timestamp": item.get("timestamp"),
                    }
                )
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "oom_kills_24h": total_24h,
        "oom_kills_7d": total_7d,
        "oom_items": oom_items[:_FEED_ITEM_CAP],
        "window_days": window_days,
        "errors": {},
    }


# ------------------------------------------------------------ realized savings
def load_cluster_realized_savings(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """REALIZED savings only (…/savings, step 86400 daily buckets) — the
    Savings tab's "Realized (actual window)" panel. Summary USD strings parsed."""

    try:
        payload = client.get_cluster_realized_savings(
            org_id, cluster_id, start, end, step_seconds=_DRILLDOWN_STEP
        )
    except (CastAIError, ValueError) as exc:
        return _unavailable(_reason(exc))
    raw_summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "summary": {
            "total_cost": parse_number(raw_summary.get("totalCost")),
            "total_savings": parse_number(raw_summary.get("totalSavings")),
        },
        "items": payload.get("items") or [],
        "window": {"start": start, "end": end},
        "errors": {},
    }


_TREND_COLUMNS = ["timestamp", "downscaling", "spot"]


def trend_from_cluster_savings(payload: Any) -> pd.DataFrame:
    """Realized savings daily frame — items SUMMED per UTC day (savings are
    additive amounts, historical-model §3.2; never resampled by mean)."""

    items = (payload or {}).get("items") if isinstance(payload, dict) else payload
    rows: list[dict] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        ts = _parse_iso(item.get("timestamp"))
        if ts is None:
            continue
        rows.append(
            {
                "timestamp": ts.replace(hour=0, minute=0, second=0, microsecond=0),
                "downscaling": parse_number(item.get("downscalingSavings")) or 0.0,
                "spot": parse_number(item.get("spotSavings")) or 0.0,
            }
        )
    if not rows:
        return pd.DataFrame(
            {
                "timestamp": pd.Series(dtype="datetime64[ns, UTC]"),
                "downscaling": pd.Series(dtype="Float64"),
                "spot": pd.Series(dtype="Float64"),
            }
        )
    frame = pd.DataFrame(rows)
    out = (
        frame.groupby("timestamp", as_index=False)[["downscaling", "spot"]]
        .sum()
        .sort_values("timestamp", ignore_index=True)
    )
    out["timestamp"] = pd.to_datetime(out["timestamp"], utc=True)
    return out


# ------------------------------------------------- estimated savings history
def load_cluster_estimated_history(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """ESTIMATED savings history (model) — event-driven snapshots for the
    Savings tab "Estimated (model)" panel + History tab (6 h TTL)."""

    try:
        payload = client.get_cluster_estimated_savings_history(org_id, cluster_id, start, end)
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "items": payload.get("items") or [],
        "errors": {},
    }


_EST_HISTORY_COLUMNS = [
    "created_at", "current_cph", "optimized_layman_cph",
    "optimized_spot_instances_cph", "optimized_spot_only_cph",
]


def estimated_history_frame(payload: Any) -> pd.DataFrame:
    """items[]{createdAt, current{}, optimizedLayman{}, optimizedSpotInstances{},
    optimizedSpotOnly{}} -> last-entry-per-UTC-day rate frame (USD/h).
    No ffill: the API's entry cadence is irregular; gaps stay gaps
    (historical-model §3.1 — never fabricate beyond the cap)."""

    day_best: dict = {}
    for item in (payload or {}).get("items") or []:
        if not isinstance(item, dict):
            continue
        ts = _parse_iso(item.get("createdAt"))
        if ts is None:
            continue
        day = ts.replace(hour=0, minute=0, second=0, microsecond=0)
        if day not in day_best or ts >= day_best[day][0]:
            day_best[day] = (ts, item)
    rows = []
    for day in sorted(day_best):
        item = day_best[day][1]

        def _cph(key: str) -> float | None:
            block = item.get(key)
            return parse_number(block.get("costPerHour")) if isinstance(block, dict) else None

        rows.append(
            {
                "created_at": day,
                "current_cph": _cph("current"),
                "optimized_layman_cph": _cph("optimizedLayman"),
                "optimized_spot_instances_cph": _cph("optimizedSpotInstances"),
                "optimized_spot_only_cph": _cph("optimizedSpotOnly"),
            }
        )
    if not rows:
        return pd.DataFrame(columns=_EST_HISTORY_COLUMNS)
    return pd.DataFrame(rows, columns=_EST_HISTORY_COLUMNS)


# -------------------------------------------------------------- node history
_NODE_HISTORY_COLUMNS = ["timestamp", "on_demand", "spot", "fallback", "unknown"]


def load_cluster_node_history(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """node-count-history (1 GET, step 86400) — History tab stacked area."""

    try:
        payload = client.get_cluster_node_count_history(
            org_id, cluster_id, start, end, step_seconds=_DRILLDOWN_STEP
        )
    except (CastAIError, ValueError) as exc:
        return _unavailable(_reason(exc))
    rows: list[dict] = []
    for item in (payload or {}).get("items") or []:
        if not isinstance(item, dict):
            continue
        ts = _parse_iso(item.get("timestamp"))
        if ts is None:
            continue
        rows.append(
            {
                "timestamp": ts,
                # int64 counts via parse_number (tolerates JSON strings/nums)
                "on_demand": parse_number(item.get("nodeCountOnDemand")),
                "spot": parse_number(item.get("nodeCountSpot")),
                "fallback": parse_number(item.get("nodeCountFallback")),
                "unknown": parse_number(item.get("nodeCountUnknown")),
            }
        )
    frame = pd.DataFrame(rows, columns=_NODE_HISTORY_COLUMNS)
    if rows:
        frame = frame.sort_values("timestamp", ignore_index=True)
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "node_history": frame,
        "sources": payload.get("sources") or [],
        "last_snapshot_at": payload.get("lastSnapshotAt"),
        "errors": {},
    }


# ------------------------------------------------------------- workload costs
_WORKLOAD_COST_COLUMNS = [
    "namespace", "workload", "workload_type", "cost_window",
    "avg_cost_hourly", "avg_cpu_cost_hourly", "avg_ram_cost_hourly",
]


def load_cluster_workload_costs(client, org_id: str, cluster_id: str, start: str, end: str) -> dict:
    """Workload cost report — GET workload-costs (spec-verified GET variant;
    the POST -cost-summaries siblings stay unused under read-only posture).
    One 500-row page; sorted desc by window cost."""

    try:
        payload = client.get(
            f"/v1/cost-reports/clusters/{cluster_id}/workload-costs",
            org_id=org_id,
            params={"startTime": start, "endTime": end, "page.limit": _WORKLOAD_COSTS_CAP},
        )
    except CastAIError as exc:
        return _unavailable(_reason(exc))
    rows: list[dict] = []
    for item in (payload or {}).get("items") or []:
        if not isinstance(item, dict):
            continue
        summary = item.get("summary") if isinstance(item.get("summary"), dict) else {}
        rows.append(
            {
                "namespace": item.get("namespace"),
                "workload": item.get("workloadName"),
                "workload_type": item.get("workloadType"),
                "cost_window": parse_number(summary.get("totalCost")),
                "avg_cost_hourly": parse_number(summary.get("avgCost")),
                "avg_cpu_cost_hourly": parse_number(summary.get("avgCpuCost")),
                "avg_ram_cost_hourly": parse_number(summary.get("avgRamCost")),
            }
        )
    rows.sort(key=lambda r: (r["cost_window"] is None, -(r["cost_window"] or 0.0)))
    return {
        "available": True,
        "org_id": org_id,
        "cluster_id": cluster_id,
        "workload_costs": pd.DataFrame(rows, columns=_WORKLOAD_COST_COLUMNS),
        "row_count": len(rows),
        "truncated": bool((payload or {}).get("nextCursor")),
        "no_data_reason": (payload or {}).get("noDataReason"),
        "errors": {},
    }


# ------------------------------------------------------------- node phases
def count_node_phases(df: pd.DataFrame | None) -> dict:
    """Client-side node-state classification (reliability-model §1/ADR R7):
    cordoned = phase=='cordoned' UNION unschedulable; the canonical enum comes
    from services.enrichment_service.NODE_PHASES (same logic the health
    enrichment batch uses — import only, NO batch call from drill-down)."""

    counts = {phase: 0 for phase in NODE_PHASES}
    counts["other"] = 0
    if df is None or len(df) == 0 or "node_state_phase" not in df.columns:
        return counts
    phases = df["node_state_phase"].tolist()
    unsched = (
        df["unschedulable"].tolist() if "unschedulable" in df.columns else [None] * len(df)
    )
    for phase, flag in zip(phases, unsched):
        # None/NaN/non-string phase -> "unknown" (the enum's own bucket);
        # only true strings classify (pandas keeps None as NaN in mixed cols).
        p = phase if isinstance(phase, str) and phase else "unknown"
        if p == "cordoned" or flag is True:
            counts["cordoned"] += 1
            continue
        counts[p if p in counts else "other"] += 1
    return counts


# ------------------------------------------------------ merged issues feed
def _canon_severity(value: Any) -> str:
    v = str(value or "info").strip().lower()
    return v if v in _SEVERITY_RANK else "info"


def build_issues_feed(
    issues: Any,
    notifications: Any,
    oom: Any,
) -> dict:
    """Merged drill-down Issues feed (reliability-model §7 exact shape).

    Each source is failure-isolated by its own cached loader in app.py; this
    PURE function merges whatever arrived (per-source errors recorded under
    ``errors``; partial data never blanks the tab). Sorting: severity rank
    (critical>error>warning>info) then timestamp desc (missing timestamps last).
    """

    items: list[dict] = []
    errors: dict[str, str] = {}

    def _unavailable_reason(payload: Any) -> str | None:
        if isinstance(payload, dict) and payload.get("available") is False:
            return str(payload.get("reason") or "unavailable")
        if payload is None:
            return "loader failed"
        return None

    # --- source 1: core issues bundle (4 endpoints, own cached loader) -----
    summary: dict[str, Any] = {
        "issue_count": None,
        "agent_health": "unknown",
        "problematic_nodes": None,
        "problematic_workloads": None,
        "unscheduled_pods": None,
        "oom_kills_24h": None,
        "oom_kills_7d": None,
        "critical_notifications": None,
        "warning_notifications": None,
        "unacked_notifications": None,
    }
    reason = _unavailable_reason(issues)
    if reason is not None:
        errors["issues"] = reason
    elif isinstance(issues, dict):
        summary["problematic_nodes"] = issues.get("problematic_node_count")
        summary["problematic_workloads"] = issues.get("problematic_workload_count")
        summary["unscheduled_pods"] = issues.get("unscheduled_pod_count")
        for node in issues.get("problematic_nodes") or []:
            if not isinstance(node, dict):
                continue
            problems = [p for p in node.get("problems") or [] if isinstance(p, str) and p]
            items.append(
                {
                    "kind": "node",
                    "resource": node.get("name") or node.get("id"),
                    "namespace": None,
                    "reason": "; ".join(problems) or "problematic node",
                    "detail": None,
                    "severity": "error",
                    "timestamp": None,
                }
            )
        for wl in issues.get("problematic_workloads") or []:
            if not isinstance(wl, dict):
                continue
            problems = [p for p in wl.get("problems") or [] if isinstance(p, str) and p]
            items.append(
                {
                    "kind": "workload",
                    "resource": wl.get("name"),
                    "namespace": wl.get("namespace"),
                    "reason": "; ".join(problems) or "problematic workload",
                    "detail": wl.get("kind") or wl.get("controllerKind"),
                    "severity": "error",
                    "timestamp": None,
                }
            )
        for entry in issues.get("unscheduled_pods") or []:
            if not isinstance(entry, dict):
                continue
            pods = entry.get("unscheduledPods")
            pod_names = [p.get("name") for p in pods if isinstance(p, dict)] if isinstance(pods, list) else []
            events = entry.get("events")
            last_ts = None
            if isinstance(events, list) and events:
                last = events[-1]
                if isinstance(last, dict):
                    last_ts = last.get("lastTimestamp")
            items.append(
                {
                    "kind": "pod",
                    "resource": entry.get("name"),
                    "namespace": entry.get("namespace"),
                    "reason": entry.get("message") or (
                        f"{len(pod_names)} unscheduled pod{'s' if len(pod_names) != 1 else ''}"
                        if pod_names
                        else "unscheduled pods"
                    ),
                    "detail": ", ".join(pod_names[:5]) if pod_names else None,
                    "severity": "warning",
                    "timestamp": last_ts,
                }
            )
        degraded = 0
        components_total = 0
        for comp in issues.get("agent_components") or []:
            if not isinstance(comp, dict):
                continue
            components_total += 1
            running = parse_number(comp.get("runningPods"))
            total = parse_number(comp.get("totalPods"))
            restarts = parse_number(comp.get("totalRestarts"))
            is_degraded = (
                (running is not None and total is not None and running < total)
                or (restarts is not None and restarts > 0)
            )
            if not is_degraded:
                continue
            degraded += 1
            items.append(
                {
                    "kind": "component",
                    "resource": comp.get("name"),
                    "namespace": "castai-agent",
                    "reason": f"{_int(running)}/{_int(total)} running, {_int(restarts)} restarts",
                    "detail": comp.get("status"),
                    "severity": "warning",
                    "timestamp": comp.get("lastRestartTime"),
                }
            )
        if components_total:
            summary["agent_health"] = "degraded" if degraded else "healthy"

    # --- source 2: notifications (own cached loader, ttl 300) --------------
    reason = _unavailable_reason(notifications)
    if reason is not None:
        errors["notifications"] = reason
    elif isinstance(notifications, dict):
        crit = warn = 0
        summary["unacked_notifications"] = notifications.get("count_unacked")
        for entry in notifications.get("items") or []:
            if not isinstance(entry, dict):
                continue
            sev = _canon_severity(entry.get("severity"))
            if sev in ("critical", "error"):
                crit += 1
            elif sev == "warning":
                warn += 1
            items.append(
                {
                    "kind": "notification",
                    "resource": entry.get("name") or entry.get("id"),
                    "namespace": None,
                    "reason": entry.get("reason") or entry.get("name") or "notification",
                    "detail": entry.get("detail"),
                    "severity": sev,
                    "timestamp": entry.get("timestamp"),
                }
            )
        summary["critical_notifications"] = crit
        summary["warning_notifications"] = warn

    # --- source 3: OOM events (own cached loader, ttl 900) -----------------
    reason = _unavailable_reason(oom)
    if reason is not None:
        errors["oom"] = reason
    elif isinstance(oom, dict):
        summary["oom_kills_24h"] = oom.get("oom_kills_24h")
        summary["oom_kills_7d"] = oom.get("oom_kills_7d")
        for entry in oom.get("oom_items") or []:
            if not isinstance(entry, dict):
                continue
            items.append(
                {
                    "kind": "oom",
                    "resource": entry.get("workload"),
                    "namespace": entry.get("namespace"),
                    "reason": f"OOMKilled ×{entry.get('count')}"
                    + (f" (container {entry['container']})" if entry.get("container") else ""),
                    "detail": entry.get("workload_type"),
                    "severity": "critical",
                    "timestamp": entry.get("timestamp"),
                }
            )

    # issue_count: plain pairwise sum (reliability-model §5; all-NA -> None).
    parts = [
        summary["problematic_nodes"],
        summary["problematic_workloads"],
        summary["unscheduled_pods"],
        summary["oom_kills_24h"],
        summary["critical_notifications"],
    ]
    present = [int(v) for v in parts if isinstance(v, (int, float)) and not isinstance(v, bool)]
    summary["issue_count"] = sum(present) if present else None

    for item in items:
        item["severity_rank"] = _SEVERITY_RANK[item["severity"]]
        item["_ts"] = _parse_iso(item.get("timestamp"))
    items.sort(
        key=lambda i: (i["severity_rank"], -(i["_ts"].timestamp()) if i["_ts"] else float("inf"))
    )
    for item in items:
        item.pop("_ts", None)
    return {
        "available": True,
        "summary": summary,
        "items": items[:_FEED_ITEM_CAP],
        "item_count": len(items),
        "errors": errors,
    }
