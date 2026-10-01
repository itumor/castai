"""Enterprise fleet table v2 + node pagination table (docs/ux-v2.md §3).

Contract for ``render_fleet_table(df)``:
  * Renders the master cluster table with ``st.dataframe`` (single-row
    selection, ``on_select="rerun"``). Returns ``(organization_id,
    cluster_id)`` of the selected row, or ``None``.
  * Column picker (``st.multiselect``, key ``fleet_visible_cols``) toggles
    non-identity columns; identity columns (health / organization_name /
    cluster_name) stay pinned and cannot be hidden. Picker edits are pure
    pandas — 0 API calls (I1).
  * Hard-caps the payload at 25,000 rows with a caption (Arrow ceiling,
    ux-design.md §3). NO Styler anywhere; status color rides on pre-rendered
    emoji text columns — emoji survive CSV export too (ux-design.md §6).
  * CSV export ships the FULL RAW column set (incl. ``overview_cost_hourly``
    and every raw numeric — display strings never leave the UI), capped at
    500 rows with a caption when truncated (perf-v2 REJECT list #3).
  * Every new Wave-A column is read defensively (presence-checked); a frame
    lacking them renders fine (frozen-column contract — UI ships first).
  * Selection read path: ``st.session_state[<dataframe key>].selection.rows``
    gives positional indices into the *displayed* frame; the matching
    ``(organization_id, cluster_id)`` is looked up in a parallel list built
    from the same ordered rows.
  * Pure presentation — ZERO API calls (rerun invariant I1).
"""

from __future__ import annotations

from typing import Any, Mapping

import pandas as pd
import streamlit as st

from utils.formatting import fmt_money_compact

__all__ = [
    "MAX_ROWS",
    "EXPORT_ROW_CAP",
    "PICKER_KEY",
    "render_fleet_table",
    "health_emoji",
    "render_nodes_table",
    "build_display_columns",
    "prepare_fleet_display",
    "DEFAULT_VISIBLE_COLUMNS",
    "fleet_csv_export",
    "sanitize_csv_frame",
    "data_age_label",
    "savings_display_label",
    "render_wa_workloads_table",
    "render_node_pricing_table",
    "render_issues_feed",
    "render_workload_costs_table",
    "node_state_chips",
]

MAX_ROWS = 25_000  # Arrow-serialization ceiling (ux-design.md §3)
EXPORT_ROW_CAP = 500  # CSV export cap (perf-v2 §5.2 / REJECT list #3)
PICKER_KEY = "fleet_visible_cols"
_TABLE_HEIGHT = 520
_FLEET_TABLE_KEY = "fleet_table"
_SIG_KEY = "_fleet_table_sig"  # content signature for stale-selection guard

_GREEN = ("ready", "active", "ok", "running", "connected", "healthy")
_YELLOW = ("warning", "connecting", "degraded", "pending", "partial", "maintenance")
_RED = ("failed", "error", "not_healthy", "not_healthy_cluster")
_BLACK = (
    "deleted",
    "disconnected",
    "disconnecting",
    "non-responding",  # Disconnected sentinel family (data-model §5)
    "terminated",
    "archived",
    "deleting",
)


def health_emoji(status: Any, agent_status: Any = None) -> str:
    """Map cluster/agent status strings to 🟢/🟡/🔴/⚫/⚪ (dual-coded text).

    Keyword-matched case-insensitively so enum spellings
    (``"ready"``, ``"AGENT_STATUS_RUNNING"``, …) all resolve.
    """

    for candidate in (status, agent_status):
        if candidate is None:
            continue
        try:
            if pd.isna(candidate):
                continue
        except (TypeError, ValueError):
            continue
        text = str(candidate).strip().lower()
        if not text:
            continue
        if any(word in text for word in _BLACK):
            return "⚫ " + text
        if any(word in text for word in _RED):
            return "🔴 " + text
        if any(word in text for word in _YELLOW):
            return "🟡 " + text
        if any(word in text for word in _GREEN):
            return "🟢 " + text
        return "⚪ " + text
    return "⚪ unknown"


# ------------------------------------------------------------- cell helpers


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return True


def data_age_label(minutes: Any) -> str:
    """Pre-rendered freshness cell: 🟢 <30m · 🟡 <120m · 🔴 ≥120m · "unknown"."""

    if _is_missing(minutes):
        return "unknown"
    try:
        m = float(minutes)
    except (TypeError, ValueError):
        return "unknown"
    if m < 0:
        m = 0.0
    if m < 30:
        return f"🟢 {int(round(m))}m"
    if m < 120:
        return f"🟡 {int(round(m))}m"
    hours = m / 60.0
    return f"🔴 {hours:.1f}h" if hours < 10 else f"🔴 {int(round(hours))}h"


def savings_display_label(monthly: Any) -> str:
    """Pre-rendered savings cell (ux-v2 §3 / finops §2 negatives):
    ``"🔻 −$X (cost increase)"`` · ``"—"`` (missing) · ``"$X"`` (>= 0)."""

    if _is_missing(monthly):
        return "—"
    try:
        value = float(monthly)
    except (TypeError, ValueError):
        return "—"
    if value < 0:
        return f"🔻 −{fmt_money_compact(abs(value))} (cost increase)"
    return fmt_money_compact(value)


def _col(df: pd.DataFrame, name: str) -> pd.Series | None:
    return df[name] if name in df.columns else None


def _coalesce(df: pd.DataFrame, *names: str) -> pd.Series | None:
    """First present (not all-missing) column among candidate names."""

    for name in names:
        if name in df.columns:
            return df[name]
    return None


def _wa_chip(value: Any) -> str:
    if _is_missing(value):
        return "⚪ unknown"
    text = str(value).strip()
    lowered = text.lower()
    if "running" in lowered or "ok" == lowered:
        return "🟢 running"
    if "not installed" in lowered or "not_installed" in lowered:
        return "⚫ not installed"
    if lowered in ("unknown", "n/a", ""):
        return "⚪ unknown"
    return "⚪ " + text


def _na_chip(source: Any, *, loaded: bool) -> str:
    """Node-autoscaler chip: enrichment bools ⇒ Enabled/Disabled; else — / load."""

    if not loaded:
        return "n/a — load"
    if _is_missing(source):
        return "—"
    if isinstance(source, str):
        lowered = source.strip().lower()
        if lowered in ("true", "1", "yes", "enabled"):
            return "🟢 Enabled"
        if lowered in ("false", "0", "no", "disabled"):
            return "⚫ Disabled"
        return "—"
    try:
        return "🟢 Enabled" if bool(source) else "⚫ Disabled"
    except (TypeError, ValueError):
        return "—"


def _problematic_label(value: Any, *, loaded: bool) -> str:
    if not loaded:
        return "n/a — load"
    if _is_missing(value):
        return "—"
    try:
        return str(int(float(value)))
    except (TypeError, ValueError):
        return "—"


# Display-column registry -----------------------------------------------------
# Each entry: key -> (group, label, builder). Builders receive the merged
# filtered frame and return a Series (or scalar broadcast); EVERY source
# access is presence-checked (frozen-column contract).

_ALWAYS_VISIBLE = ("health", "organization_name", "cluster_name")

DEFAULT_VISIBLE_COLUMNS = [
    "health",
    "organization_name",
    "cluster_name",
    "provider",
    "region",
    "status",
    "agent_status",
    "data_age",
    "cluster_score",
    "cpu_utilization_pct",
    "memory_utilization_pct",
    "nodes_total",
    "nodes_spot",
    "monthly_cost",
    "savings_display",
    "wa_status",
    "na_display",
    "problematic_display",
    "unschedulable_pods",
]

# Columns never offered in the picker (identity/lookup payloads).
_PICKER_EXCLUDED = frozenset(
    {
        "organization_id",
        "cluster_id",
        # source columns superseded by display builds (rename tolerance)
        "cpu_efficiency",
        "memory_efficiency",
        "workload_autoscaler_status",
        "wa_display",
    }
)


def build_display_columns(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Build every v2 display column defensively from the merged fleet frame.

    Pure pandas. Columns whose sources are absent still materialize with
    pre-batch/unknown markers so the 18 default-visible set ALWAYS renders,
    regardless of which Wave-A columns have landed.
    """

    n = len(df)
    out: dict[str, pd.Series] = {}

    # --- health chip (ghost rows get the 👻 status_display override)
    status = _col(df, "status")
    agent = _col(df, "agent_status")
    ghost = _col(df, "is_ghost")
    health_vals = [
        health_emoji(s, a)
        for s, a in zip(
            status.tolist() if status is not None else [None] * n,
            agent.tolist() if agent is not None else [None] * n,
        )
    ]
    out["ghost"] = pd.Series(
        [
            "👻" if (v is not None and not _is_missing(v) and bool(v)) else ""
            for v in (ghost.tolist() if ghost is not None else [None] * n)
        ],
        index=df.index,
    )
    out["health"] = pd.Series(
        [
            "👻 ghost" if g else h
            for g, h in zip(out["ghost"].tolist(), health_vals)
        ],
        index=df.index,
    )

    for key in _ALWAYS_VISIBLE[1:]:
        if key in df.columns:
            out[key] = df[key]

    # --- Status & freshness
    for key in ("provider", "region", "status", "agent_status", "data_status",
                "reporting_state", "kubernetes_version_short"):
        if key in df.columns:
            out[key] = df[key]

    age_minutes = _col(df, "snapshot_age_minutes")
    if age_minutes is None and "last_updated" in df.columns:
        stamp = pd.to_datetime(df["last_updated"], errors="coerce", utc=True)
        now = pd.Timestamp.now(tz="UTC")
        delta = (now - stamp).dt.total_seconds() / 60.0
        age_minutes = delta.where(stamp.notna())
    if age_minutes is not None:
        out["data_age"] = pd.Series(
            [data_age_label(v) for v in pd.to_numeric(age_minutes, errors="coerce").tolist()],
            index=df.index,
        )
    else:
        out["data_age"] = pd.Series(["unknown"] * n, index=df.index)

    # --- CPU / Memory (R8 renames: both old and new names store 0–1 ratios;
    # the ProgressColumn scale is 0–100 so the display column is ×100)
    cpu_util = _coalesce(df, "cpu_utilization_pct", "cpu_efficiency")
    out["cpu_utilization_pct"] = (
        pd.to_numeric(cpu_util, errors="coerce") * 100.0 if cpu_util is not None
        else pd.Series(pd.NA, index=df.index, dtype="Float64")
    )
    mem_util = _coalesce(df, "memory_utilization_pct", "memory_efficiency")
    out["memory_utilization_pct"] = (
        pd.to_numeric(mem_util, errors="coerce") * 100.0 if mem_util is not None
        else pd.Series(pd.NA, index=df.index, dtype="Float64")
    )
    for key in ("cpu_request_efficiency_pct", "memory_request_efficiency_pct"):
        source = _col(df, key)
        if source is not None:
            out[key] = pd.to_numeric(source, errors="coerce") * 100.0
    for key in ("cpu_provisioned", "cpu_requested", "memory_provisioned_gib",
                "memory_requested_gib"):
        if key in df.columns:
            out[key] = df[key]

    # --- Nodes
    for key in ("nodes_total", "nodes_spot", "nodes_unknown", "na_managed_nodes",
                "na_coverage_pct", "nodes_provider_managed"):
        if key in df.columns:
            out[key] = df[key]

    # --- FinOps
    for key in ("monthly_cost", "potential_savings", "report_period_cost",
                "report_cost_pct_change", "waste_cpu_usd", "waste_ram_usd",
                "waste_storage_usd", "waste_total_usd",
                # v2-OPS overprovisioning trio: ALREADY 0–100-scale payload
                # doubles (not 0–1 ratios) — pass through, no ×100.
                "overprovisioned_cpu_pct", "overprovisioned_ram_pct",
                "overprovisioned_storage_pct"):
        if key in df.columns:
            out[key] = df[key]
    savings = _col(df, "potential_savings")
    out["savings_display"] = pd.Series(
        [savings_display_label(v) for v in (savings.tolist() if savings is not None else [None] * n)],
        index=df.index,
    )

    # --- Autoscaling chips (v2-OPS: rebalance trio passes through — org-level
    # at Tier 1, so rows stay NA until a cluster-resolved match exists)
    for key in ("rebalance_schedule_name", "rebalance_last_trigger", "rebalance_next_trigger"):
        if key in df.columns:
            out[key] = df[key]
    wa_source = _coalesce(df, "wa_display", "workload_autoscaler_status")
    out["wa_status"] = pd.Series(
        [_wa_chip(v) for v in (wa_source.tolist() if wa_source is not None else [None] * n)],
        index=df.index,
    )
    na_display = _col(df, "na_display")
    na_enabled = _col(df, "enr_na_policies_na_enabled")
    na_managed = _col(df, "na_managed_nodes")
    if na_display is not None:
        out["na_display"] = na_display
    elif na_enabled is not None:
        out["na_display"] = pd.Series(
            [_na_chip(v, loaded=True) for v in na_enabled.tolist()], index=df.index
        )
    elif na_managed is not None:
        # na_managed presence but no enrichment verdict: "—" (frozen contract)
        out["na_display"] = pd.Series(["—"] * n, index=df.index)
    else:
        out["na_display"] = pd.Series(["n/a — load"] * n, index=df.index)

    # --- Health (pre-batch "n/a — load"; post-batch integer string)
    enr_nodes = _col(df, "enr_health_problematic_nodes_count")
    out["problematic_display"] = pd.Series(
        [_problematic_label(v, loaded=enr_nodes is not None)
         for v in (enr_nodes.tolist() if enr_nodes is not None else [None] * n)],
        index=df.index,
    )
    if enr_nodes is not None:
        out["enr_health_problematic_nodes_count"] = pd.to_numeric(enr_nodes, errors="coerce")
    enr_workloads = _col(df, "enr_health_problematic_workloads_count")
    if enr_workloads is not None:
        out["enr_health_problematic_workloads_count"] = pd.to_numeric(enr_workloads, errors="coerce")
    for key in ("unschedulable_pods",):
        if key in df.columns:
            out[key] = df[key]

    # --- Realized savings display (realized enrichment batch)
    realized = _col(df, "enr_realized_realized_savings")
    out["realized_display"] = pd.Series(
        [_money_label(v, loaded=realized is not None)
         for v in (realized.tolist() if realized is not None else [None] * n)],
        index=df.index,
    )

    # --- Data quality
    for key in ("data_freshness_status", "snapshot_age_minutes", "agent_health",
                "wa_agent_version", "wa_last_reported", "storage_provisioned_gib",
                "storage_claimed_gib", "storage_cost_hourly"):
        if key in df.columns:
            out[key] = df[key]

    return out


def _money_label(value: Any, *, loaded: bool) -> str:
    if not loaded:
        return "n/a — load"
    if _is_missing(value):
        return "—"
    try:
        return fmt_money_compact(float(value))
    except (TypeError, ValueError):
        return "—"


_DISPLAY_LABELS = {
    "health": ("Identity", "Health"),
    "organization_name": ("Identity", "Organization"),
    "cluster_name": ("Identity", "Cluster"),
    "provider": ("Status & Freshness", "Cloud"),
    "region": ("Status & Freshness", "Region"),
    "status": ("Status & Freshness", "Status"),
    "agent_status": ("Status & Freshness", "Agent"),
    "data_age": ("Status & Freshness", "Data age"),
    "data_status": ("Status & Freshness", "Data status"),
    "reporting_state": ("Status & Freshness", "Reporting state"),
    "cluster_score": ("Status & Freshness", "Cluster score"),
    "kubernetes_version_short": ("Status & Freshness", "K8s version"),
    "cpu_utilization_pct": ("CPU", "CPU utilization"),
    "cpu_request_efficiency_pct": ("CPU", "CPU req efficiency"),
    "cpu_provisioned": ("CPU", "vCPU provisioned"),
    "cpu_requested": ("CPU", "vCPU requested"),
    "memory_utilization_pct": ("Memory", "Mem utilization"),
    "memory_request_efficiency_pct": ("Memory", "Mem req efficiency"),
    "memory_provisioned_gib": ("Memory", "Mem provisioned"),
    "memory_requested_gib": ("Memory", "Mem requested"),
    "nodes_total": ("Nodes", "Nodes"),
    "nodes_spot": ("Nodes", "Spot nodes"),
    "nodes_unknown": ("Nodes", "Unknown nodes"),
    "na_managed_nodes": ("Nodes", "NA managed nodes"),
    "na_coverage_pct": ("Nodes", "NA coverage"),
    "nodes_provider_managed": ("Nodes", "Provider-managed #"),
    "monthly_cost": ("FinOps", "Cost/mo"),
    "savings_display": ("FinOps", "Savings/mo"),
    "potential_savings": ("FinOps", "Savings/mo (numeric)"),
    "report_period_cost": ("FinOps", "Period cost"),
    "report_cost_pct_change": ("FinOps", "Cost Δ% (0–100)"),
    "waste_cpu_usd": ("FinOps", "Waste CPU $"),
    "waste_ram_usd": ("FinOps", "Waste RAM $"),
    "waste_storage_usd": ("FinOps", "Waste storage $"),
    "waste_total_usd": ("FinOps", "Waste total $"),
    "overprovisioned_cpu_pct": ("FinOps", "Overprov CPU %"),
    "overprovisioned_ram_pct": ("FinOps", "Overprov RAM %"),
    "overprovisioned_storage_pct": ("FinOps", "Overprov storage %"),
    "realized_display": ("FinOps", "Realized (batch)"),
    "wa_status": ("Autoscaling", "WA"),
    "na_display": ("Autoscaling", "NA"),
    "rebalance_schedule_name": ("Autoscaling", "Rebalance schedule"),
    "rebalance_last_trigger": ("Autoscaling", "Rebalance last"),
    "rebalance_next_trigger": ("Autoscaling", "Rebalance next"),
    "problematic_display": ("Health", "Problematic nodes"),
    "enr_health_problematic_nodes_count": ("Health", "Problematic (numeric)"),
    "enr_health_problematic_workloads_count": ("Health", "Problematic workloads"),
    "unschedulable_pods": ("Health", "Unsched pods"),
    "data_freshness_status": ("Data quality", "Freshness status"),
    "snapshot_age_minutes": ("Data quality", "Freshness (raw minutes)"),
    "agent_health": ("Data quality", "Agent health"),
    "wa_agent_version": ("Data quality", "WA version"),
    "wa_last_reported": ("Data quality", "WA last reported"),
    "storage_provisioned_gib": ("Storage", "Storage provisioned"),
    "storage_claimed_gib": ("Storage", "Storage claimed"),
    "storage_cost_hourly": ("Storage", "Storage $/h"),
    "ghost": ("Identity", "Ghost marker"),
}


def _picker_options(
    display: Mapping[str, pd.Series],
    source: pd.DataFrame | None = None,
) -> dict[str, tuple[str, str]]:
    """key -> (group, label) for every picker option; raw leftover source
    columns are offered under a "Raw" group (hidden by default — keeps every
    raw numeric one multiselect away for numeric sorting)."""

    options: dict[str, tuple[str, str]] = {}
    for key in display:
        if key in _PICKER_EXCLUDED:
            continue
        options[key] = _DISPLAY_LABELS.get(key, ("Raw", key))
    if source is not None:
        for key in source.columns:
            if key in options or key in _PICKER_EXCLUDED:
                continue
            options[str(key)] = ("Raw", str(key))
    return options


def _build_column_config(columns: list[str]) -> dict:
    """column_config entries for the fleet table, keyed only by present cols."""

    cfg: dict[str, Any] = {}
    if "health" in columns:
        cfg["health"] = st.column_config.TextColumn("Health", help="Cluster/agent health (🟢 ok · 🟡 pending · 🔴 failed · ⚫ down · ⚪ unknown · 👻 ghost)")
    if "ghost" in columns:
        cfg["ghost"] = st.column_config.TextColumn("Ghost", help="UNSPECIFIED-status ghost row (quarantined)")
    if "organization_name" in columns:
        cfg["organization_name"] = st.column_config.TextColumn("Organization", pinned=True)
    if "cluster_name" in columns:
        cfg["cluster_name"] = st.column_config.TextColumn("Cluster", pinned=True)
    if "provider" in columns:
        cfg["provider"] = st.column_config.TextColumn("Cloud")
    if "region" in columns:
        cfg["region"] = st.column_config.TextColumn("Region")
    if "status" in columns:
        cfg["status"] = st.column_config.TextColumn("Status")
    if "agent_status" in columns:
        cfg["agent_status"] = st.column_config.TextColumn("Agent")
    if "data_age" in columns:
        cfg["data_age"] = st.column_config.TextColumn("Data age", help="🟢 <30m · 🟡 <120m · 🔴 ≥120m · unknown")
    if "data_status" in columns:
        cfg["data_status"] = st.column_config.TextColumn(
            "Data", help="ok | partial | unavailable (per-org partial-failure marker)")
    if "reporting_state" in columns:
        cfg["reporting_state"] = st.column_config.TextColumn("Reporting")
    if "kubernetes_version_short" in columns:
        cfg["kubernetes_version_short"] = st.column_config.TextColumn("K8s")
    if "wa_status" in columns:
        cfg["wa_status"] = st.column_config.TextColumn(
            "WA", help="Workload autoscaler: 🟢 running · ⚫ not installed · ⚪ unknown")
    if "na_display" in columns:
        cfg["na_display"] = st.column_config.TextColumn(
            "NA", help="Node autoscaler: 🟢 Enabled · ⚫ Disabled · n/a — load (enrichment batch)")
    if "cpu_utilization_pct" in columns:
        cfg["cpu_utilization_pct"] = st.column_config.ProgressColumn(
            "CPU util", format="%.1f%%", min_value=0, max_value=100,
            help="cpu_used / cpu_allocatable (0–100%; None → empty bar reads as N/A)")
    if "memory_utilization_pct" in columns:
        cfg["memory_utilization_pct"] = st.column_config.ProgressColumn(
            "Mem util", format="%.1f%%", min_value=0, max_value=100,
            help="ram_used / ram_allocatable")
    if "cpu_request_efficiency_pct" in columns:
        cfg["cpu_request_efficiency_pct"] = st.column_config.ProgressColumn(
            "CPU req eff", format="%.1f%%", min_value=0, max_value=100)
    if "memory_request_efficiency_pct" in columns:
        cfg["memory_request_efficiency_pct"] = st.column_config.ProgressColumn(
            "Mem req eff", format="%.1f%%", min_value=0, max_value=100)
    if "cpu_provisioned" in columns:
        cfg["cpu_provisioned"] = st.column_config.NumberColumn("vCPU prov", format="%.0f")
    if "cpu_requested" in columns:
        cfg["cpu_requested"] = st.column_config.NumberColumn("vCPU req", format="%.1f")
    if "memory_provisioned_gib" in columns:
        cfg["memory_provisioned_gib"] = st.column_config.NumberColumn("Mem prov", format="%.0f GiB")
    if "memory_requested_gib" in columns:
        cfg["memory_requested_gib"] = st.column_config.NumberColumn("Mem req", format="%.1f GiB")
    if "cluster_score" in columns:
        cfg["cluster_score"] = st.column_config.NumberColumn(
            "Score", format="%.1f", help="CAST AI cluster score (clusters/summary); scale per CAST AI")
    if "nodes_total" in columns:
        cfg["nodes_total"] = st.column_config.NumberColumn("Nodes", format="%d")
    if "nodes_spot" in columns:
        cfg["nodes_spot"] = st.column_config.NumberColumn("Spot", format="%d")
    if "nodes_unknown" in columns:
        cfg["nodes_unknown"] = st.column_config.NumberColumn("Unknown", format="%d")
    if "na_managed_nodes" in columns:
        cfg["na_managed_nodes"] = st.column_config.NumberColumn("NA nodes", format="%d")
    if "na_coverage_pct" in columns:
        cfg["na_coverage_pct"] = st.column_config.NumberColumn("NA cov.", format="%.0f%%")
    if "nodes_provider_managed" in columns:
        cfg["nodes_provider_managed"] = st.column_config.NumberColumn(
            "Prov-managed", format="%d",
            help="nodes_total − CAST-managed counters; N/A when either side missing or inverted")
    if "overprovisioned_cpu_pct" in columns:
        cfg["overprovisioned_cpu_pct"] = st.column_config.NumberColumn(
            "Overprov CPU", format="%.1f%%",
            help="Efficiency report CPU overprovisioned percent (0–100 payload scale)")
    if "overprovisioned_ram_pct" in columns:
        cfg["overprovisioned_ram_pct"] = st.column_config.NumberColumn(
            "Overprov RAM", format="%.1f%%",
            help="Efficiency report RAM overprovisioned percent (0–100 payload scale)")
    if "overprovisioned_storage_pct" in columns:
        cfg["overprovisioned_storage_pct"] = st.column_config.NumberColumn(
            "Overprov stor", format="%.1f%%",
            help="Efficiency report storage overprovisioned percent (0–100 payload scale)")
    if "rebalance_schedule_name" in columns:
        cfg["rebalance_schedule_name"] = st.column_config.TextColumn(
            "Rebalance", help="Org-level at Tier 1 — N/A until a cluster-resolved match exists")
    if "rebalance_last_trigger" in columns:
        cfg["rebalance_last_trigger"] = st.column_config.TextColumn("Reb last")
    if "rebalance_next_trigger" in columns:
        cfg["rebalance_next_trigger"] = st.column_config.TextColumn("Reb next")
    if "monthly_cost" in columns:
        cfg["monthly_cost"] = st.column_config.NumberColumn(
            "Cost/mo", format="$%d", help="Run-rate: costHourly × 730 h")
    if "savings_display" in columns:
        cfg["savings_display"] = st.column_config.TextColumn(
            "Savings/mo", help="🟢 $X opportunity · 🔻 −$X (cost increase) · — missing")
    if "potential_savings" in columns:
        cfg["potential_savings"] = st.column_config.NumberColumn(
            "Savings/mo #", format="$%d", help="Estimated monthly potential savings (raw, for numeric sort)")
    if "report_period_cost" in columns:
        cfg["report_period_cost"] = st.column_config.NumberColumn("Period cost", format="$%d")
    if "report_cost_pct_change" in columns:
        cfg["report_cost_pct_change"] = st.column_config.NumberColumn(
            "Δ%", format="%.1f%%", help="Report payload pct — already on the 0–100 scale")
    if "waste_total_usd" in columns:
        cfg["waste_total_usd"] = st.column_config.NumberColumn("Waste $", format="$%d")
    if "problematic_display" in columns:
        cfg["problematic_display"] = st.column_config.TextColumn(
            "Problematic", help="Problematic nodes: integer post-batch, n/a — load before")
    if "enr_health_problematic_nodes_count" in columns:
        cfg["enr_health_problematic_nodes_count"] = st.column_config.NumberColumn("Prob. nodes #", format="%d")
    if "enr_health_problematic_workloads_count" in columns:
        cfg["enr_health_problematic_workloads_count"] = st.column_config.NumberColumn("Prob. workloads #", format="%d")
    if "unschedulable_pods" in columns:
        cfg["unschedulable_pods"] = st.column_config.NumberColumn("Unsched pods", format="%d")
    if "realized_display" in columns:
        cfg["realized_display"] = st.column_config.TextColumn(
            "Realized", help="Realized savings over the window (enrichment batch)")
    if "snapshot_age_minutes" in columns:
        cfg["snapshot_age_minutes"] = st.column_config.NumberColumn("Age (min)", format="%.0f")
    if "agent_health" in columns:
        cfg["agent_health"] = st.column_config.TextColumn("Agent health")
    if "storage_provisioned_gib" in columns:
        cfg["storage_provisioned_gib"] = st.column_config.NumberColumn("Stor prov", format="%.0f GiB")
    if "storage_claimed_gib" in columns:
        cfg["storage_claimed_gib"] = st.column_config.NumberColumn("Stor claimed", format="%.0f GiB")
    if "storage_cost_hourly" in columns:
        cfg["storage_cost_hourly"] = st.column_config.NumberColumn("Stor $/h", format="$%.4f")
    return cfg


def prepare_fleet_display(
    df: pd.DataFrame,
    visible_keys: list[str] | None = None,
) -> tuple[pd.DataFrame, list[tuple[str, str]]]:
    """Build (display_df, ids) — display grid + parallel (org, cluster) ids.

    ``ids[i]`` is the identity of ``display_df`` row ``i``; selection indices
    map 1:1. ``visible_keys`` picks the columns (identity columns are always
    present and pinned); when None the 18-column default set renders.
    """

    display_map = build_display_columns(df)
    options = _picker_options(display_map, df)
    if visible_keys is None:
        visible_keys = [k for k in DEFAULT_VISIBLE_COLUMNS if k in options]
    chosen = [k for k in visible_keys if k in options and k not in _ALWAYS_VISIBLE]
    order = [k for k in _ALWAYS_VISIBLE if k in display_map] + chosen

    def _series(key: str) -> pd.Series:
        if key in display_map:
            return display_map[key]
        return df[key]  # raw leftover source column (numeric sort options)

    display = pd.DataFrame({k: _series(k) for k in order})[order]

    org_ids = df["organization_id"].astype("string").tolist() if "organization_id" in df.columns else [""] * len(df)
    cluster_ids = df["cluster_id"].astype("string").tolist() if "cluster_id" in df.columns else [""] * len(df)
    ids = [
        (o if isinstance(o, str) else "", c if isinstance(c, str) else "")
        for o, c in zip(org_ids, cluster_ids)
    ]
    return display, ids


def _read_selected_index(key: str) -> int | None:
    """st.session_state[key].selection.rows[0] (positional), or None."""

    state = st.session_state.get(key)
    if state is None:
        return None
    selection = getattr(state, "selection", None)
    if selection is None and isinstance(state, dict):
        selection = state.get("selection")
    rows = getattr(selection, "rows", None)
    if rows is None and isinstance(selection, dict):
        rows = selection.get("rows")
    if not rows:
        return None
    try:
        return int(rows[0])
    except (TypeError, ValueError, IndexError):
        return None


# CSV formula-injection guard (OWASP CWE-1236): spreadsheet apps execute any
# cell whose TEXT begins with ``= + - @`` as a formula (tab/CR prefixes smuggle
# formulas past naive filters). Every export escapes such string cells by
# prefixing a single quote. Numeric columns (incl. NEGATIVE savings — finops
# §2 rule 9) ship untouched as numbers; only str cells are escaped.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def _csv_cell_safe(value: Any) -> Any:
    """Escape one cell; non-strings (numbers, pd.NA, timestamps) pass through."""
    if isinstance(value, str) and value[:1] in _CSV_FORMULA_PREFIXES:
        return "'" + value
    return value


def sanitize_csv_frame(df: pd.DataFrame | None) -> pd.DataFrame | None:
    """Return a copy with formula-leading string cells quote-escaped.

    Only object-dtype (string-carrying) columns are scanned; numeric columns
    are never touched, so negative money/node values stay numeric.
    """
    if df is None or len(df) == 0:
        return df
    out = df.copy()
    for name in out.columns:
        series = out[name]
        # object / pandas-3 str / StringDtype all carry escapable text;
        # is_string_dtype covers them uniformly (dtype == object alone misses
        # the pandas-3 inferred str dtype).
        if not pd.api.types.is_string_dtype(series):
            continue
        if series.map(
            lambda v: isinstance(v, str) and v[:1] in _CSV_FORMULA_PREFIXES
        ).any():
            out[name] = series.map(_csv_cell_safe)
    return out


def fleet_csv_export(
    df: pd.DataFrame | None,
    cap: int = EXPORT_ROW_CAP,
) -> tuple[bytes, int, int]:
    """(csv_bytes, rows_shipped, rows_total) — FULL RAW column set, capped.

    The export is auditability-first: no display strings, every raw numeric
    column (incl. ``overview_cost_hourly``, waste/enrichment columns) ships as
    stored. Truncation can never exceed ``cap`` (perf-v2 REJECT list #3).
    Text cells are formula-injection-escaped (``'`` prefix) so hostile
    cluster/org names cannot execute in a spreadsheet app (OWASP CWE-1236).
    """

    if df is None:
        return b"", 0, 0
    total = len(df)
    shown = df.head(max(0, int(cap))) if total > cap else df
    shown = sanitize_csv_frame(shown)
    return shown.to_csv(index=False).encode("utf-8"), len(shown), total


def render_fleet_table(df: pd.DataFrame | None) -> tuple[str, str] | None:
    """Render the master fleet table; return the selected (org_id, cluster_id).

    Returns None when nothing is selected or the selection cannot be mapped.
    """

    if df is None or len(df) == 0:
        st.info("No clusters match the current filters.")
        return None

    truncated = len(df) > MAX_ROWS
    shown = df.head(MAX_ROWS) if truncated else df

    display_map = build_display_columns(shown)
    options = _picker_options(display_map, shown)

    # Column picker state: defaults materialize once per session; identity
    # columns are always included downstream regardless of the picker value.
    default_visible = [k for k in DEFAULT_VISIBLE_COLUMNS if k in options]
    if PICKER_KEY not in st.session_state:
        st.session_state[PICKER_KEY] = list(default_visible)
    else:
        # Tolerate options changing under a live session (dataset refetch):
        # keep prior choices still valid, keep everything else untouched.
        st.session_state[PICKER_KEY] = [
            k for k in st.session_state.get(PICKER_KEY, []) if k in options
        ] or list(default_visible)

    title_col, picker_col, dl_col = st.columns([3, 2, 1])
    title_col.markdown(f"**Clusters ({len(shown):,} of {len(df):,})**")
    picker_col.multiselect(
        "Columns",
        options=list(options.keys()),
        key=PICKER_KEY,
        format_func=lambda k: f"{options[k][0]} · {options[k][1]}",
        placeholder="Toggle columns…",
        help="Show/hide non-identity columns (pure pandas — 0 API calls). "
             "Identity columns stay pinned; Raw options expose numerics for sorting.",
    )
    csv_bytes, export_rows, export_total = fleet_csv_export(df)
    dl_col.download_button(
        "⬇ CSV",
        data=csv_bytes,
        file_name="castai_fleet.csv",
        mime="text/csv",
        key="fleet_csv_download",
        help=f"Download the filtered fleet as CSV (raw columns, max {EXPORT_ROW_CAP} rows)",
    )

    visible = st.session_state.get(PICKER_KEY, default_visible)
    display, ids = prepare_fleet_display(shown, visible_keys=list(visible))

    # Stale-selection guard: the dataframe widget stores selection as ROW
    # INDICES. When the underlying data changes (filter/date edits, column
    # toggles, TTL refetch), stored indices would silently remap onto different
    # clusters. Drop the stale widget selection before instantiating the
    # widget; the authoritative selection lives in session_state["selected"]
    # (ux-design §4 — selection survives filter changes via the session key,
    # not the widget).
    sig = hash((tuple(ids), tuple(display.columns)))
    previous_sig = st.session_state.get(_SIG_KEY)
    if previous_sig != sig:
        st.session_state[_SIG_KEY] = sig
        if previous_sig is not None:
            try:
                st.session_state[_FLEET_TABLE_KEY] = {"selection": {"rows": []}}
            except Exception:  # pragma: no cover - widget state reset is best-effort
                pass

    if truncated:
        st.caption(f"Showing first {MAX_ROWS:,} rows (table payload cap). Use filters or the CSV export for the rest.")
    if export_total > export_rows:
        st.caption(
            f"Export limited to {export_rows} of {export_total:,} rows — narrow filters to export more."
        )

    event = st.dataframe(
        display,
        key=_FLEET_TABLE_KEY,
        on_select="rerun",
        selection_mode="single-row",
        width="stretch",
        hide_index=True,
        height=_TABLE_HEIGHT,
        column_config=_build_column_config(list(display.columns)),
    )
    # The returned event mirrors session_state[key]; the state read is the
    # canonical path (fragment-safe, documented contract).
    pos = _read_selected_index(_FLEET_TABLE_KEY)
    if pos is None and event is not None:
        sel = getattr(event, "selection", None)
        rows = getattr(sel, "rows", None) if sel is not None else None
        if rows:
            try:
                pos = int(rows[0])
            except (TypeError, ValueError):
                pos = None
    if pos is None or pos < 0 or pos >= len(ids):
        return None
    org_id, cluster_id = ids[pos]
    if not org_id or not cluster_id:
        return None
    return (org_id, cluster_id)


def render_nodes_table(
    df: pd.DataFrame | None,
    *,
    page_size: int = 100,
    page_key: str = "nodes_page",
) -> None:
    """Paginated nodes table (Tier-2 Nodes tab): 100 rows/page via selector.

    Pagination is in-memory pandas only — ZERO API calls (I1). The caller
    wraps this in ``@st.fragment`` so the page selector reruns only itself.
    ``page_key`` should be scoped to the cluster so page state doesn't leak
    across drill-down selections.
    """

    if df is None or len(df) == 0:
        st.info("No node data for this cluster in the current window.")
        return

    total = len(df)
    pages = max(1, (total + page_size - 1) // page_size)
    page = 1
    if pages > 1:
        page = int(
            st.number_input(
                f"Page (of {pages})",
                min_value=1,
                max_value=pages,
                value=1,
                step=1,
                key=page_key,
            )
        )
    start = (page - 1) * page_size
    chunk = df.iloc[start : start + page_size]
    st.caption(f"Nodes {start + 1:,}–{min(start + page_size, total):,} of {total:,}")

    lifecycle = chunk["lifecycle"] if "lifecycle" in chunk.columns else None
    if lifecycle is not None:
        spot = int((lifecycle.astype("string") == "spot").sum())
        if total == len(chunk):
            scope_spot = int((df["lifecycle"].astype("string") == "spot").sum())
            pct = (scope_spot / total * 100.0) if total else 0.0
            st.caption(f"{total:,} nodes · {scope_spot:,} spot ({pct:.0f}%)")

    columns: dict[str, Any] = {}
    present = list(chunk.columns)
    labels = {
        "node_name": ("Node", "text"),
        "instance_type": ("Instance", "text"),
        "zone": ("Zone", "text"),
        "lifecycle": ("Lifecycle", "text"),
        "node_state_phase": ("State", "text"),
        "cpu_capacity_cores": ("vCPU cap", "num0"),
        "cpu_allocatable_cores": ("vCPU alloc", "num1"),
        "cpu_requested_cores": ("vCPU req", "num1"),
        "mem_capacity_gib": ("Mem cap", "gib0"),
        "mem_allocatable_gib": ("Mem alloc", "gib1"),
        "mem_requested_gib": ("Mem req", "gib1"),
        "added_by": ("Added by", "text"),
        "unschedulable": ("Unschedulable", "checkbox"),
        "node_created_at": ("Created", "text"),
        "joined_at": ("Joined", "text"),
    }
    for col, spec in labels.items():
        if col not in present:
            continue
        label, kind = spec
        if kind == "text":
            columns[col] = st.column_config.TextColumn(label)
        elif kind == "num0":
            columns[col] = st.column_config.NumberColumn(label, format="%.0f")
        elif kind == "num1":
            columns[col] = st.column_config.NumberColumn(label, format="%.1f")
        elif kind == "gib0":
            columns[col] = st.column_config.NumberColumn(label, format="%.0f GiB")
        elif kind == "gib1":
            columns[col] = st.column_config.NumberColumn(label, format="%.1f GiB")
        elif kind == "checkbox":
            columns[col] = st.column_config.CheckboxColumn(label)

    st.dataframe(
        chunk,
        width="stretch",
        hide_index=True,
        height=480,
        column_config=columns,
    )


# --------------------------------------------------------------------------
# Wave-C drill-down v2 table helpers (pure presentation — 0 API calls, I1).
# --------------------------------------------------------------------------

_SEVERITY_EMOJI = {"critical": "🔴", "error": "🔴", "warning": "🟡", "info": "⚪"}


def node_state_chips(counts: Mapping[str, Any] | None) -> None:
    """One-line node-state classification chips (reliability-model §1:
    '41 ready · 2 pending · 1 failed'). ``counts`` comes from
    optimization_service.count_node_phases (the same module-level
    classification logic as the health enrichment batch — no extra calls)."""

    if not counts:
        st.caption("Node state classification unavailable.")
        return
    emoji = {
        "ready": "🟢", "pending": "🟡", "creating": "🟡", "interrupted": "🟠",
        "not_ready": "🔴", "draining": "🟠", "deleting": "🟠", "deleted": "⚫",
        "cordoned": "⛔", "unknown": "⚪", "other": "⚪",
    }
    parts = []
    for phase in ("ready", "pending", "creating", "not_ready", "draining",
                  "deleting", "deleted", "interrupted", "cordoned", "unknown", "other"):
        count = int(counts.get(phase) or 0)
        if count:
            parts.append(f"{emoji.get(phase, '⚪')} {count:,} {phase.replace('_', ' ')}")
    if not parts:
        st.caption("No classified node states for this cluster.")
        return
    st.markdown("**Node states:** " + " · ".join(parts))


def render_wa_workloads_table(df: pd.DataFrame | None, *, truncated: bool = False) -> None:
    """WA workloads table (Workloads-tab §4 autoscaler-model): requested vs
    RECOMMENDED CPU/mem; the per-workload "used" column is a fixed N/A."""

    if df is None or len(df) == 0:
        st.info("No workload-autoscaler workloads returned for this cluster.")
        return
    st.dataframe(
        df,
        width="stretch",
        hide_index=True,
        height=min(480, 36 * len(df) + 40),
        column_config={
            "namespace": st.column_config.TextColumn("Namespace"),
            "name": st.column_config.TextColumn("Workload"),
            "kind": st.column_config.TextColumn("Kind"),
            "policy": st.column_config.TextColumn("Policy"),
            "requested_cpu": st.column_config.NumberColumn("Req CPU", format="%.2f"),
            "requested_mem_gib": st.column_config.NumberColumn("Req mem", format="%.1f GiB"),
            "recommended_cpu": st.column_config.NumberColumn("Rec CPU", format="%.2f"),
            "recommended_mem_gib": st.column_config.NumberColumn("Rec mem", format="%.1f GiB"),
            "status": st.column_config.TextColumn("Status"),
            "managed_by": st.column_config.TextColumn("Managed by"),
            "used": st.column_config.TextColumn("Used"),
        },
    )
    captions = [
        "'Used' is N/A: the workloads endpoint exposes no per-workload usage "
        "metric (usage exists only in workloads-summary aggregates — autoscaler-model §4)."
    ]
    if truncated:
        captions.append("Showing the first 500 workloads (page cap); the API reports more pages.")
    st.caption(" ".join(captions))


def render_node_pricing_table(df: pd.DataFrame | None, *, node_count: int = 0, shown: int = 0) -> None:
    """Node pricing table (Cost tab): top-N nodes by total price/hour."""

    if df is None or len(df) == 0:
        st.info("No node pricing returned for this cluster.")
        return
    st.dataframe(
        df,
        width="stretch",
        hide_index=True,
        column_config={
            "node_name": st.column_config.TextColumn("Node"),
            "total_price_hourly": st.column_config.NumberColumn("Total $/h", format="$%.3f"),
            "base_price_hourly": st.column_config.NumberColumn("Base $/h", format="$%.3f"),
            "components_count": st.column_config.NumberColumn("Components", format="%d"),
            "provider": st.column_config.TextColumn("Provider"),
            "region": st.column_config.TextColumn("Region"),
        },
    )
    st.caption(
        f"Top {shown:,} of {node_count:,} priced nodes by total price/hour "
        "(USD strings from the pricing API, parsed to floats)."
    )


def render_issues_feed(feed: Mapping[str, Any] | None) -> None:
    """Merged severity feed (reliability-model §7): one table, severity
    emoji column, ≤100 rows, hidden index; per-source error chips above."""

    if not feed:
        st.info("No issues data available.")
        return
    errors = feed.get("errors") if isinstance(feed, Mapping) else None
    if errors:
        joined = " · ".join(f"{source}: {msg}" for source, msg in list(errors.items())[:5])
        st.caption(f"⚠ Some sources failed (feed is partial): {joined}")
    summary = feed.get("summary") or {}
    chips = []
    crit = summary.get("critical_notifications")
    oom24 = summary.get("oom_kills_24h")
    n_crit = (crit or 0) + (oom24 or 0)
    chips.append(f"🔴 {n_crit} critical")
    problem = summary.get("problematic_nodes") or 0
    pw = summary.get("problematic_workloads") or 0
    chips.append(f"🔴 {problem + pw} errors (nodes/workloads)")
    warn_items = summary.get("warning_notifications")
    unsched = summary.get("unscheduled_pods")
    chips.append(f"🟡 {(warn_items or 0)} warnings" + (f" · {unsched} unsched pods" if unsched else ""))
    chips.append(f"agent: {summary.get('agent_health', 'unknown')}")
    st.caption(" · ".join(chips))

    items = feed.get("items") or []
    if not items:
        st.success("No issues reported by the loaded sources.")
        return
    rows = []
    for item in items[:100]:
        rows.append(
            {
                "severity": f"{_SEVERITY_EMOJI.get(item.get('severity'), '⚪')} {item.get('severity')}",
                "kind": item.get("kind"),
                "resource": item.get("resource"),
                "namespace": item.get("namespace") or "—",
                "reason": item.get("reason"),
                "detail": item.get("detail"),
                "time (UTC)": item.get("timestamp") or "—",
            }
        )
    if len(items) > 100:
        st.caption(f"Showing first 100 of {len(items)} feed items.")
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True,
                 height=min(480, 36 * len(rows) + 40))


def render_workload_costs_table(df: pd.DataFrame | None, *, truncated: bool = False) -> None:
    """Workload cost table (Workloads tab): namespace/workload/kind/cost over
    the selected window. Only clusters with workload reporting return rows."""

    if df is None or len(df) == 0:
        st.info("No workload cost data for this cluster in the selected window.")
        return
    st.dataframe(
        df,
        width="stretch",
        hide_index=True,
        height=min(480, 36 * len(df) + 40),
        column_config={
            "namespace": st.column_config.TextColumn("Namespace"),
            "workload": st.column_config.TextColumn("Workload"),
            "workload_type": st.column_config.TextColumn("Kind"),
            "cost_window": st.column_config.NumberColumn("Cost (window)", format="$%.2f"),
            "avg_cost_hourly": st.column_config.NumberColumn("Avg $/h", format="$%.3f"),
            "avg_cpu_cost_hourly": st.column_config.NumberColumn("CPU $/h", format="$%.3f"),
            "avg_ram_cost_hourly": st.column_config.NumberColumn("RAM $/h", format="$%.3f"),
        },
    )
    cap = ('Requested-vs-recommended cost is not in this payload (GET '
           'workload-costs carries window totals only; the richer summaries are '
           'POST-only and stay unused under the read-only posture).')
    if truncated:
        cap = "Showing the first 500 workloads (page cap). " + cap
    st.caption(cap)
