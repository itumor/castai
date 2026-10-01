"""Fleet assembly service (Tier-1 per-org fan-out, Builder B3).

Tier 1 composition (docs/api-matrix.md §12b, docs/architecture.md §3): per child
org fetch — through the read-only client —
  external-clusters  x  organization/clusters/summary  x  organization/overview
  x  organization/clusters/report  x  WA org agent-statuses
joined client-side on cluster_id; organization_id/name stamped from the REQUEST
scope (docs/data-model.md §0 rules 1–2).

Concurrency/resilience (docs/architecture.md §4): ThreadPoolExecutor
(max_workers=8) at org-bundle granularity. EVERY endpoint call is wrapped
individually: a failing endpoint is recorded as a sanitized FetchError and its
payload treated as absent; an org contributes rows as long as ANY payload
arrived (union of cluster ids seen in any payload); only when all 5 calls fail
does the org contribute zero rows. One org's exception NEVER escapes its future
— the sweep never aborts.

Report-window extras (docs/data-model.md §1.5 caveat): clusters[].summary
.totalCost / .totalCostPercentChange are appended as REPORT_EXTRA_COLUMNS for
DISPLAY ONLY ("average"-flavored semantics — never fed to KPI sums).
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

import pandas as pd

from services.organization_service import FetchError
from utils.errors import error_kind, sanitize_message

# Canonical enterprise cluster-table columns (docs/data-model.md; N/A = pd.NA, never silent 0)
# ADR v2 R8 renames: cpu_efficiency -> cpu_utilization_pct,
# memory_efficiency -> memory_utilization_pct (SAME 0–1 values; rename only).
FLEET_COLUMNS: list[str] = [
    "organization_name", "organization_id", "cluster_name", "cluster_id",
    "provider", "region", "status", "agent_status", "kubernetes_version",
    "cpu_provisioned", "cpu_allocatable", "cpu_requested", "cpu_used", "cpu_utilization_pct",
    "memory_provisioned_gib", "memory_allocatable_gib", "memory_requested_gib", "memory_used_gib", "memory_utilization_pct",
    "nodes_total", "nodes_spot", "nodes_on_demand", "nodes_fallback",
    "cost_hourly", "monthly_cost",
    "potential_savings_hourly", "potential_savings_percentage",
    "workload_autoscaler_status", "node_autoscaler_status",
    "problematic_nodes", "problematic_workloads", "unschedulable_pods",
    "data_status",  # ok | partial | unavailable  (resilience marker)
    "last_updated",
]

# Display-only report-window columns appended after FLEET_COLUMNS + the
# normalizer extras (docs/data-model.md §1.5 caveat — never in KPI math).
REPORT_EXTRA_COLUMNS: list[str] = ["report_period_cost", "report_cost_pct_change"]

# The 5-call per-org bundle: (operation label, client method, windowed?).
_BUNDLE_ENDPOINTS = (
    ("clusters", "get_clusters", False),
    ("summary", "get_org_clusters_summary", False),
    ("overview", "get_org_overview", True),
    ("report", "get_org_clusters_report", True),
    ("woa", "get_org_wa_agent_statuses", False),
)

# ADR v2 R2: the per-cluster ``organization/clusters/efficiency`` items[] call
# JOINS Tier-1 BY DEFAULT (1 + 6×N budget). Its matched ``items[]`` records feed
# the fleet ``waste_*_usd`` columns (finops-model §4 — USD/window doubles,
# NEVER summed with spend or savings) and the whole payload is carried out on
# FleetResult.org_efficiency. One page at the default limit=500 (no org in the
# design envelope approaches 500 clusters); the org-level efficiency/summary
# totalWaste cross-check stays drill-down-only (cost_service.waste_by_organization).
_ORG_EFFICIENCY_ENDPOINT = ("org_efficiency", "get_org_cluster_efficiency", True)

# ADR v2 R11 (OPS-VISIBILITY wave): `/v1/rebalancing-schedules` is the 7th
# per-org Tier-1 call (default ON, flag CASTAI_ENABLE_REBALANCE_SCHEDULES).
# NOT windowed — the schedule inventory is point-in-time. The payloads ride
# FleetResult.rebalance_schedules at ORG level: schedule↔cluster linkage is
# NOT resolvable from this payload (embedded jobs[] are opaque by contract;
# launchConfiguration NodeSelectors are label selectors with no cluster field,
# spec-verified), so fleet rows keep rebalance_* columns NA and per-cluster
# truth comes from the drill-down rebalancing-jobs endpoint (NA tab).
_REBALANCE_SCHEDULES_ENDPOINT = ("rebalance_schedules", "get_rebalancing_schedules", False)

_MAX_WORKER_CAP = 32  # docs/architecture.md §4

_ENV_FLAG_ORG_EFFICIENCY = "CASTAI_ENABLE_ORG_EFFICIENCY"
_ENV_FLAG_REBALANCE_SCHEDULES = "CASTAI_ENABLE_REBALANCE_SCHEDULES"
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


def _org_efficiency_default() -> bool:
    """Env resolution of the org-efficiency Tier-1 flag (service-side default).

    The v1 settings flag was declared-but-inert; ADR v2 turns it ON by
    default. app.py's cached sweep signature is unchanged, so the flag is
    resolved env-first here (same precedence as config/settings.py); an
    unset/unknown value means ON. The flag is OFF when explicitly disabled.
    """

    raw = os.environ.get(_ENV_FLAG_ORG_EFFICIENCY)
    if raw is None:
        return True
    lowered = raw.strip().lower()
    if lowered in _FALSE_VALUES:
        return False
    return True  # unknown values stay ON (fail-visible: extra verified call)


def _env_flag_default(env_name: str) -> bool:
    """Shared env-first bool resolution (ON unless explicitly disabled —
    fail-visible: a typo keeps the extra verified call rather than silently
    dropping data). Mirrors config/settings.py precedence."""

    raw = os.environ.get(env_name)
    if raw is None:
        return True
    lowered = raw.strip().lower()
    if lowered in _FALSE_VALUES:
        return False
    return True


def _rebalance_schedules_default() -> bool:
    """Env resolution of the rebalancing-schedules Tier-1 flag (default ON)."""

    return _env_flag_default(_ENV_FLAG_REBALANCE_SCHEDULES)


@dataclass
class FleetResult:
    df: pd.DataFrame  # columns = FLEET_COLUMNS
    errors: list[FetchError] = field(default_factory=list)
    fetched_at: str = ""  # ISO-8601 UTC
    # {org_id: raw organization/clusters/report payload} — carried out so the
    # cost trend needs NO second per-org sweep (final-review MAJOR-2).
    reports: dict = field(default_factory=dict)
    # {org_id: raw organization/clusters/efficiency payload} (items[] with
    # per-cluster wasted{cpu,ram,storage}) — populated only when the
    # org-efficiency Tier-1 flag is ON (ADR v2 R2 default); matched items feed
    # the fleet waste_*_usd columns during row build.
    org_efficiency: dict = field(default_factory=dict)
    # {org_id: raw /v1/rebalancing-schedules payload} — populated only when
    # the rebalancing-schedules Tier-1 flag is ON (ADR v2 R11 default).
    # ORG-LEVEL ONLY: no row join (embedded jobs[] are opaque; NodeSelectors
    # carry no cluster field). Surfaced in the NA-tab Rebalancing section.
    rebalance_schedules: dict = field(default_factory=dict)


def _utc_iso_seconds() -> str:
    """FleetResult.fetched_at: UTC, second precision, RFC-3339 'Z' suffix."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fetch_bundle(
    client,
    org_id: str,
    org_name: str,
    start: str,
    end: str,
    *,
    include_org_efficiency: bool = True,
    include_rebalance_schedules: bool = True,
) -> tuple[dict[str, dict | None], list[FetchError]]:
    """Fetch the Tier-1 payloads for ONE org; NEVER raises.

    5 base calls (+1 ``org_efficiency`` when the flag is ON — ADR v2 default;
    +1 ``rebalance_schedules`` when ITS flag is ON — ADR v2 R11 default).
    Each call is wrapped individually: failure -> FetchError (sanitized) and
    that payload is None. A non-dict wire answer counts as a failed endpoint.
    """
    endpoints = list(_BUNDLE_ENDPOINTS)
    if include_org_efficiency:
        endpoints.append(_ORG_EFFICIENCY_ENDPOINT)
    if include_rebalance_schedules:
        endpoints.append(_REBALANCE_SCHEDULES_ENDPOINT)
    payloads: dict[str, dict | None] = {}
    errors: list[FetchError] = []
    for operation, method, windowed in endpoints:
        try:
            call = getattr(client, method)
            raw = call(org_id, start, end) if windowed else call(org_id)
        except Exception as exc:  # one endpoint/org must never escape
            payloads[operation] = None
            errors.append(
                FetchError(
                    organization_id=org_id,
                    organization_name=org_name,
                    operation=operation,
                    message=sanitize_message(str(exc)),
                    kind=error_kind(exc),
                )
            )
            continue
        payloads[operation] = raw if isinstance(raw, dict) else None
        if not isinstance(raw, dict):
            errors.append(
                FetchError(
                    organization_id=org_id,
                    organization_name=org_name,
                    operation=operation,
                    message="endpoint returned a non-object payload",
                    kind="PayloadError",
                )
            )
    return payloads, errors


def _index_by(items: object, key: str) -> dict[str, dict]:
    """Index an items[]/clusters[] wire list by an id field; first entry wins."""
    out: dict[str, dict] = {}
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        cid = item.get(key)
        if cid is None or cid == "":
            continue
        out.setdefault(str(cid), item)
    return out


def _org_rows(
    client,
    org_id: str,
    org_name: str,
    start: str,
    end: str,
    fetched_at: object,
    include_org_efficiency: bool = True,
    include_rebalance_schedules: bool = True,
) -> tuple[list[dict], list[FetchError], dict | None, dict | None, dict | None]:
    """Build one org's fleet rows + errors. NEVER raises (executor isolation)."""
    # Deferred: data.normalizers imports FLEET_COLUMNS from this module, so a
    # top-level import here would close a circular-import trap.
    from data.normalizers import build_fleet_row, parse_number

    payloads, errors = _fetch_bundle(
        client, org_id, org_name, start, end,
        include_org_efficiency=include_org_efficiency,
        include_rebalance_schedules=include_rebalance_schedules,
    )
    if all(payloads[op] is None for op, _, _ in _BUNDLE_ENDPOINTS):
        return [], errors, None, None, None  # all 5 base endpoints failed -> zero rows

    # api-matrix §2.1: deleted clusters (deletedAt set) are excluded everywhere —
    # blacklisted from the id union so a stale summary/overview/report row for a
    # deleted cluster can never sneak back into the fleet table or its KPIs.
    inventory_raw = _index_by((payloads["clusters"] or {}).get("items"), "id")
    deleted_ids = {cid for cid, item in inventory_raw.items() if item.get("deletedAt")}
    inventory = {cid: item for cid, item in inventory_raw.items() if cid not in deleted_ids}
    summary_map = _index_by((payloads["summary"] or {}).get("items"), "clusterId")
    overview_map = _index_by((payloads["overview"] or {}).get("clusters"), "clusterId")
    report_map = _index_by((payloads["report"] or {}).get("clusters"), "clusterId")
    wa_map = _index_by((payloads["woa"] or {}).get("clusterAgentStatuses"), "clusterId")
    # ADR v2 R2: per-cluster efficiency items (wasted.{cpu,ram,storage}) joined
    # by clusterId into the waste columns at row-build time (finops-model §4).
    efficiency_payload = (
        payloads.get("org_efficiency") if isinstance(payloads.get("org_efficiency"), dict) else None
    )
    efficiency_map = _index_by((efficiency_payload or {}).get("items"), "clusterId")
    # ADR v2 R11: rebalance schedules stay ORG-level (no row join — see the
    # FleetResult field note); the payload is only carried out.
    rebalance_payload = (
        payloads.get("rebalance_schedules")
        if isinstance(payloads.get("rebalance_schedules"), dict) else None
    )

    # Report-window extras per cluster (display-only; see module docstring).
    report_extras: dict[str, dict[str, float | None]] = {}
    for cid, entry in report_map.items():
        per_summary = entry.get("summary")
        per_summary = per_summary if isinstance(per_summary, dict) else {}
        report_extras[cid] = {
            "report_period_cost": parse_number(per_summary.get("totalCost")),
            "report_cost_pct_change": parse_number(per_summary.get("totalCostPercentChange")),
        }

    # Union of cluster ids seen in ANY payload; inventory order first, then
    # first-seen order across the other payloads (deleted clusters excluded).
    all_ids = [
        cid
        for cid in dict.fromkeys(
            list(inventory) + list(summary_map) + list(overview_map) + list(report_map) + list(wa_map)
        )
        if cid not in deleted_ids
    ]

    # Final-review MAJOR-3: distinguish "org WA call failed/absent" (render NA)
    # from "payload arrived but cluster missing" (render "Not installed").
    wa_available = isinstance(payloads.get("woa"), dict)
    report_payload = payloads.get("report") if isinstance(payloads.get("report"), dict) else None

    rows: list[dict] = []
    for cid in all_ids:
        wa_entry = wa_map.get(cid) or {}
        row = build_fleet_row(
            organization_id=org_id,
            organization_name=org_name,
            cluster_item=inventory.get(cid),
            summary_item=summary_map.get(cid),
            overview_item=overview_map.get(cid),
            wa_status=wa_entry.get("status"),
            wa_available=wa_available,
            wa_entry=wa_entry,
            efficiency_item=efficiency_map.get(cid),
            fetched_at=fetched_at,
        )
        # The row exists because of cid; stamp it when no payload carried the id
        # (e.g. cluster seen only in the report payload — build_fleet_row can
        # then leave cluster_id empty). This fills a hole; it never overwrites.
        if not isinstance(row.get("cluster_id"), str) or not row["cluster_id"]:
            row["cluster_id"] = cid
        extras = report_extras.get(cid) or {}
        for name in REPORT_EXTRA_COLUMNS:
            value = extras.get(name)
            row[name] = pd.NA if value is None else value
        rows.append(row)
    return rows, errors, report_payload, efficiency_payload, rebalance_payload


def build_fleet_dataframe(
    client,
    organizations: list,
    start: str,
    end: str,
    *,
    max_workers: int = 8,
    progress_cb: Callable[[str, int, int], None] | None = None,
    include_org_efficiency: bool | None = None,
    include_rebalance_schedules: bool | None = None,
) -> FleetResult:
    """Enterprise fleet table: one row per (organization_id, cluster_id).

    Org bundles run concurrently (ThreadPoolExecutor); per-endpoint failures
    become FetchErrors and missing payloads; ``progress_cb(org_name, done,
    total)`` fires as each org future completes. An empty sweep still returns a
    dataframe carrying the full canonical column order.

    ``include_org_efficiency``: None resolves env-first (ADR v2 default ON):
    the per-org bundle then costs 6 calls (5 base + ``clusters/efficiency``),
    keeping the Tier-1 budget at ``1 + 6×N_orgs`` (perf-v2 §1.1). Explicit
    False restores the v1 5-call bundle. The efficiency payloads ride
    ``FleetResult.org_efficiency`` AND feed the per-row waste_*_usd columns
    (items[] matched by clusterId during row build; ADR v2 R2).

    ``include_rebalance_schedules``: None resolves env-first (ADR v2 R11
    default ON): the per-org bundle then costs 7 calls (+``rebalancing-
    schedules``), budget ``1 + 7×N_orgs``; explicit OFF keeps the 6-call
    bundle. Payloads ride ``FleetResult.rebalance_schedules`` at ORG level —
    no row join (opaque embedded jobs[]; NodeSelectors carry no cluster id).
    """
    # Deferred: data.normalizers imports FLEET_COLUMNS from this module.
    from data.normalizers import EXTRA_COLUMNS

    if include_org_efficiency is None:
        include_org_efficiency = _org_efficiency_default()
    if include_rebalance_schedules is None:
        include_rebalance_schedules = _rebalance_schedules_default()

    columns = list(dict.fromkeys([*FLEET_COLUMNS, *EXTRA_COLUMNS, *REPORT_EXTRA_COLUMNS]))
    orgs = [o for o in (organizations or []) if o is not None]
    fetched_at = _utc_iso_seconds()

    rows_all: list[dict] = []
    errors_all: list[FetchError] = []
    reports: dict[str, dict] = {}
    org_efficiency: dict[str, dict] = {}
    rebalance_schedules: dict[str, dict] = {}
    total = len(orgs)
    done = 0

    workers = max(1, min(int(max_workers), _MAX_WORKER_CAP))
    if total:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    _org_rows,
                    client,
                    str(org.organization_id),
                    str(org.organization_name),
                    start,
                    end,
                    fetched_at,
                    include_org_efficiency,
                    include_rebalance_schedules,
                ): org
                for org in orgs
            }
            for future in as_completed(futures):
                org = futures[future]
                try:
                    org_rows, org_errors, org_report, org_eff, org_reb = future.result()
                except Exception as exc:  # belt-and-braces: NEVER abort the sweep
                    org_rows, org_errors, org_report, org_eff, org_reb = (
                        [],
                        [
                            FetchError(
                                organization_id=str(getattr(org, "organization_id", "")),
                                organization_name=str(getattr(org, "organization_name", "")),
                                operation="org_bundle",
                                message=sanitize_message(str(exc)),
                                kind=error_kind(exc),
                            )
                        ],
                        None,
                        None,
                        None,
                    )
                rows_all.extend(org_rows)
                errors_all.extend(org_errors)
                if org_report is not None:
                    reports[str(org.organization_id)] = org_report
                if org_eff is not None:
                    org_efficiency[str(org.organization_id)] = org_eff
                if org_reb is not None:
                    rebalance_schedules[str(org.organization_id)] = org_reb
                done += 1
                if progress_cb is not None:
                    try:
                        progress_cb(str(org.organization_name), done, total)
                    except Exception:
                        pass  # UI telemetry must never break the sweep

    df = pd.DataFrame(rows_all, columns=columns)
    return FleetResult(
        df=df,
        errors=errors_all,
        fetched_at=fetched_at,
        reports=reports,
        org_efficiency=org_efficiency,
        rebalance_schedules=rebalance_schedules,
    )


def build_org_reports(client, organizations: list, start: str, end: str, max_workers: int = 8) -> tuple[dict, list]:
    """Per-org ``organization/clusters/report`` fetch -> ({org_id: report}, errors).

    Same resilience contract as :func:`build_fleet_dataframe` (per-org failure
    isolated, recorded as a sanitized FetchError, never raised). Used by
    ``services.cost_service.get_cost_trend``.
    """
    orgs = [o for o in (organizations or []) if o is not None]

    def _one(org) -> tuple[str, str, dict | None, str | None, str]:
        org_id = str(org.organization_id)
        org_name = str(org.organization_name)
        try:
            raw = client.get_org_clusters_report(org_id, start, end)
        except Exception as exc:
            return org_id, org_name, None, sanitize_message(str(exc)), error_kind(exc)
        if not isinstance(raw, dict):
            return org_id, org_name, None, "endpoint returned a non-object payload", "PayloadError"
        return org_id, org_name, raw, None, ""

    workers = max(1, min(int(max_workers), _MAX_WORKER_CAP))
    reports: dict[str, dict] = {}
    errors: list[FetchError] = []
    if orgs:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_one, org) for org in orgs]
            for future in as_completed(futures):
                try:
                    org_id, org_name, payload, message, kind = future.result()
                except Exception as exc:
                    errors.append(
                        FetchError(
                            organization_id="",
                            organization_name="",
                            operation="report",
                            message=sanitize_message(str(exc)),
                            kind=error_kind(exc),
                        )
                    )
                    continue
                if message is not None:
                    errors.append(
                        FetchError(
                            organization_id=org_id,
                            organization_name=org_name,
                            operation="report",
                            message=message,
                            kind=kind,
                        )
                    )
                elif payload is not None:
                    reports[org_id] = payload
    return reports, errors
