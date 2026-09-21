"""History analytics service (historical-model §1, §2.3-A, §8).

What lives here (all derived from ALREADY-FETCHED payloads unless a client is
explicitly passed — the fleet sweep's ``FleetResult.reports`` costs 0 calls):

  * :func:`window_pct_from_reports` — ratio-of-sums window cost change from
    per-org report ``summary{}``: prev = ``total/(1+pct/100)`` per org, then
    ``Σcurrent/Σprev − 1`` (never a mean of per-org percentages). Orgs with
    ``pct == −100`` are EXCLUDED from both sums (prev undefined) and counted.
  * :func:`top_movers_from_reports` — per-cluster Δ ranking from the same
    report payloads (0 calls).
  * :func:`spot_trend_from_org_efficiency` — OPT-IN History-scope sweep of
    ``organization/efficiency`` series (+1 call/org, NOT the default tier):
    day × {spot, on_demand, fallback} provisioned-CPU share, ratio-of-sums.
  * :func:`get_cluster_history_bundle` — thin delegate to
    ``cost_service.cluster_history_bundle`` (reused by drill-down later).
"""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

from data.normalizers import parse_number
from services import cost_service

_TOP_MOVER_COLUMNS = [
    "organization_id",
    "cluster_id",
    "cluster_name",
    "period_cost",
    "previous_period_cost",
    "delta_cost",
]


def _summary_of(report: Any) -> dict:
    return report.get("summary") if isinstance(report, dict) and isinstance(report.get("summary"), dict) else {}


def _previous_total(total: float | None, pct_change: float | None) -> float | None:
    """prev = total/(1+pct/100); None when undefined (pct −100 => prev = ∞)."""

    if total is None or pct_change is None or pct_change == -100.0:
        return None
    return total / (1.0 + pct_change / 100.0)


def window_pct_from_reports(reports: dict) -> tuple[float | None, float | None]:
    """(current_period_sum, window_pct_change|None) via ratio-of-sums.

    Pairwise discipline: an org enters the pct numerator/denominator only when
    BOTH its ``totalCost`` and a usable ``totalCostPercentChange`` are present
    (pct == −100 excluded — a zero previous period would fabricate +∞).
    ``reports`` = the sweep's {org_id: report} payloads (0 extra calls).
    """

    cur_values: list[float] = []
    cur_included: list[float] = []
    prev_included: list[float] = []
    for report in (reports or {}).values():
        summary = _summary_of(report)
        total = parse_number(summary.get("totalCost"))
        pct = parse_number(summary.get("totalCostPercentChange"))
        if total is not None:
            cur_values.append(total)
        prev = _previous_total(total, pct)
        if prev is not None and total is not None:
            cur_included.append(total)
            prev_included.append(prev)
    cur_sum = sum(cur_values) if cur_values else None
    prev_sum = sum(prev_included)
    window_pct = ((sum(cur_included) / prev_sum - 1.0) * 100.0) if prev_sum > 0 else None
    return cur_sum, window_pct


def top_movers_from_reports(reports: dict, n: int = 5) -> pd.DataFrame:
    """Per-cluster |Δ| ranking from report ``clusters[].summary`` (0 calls).

    ``previous = total/(1+pct/100)`` per cluster row (historical-model §1.4);
    rows without a usable pct (incl. −100) are excluded rather than imputed.
    """

    rows: list[dict] = []
    for org_id, report in (reports or {}).items():
        clusters = report.get("clusters") if isinstance(report, dict) else None
        for entry in clusters or []:
            if not isinstance(entry, dict):
                continue
            summary = _summary_of(entry)
            total = parse_number(summary.get("totalCost"))
            pct = parse_number(summary.get("totalCostPercentChange"))
            prev = _previous_total(total, pct)
            if total is None or prev is None:
                continue
            rows.append(
                {
                    "organization_id": str(org_id),
                    "cluster_id": str(entry.get("clusterId") or ""),
                    "cluster_name": str(entry.get("clusterName") or ""),
                    "period_cost": total,
                    "previous_period_cost": prev,
                    "delta_cost": total - prev,
                }
            )
    df = pd.DataFrame(rows, columns=_TOP_MOVER_COLUMNS)
    if len(df) == 0:
        return df
    df = df.reindex(df["delta_cost"].abs().sort_values(ascending=False).index)
    return df.head(max(0, int(n))).reset_index(drop=True)


_SPOT_TREND_COLUMNS = [
    "timestamp",
    "spot",
    "on_demand",
    "fallback",
    "spot_share",
    "on_demand_share",
    "fallback_share",
]


def _org_efficiency_frame(payload: Any) -> pd.DataFrame:
    """One org's efficiency SERIES -> (timestamp, spot, on_demand, fallback)
    provisioned-CPU frame. Missing lifecycle blocks stay NA (min_count=1)."""

    rows: list[dict] = []
    for item in (payload or {}).get("items") or []:
        if not isinstance(item, dict):
            continue
        def _cpu(block: Any) -> float | None:
            resources = block.get("cpuResources") if isinstance(block, dict) else None
            if not isinstance(resources, dict):
                return None
            return parse_number(resources.get("provisioned"))

        rows.append(
            {
                "timestamp": pd.to_datetime(item.get("timestamp"), utc=True, errors="coerce"),
                "spot": _cpu(item.get("spot")),
                "on_demand": _cpu(item.get("onDemand")),
                "fallback": _cpu(item.get("fallback")),
            }
        )
    return pd.DataFrame(rows)


def spot_trend_from_org_efficiency(
    client: Any,
    organizations: list,
    start: str,
    end: str,
    *,
    max_workers: int = 8,
    progress_cb: Callable[[str, int, int], None] | None = None,
) -> pd.DataFrame:
    """OPT-IN History-scope fleet spot-CPU-share daily trend (+1 call/org).

    Org efficiency series lifecycle blocks (schema-verified; population is a
    live-validation checkpoint — historical-model §7.3). Per-org failures are
    simply absent (same contract as ``trend_from_reports``); lifecycle classes
    aggregate with ``min_count=1`` so an all-missing class yields NA share,
    never a silently re-based fraction.
    """

    def _task(org: Any) -> tuple[str, str, Any, Any]:
        org_id = str(getattr(org, "organization_id", ""))
        org_name = str(getattr(org, "organization_name", ""))
        try:
            payload = client.get_org_efficiency(org_id, start, end, step_seconds=86400)
        except Exception:
            return org_id, org_name, None, None  # absent, callers see coverage
        return org_id, org_name, _org_efficiency_frame(payload), None

    results, _errors = cost_service._run_per_org(
        [o for o in (organizations or []) if o is not None],
        _task,
        max_workers=max_workers,
        progress_cb=progress_cb,
    )
    frames = [f for f in results.values() if isinstance(f, pd.DataFrame) and len(f) > 0]
    if not frames:
        return pd.DataFrame(columns=_SPOT_TREND_COLUMNS)
    combined = pd.concat(frames, ignore_index=True)
    combined = combined.loc[combined["timestamp"].notna()]
    if len(combined) == 0:
        return pd.DataFrame(columns=_SPOT_TREND_COLUMNS)
    grouped = (
        combined.groupby("timestamp", as_index=False)[["spot", "on_demand", "fallback"]]
        .sum(min_count=1)
        .sort_values("timestamp", ignore_index=True)
    )
    total = grouped[["spot", "on_demand", "fallback"]].sum(axis=1, min_count=1)
    for col in ("spot", "on_demand", "fallback"):
        grouped[f"{col}_share"] = (grouped[col] / total).where(total.gt(0))
    return grouped[_SPOT_TREND_COLUMNS]


def get_cluster_history_bundle(
    client: Any,
    org_id: str,
    cluster_id: str,
    start: str,
    end: str,
    step_seconds: int = 86400,
) -> dict:
    """Drill-down history bundle — delegates to the cost_service family fn
    (node-count-history + estimated-savings-history + realized; 3 calls)."""

    return cost_service.cluster_history_bundle(
        client, org_id, cluster_id, start, end, step_seconds=step_seconds
    )
