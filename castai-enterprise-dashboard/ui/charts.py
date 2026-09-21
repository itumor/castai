"""Plotly chart renderers (docs/ux-design.md §2 charts row, §6 color tokens).

Functions are NA/empty-safe: an empty or all-missing input renders a neutral
``st.info`` hint and returns ``None`` instead of raising (per "Empty/error
states" grammar in ux-design.md §4).

Palette (ux-design.md §6): restrained colorway — spend in blues (#1565C0
family), savings in greens (#2E7D32). Charts must never be the sole color
channel: every chart carries labels/values too.

All inputs are ordinary pandas DataFrames (never live service objects). No
API calls are made here (rerun invariant I1).
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from data.normalizers import HOURS_PER_MONTH
from utils.formatting import fmt_money_compact

__all__ = [
    "SPEND_COLOR",
    "SAVINGS_COLOR",
    "OPTIMAL_COLOR",
    "cost_by_org_bar",
    "current_vs_optimal_bar",
    "daily_cost_trend",
    "spot_adoption_area",
    "realized_savings_area",
    "estimated_history_lines",
    "node_count_history_area",
    "cumulative_realized_line",
]

# ux-design.md §6 tokens.
SPEND_COLOR = "#1565C0"     # savings/spend blue family
OPTIMAL_COLOR = "#90CAF9"   # lighter blue for the "optimized" comparison trace
SAVINGS_COLOR = "#2E7D32"   # green
COLORWAY = [
    "#1565C0", "#2E7D32", "#F9A825", "#C62828", "#9E9E9E",
    "#5E35B1", "#00838F", "#AD1457",
]

_PLOTLY_CONFIG = {"displaylogo": False, "scrollZoom": False}
_NO_DATA_HINT = "No data available for this chart in the current scope."


def _numeric(series: Any) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _template() -> None:
    """Apply the restrained colorway via layout defaults on each figure."""

    # plotly has no global template mutation guarantee across reruns, so each
    # figure sets its own layout colorway explicitly.
    return None


def _finalize(fig: go.Figure, *, height: int = 420) -> go.Figure:
    fig.update_layout(
        height=height,
        margin={"l": 10, "r": 10, "t": 30, "b": 10},
        colorway=COLORWAY,
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "x": 0},
    )
    return fig


def cost_by_org_bar(df: pd.DataFrame | None, *, top_n: int = 20) -> None:
    """Horizontal bar: monthly cost by organization — top N + "Other" rollup.

    Accepts either the fleet frame (per-cluster ``monthly_cost``) or the
    ``cost_by_organization`` aggregate (per-org ``monthly_cost``); grouping by
    ``organization_name`` is correct for both grains. ``min_count=1`` sums keep
    all-missing orgs as NA (shown as N/A in the hover, sorted last).
    """

    if df is None or len(df) == 0:
        st.info(_NO_DATA_HINT)
        return None
    if "organization_name" not in df.columns or "monthly_cost" not in df.columns:
        st.info(_NO_DATA_HINT)
        return None

    work = df[["organization_name", "monthly_cost"]].copy()
    work["organization_name"] = work["organization_name"].fillna("Unknown")
    work["monthly_cost"] = _numeric(work["monthly_cost"])
    grouped = (
        work.groupby("organization_name", dropna=False)["monthly_cost"]
        .sum(min_count=1)
        .reset_index()
        .sort_values("monthly_cost", ascending=False, na_position="last")
    )
    if grouped["monthly_cost"].isna().all():
        st.info(_NO_DATA_HINT)
        return None

    if len(grouped) > top_n:
        head = grouped.head(top_n - 1)
        other = grouped.iloc[top_n - 1 :]["monthly_cost"].sum(min_count=1)
        grouped = pd.concat(
            [head, pd.DataFrame(
                [{"organization_name": f"Other ({len(grouped) - (top_n - 1)} orgs)",
                  "monthly_cost": other}]
            )],
            ignore_index=True,
        )

    plot_df = grouped.copy()
    plot_df["label"] = plot_df["monthly_cost"].map(fmt_money_compact)
    fig = px.bar(
        plot_df,
        x="monthly_cost",
        y="organization_name",
        orientation="h",
        text="label",
        labels={"monthly_cost": "Monthly cost (USD)", "organization_name": ""},
        color_discrete_sequence=[SPEND_COLOR],
    )
    fig.update_traces(hovertemplate="%{y}<br>%{text} / month<extra></extra>",
                      textposition="outside", cliponaxis=False)
    fig.update_layout(yaxis={"categoryorder": "total ascending", "automargin": True})
    _finalize(fig, height=max(360, 28 * len(plot_df) + 120))
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG)
    return fig


def current_vs_optimal_bar(df: pd.DataFrame | None, *, top_n: int = 10) -> None:
    """Grouped bar: current run-rate vs optimal cost hourly, top N clusters.

    Optimal monthly = ``optimal_cost_hourly`` x 730 (run-rate convention,
    docs/metrics.md). Needs ``cluster_name`` + ``monthly_cost`` +
    ``optimal_cost_hourly`` (fleet frame extras); renders info otherwise.
    """

    needed = {"cluster_name", "monthly_cost", "optimal_cost_hourly"}
    if df is None or len(df) == 0 or not needed.issubset(df.columns):
        st.info(_NO_DATA_HINT)
        return None

    work = df[["organization_name", "cluster_name", "monthly_cost",
               "optimal_cost_hourly"]].copy()
    work["monthly_cost"] = _numeric(work["monthly_cost"])
    work["optimal_monthly"] = _numeric(work["optimal_cost_hourly"]) * HOURS_PER_MONTH
    work = work.dropna(subset=["monthly_cost", "optimal_monthly"], how="all")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None

    org = work.get("organization_name")
    org_text = org.fillna("").astype(str) if org is not None else pd.Series([""] * len(work))
    name = work["cluster_name"].fillna("?").astype(str)
    work["label"] = [
        f"{o} / {n}" if o else n
        for o, n in zip(org_text, name)
    ]
    work = work.sort_values("monthly_cost", ascending=False, na_position="last").head(top_n)

    long_df = pd.DataFrame(
        {
            "cluster": list(work["label"]) + list(work["label"]),
            "kind": (["Current"] * len(work)) + (["Optimal"] * len(work)),
            "monthly": list(work["monthly_cost"]) + list(work["optimal_monthly"]),
        }
    )
    long_df["hover"] = long_df["monthly"].map(fmt_money_compact)
    fig = px.bar(
        long_df,
        x="monthly",
        y="cluster",
        color="kind",
        orientation="h",
        barmode="group",
        labels={"monthly": "Monthly run-rate (USD)", "cluster": "", "kind": ""},
        color_discrete_map={"Current": SPEND_COLOR, "Optimal": OPTIMAL_COLOR},
        custom_data=["hover"],
    )
    fig.update_traces(hovertemplate="%{y}<br>%{customdata[0]} / month<extra></extra>")
    fig.update_layout(yaxis={"categoryorder": "total ascending", "automargin": True})

    total_current = _numeric(work["monthly_cost"]).sum(min_count=1)
    total_optimal = _numeric(work["optimal_monthly"]).sum(min_count=1)
    if pd.notna(total_current) and total_current and total_current > 0 and pd.notna(total_optimal):
        delta_pct = (1.0 - float(total_optimal) / float(total_current)) * 100.0
        _finalize(fig, height=max(360, 28 * len(work) + 140))
    else:
        delta_pct = None
        _finalize(fig, height=max(360, 28 * len(work) + 140))
    if delta_pct is not None:
        fig.update_layout(
            title={"text": f"top {len(work)} clusters — optimal is {delta_pct:.0f}% below current",
                   "font": {"size": 13}}
        )
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG)
    return fig


def daily_cost_trend(df: pd.DataFrame | None, *, key: str | None = None) -> None:
    """Line/area: daily cost over the selected range (ux-design.md §2, optional).

    Expects a frame with ``timestamp`` (datetime-like) and ``value`` (numeric)
    columns — the shape produced by the cost-trend service. NA/empty-safe.
    """

    if df is None or len(df) == 0:
        st.info(_NO_DATA_HINT)
        return None
    if "timestamp" not in df.columns or "value" not in df.columns:
        st.info(_NO_DATA_HINT)
        return None

    work = df[["timestamp", "value"]].copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], errors="coerce", utc=True)
    work["value"] = _numeric(work["value"])
    work = work.dropna(subset=["timestamp", "value"]).sort_values("timestamp")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None

    fig = px.area(
        work,
        x="timestamp",
        y="value",
        labels={"timestamp": "", "value": "Daily cost (USD)"},
        color_discrete_sequence=[SPEND_COLOR],
    )
    fig.update_traces(hovertemplate="%{x|%Y-%m-%d}<br>%{customdata[0]}<extra></extra>",
                      customdata=work["value"].map(fmt_money_compact).to_frame("label").values)
    _finalize(fig, height=300)
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG, key=key)
    return fig


def spot_adoption_area(df: pd.DataFrame | None) -> None:
    """Stacked area: fleet spot-CPU adoption over the window (ADR v2 R4).

    Expects the ``spot_trend_from_org_efficiency`` frame: ``timestamp`` +
    ``spot_share`` / ``on_demand_share`` / ``fallback_share`` (0–1 ratios,
    min_count=1 semantics — an absent class stays NA and drops out of the
    stack rather than rendering as 0).
    """

    if df is None or len(df) == 0 or "timestamp" not in df.columns:
        st.info(_NO_DATA_HINT)
        return None

    classes = [
        ("spot_share", "Spot", SPEND_COLOR),
        ("on_demand_share", "On-demand", "#9E9E9E"),
        ("fallback_share", "Fallback", "#F9A825"),
    ]
    frames: list[pd.DataFrame] = []
    for column, label, _color in classes:
        if column not in df.columns:
            continue
        part = df[["timestamp", column]].copy()
        part.columns = ["timestamp", "share"]
        part["class"] = label
        frames.append(part)
    if not frames:
        st.info(_NO_DATA_HINT)
        return None
    work = pd.concat(frames, ignore_index=True)
    work["timestamp"] = pd.to_datetime(work["timestamp"], errors="coerce", utc=True)
    work["share"] = _numeric(work["share"])
    work = work.dropna(subset=["timestamp", "share"]).sort_values("timestamp")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None

    fig = px.area(
        work,
        x="timestamp",
        y="share",
        color="class",
        labels={"timestamp": "", "share": "Provisioned-CPU share", "class": ""},
        color_discrete_map={label: color for _col, label, color in classes},
    )
    fig.update_yaxes(tickformat=".0%", range=[0, 1])
    fig.update_traces(
        hovertemplate="%{x|%Y-%m-%d}<br>%{fullData.name}: %{y:.1%}<extra></extra>"
    )
    _finalize(fig, height=340)
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG)
    coverage_days = int(work["timestamp"].nunique())
    st.caption(f"{coverage_days} day{'s' if coverage_days != 1 else ''} across reporting organizations.")
    return fig


# --------------------------------------------------------------------------
# Wave-C drill-down charts (Savings / History tabs). Same NA/empty-safety
# contract: empty input renders a neutral st.info and returns None.
# --------------------------------------------------------------------------


def realized_savings_area(df: pd.DataFrame | None, *, key: str | None = None) -> None:
    """Stacked area: REALIZED savings per day — downscaling + spot (USD/day).

    Realized amounts, never mixed with estimated USD/h rates (metrics.md §C).
    Expects the ``trend_from_cluster_savings`` frame (timestamp/downscaling/spot).
    """

    if df is None or len(df) == 0 or "timestamp" not in df.columns:
        st.info(_NO_DATA_HINT)
        return None
    frames: list[pd.DataFrame] = []
    for column, label in (("downscaling", "Downscaling"), ("spot", "Spot")):
        if column not in df.columns:
            continue
        part = df[["timestamp", column]].copy()
        part.columns = ["timestamp", "value"]
        part["kind"] = label
        frames.append(part)
    if not frames:
        st.info(_NO_DATA_HINT)
        return None
    work = pd.concat(frames, ignore_index=True)
    work["timestamp"] = pd.to_datetime(work["timestamp"], errors="coerce", utc=True)
    work["value"] = _numeric(work["value"])
    work = work.dropna(subset=["timestamp"]).sort_values("timestamp")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None
    fig = px.area(
        work, x="timestamp", y="value", color="kind",
        labels={"timestamp": "", "value": "Realized savings (USD/day)", "kind": ""},
        color_discrete_map={"Downscaling": SAVINGS_COLOR, "Spot": "#81C784"},
    )
    fig.update_traces(hovertemplate="%{x|%Y-%m-%d}<br>%{fullData.name}: %{y:,.2f} USD<extra></extra>")
    _finalize(fig, height=300)
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG, key=key)
    return fig


def estimated_history_lines(df: pd.DataFrame | None, *, key: str | None = None) -> None:
    """Lines: ESTIMATED costPerHour — current vs optimizedLayman vs
    optimizedSpotInstances (USD/h, model). Irregular cadence: gaps are honest."""

    if df is None or len(df) == 0 or "created_at" not in df.columns:
        st.info(_NO_DATA_HINT)
        return None
    series = [
        ("current_cph", "Current", SPEND_COLOR),
        ("optimized_layman_cph", "Optimized (layman)", SAVINGS_COLOR),
        ("optimized_spot_instances_cph", "Optimized (spot)", OPTIMAL_COLOR),
    ]
    frames: list[pd.DataFrame] = []
    for column, label, _color in series:
        if column not in df.columns:
            continue
        part = df[["created_at", column]].copy()
        part.columns = ["created_at", "value"]
        part["series"] = label
        frames.append(part)
    if not frames:
        st.info(_NO_DATA_HINT)
        return None
    work = pd.concat(frames, ignore_index=True)
    work["created_at"] = pd.to_datetime(work["created_at"], errors="coerce", utc=True)
    work["value"] = _numeric(work["value"])
    work = work.dropna(subset=["created_at", "value"]).sort_values("created_at")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None
    fig = px.line(
        work, x="created_at", y="value", color="series",
        labels={"created_at": "", "value": "Cost (USD/h)", "series": ""},
        color_discrete_map={label: color for _c, label, color in series},
    )
    fig.update_traces(hovertemplate="%{x|%Y-%m-%d}<br>%{fullData.name}: %{y:,.3f} USD/h<extra></extra>")
    _finalize(fig, height=300)
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG, key=key)
    return fig


def node_count_history_area(df: pd.DataFrame | None, *, key: str | None = None) -> None:
    """Stacked area: node counts onDemand/spot/fallback (+ 'unknown' as its own
    series — never silently allocated, historical-model §2.2)."""

    if df is None or len(df) == 0 or "timestamp" not in df.columns:
        st.info(_NO_DATA_HINT)
        return None
    classes = [
        ("on_demand", "On-demand", SPEND_COLOR),
        ("spot", "Spot", SAVINGS_COLOR),
        ("fallback", "Fallback", "#F9A825"),
        ("unknown", "Unknown source", "#9E9E9E"),
    ]
    frames: list[pd.DataFrame] = []
    for column, label, _color in classes:
        if column not in df.columns:
            continue
        part = df[["timestamp", column]].copy()
        part.columns = ["timestamp", "count"]
        part["kind"] = label
        frames.append(part)
    if not frames:
        st.info(_NO_DATA_HINT)
        return None
    work = pd.concat(frames, ignore_index=True)
    work["timestamp"] = pd.to_datetime(work["timestamp"], errors="coerce", utc=True)
    work["count"] = _numeric(work["count"])
    work = work.dropna(subset=["timestamp", "count"]).sort_values("timestamp")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None
    fig = px.area(
        work, x="timestamp", y="count", color="kind",
        labels={"timestamp": "", "count": "Nodes", "kind": ""},
        color_discrete_map={label: color for _c, label, color in classes},
    )
    fig.update_traces(hovertemplate="%{x|%Y-%m-%d}<br>%{fullData.name}: %{y:,.0f}<extra></extra>")
    _finalize(fig, height=300)
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG, key=key)
    return fig


def cumulative_realized_line(daily: pd.DataFrame | None, *, key: str | None = None) -> None:
    """Cumulative REALIZED savings line (sum of the daily downscaling+spot
    series). Derived client-side from the daily frame — 0 extra calls."""

    if daily is None or len(daily) == 0 or "timestamp" not in daily.columns:
        st.info(_NO_DATA_HINT)
        return None
    work = daily[["timestamp"]].copy()
    total = pd.Series(0.0, index=daily.index, dtype="Float64")
    for column in ("downscaling", "spot"):
        if column in daily.columns:
            total = total.add(_numeric(daily[column]).fillna(0.0))
    work["value"] = total.cumsum()
    work["timestamp"] = pd.to_datetime(work["timestamp"], errors="coerce", utc=True)
    work = work.dropna(subset=["timestamp"]).sort_values("timestamp")
    if work.empty:
        st.info(_NO_DATA_HINT)
        return None
    fig = px.line(
        work, x="timestamp", y="value",
        labels={"timestamp": "", "value": "Cumulative realized savings (USD)"},
        color_discrete_sequence=[SAVINGS_COLOR],
    )
    fig.update_traces(hovertemplate="%{x|%Y-%m-%d}<br>%{y:,.2f} USD cumulative<extra></extra>")
    _finalize(fig, height=280)
    st.plotly_chart(fig, width="stretch", config=_PLOTLY_CONFIG, key=key)
    return fig
