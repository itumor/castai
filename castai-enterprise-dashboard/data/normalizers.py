"""Wire JSON -> typed fleet rows (Builder B2, data-plane, ADR v2 R5/R6/R8).

Sources (docs/api-matrix.md):
  * §2.1  GET /v1/kubernetes/external-clusters                       -> items[]
  * §3.1  GET /v1/cost-reports/organization/clusters/summary         -> items[]
  * §3.6  GET /v1/cost-reports/organization/overview                 -> clusters[]
  * §7.2  GET /v1/workload-autoscaling/organizations/{orgId}/components/
          workload-autoscaler -> clusterAgentStatuses[] (the caller passes the
          pre-matched single status string as ``wa_status`` and, since v2, the
          full record as ``wa_entry`` for the display/version/resize columns)
  * api-delta-v2 §2c  GET /v1/cost-reports/organization/clusters/efficiency
          -> items[] (caller passes the per-cluster record as ``efficiency_item``;
          waste doubles, USD/window)

Conventions (docs/data-model.md, docs/api-matrix.md §0.1):
  * proto3 numerics arrive as JSON strings (``"cpuProvisionedOnDemand": "4.5"``);
    parse defensively via :func:`parse_number`; unparseable/absent -> ``pd.NA``,
    NEVER silent 0.
  * ClusterSummary CPU = cores and RAM = GiB **already** (spec: "Provisioned RAM
    GiB", "Used RAM GiB"). The millicores/MiB trap lives in the per-cluster NODE
    endpoints (Tier 2), not here -> NO unit scaling is applied in this module.
  * Money = USD/hour; monthly run-rate = hourly x 730 (explicit convention).
  * Missing inputs keep ``pd.NA`` semantics; Tier-2-only cells carry the ``"T2"``
    sentinel string (architecture.md §9.4).
  * ADR v2 R8 renames: ``cpu_utilization_pct`` / ``memory_utilization_pct`` are
    the v1 ``cpu_efficiency`` / ``memory_efficiency`` — SAME values (0–1 ratios,
    used/allocatable), renamed only. ``*_pct`` encodes the display contract
    (render % at the edge), never a 0–100 stored scale (resource-metrics §2).
  * Waste column law (resource-metrics §7, finops §4): ``waste_*_usd`` are
    USD/window doubles from CAST's rightsizing model — NEVER sum them with spend
    (it already includes the idle capacity) or with ``potential_savings*`` (a
    second, different estimate model). Three lenses, three sections.
  * Storage trap (resource-metrics §3): the summary wire field
    ``storageRequested`` is **active PVC claims accessed by a workload**, NOT a
    scheduler-style request — it ships only as ``storage_active_claimed_gib``;
    the column name encodes this on purpose.

Row shape: build_fleet_row emits EXACTLY ``services.cluster_service.FLEET_COLUMNS``
keys first, then the lead-architect-approved auxiliary keys in EXTRA_COLUMNS
(data-model.md §2 auxiliaries; B3 appends them after FLEET_COLUMNS).
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from models import Cluster
from services.cluster_service import FLEET_COLUMNS

HOURS_PER_MONTH = 730  # run-rate -> monthly convention (docs/data-model.md §1.5)

# Freshness law (ADR v2 / R5): a snapshot is "fresh" below this age; at or
# above it the data is "stale" (minutes, wall-clock against UTC now).
FRESHNESS_FRESH_MINUTES = 30.0

# Sentinels (docs/data-model.md §5, architecture.md §9 item 4)
TIER2_SENTINEL = "T2"  # cell exists only after Tier-2 drill-down
WA_NOT_INSTALLED = "Not installed"  # cluster absent from org WA status payload

# WA enum has EXACTLY three values (autoscaler-model §2.1, spec-verified).
WA_STATUS_RUNNING = "AGENT_STATUS_RUNNING"
WA_STATUS_UNKNOWN = "AGENT_STATUS_UNKNOWN"
WA_STATUS_INVALID = "AGENT_STATUS_INVALID"

# Ghost definition (current-data-audit §4/#10, ADR v2 R5): exactly the
# reporting_state UNSPECIFIED rows (4 in the 2026-09-21 baseline). Ghosts stay
# VISIBLE in the table and are masked out of every KPI by the aggregators.
GHOST_REPORTING_STATE = "CLUSTER_STATE_UNSPECIFIED"

# reliability-model §5/agent_status vocab (external-clusters, lowercase wire)
_AGENT_DISCONNECTED = frozenset({"disconnected", "disconnecting"})
_STATUS_HIBERNATING = frozenset({"hibernating", "hibernated", "resuming"})

_K8S_SHORT_RE = re.compile(r"^v?(\d+)\.(\d+)")

# Lead-architect-approved auxiliary columns appended after FLEET_COLUMNS.
# Order IS the export contract; the UI builder consumes these names verbatim.
EXTRA_COLUMNS: list[str] = [
    # --- v1 auxiliaries (unchanged) -----------------------------------------
    "reporting_state",       # overview clusters[].state
    "optimal_cost_hourly",   # overview clusters[].optimalCostHourly (USD/h)
    "is_phase2",             # external-clusters items[].isPhase2 (bool, NA-able)
    "pod_count",             # summary items[].podCount
    "nodes_unknown",         # summary items[].unknownNodeCount (unsupported instance types)
    "cluster_score",         # summary items[].clusterScore (CAST AI cluster score; string->float; NA)
    "potential_savings",     # potential_savings_hourly * 730 (USD/month, scheduling flavor)
    # Final-review MAJOR-1: savings ratios must divide by the OVERVIEW item's own
    # costHourly (same-source pairwise mask, data-model §3.7), never by the
    # summary-derived cost_hourly.
    "overview_cost_hourly",  # overview clusters[].costHourly (USD/h)
    # --- v2 request efficiency (ADR R8): used/requested, requested>0 mask ---
    "cpu_request_efficiency_pct",     # _safe_ratio_pos(cpu_used, cpu_requested)
    "memory_request_efficiency_pct",  # _safe_ratio_pos(ram_used, ram_requested)
    # --- v2 node-autoscaler coverage (ADR R6, +0 calls) ---------------------
    "na_managed_nodes",  # Σ summary nodeCount{OnDemand,Spot,SpotFallback}Castai, min_count=1
    "na_coverage_pct",   # na_managed_nodes / nodes_total (nodes_total>0 mask)
    # --- v2 storage (summary pass-through, proto3 string numerics) ----------
    "storage_provisioned_gib",     # storageProvisioned (GiB provisioned)
    "storage_claimed_gib",         # storageClaimed (GiB claimed in PVC)
    "storage_active_claimed_gib",  # storageRequested (TRAP: ACTIVE claims — see docstring)
    "storage_commit_pct",          # claimed/provisioned (provisioned>0 mask); "commit", never "utilization"
    "storage_cost_hourly",         # storageCostHourly (component of cost_hourly; display split)
    # --- v2 waste (ADR R2): clusters/efficiency items[].wasted.* doubles ----
    "waste_cpu_usd",      # wasted.cpu (USD/window)
    "waste_ram_usd",      # wasted.ram (USD/window)
    "waste_storage_usd",  # wasted.storage (USD/window)
    "waste_total_usd",    # cpu+ram+storage min_count=1 — never silently re-based
    # --- v2 WA display family (autoscaler-model §2.2, same org payload) -----
    "wa_display",          # display mapping of the raw enum; MAJOR-3 pd.NA stands
    "wa_agent_version",    # clusterAgentStatuses[].currentVersion
    "wa_version_drift",    # bool: currentVersion != latestVersion (both present); else NA
    "wa_in_place_resize",  # bool: inPlaceResizeEnabled; NA when absent
    "wa_last_reported",    # clusterAgentStatuses[].updatedAt (tz-aware; NaT when absent)
    # --- v2 agent health (reliability-model §6, derived, +0 calls) ----------
    "agent_health",  # Connected/Connecting/Non-responding/Disconnected/Hibernated/Failed/Unknown
    # --- v2 freshness --------------------------------------------------------
    "latest_sync_time",       # agentSnapshotReceivedAt else sweep ts (tz-aware; NaT when both missing)
    "snapshot_age_minutes",   # tz-aware now - latest_sync_time, minutes (>=0); NA when ts missing
    "data_freshness_status",  # "fresh" (<30 min) | "stale" (>=30 min) | "unknown" (NA)
    # --- v2 ghost quarantine (audit #10; aggregators mask, table keeps row) --
    "is_ghost",  # bool: reporting_state == CLUSTER_STATE_UNSPECIFIED exactly
    # --- v2 savings polarity (ADR R5 + finops §2 rule 9; never clamped) -----
    "has_positive_savings_opportunity",  # bool: potential_savings_hourly > 0 (NA stays NA)
    "has_negative_savings",              # bool: potential_savings_hourly < 0 (NA stays NA)
    # --- v2 k8s version normalization (audit #4) -----------------------------
    "kubernetes_version_short",  # major.minor from kubernetes_version ('v1.34.9' -> '1.34')
    "kubernetes_version_known",  # bool: the raw version string parsed (False, never NA)
]

__all__ = [
    "FRESHNESS_FRESH_MINUTES",
    "GHOST_REPORTING_STATE",
    "HOURS_PER_MONTH",
    "TIER2_SENTINEL",
    "WA_NOT_INSTALLED",
    "WA_STATUS_INVALID",
    "WA_STATUS_RUNNING",
    "WA_STATUS_UNKNOWN",
    "EXTRA_COLUMNS",
    "parse_number",
    "wa_display",
    "agent_health_value",
    "kubernetes_version_short",
    "normalize_cluster_item",
    "build_fleet_row",
]


def parse_number(value: Any) -> float | None:
    """Coerce a proto3 JSON numeric (string or number) to ``float``.

    Defensive against every wire oddity: ``None``, ``""`` / whitespace-only
    strings, garbage strings, booleans (bool is an int subclass but is NOT a
    numeric field), and non-finite results (``nan``/``inf``). Anything
    unusable returns ``None`` -- the caller converts to ``pd.NA`` and never to 0.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None  # True/False are flags, not measurements
    if isinstance(value, (int, float)):
        result = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            result = float(text)
        except ValueError:
            return None
    else:
        try:
            result = float(value)
        except (TypeError, ValueError):
            return None
    if not math.isfinite(result):
        return None
    return result


def _na(value: float | None) -> object:
    """Missing numeric -> pd.NA (never 0)."""
    return pd.NA if value is None else value


def _na_text(value: object) -> object:
    """Missing/blank text -> pd.NA."""
    if value is None:
        return pd.NA
    if isinstance(value, str) and value == "":
        return pd.NA
    return value


def _sum_present(*values: float | None) -> float | None:
    """Sum non-None values; None when every input is missing (min_count=1)."""
    present = [v for v in values if v is not None]
    return sum(present) if present else None


def _sum_fields(mapping: dict, *keys: str) -> float | None:
    """parse_number + min_count=1 sum over proto3 string fields of ``mapping``."""
    return _sum_present(*(parse_number(mapping.get(k)) for k in keys))


def _safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    """Pairwise ratio; None when either side is missing or denominator is 0."""
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _safe_ratio_pos(numerator: float | None, denominator: float | None) -> float | None:
    """Pairwise ratio; None on missing sides or denominator <= 0.

    Row-form of the aggregation mask law (resource-metrics §4): a zero or
    negative denominator is *undefined*, not zero usage — the numerator of a
    row with denominator <= 0 must never enter any sum either.
    """
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator


def _utc_now() -> datetime:
    """Wall clock for freshness math (module-level so tests can pin it)."""
    return datetime.now(timezone.utc)


# --------------------------------------------------------------- v2 helpers

def wa_display(wa_status: object, wa_entry: dict | None) -> object:
    """WA presentation mapping (autoscaler-model §2.2; MAJOR-3 stands).

    * ``wa_entry is None`` — the org WA payload FAILED/absent -> ``pd.NA``
      (the row leaves the wa_coverage scope instead of polluting it).
    * ``RUNNING`` -> ``"Running"``
    * ``UNKNOWN`` -> ``"Installed (status unknown)"`` when the entry carries
      ``currentVersion`` or ``installedAt``; stub rows -> ``"Unknown"``
    * ``INVALID`` -> ``"Invalid"``
    * (any other/absent status, payload arrived) -> ``"Not installed"``
    """
    if wa_entry is None:
        return pd.NA
    if wa_status == WA_STATUS_RUNNING:
        return "Running"
    if wa_status == WA_STATUS_UNKNOWN:
        if wa_entry.get("currentVersion") or wa_entry.get("installedAt"):
            return "Installed (status unknown)"
        return "Unknown"
    if wa_status == WA_STATUS_INVALID:
        return "Invalid"
    return WA_NOT_INSTALLED


def agent_health_value(
    status: object,
    agent_status: object,
    snapshot_age_minutes: float | None,
) -> str:
    """Derived Tier-1 agent health (reliability-model §6, +0 calls).

    First match wins (deterministic per row shape):

    ==============  =========================================================
    value           condition
    ==============  =========================================================
    Failed          ``status == "failed"``
    Hibernated      ``status in {hibernating, hibernated, resuming}``
    Connecting      ``status == "connecting"`` or ``agent_status == "waiting-connection"``
    Disconnected    ``agent_status in {disconnected, disconnecting}``
    Non-responding  ``agent_status == "non-responding"`` or ``status == "warning"``
    Non-responding  ``agent_status == "online"`` with a STALE snapshot
                    (age >= :data:`FRESHNESS_FRESH_MINUTES`)
    Connected       ``agent_status == "online"`` (snapshot fresh or absent —
                    an absent age is never treated as stale)
    Unknown         both fields missing / unrecognized
    ==============  =========================================================
    """
    st = str(status).strip().lower() if isinstance(status, str) else ""
    ag = str(agent_status).strip().lower() if isinstance(agent_status, str) else ""
    if st == "failed":
        return "Failed"
    if st in _STATUS_HIBERNATING:
        return "Hibernated"
    if st == "connecting" or ag == "waiting-connection":
        return "Connecting"
    if ag in _AGENT_DISCONNECTED:
        return "Disconnected"
    if ag == "non-responding" or st == "warning":
        return "Non-responding"
    if ag == "online":
        if snapshot_age_minutes is not None and snapshot_age_minutes >= FRESHNESS_FRESH_MINUTES:
            return "Non-responding"
        return "Connected"
    return "Unknown"


def kubernetes_version_short(version: object) -> tuple[object, bool]:
    """``kubernetesVersion`` -> (``major.minor``, known) normalization.

    Handles both ``'v1.34.9'`` -> ``'1.34'`` and ``'1.35'`` -> ``'1.35'``
    (audit #4 mixed formats); anything unparseable -> (``pd.NA``, False).
    """
    if not isinstance(version, str):
        return pd.NA, False
    match = _K8S_SHORT_RE.match(version.strip())
    if not match:
        return pd.NA, False
    return f"{match.group(1)}.{match.group(2)}", True


def normalize_cluster_item(org_id: str, org_name: str, item: dict | None) -> Cluster:
    """Map one external-clusters ``items[]`` payload onto ``models.Cluster``.

    ``models.Cluster`` carries only the inventory identity fields
    (provider <- providerType, region <- region.name, status); agent_status and
    kubernetes_version are extracted by :func:`build_fleet_row` straight from the
    wire item because the frozen dataclass has no slots for them. Missing text
    degrades to ``""`` inside the dataclass (it is typed ``str``, not NA-able).
    """
    item = item if isinstance(item, dict) else {}
    region = item.get("region")
    region_name = region.get("name") if isinstance(region, dict) else None

    def _text(v: object) -> str:
        return "" if v is None else str(v)

    return Cluster(
        organization_id=_text(org_id),
        organization_name=_text(org_name),
        cluster_id=_text(item.get("id")),
        cluster_name=_text(item.get("name")),
        provider=_text(item.get("providerType")),
        region=_text(region_name),
        status=_text(item.get("status")),
    )


def build_fleet_row(
    *,
    organization_id: str,
    organization_name: str,
    cluster_item: dict | None = None,
    summary_item: dict | None = None,
    overview_item: dict | None = None,
    wa_status: str | None = None,
    wa_available: bool = True,
    wa_entry: dict | None = None,
    efficiency_item: dict | None = None,
    fetched_at: object = None,
) -> dict:
    """Join one cluster's Tier-1 payloads into a FLEET_COLUMNS row dict.

    data_status matrix (missing inputs keep pd.NA, never 0):
      * ``"ok"``          -- summary payload present for this cluster
                             (summary is THE fleet-table source, api-matrix §3.1)
      * ``"partial"``     -- no summary, but overview and/or WA status present
      * ``"unavailable"`` -- nothing but (maybe) the inventory item: the org's
                             cost-report/WA fan-out failed; the row still exists
                             from cluster_item.

    ``wa_entry`` (v2): the full matched ``clusterAgentStatuses[]`` record. When
    given and ``wa_status`` is None, the status is read off the entry — old
    callers passing only ``wa_status`` keep working unchanged.
    ``efficiency_item`` (v2, ADR R2): the matched ``clusters/efficiency``
    ``items[]`` record — the waste-column source (NEVER summed with spend or
    savings, resource-metrics §7).
    """
    cluster_item = cluster_item if isinstance(cluster_item, dict) else None
    summary_item = summary_item if isinstance(summary_item, dict) else None
    overview_item = overview_item if isinstance(overview_item, dict) else None
    ci = cluster_item or {}
    si = summary_item or {}
    oi = overview_item or {}
    we = wa_entry if isinstance(wa_entry, dict) else None
    ei = efficiency_item if isinstance(efficiency_item, dict) else None
    if wa_status is None and we is not None:
        wa_status = we.get("status")

    base = normalize_cluster_item(organization_id, organization_name, cluster_item)
    cluster_id = base.cluster_id or str(si.get("clusterId") or oi.get("clusterId") or "")

    # --- summary (§3.1): one current-state row per cluster, string numerics ---
    cpu_provisioned = _sum_fields(si, "cpuProvisionedOnDemand", "cpuProvisionedSpot", "cpuProvisionedSpotFallback")
    cpu_allocatable = _sum_fields(si, "cpuAllocatableOnDemand", "cpuAllocatableSpot", "cpuAllocatableSpotFallback")
    cpu_requested = _sum_fields(si, "cpuRequestedOnDemand", "cpuRequestedSpot", "cpuRequestedSpotFallback")
    cpu_used = parse_number(si.get("cpuUsed"))
    ram_provisioned = _sum_fields(si, "ramProvisionedOnDemand", "ramProvisionedSpot", "ramProvisionedSpotFallback")
    ram_allocatable = _sum_fields(si, "ramAllocatableOnDemand", "ramAllocatableSpot", "ramAllocatableSpotFallback")
    ram_requested = _sum_fields(si, "ramRequestedOnDemand", "ramRequestedSpot", "ramRequestedSpotFallback")
    ram_used = parse_number(si.get("ramUsed"))  # spec: "Used RAM GiB" -- no scaling

    nodes_on_demand = parse_number(si.get("nodeCountOnDemand"))
    nodes_spot = parse_number(si.get("nodeCountSpot"))
    nodes_fallback = parse_number(si.get("nodeCountSpotFallbackCastai"))  # CAST-managed only
    # unknownNodeCount is EXCLUDED from nodes_total (data-model.md §2 row 21);
    # it rides along as the nodes_unknown auxiliary column instead.
    nodes_total = _sum_present(nodes_on_demand, nodes_spot)

    cost_hourly = _sum_fields(si, "costHourlyOnDemand", "costHourlySpot", "costHourlySpotFallback")
    monthly_cost = cost_hourly * HOURS_PER_MONTH if cost_hourly is not None else None
    unschedulable_pods = parse_number(si.get("unschedulablePodCount"))

    # --- v2 resource sections from the SAME summary item -------------------
    # ADR R8: request efficiency = used / REQUESTED, requested>0 row mask
    # (a cluster with no sized requests is "no requests", never 0%).
    cpu_request_efficiency = _safe_ratio_pos(cpu_used, cpu_requested)
    memory_request_efficiency = _safe_ratio_pos(ram_used, ram_requested)
    # ADR R6: NA coverage from the summary *Castai counters (+0 calls).
    na_managed_nodes = _sum_fields(
        si, "nodeCountOnDemandCastai", "nodeCountSpotCastai", "nodeCountSpotFallbackCastai"
    )
    na_coverage = _safe_ratio_pos(na_managed_nodes, nodes_total)
    # Storage (resource-metrics §3). TRAP: storageRequested is ACTIVE claims;
    # storage_commit_pct is "commit" (claims/provisioned), never "utilization".
    storage_provisioned = parse_number(si.get("storageProvisioned"))
    storage_claimed = parse_number(si.get("storageClaimed"))
    storage_active_claimed = parse_number(si.get("storageRequested"))
    storage_cost = parse_number(si.get("storageCostHourly"))
    storage_commit = _safe_ratio_pos(storage_claimed, storage_provisioned)

    # --- overview (§3.6): savings are PAIRWISE on the overview item's own
    # costHourly/optimalCostHourly (data-model.md §3.7 "same mask") ---
    ov_cost = parse_number(oi.get("costHourly"))
    ov_optimal = parse_number(oi.get("optimalCostHourly"))
    potential_savings_hourly = (
        ov_cost - ov_optimal if (ov_cost is not None and ov_optimal is not None) else None
    )
    potential_savings_percentage = _safe_ratio(potential_savings_hourly, ov_cost)
    # v2 savings polarity (finops §2 rule 9): raw is NEVER clamped; the boolean
    # lenses stay NA when the raw value is absent.
    has_positive_savings = (
        pd.NA if potential_savings_hourly is None else bool(potential_savings_hourly > 0)
    )
    has_negative_savings = (
        pd.NA if potential_savings_hourly is None else bool(potential_savings_hourly < 0)
    )

    # --- v2 waste (clusters/efficiency items[].wasted.*, DOUBLES, USD/window).
    # Three lenses law (resource-metrics §7): NEVER add waste to spend or to
    # potential savings. All-three-absent -> total NA (min_count=1 per class).
    wasted = ei.get("wasted") if isinstance(ei, dict) else {}
    wasted = wasted if isinstance(wasted, dict) else {}
    waste_cpu = parse_number(wasted.get("cpu"))
    waste_ram = parse_number(wasted.get("ram"))
    waste_storage = parse_number(wasted.get("storage"))
    waste_total = _sum_present(waste_cpu, waste_ram, waste_storage)

    # --- v2 WA display family (autoscaler-model §2.2; MAJOR-3 pd.NA stands).
    # The display helper needs the payload-arrived-vs-failed distinction
    # expressed through the entry: failed org call -> None (NA), arrived ->
    # dict (missing cluster row -> "Not installed").
    display_entry = (we if we is not None else {}) if wa_available else None
    wa_current_version = we.get("currentVersion") if isinstance(we, dict) else None
    wa_latest_version = we.get("latestVersion") if isinstance(we, dict) else None
    if isinstance(wa_current_version, str) and wa_current_version and isinstance(
        wa_latest_version, str
    ) and wa_latest_version:
        wa_version_drift = bool(wa_current_version != wa_latest_version)
    else:
        wa_version_drift = pd.NA
    wa_resize_raw = we.get("inPlaceResizeEnabled") if isinstance(we, dict) else None
    wa_in_place_resize = bool(wa_resize_raw) if isinstance(wa_resize_raw, bool) else pd.NA
    wa_last_reported = (
        pd.to_datetime(we.get("updatedAt"), errors="coerce", utc=True)
        if isinstance(we, dict)
        else pd.NaT
    )

    # --- v2 freshness + agent health (reliability-model §6, +0 calls) -------
    snapshot_ts = pd.to_datetime(ci.get("agentSnapshotReceivedAt"), errors="coerce", utc=True)
    last_updated = pd.to_datetime(fetched_at, errors="coerce", utc=True)  # NaT on garbage
    now = _utc_now()
    snapshot_age = None
    if pd.notna(snapshot_ts):
        # clock-skew guard: a barely-future timestamp is 0 minutes old, never negative
        snapshot_age = max(0.0, (now - snapshot_ts).total_seconds() / 60.0)
    if pd.notna(snapshot_ts):
        latest_sync = snapshot_ts
        age_minutes = snapshot_age
    elif pd.notna(last_updated):
        latest_sync = last_updated
        age_minutes = max(0.0, (now - last_updated).total_seconds() / 60.0)
    else:
        latest_sync = pd.NaT
        age_minutes = None
    if age_minutes is None:
        freshness = "unknown"
    else:
        freshness = "fresh" if age_minutes < FRESHNESS_FRESH_MINUTES else "stale"
    agent_health = agent_health_value(ci.get("status"), ci.get("agentStatus"), snapshot_age)

    # --- v2 ghosts (audit #10): reporting_state UNSPECIFIED exactly ----------
    reporting_state = oi.get("state")
    is_ghost = isinstance(reporting_state, str) and reporting_state == GHOST_REPORTING_STATE

    # --- v2 k8s version normalization (audit #4) ------------------------------
    version_raw = ci.get("kubernetesVersion")
    version_short, version_known = kubernetes_version_short(version_raw)

    # --- resilience marker ---
    if summary_item is not None:
        data_status = "ok"
    elif overview_item is not None or wa_status:
        data_status = "partial"
    else:
        data_status = "unavailable"

    row = {
        # identity (grain: (organization_id, cluster_id); names NOT unique)
        "organization_name": organization_name,
        "organization_id": organization_id,
        "cluster_name": _na_text(base.cluster_name),
        "cluster_id": _na_text(cluster_id),
        # inventory (external-clusters §2.1)
        "provider": _na_text(base.provider),
        "region": _na_text(base.region),
        "status": _na_text(ci.get("status")),
        "agent_status": _na_text(ci.get("agentStatus")),
        "kubernetes_version": _na_text(version_raw),  # nullable -> pd.NA
        # CPU cores (Σ over OnDemand/Spot/SpotFallback, min_count=1)
        "cpu_provisioned": _na(cpu_provisioned),
        "cpu_allocatable": _na(cpu_allocatable),
        "cpu_requested": _na(cpu_requested),
        "cpu_used": _na(cpu_used),
        # ADR v2 R8 rename: was cpu_efficiency — SAME 0–1 value (used/allocatable)
        "cpu_utilization_pct": _na(_safe_ratio(cpu_used, cpu_allocatable)),
        # RAM GiB (ClusterSummary is already GiB-scale; NO unit conversion)
        "memory_provisioned_gib": _na(ram_provisioned),
        "memory_allocatable_gib": _na(ram_allocatable),
        "memory_requested_gib": _na(ram_requested),
        "memory_used_gib": _na(ram_used),
        # ADR v2 R8 rename: was memory_efficiency — SAME 0–1 value
        "memory_utilization_pct": _na(_safe_ratio(ram_used, ram_allocatable)),
        # nodes
        "nodes_total": _na(nodes_total),
        "nodes_spot": _na(nodes_spot),
        "nodes_on_demand": _na(nodes_on_demand),
        "nodes_fallback": _na(nodes_fallback),
        # money (USD/h; monthly = x730 run-rate)
        "cost_hourly": _na(cost_hourly),
        "monthly_cost": _na(monthly_cost),
        # savings opportunity (overview, pairwise)
        "potential_savings_hourly": _na(potential_savings_hourly),
        "potential_savings_percentage": _na(potential_savings_percentage),
        # autoscaler / health
        # Final-review MAJOR-3: "Not installed" applies ONLY when the org WA
        # payload ARRIVED but has no row for this cluster. A failed/absent org
        # WA call (wa_available=False) renders NA so the cluster leaves the
        # wa_coverage mask instead of polluting its denominator.
        "workload_autoscaler_status": (
            wa_status if wa_status else (WA_NOT_INSTALLED if wa_available else pd.NA)
        ),
        "node_autoscaler_status": TIER2_SENTINEL,   # Tier-2-only (architecture §9.4)
        "problematic_nodes": TIER2_SENTINEL,        # Tier-2-only
        "problematic_workloads": TIER2_SENTINEL,    # Tier-2-only
        "unschedulable_pods": _na(unschedulable_pods),
        "data_status": data_status,
        "last_updated": last_updated,
    }

    extras = {
        "reporting_state": _na_text(reporting_state),
        "optimal_cost_hourly": _na(ov_optimal),
        "is_phase2": ci["isPhase2"] if ci.get("isPhase2") is not None else pd.NA,
        "pod_count": _na(parse_number(si.get("podCount"))),
        "nodes_unknown": _na(parse_number(si.get("unknownNodeCount"))),
        # CAST AI's own cluster score (spec: "Cluster score.", string numeric;
        # scale/range undocumented → passed through as-is, NA when absent).
        "cluster_score": _na(parse_number(si.get("clusterScore"))),
        "potential_savings": _na(
            potential_savings_hourly * HOURS_PER_MONTH
            if potential_savings_hourly is not None
            else None
        ),
        "overview_cost_hourly": _na(ov_cost),
        # v2 request efficiency (ADR R8)
        "cpu_request_efficiency_pct": _na(cpu_request_efficiency),
        "memory_request_efficiency_pct": _na(memory_request_efficiency),
        # v2 NA coverage (ADR R6)
        "na_managed_nodes": _na(na_managed_nodes),
        "na_coverage_pct": _na(na_coverage),
        # v2 storage (resource-metrics §3; commit is a proxy, never utilization)
        "storage_provisioned_gib": _na(storage_provisioned),
        "storage_claimed_gib": _na(storage_claimed),
        "storage_active_claimed_gib": _na(storage_active_claimed),
        "storage_commit_pct": _na(storage_commit),
        "storage_cost_hourly": _na(storage_cost),
        # v2 waste (never summed with spend/savings — module docstring)
        "waste_cpu_usd": _na(waste_cpu),
        "waste_ram_usd": _na(waste_ram),
        "waste_storage_usd": _na(waste_storage),
        "waste_total_usd": _na(waste_total),
        # v2 WA display family
        "wa_display": wa_display(wa_status, display_entry),
        "wa_agent_version": _na_text(wa_current_version),
        "wa_version_drift": wa_version_drift,
        "wa_in_place_resize": wa_in_place_resize,
        "wa_last_reported": wa_last_reported,
        # v2 reliability + freshness
        "agent_health": agent_health,
        "latest_sync_time": latest_sync,
        "snapshot_age_minutes": _na(age_minutes),
        "data_freshness_status": freshness,
        # v2 ghosts + savings polarity + k8s version
        "is_ghost": is_ghost,
        "has_positive_savings_opportunity": has_positive_savings,
        "has_negative_savings": has_negative_savings,
        "kubernetes_version_short": version_short,
        "kubernetes_version_known": version_known,
    }

    # Contract guard: exact FLEET_COLUMNS key set/order first, extras appended after.
    ordered = {name: row[name] for name in FLEET_COLUMNS}
    ordered.update(extras)
    return ordered
