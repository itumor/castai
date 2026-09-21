"""Cost/savings enterprise aggregation (contract — implemented by Builder B3).

Aggregation rules (docs/data-model.md, docs/metrics.md):
  * enterprise_monthly_cost  = SUM(cluster monthly cost)                [USD/month]
  * potential_savings        = SUM(cluster potential savings)           [USD/hour -> /month]
  * potential_savings_pct    = SUM(savings) / SUM(current cost)         [weighted, never mean of %]
  * cpu_utilization_pct    = SUM(cpu_used)/SUM(cpu_allocatable)       [weighted]
  * Realized vs estimated savings are NEVER mixed (only clusters/{id}/savings
    is realized; everything org-level is estimated — label accordingly).

enterprise_kpis / cost_by_organization delegate to data.aggregators (single
source of ratio-of-sums truth). savings_by_organization operates on the
pairwise savings scope only: rows where potential_savings_hourly is present
(monthly_cost and the weighted pct share that mask — docs/data-model.md §3.7).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

import pandas as pd

from data import aggregators
from data.normalizers import HOURS_PER_MONTH, parse_number
from services import cluster_service
from services.organization_service import FetchError
from utils.errors import error_kind, sanitize_message

_SAVINGS_BY_ORG_COLUMNS: list[str] = [
    "organization_name",
    "organization_id",
    "clusters_with_savings",
    "monthly_cost",
    "potential_savings_monthly",
    "potential_savings_pct",
]

_TREND_COLUMNS = ["timestamp", "value"]

_MAX_WORKER_CAP = 32  # docs/architecture.md §4

_WASTE_BY_ORG_COLUMNS: list[str] = [
    "organization_name",
    "organization_id",
    "waste_cpu_usd",
    "waste_ram_usd",
    "waste_storage_usd",
    "waste_total_usd",
    "api_total_waste_usd",
    "waste_drift_flag",
]

_WASTE_DRIFT_THRESHOLD = 0.05  # finops-model §4: derived-vs-totalWaste drift > 5%


def enterprise_kpis(fleet: pd.DataFrame) -> dict:
    """Headline KPI card values — delegates to data.aggregators.enterprise_kpis."""
    return aggregators.enterprise_kpis(fleet)


def cost_by_organization(fleet: pd.DataFrame) -> pd.DataFrame:
    """Per-org cost rollup — delegates to data.aggregators.cost_by_organization."""
    return aggregators.cost_by_organization(fleet)


def _numeric_column(df: pd.DataFrame, name: str) -> pd.Series:
    """fleet[name] as numerics; all-NA series when the column is absent."""
    if df is None or name not in df.columns:
        index = df.index if df is not None else None
        return pd.Series(pd.NA, index=index, dtype="Float64")
    return pd.to_numeric(df[name], errors="coerce")


def _sum_min_count_1(s: pd.Series) -> Any:
    """groupby-agg helper: sum with min_count=1 (all-missing -> NaN, never 0)."""
    return s.sum(min_count=1)


def savings_by_organization(fleet: pd.DataFrame) -> pd.DataFrame:
    """Per-org savings-opportunity rollup, sorted desc by potential savings.

    Scope = rows with ``potential_savings_hourly`` present (pairwise savings
    mask, docs/data-model.md §3.7). ``monthly_cost`` and the weighted pct
    (Σ savings / Σ cost) share that scope — a cluster without savings data
    NEVER pollutes the denominator, and pct is never a mean of per-cluster
    percentages.
    """
    if (
        fleet is None
        or len(fleet) == 0
        or "organization_id" not in fleet.columns
        or "organization_name" not in fleet.columns
    ):
        return pd.DataFrame(columns=_SAVINGS_BY_ORG_COLUMNS)

    work = pd.DataFrame(
        {
            "organization_id": fleet["organization_id"],
            "organization_name": fleet["organization_name"],
            "monthly_cost": _numeric_column(fleet, "monthly_cost"),
            # Final-review MAJOR-1: savings ratios divide by the OVERVIEW item's
            # own costHourly (same-source pairwise mask, data-model §3.7).
            "ov_cost": _numeric_column(fleet, "overview_cost_hourly"),
            "ps_hourly": _numeric_column(fleet, "potential_savings_hourly"),
        }
    )
    scope = work.loc[work["ps_hourly"].notna()]
    if len(scope) == 0:
        return pd.DataFrame(columns=_SAVINGS_BY_ORG_COLUMNS)

    keys = ["organization_id", "organization_name"]
    out = (
        scope.groupby(keys, sort=False, dropna=False)
        .agg(
            clusters_with_savings=("organization_id", "size"),
            monthly_cost=("monthly_cost", _sum_min_count_1),
            __ps_hourly=("ps_hourly", _sum_min_count_1),
        )
        .reset_index()
    )
    out["potential_savings_monthly"] = out["__ps_hourly"] * HOURS_PER_MONTH

    # Weighted pct per org on the pairwise (savings, own overview cost) mask.
    pair = scope.loc[scope["ov_cost"].notna()]
    if len(pair) > 0:
        pair_sums = pair.groupby(keys, sort=False, dropna=False)[["ov_cost", "ps_hourly"]].sum()
        pct = pair_sums["ps_hourly"] / pair_sums["ov_cost"]
        pct = pct.mask(pair_sums["ov_cost"].isna() | (pair_sums["ov_cost"] == 0))
        out = out.merge(pct.rename("potential_savings_pct").reset_index(), on=keys, how="left")
    else:
        out["potential_savings_pct"] = pd.NA

    out = out.drop(columns="__ps_hourly")[_SAVINGS_BY_ORG_COLUMNS]
    return out.sort_values(
        "potential_savings_monthly", ascending=False, na_position="last"
    ).reset_index(drop=True)


def _empty_trend() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": pd.Series(dtype="datetime64[ns, UTC]"),
            "value": pd.Series(dtype="Float64"),
        }
    )


def trend_from_reports(reports: dict) -> pd.DataFrame:
    """Enterprise daily-cost trend from ALREADY-FETCHED per-org report payloads.

    Final-review MAJOR-2: the fleet sweep's own ``organization/clusters/report``
    payloads (FleetResult.reports) feed the chart — NO second per-org sweep.
    Per-org failures are simply absent from `reports` (FetchErrors were
    recorded by the sweep); the trend aggregates whatever arrived.
    Returns columns ``timestamp`` (datetime64[ns, UTC]) and ``value`` (Float64,
    USD/day), sorted ascending.
    """
    frames = [
        aggregators.trend_from_org_report(report)
        for report in (reports or {}).values()
        if isinstance(report, dict)
    ]
    frames = [f for f in frames if len(f) > 0]
    if not frames:
        return _empty_trend()

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.loc[combined["timestamp"].notna()]
    if len(combined) == 0:
        return _empty_trend()

    out = (
        combined.groupby("timestamp", as_index=False)["value"]
        .sum(min_count=1)
        .sort_values("timestamp", ignore_index=True)
    )
    return out


def get_cost_trend(client, organizations: list, start: str, end: str) -> pd.DataFrame:
    """Compatibility wrapper: fetch per-org reports, then :func:`trend_from_reports`.

    Prefer feeding FleetResult.reports from build_fleet_dataframe (the fleet
    sweep already fetched them); this wrapper exists for callers that lack a
    prior sweep. Returns columns ``timestamp`` / ``value`` like above.
    """
    reports, _errors = cluster_service.build_org_reports(client, organizations, start, end)
    return trend_from_reports(reports)


# --------------------------------------------------------------------------
# v2 parallel per-org fetch helpers (failure-isolated, FetchError-recorded).
# --------------------------------------------------------------------------
def _run_per_org(
    orgs: list,
    task: Callable[[Any], tuple[str, str, Any, FetchError | None]],
    *,
    max_workers: int = 8,
    progress_cb: Callable[[str, int, int], None] | None = None,
) -> tuple[dict[str, Any], list[FetchError]]:
    """Fan out one per-org task; NEVER raises. ``task(org)`` ->
    (org_id, org_name, value, error). Values/errors both come back."""

    total = len(orgs)
    if not total:
        return {}, []
    results: dict[str, Any] = {}
    errors: list[FetchError] = []
    workers = max(1, min(int(max_workers), _MAX_WORKER_CAP))
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(task, org) for org in orgs]
        for future in as_completed(futures):
            try:
                org_id, _org_name, value, err = future.result()
            except Exception as exc:  # one org must never abort the set
                org_id, value, err = "", None, FetchError(
                    organization_id="",
                    organization_name="",
                    operation="org_task",
                    message=sanitize_message(str(exc)),
                    kind=error_kind(exc),
                )
            if err is not None:
                errors.append(err)
            if org_id and value is not None:
                results[org_id] = value
            done += 1
            if progress_cb is not None:
                try:
                    progress_cb(org_id, done, total)
                except Exception:
                    pass
    return results, errors


def _waste_for_org(client: Any, org: Any, start: str, end: str) -> tuple[str, str, Any, FetchError | None]:
    """2 serial calls for ONE org (clusters/efficiency pages + summary).

    Derived waste = Σ wasted.{cpu,ram,storage} over all efficiency items
    (min_count=1 per class: a missing class makes the total NA, never a
    silently re-based partial sum); cross-checked against
    ``efficiency/summary.totalWaste`` with a >5% drift flag (finops-model §4).
    """
    org_id = str(getattr(org, "organization_id", ""))
    org_name = str(getattr(org, "organization_name", ""))
    try:
        items = client.get_all_org_cluster_efficiency(org_id, start, end)
        summary = client.get_org_efficiency_summary(org_id, start, end)
    except Exception as exc:
        return org_id, org_name, None, FetchError(
            organization_id=org_id,
            organization_name=org_name,
            operation="waste",
            message=sanitize_message(str(exc)),
            kind=error_kind(exc),
        )
    wasted = {k: [] for k in ("cpu", "ram", "storage")}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        w = item.get("wasted") if isinstance(item.get("wasted"), dict) else {}
        for key in wasted:
            value = parse_number(w.get(key))  # wire: JSON DOUBLES (api-delta §2c)
            if value is not None:
                wasted[key].append(value)
    cpu = sum(wasted["cpu"]) if wasted["cpu"] else None
    ram = sum(wasted["ram"]) if wasted["ram"] else None
    storage = sum(wasted["storage"]) if wasted["storage"] else None
    present = [v for v in (cpu, ram, storage) if v is not None]
    derived_total = sum(present) if len(present) == 3 else None  # min_count=3
    api_total = parse_number((summary or {}).get("totalWaste"))
    if api_total is not None and api_total > 0 and derived_total is not None:
        drift = abs(derived_total - api_total) / api_total > _WASTE_DRIFT_THRESHOLD
    elif api_total == 0 and derived_total is not None:
        drift = derived_total > 0
    else:
        drift = False  # insufficient data — flag only on evidence
    row = {
        "organization_name": org_name,
        "organization_id": org_id,
        "waste_cpu_usd": cpu,
        "waste_ram_usd": ram,
        "waste_storage_usd": storage,
        "waste_total_usd": derived_total,
        "api_total_waste_usd": api_total,
        "waste_drift_flag": drift,
    }
    return org_id, org_name, row, None


def waste_by_organization(
    client: Any,
    organizations: list,
    start: str,
    end: str,
    *,
    max_workers: int = 8,
    progress_cb: Callable[[str, int, int], None] | None = None,
) -> tuple[pd.DataFrame, list[FetchError]]:
    """Derived waste per org (CPU+RAM+storage USD/window) + API cross-check.

    Two calls per org (clusters/efficiency pages, efficiency/summary), orgs in
    parallel; per-org failures isolate into the returned FetchError list.
    """
    orgs = [o for o in (organizations or []) if o is not None]
    results, errors = _run_per_org(
        orgs,
        lambda org: _waste_for_org(client, org, start, end),
        max_workers=max_workers,
        progress_cb=progress_cb,
    )
    rows = [results[key] for key in results]
    return pd.DataFrame(rows, columns=_WASTE_BY_ORG_COLUMNS), errors


def notifications_summary(
    client: Any,
    organizations: list,
    *,
    max_workers: int = 8,
    progress_cb: Callable[[str, int, int], None] | None = None,
) -> tuple[dict, list[FetchError]]:
    """Per-org + enterprise notification counts (reliability-model §4).

    3 ``page.limit=1`` exact-count reads per org (CRITICAL+ERROR / WARNING /
    unacked with isExpired=false). Call-count reads rely on envelope ``count``
    / ``countUnacked`` — items are never downloaded.
    """
    orgs = [o for o in (organizations or []) if o is not None]

    def _task(org: Any) -> tuple[str, str, Any, FetchError | None]:
        org_id = str(getattr(org, "organization_id", ""))
        org_name = str(getattr(org, "organization_name", ""))
        try:
            unacked = client.get_notifications(org_id, is_expired=False, limit=1)
            critical = client.get_notifications(
                org_id, severities=["CRITICAL", "ERROR"], limit=1
            )
            warning = client.get_notifications(org_id, severities=["WARNING"], limit=1)
        except Exception as exc:
            return org_id, org_name, None, FetchError(
                organization_id=org_id,
                organization_name=org_name,
                operation="notifications",
                message=sanitize_message(str(exc)),
                kind=error_kind(exc),
            )
        value = {
            "organization_id": org_id,
            "organization_name": org_name,
            "notifications_unacked": (unacked or {}).get("countUnacked"),
            "notifications_critical": (critical or {}).get("count"),
            "notifications_warning": (warning or {}).get("count"),
        }
        return org_id, org_name, value, None

    results, errors = _run_per_org(
        orgs, _task, max_workers=max_workers, progress_cb=progress_cb
    )
    per_org = list(results.values())

    def _sum(key: str) -> int:
        return int(sum(v[key] for v in per_org if isinstance(v.get(key), (int, float))))

    totals = {
        "unacked": _sum("notifications_unacked"),
        "critical": _sum("notifications_critical"),
        "warning": _sum("notifications_warning"),
        "organizations_ok": len(per_org),
        "organizations_failed": len(errors),
    }
    return {"per_org": per_org, "totals": totals}, errors


def _window_label(start: str, end: str) -> str:
    """Human window label for KPI keys, e.g. ``30d`` / ``24h``."""

    def _parse(ts: str) -> datetime | None:
        try:
            return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None

    a, b = _parse(start), _parse(end)
    if a is None or b is None:
        return "window"
    hours = max(0.0, (b - a).total_seconds() / 3600.0)
    return f"{round(hours)}h" if hours < 48 else f"{round(hours / 24)}d"


def org_oom_totals(
    client: Any,
    organizations: list,
    start: str,
    end: str,
    step_seconds: int = 86400,
    event_types: Any = frozenset({"OOMKilled"}),
    *,
    max_workers: int = 8,
) -> tuple[dict, list[FetchError]]:
    """Fleet/org OOM totals ONLY (reliability-model §3: the org response has
    NO clusterId anywhere — per-cluster attribution is impossible here).

    One ``workload-event-metrics`` call per org; eventCount strings summed
    over ``series[].items[]``; per-org failures isolated.
    """
    orgs = [o for o in (organizations or []) if o is not None]
    # Pre-flight validation (fail-fast on programmer error, not isolated per
    # org like fetch failures): the client enforces the same allow-list.
    from services.castai_client import _validate_event_types

    events = _validate_event_types(event_types or {"OOMKilled"})

    def _task(org: Any) -> tuple[str, str, Any, FetchError | None]:
        org_id = str(getattr(org, "organization_id", ""))
        org_name = str(getattr(org, "organization_name", ""))
        try:
            payload = client.get_org_workload_event_metrics(
                org_id, event_types=events, start=start, end=end, step_seconds=step_seconds
            )
        except Exception as exc:
            return org_id, org_name, None, FetchError(
                organization_id=org_id,
                organization_name=org_name,
                operation="oom_metrics",
                message=sanitize_message(str(exc)),
                kind=error_kind(exc),
            )
        total = 0
        for series in (payload or {}).get("series") or []:
            if not isinstance(series, dict):
                continue
            for item in series.get("items") or []:
                if not isinstance(item, dict):
                    continue
                try:
                    total += int(item.get("eventCount") or 0)
                except (TypeError, ValueError):
                    continue
        return org_id, org_name, total, None

    results, errors = _run_per_org(orgs, _task, max_workers=max_workers)
    label = _window_label(start, end)
    totals = {
        f"oom_kills_{label}": int(sum(results.values())),
        "organizations_ok": len(results),
        "organizations_failed": len(errors),
        "window": label,
    }
    return totals, errors


def cluster_history_bundle(
    client: Any,
    org_id: str,
    cluster_id: str,
    start: str,
    end: str,
    step_seconds: int = 86400,
) -> dict:
    """Cluster history family (3 calls, internally parallel; NEVER raises):
    node-count-history + estimated-savings-history + realized savings
    (historical-model §8). Reused by the drill-down History tabs."""

    calls = {
        "node_count_history": lambda: client.get_cluster_node_count_history(
            org_id, cluster_id, start, end, step_seconds=step_seconds
        ),
        "estimated_savings_history": lambda: client.get_cluster_estimated_savings_history(
            org_id, cluster_id, start, end
        ),
        "realized_savings": lambda: client.get_cluster_realized_savings(
            org_id, cluster_id, start, end, step_seconds=step_seconds
        ),
    }
    payloads: dict[str, Any] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(3, len(calls))) as pool:
        futures = {pool.submit(fn): name for name, fn in calls.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                payloads[name] = future.result()
            except Exception as exc:
                payloads[name] = None
                errors[name] = sanitize_message(str(exc))
    return {
        "available": any(value is not None for value in payloads.values()),
        "org_id": org_id,
        "cluster_id": cluster_id,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        **payloads,
        "errors": errors,
    }
