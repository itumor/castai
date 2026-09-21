"""Enterprise KPIs & rollups -- ratio-of-sums only (Builder B2, data-plane).

Aggregation law (docs/data-model.md §3, docs/metrics.md global conventions):
  * Every ratio KPI = SUM(numerator) / SUM(denominator) over pairwise-complete
    rows; NEVER a mean of per-cluster percentages.
  * Money sums include only rows where the value is present (min_count=1);
    all-missing -> None (display "N/A"), never 0.
  * 0/0 or empty numerator scope -> None.

Fleet frames passed here may arrive as object dtype (dict-built rows mixing
``pd.NA`` and floats) -- every helper coerces defensively with
``pd.to_numeric(errors="coerce")`` before aggregating.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from data.normalizers import HOURS_PER_MONTH, parse_number

WA_RUNNING = "AGENT_STATUS_RUNNING"

__all__ = [
    "sum_or_na",
    "weighted_ratio",
    "enterprise_kpis",
    "cost_by_organization",
    "trend_from_org_report",
]


def _coerce(series: Any) -> pd.Series:
    """Any sequence/Series -> numeric Series, failures to NaN."""
    if not isinstance(series, pd.Series):
        series = pd.Series(series)
    return pd.to_numeric(series, errors="coerce")


def _numeric_column(df: pd.DataFrame | None, name: str) -> pd.Series:
    """df[name] as numerics; an all-NA Series when the column is absent."""
    if df is None or name not in df.columns:
        index = df.index if df is not None else None
        return pd.Series(pd.NA, index=index, dtype="Float64")
    return _coerce(df[name])


def sum_or_na(series: Any) -> float | None:
    """Sum of present values; None when the series has no usable value.

    (min_count=1 semantics -- a missing measurement never aggregates as 0.)
    """
    if series is None:
        return None
    s = _coerce(series)
    if len(s) == 0:
        return None
    total = s.sum(min_count=1)
    if pd.isna(total):
        return None
    return float(total)


def weighted_ratio(
    df: pd.DataFrame | None,
    numerator_col: str,
    denominator_col: str,
    mask: Any = None,
) -> float | None:
    """SUM(numerator)/SUM(denominator) over pairwise-complete rows.

    Rows where either side is NA are dropped pairwise (never zero-imputed);
    rows with ``denominator <= 0`` are EXCLUDED from the pair-scope too (v2
    fix — a zero/negative denominator is *undefined*, not zero usage; its
    numerator must not stack into the sum either — resource-metrics §4). An
    optional boolean ``mask`` further restricts the scope. Returns None when
    there is no pairwise-complete row or the summed denominator is 0.
    """
    if df is None or len(df) == 0:
        return None
    if numerator_col not in df.columns or denominator_col not in df.columns:
        return None
    num = _coerce(df[numerator_col])
    den = _coerce(df[denominator_col])
    pair = num.notna() & den.notna() & den.gt(0)
    if mask is not None:
        mask_series = pd.Series(mask, index=df.index)
        pair &= mask_series.fillna(False).astype(bool)
    if not bool(pair.any()):
        return None
    num_sum = num.loc[pair].sum()
    den_sum = den.loc[pair].sum()
    if den_sum == 0:
        return None
    return float(num_sum / den_sum)


def _drop_ghosts(df: pd.DataFrame | None) -> pd.DataFrame | None:
    """Remove audit-#10 ghost rows (``is_ghost``) BEFORE any KPI mask.

    Ghosts (``reporting_state == CLUSTER_STATE_UNSPECIFIED`` — cluster_id-only
    rows absent from external-clusters) stay visible in the table but must
    never enter a KPI or an org rollup (ADR v2 R5). Frames without the column
    (older callers) pass through unchanged.
    """
    if df is None or len(df) == 0 or "is_ghost" not in df.columns:
        return df
    ghost = (df["is_ghost"] == True).fillna(False).astype(bool)  # noqa: E712
    return df.loc[~ghost]


def _sum_min_count_1(s: pd.Series) -> float:
    """groupby-agg helper: sum with min_count=1 (all-missing -> NaN)."""
    return s.sum(min_count=1)


def enterprise_kpis(df: pd.DataFrame | None) -> dict:
    """Headline KPI card values over the fleet frame (keys per docs/metrics.md §B).

    None-safe: ratios come from :func:`weighted_ratio`; money/count sums from
    :func:`sum_or_na`; counts that are legitimately zero stay 0 (a measured
    zero is fine -- only *missing* must never become 0).

    v2: ghost rows (``is_ghost``) are masked out before EVERY aggregation
    (ADR v2 R5 / audit #10). ADR v2 R5 savings trio: ``potential_savings_*``
    stays the NET headline (negatives included, never clamped);
    ``gross_savings_opportunity`` sums only raw>0 hourly ×730 (None when no
    positive row), ``headroom_savings`` sums only raw<0 hourly ×730 (None when
    no negative row), ``headroom_clusters`` counts the raw<0 rows.
    ``waste_*_usd`` KPIs are USD/window sums (min_count=1) — NEVER additive
    with spend or savings (resource-metrics §7).
    """
    df = df if isinstance(df, pd.DataFrame) else None
    df = _drop_ghosts(df)

    organizations = 0
    clusters = 0
    wa_coverage = None
    orgs_unavailable = 0
    clusters_with_unscheduled_pods = 0

    if df is not None and len(df) > 0:
        clusters = int(len(df))
        if "organization_id" in df.columns:
            organizations = int(df["organization_id"].nunique())
            if "data_status" in df.columns:
                orgs_unavailable = int(
                    df.loc[df["data_status"] == "unavailable", "organization_id"].nunique()
                )
        if "workload_autoscaler_status" in df.columns:
            # Scope = clusters with a KNOWN WA status. Org WA-call failures
            # render NA (normalizers, final-review MAJOR-3) and leave the mask
            # entirely; data-model §3.9: count(RUNNING)/count(clusters in scope).
            status_col = df["workload_autoscaler_status"]
            in_scope = status_col.notna()
            if int(in_scope.sum()) > 0:
                running = (
                    df.loc[in_scope, "workload_autoscaler_status"].astype("string")
                    == WA_RUNNING
                )
                wa_frame = pd.DataFrame(
                    {"__running": running.astype("float64").to_numpy(),
                     "__scope": 1.0},
                    index=df.index[in_scope],
                )
                wa_coverage = weighted_ratio(wa_frame, "__running", "__scope")
        unsched = _numeric_column(df, "unschedulable_pods")
        clusters_with_unscheduled_pods = int((unsched > 0).sum())

    monthly_cost = sum_or_na(_numeric_column(df, "monthly_cost"))
    savings_hourly = sum_or_na(_numeric_column(df, "potential_savings_hourly"))

    # Savings polarity splits (finops §2 rule 9): the raw hourly series is the
    # ONLY input; negatives are never clamped anywhere.
    ps_series = _numeric_column(df, "potential_savings_hourly")
    ps_positive = ps_series.where(ps_series > 0).dropna()
    ps_negative = ps_series.where(ps_series < 0).dropna()
    gross_hourly = sum_or_na(ps_positive)
    headroom_hourly = sum_or_na(ps_negative)

    return {
        "organizations": organizations,
        "clusters": clusters,
        "nodes_total": sum_or_na(_numeric_column(df, "nodes_total")),
        "monthly_cost": monthly_cost,
        # ADR v2 R8 renames (was cpu_efficiency / memory_efficiency; same values)
        "cpu_utilization_pct": weighted_ratio(df, "cpu_used", "cpu_allocatable"),
        "memory_utilization_pct": weighted_ratio(df, "memory_used_gib", "memory_allocatable_gib"),
        # v2 request efficiency (ADR R8): requested>0 rows only (mask law §4)
        "cpu_request_efficiency_pct": weighted_ratio(df, "cpu_used", "cpu_requested"),
        "memory_request_efficiency_pct": weighted_ratio(df, "memory_used_gib", "memory_requested_gib"),
        # v2 node-autoscaler coverage (ADR R6): ratio-of-sums over masked pairs
        "na_coverage_pct": weighted_ratio(df, "na_managed_nodes", "nodes_total"),
        "potential_savings_monthly": (
            savings_hourly * HOURS_PER_MONTH if savings_hourly is not None else None
        ),
        # Σ(cost − optimal) / Σ cost, pairwise on the OVERVIEW item's own fields
        # (data-model §3.7 "same mask"; final-review MAJOR-1) -- never mean of %
        "potential_savings_pct": weighted_ratio(
            df, "potential_savings_hourly", "overview_cost_hourly"
        ),
        # v2 savings trio companions to the NET headline above (ADR R5)
        "gross_savings_opportunity": (
            gross_hourly * HOURS_PER_MONTH if gross_hourly is not None else None
        ),
        "headroom_savings": (
            headroom_hourly * HOURS_PER_MONTH if headroom_hourly is not None else None
        ),
        "headroom_clusters": int(len(ps_negative)),
        "clusters_with_positive_savings": int(len(ps_positive)),
        # v2 waste totals (USD/window; three-lenses law — never additive)
        "waste_cpu_usd": sum_or_na(_numeric_column(df, "waste_cpu_usd")),
        "waste_ram_usd": sum_or_na(_numeric_column(df, "waste_ram_usd")),
        "waste_storage_usd": sum_or_na(_numeric_column(df, "waste_storage_usd")),
        "waste_total_usd": sum_or_na(_numeric_column(df, "waste_total_usd")),
        "spot_coverage": weighted_ratio(df, "nodes_spot", "nodes_total"),
        "wa_coverage": wa_coverage,
        "clusters_with_unscheduled_pods": clusters_with_unscheduled_pods,
        # Σ pods pending scheduling across the fleet (data-model §3.10).
        "unschedulable_pods_total": sum_or_na(_numeric_column(df, "unschedulable_pods")),
        "orgs_unavailable": orgs_unavailable,
    }


def cost_by_organization(df: pd.DataFrame | None) -> pd.DataFrame:
    """Per-org cost rollup; ratio-of-sums savings pct per org; sorted desc by cost.

    Columns: organization_name, organization_id, clusters, monthly_cost,
    potential_savings_monthly, potential_savings_pct. An org whose cost or
    savings are all-NA stays listed -- its pct is NA (excluded from the ratio),
    its money sums are NA, and it sinks to the bottom of the sort. Ghost rows
    (``is_ghost``) are masked out first (audit #10: "do not count in org
    rollups").
    """
    columns = [
        "organization_name", "organization_id", "clusters",
        "monthly_cost", "potential_savings_monthly", "potential_savings_pct",
    ]
    if (
        df is None
        or len(df) == 0
        or "organization_id" not in df.columns
        or "organization_name" not in df.columns
    ):
        return pd.DataFrame(columns=columns)
    df = _drop_ghosts(df)
    if len(df) == 0:
        return pd.DataFrame(columns=columns)

    work = pd.DataFrame(
        {
            "organization_id": df["organization_id"],
            "organization_name": df["organization_name"],
            "monthly_cost": _numeric_column(df, "monthly_cost"),
            # Final-review MAJOR-1: the savings-ratio denominator is the OVERVIEW
            # item's own costHourly (same-source pairwise mask, data-model §3.7).
            "ov_cost": _numeric_column(df, "overview_cost_hourly"),
            "ps_hourly": _numeric_column(df, "potential_savings_hourly"),
        }
    )
    keys = ["organization_id", "organization_name"]
    grouped = work.groupby(keys, sort=False, dropna=False)
    out = grouped.agg(
        clusters=("organization_id", "size"),
        monthly_cost=("monthly_cost", _sum_min_count_1),
        __ps_hourly=("ps_hourly", _sum_min_count_1),
    ).reset_index()
    out["potential_savings_monthly"] = out["__ps_hourly"] * HOURS_PER_MONTH

    # Weighted pct per org: Σ savings / Σ cost on pairwise-complete rows only
    # (savings carry their OWN overview cost basis -- final-review MAJOR-1).
    pair = work.loc[work["ov_cost"].notna() & work["ps_hourly"].notna()]
    pair_sums = pair.groupby(keys, sort=False, dropna=False)[["ov_cost", "ps_hourly"]].sum()
    pct = pair_sums["ps_hourly"] / pair_sums["ov_cost"]
    pct = pct.mask(pair_sums["ov_cost"].isna() | (pair_sums["ov_cost"] == 0))
    out = out.merge(pct.rename("potential_savings_pct").reset_index(), on=keys, how="left")

    out = out.drop(columns="__ps_hourly")
    out = out[columns]
    return out.sort_values(
        "monthly_cost", ascending=False, na_position="last"
    ).reset_index(drop=True)


def trend_from_org_report(report_json: Any) -> pd.DataFrame:
    """``organization/clusters/report`` ``totalDailyCost[]`` -> chart frame.

    Returns columns ``timestamp`` (datetime64[ns, UTC]) and ``value`` (Float64,
    USD/day; proto3 string numerics parsed). Empty/missing/garbage input yields
    an empty frame with those columns; result sorted ascending by timestamp.
    """
    empty = pd.DataFrame(
        {
            "timestamp": pd.Series(dtype="datetime64[ns, UTC]"),
            "value": pd.Series(dtype="Float64"),
        }
    )
    if not isinstance(report_json, dict):
        return empty
    items = report_json.get("totalDailyCost")
    if not isinstance(items, list) or not items:
        return empty
    rows = [it for it in items if isinstance(it, dict)]
    if not rows:
        return empty
    timestamps = pd.to_datetime(
        [r.get("timestamp") for r in rows], errors="coerce", utc=True
    )
    # pandas 3 infers microseconds; pin the documented ns resolution.
    timestamps = timestamps.astype("datetime64[ns, UTC]")
    values = pd.array([parse_number(r.get("value")) for r in rows], dtype="Float64")
    out = pd.DataFrame({"timestamp": timestamps, "value": values})
    return out.sort_values("timestamp", na_position="last", ignore_index=True)
