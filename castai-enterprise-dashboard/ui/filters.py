"""Filter bar for the enterprise fleet table v2 (docs/ux-v2.md §3, §6).

Contract:
  * ``render_filters(df) -> DataFrame`` — renders the filter widgets and
    returns the filtered fleet frame. ALL filters AND-compose against the
    cached (merged) fleet df via one pure function ``apply_filter_state``
    (ux-design.md §4 "one funnel"); needs-attention pill chips OR inside the
    chip set (ux-v2 §6).
  * Pure pandas only — this module makes ZERO API calls (rerun invariants
    I1/I4: filter edits must cost 0 requests).
  * Empty multiselect == "all" (documented in every widget's help text).
  * Ghost rows (``is_ghost``) are EXCLUDED by default; the "Show ghost rows"
    toggle (off by default) un-quarantines them (ADR v2 R5).
  * Every derived bucket (Automation / Data freshness) is computed
    defensively: absent columns degrade to bucket "NA"/"unknown" rather than
    raising (frozen-column contract).
"""

from __future__ import annotations

from typing import Any, Mapping

import pandas as pd
import streamlit as st

__all__ = [
    "FILTER_KEYS",
    "render_filters",
    "reset_filters",
    "filters_active",
    "apply_filters",
    "apply_filter_state",
    "automation_bucket",
    "freshness_bucket",
    "attention_masks",
    "ATTENTION_OPTIONS",
    "AUTOMATION_OPTIONS",
    "FRESHNESS_OPTIONS",
    "F_AUTOMATION",
    "F_FRESHNESS",
    "F_ATTENTION",
    "F_SHOW_GHOSTS",
]

# Stable widget keys (list kept in one place for Reset-filters).
F_ORGS = "flt_organizations"
F_SEARCH = "flt_cluster_search"
F_PROVIDER = "flt_provider"
F_REGION = "flt_region"
F_STATUS = "flt_status"
F_AGENT = "flt_agent_status"
F_WA = "flt_wa_status"
F_AUTOMATION = "flt_automation"
F_FRESHNESS = "flt_freshness"
F_ATTENTION = "flt_attention"
F_SHOW_GHOSTS = "flt_show_ghosts"
FILTER_KEYS = [
    F_ORGS, F_SEARCH, F_PROVIDER, F_REGION, F_STATUS, F_AGENT, F_WA,
    F_AUTOMATION, F_FRESHNESS, F_ATTENTION,
]
# F_SHOW_GHOSTS is a bool toggle — popped by reset_filters but NOT part of the
# list-valued iteration (a resting False must never count as "active").

_HELP_AND = "Multi-select; options AND together with the other filters. Empty = all."
_HELP_SEARCH = "Substring match on cluster name (case-insensitive)."

# Derived-bucket domains (Agent 6 automation mapping; freshness 60m rule).
AUTOMATION_OPTIONS = [
    "Automating",
    "Halted",
    "Hibernating",
    "Agent disconnected",
    "Connecting",
    "NA",
]
FRESHNESS_OPTIONS = ["fresh", "stale", "unknown"]

ATTENTION_OPTIONS = [
    "Has issues",
    "Negative savings",
    "Low WA coverage (<50%)",
    "Not installed WA",
    "Stale data",
]

_DISCONNECTED_WORDS = (
    "disconnected", "disconnecting", "non-responding", "deleted", "terminated",
    "archived", "deleting", "not_healthy",
)
_HIBERNATING_WORDS = ("hibernating", "hibernate", "sleeping", "suspended")
_CONNECTING_WORDS = ("connecting", "provisioning", "pending")
_HALTED_WORDS = ("failed", "warning", "error", "degraded", "halt")
_OK_WORDS = ("ready", "active", "ok", "running", "connected", "healthy")

_FRESH_STALE_MINUTES = 60.0


def _norm(value: Any) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).strip().lower()


def _contains(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


def automation_bucket(status: Any, agent_status: Any) -> str:
    """Automation bucket derived from (status, agent_status) — Agent 6 domain:
    Automating (expected) / Halted (failed|warning) / Hibernating /
    Agent disconnected / Connecting / NA.
    """

    s, a = _norm(status), _norm(agent_status)
    joined = s or a
    if not joined:
        return "NA"
    if _contains(s, _DISCONNECTED_WORDS) or _contains(a, _DISCONNECTED_WORDS):
        return "Agent disconnected"
    if _contains(s, _HIBERNATING_WORDS) or _contains(a, _HIBERNATING_WORDS):
        return "Hibernating"
    if _contains(s, _CONNECTING_WORDS) or _contains(a, _CONNECTING_WORDS):
        return "Connecting"
    if _contains(s, _HALTED_WORDS) or _contains(a, _HALTED_WORDS):
        return "Halted"
    if _contains(s, _OK_WORDS) or _contains(a, _OK_WORDS):
        return "Automating"
    return "NA"


def freshness_bucket(
    freshness_status: Any = None,
    snapshot_age_minutes: Any = None,
    last_updated: Any = None,
) -> str:
    """fresh / stale (>60m) / unknown — prefers the Wave-A
    ``data_freshness_status`` column, then raw age minutes, then
    ``last_updated`` (v1 column)."""

    text = _norm(freshness_status)
    if text in ("fresh", "ok", "green"):
        return "fresh"
    if text in ("stale", "old", "red"):
        return "stale"
    if text:
        return "unknown"
    age = snapshot_age_minutes
    if age is None or (_norm(str(age)) == ""):
        stamp = pd.to_datetime(last_updated, errors="coerce", utc=True) if last_updated is not None else None
        if stamp is not None and not pd.isna(stamp):
            age = (pd.Timestamp.now(tz="UTC") - stamp).total_seconds() / 60.0
    try:
        m = float(age)
    except (TypeError, ValueError):
        return "unknown"
    return "fresh" if m < _FRESH_STALE_MINUTES else "stale"


def _series_automation(df: pd.DataFrame) -> pd.Series:
    status = df["status"] if "status" in df.columns else None
    agent = df["agent_status"] if "agent_status" in df.columns else None
    n = len(df)
    return pd.Series(
        [
            automation_bucket(s, a)
            for s, a in zip(
                status.tolist() if status is not None else [None] * n,
                agent.tolist() if agent is not None else [None] * n,
            )
        ],
        index=df.index,
    )


def _series_freshness(df: pd.DataFrame) -> pd.Series:
    status_col = df.get("data_freshness_status")
    age_col = df.get("snapshot_age_minutes")
    stamp_col = df.get("last_updated")
    n = len(df)
    return pd.Series(
        [
            freshness_bucket(s, a, t)
            for s, a, t in zip(
                status_col.tolist() if status_col is not None else [None] * n,
                age_col.tolist() if age_col is not None else [None] * n,
                stamp_col.tolist() if stamp_col is not None else [None] * n,
            )
        ],
        index=df.index,
    )


def _bool_col(df: pd.DataFrame, name: str) -> pd.Series:
    if name not in df.columns:
        return pd.Series(False, index=df.index)
    return df[name].fillna(False).astype(bool)


def _num_positive(df: pd.DataFrame, name: str) -> pd.Series:
    if name not in df.columns:
        return pd.Series(False, index=df.index)
    return (pd.to_numeric(df[name], errors="coerce") > 0).fillna(False)


def attention_masks(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Needs-attention chip masks (ux-v2 §6). Pure; absent sources produce
    all-False masks (the chip stays selectable, matches nothing — the help
    text says so)."""

    masks: dict[str, pd.Series] = {}
    status_disconnected = pd.Series(False, index=df.index)
    for name in ("status", "agent_status"):
        if name in df.columns:
            text = df[name].astype("string").str.lower()
            for word in _DISCONNECTED_WORDS:
                status_disconnected |= text.str.contains(word, na=False)
    has_issues = (
        _num_positive(df, "unschedulable_pods")
        | _num_positive(df, "enr_health_problematic_nodes_count")
        | _num_positive(df, "enr_health_problematic_workloads_count")
        | status_disconnected
    )
    masks["Has issues"] = has_issues

    if "has_negative_savings" in df.columns:
        masks["Negative savings"] = _bool_col(df, "has_negative_savings")
    elif "potential_savings" in df.columns:
        masks["Negative savings"] = (
            pd.to_numeric(df["potential_savings"], errors="coerce") < 0
        ).fillna(False)
    else:
        masks["Negative savings"] = pd.Series(False, index=df.index)

    if "enr_wa_coverage_wa_coverage_pct" in df.columns:
        masks["Low WA coverage (<50%)"] = (
            pd.to_numeric(df["enr_wa_coverage_wa_coverage_pct"], errors="coerce") < 0.5
        ).fillna(False)
    else:
        masks["Low WA coverage (<50%)"] = pd.Series(False, index=df.index)

    if "workload_autoscaler_status" in df.columns:
        masks["Not installed WA"] = (
            df["workload_autoscaler_status"].astype("string").str.lower()
            == "not installed"
        ).fillna(False)
    else:
        masks["Not installed WA"] = pd.Series(False, index=df.index)

    masks["Stale data"] = _series_freshness(df) == "stale"
    return masks


def _options(df: pd.DataFrame, column: str) -> list[str]:
    """Sorted unique non-null values of a column, as plain strings."""

    if df is None or column not in df.columns:
        return []
    values = df[column].dropna().unique()
    return sorted(str(v) for v in values)


def _selected_from(state: Mapping[str, Any], key: str) -> list[str]:
    value = state.get(key)
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return [str(value)]


def _selected(key: str) -> list[str]:
    return _selected_from(st.session_state, key)


def reset_filters() -> None:
    """Clear every filter widget key and rerun (Streamlit >= 1.29 pattern)."""

    for key in FILTER_KEYS:
        st.session_state.pop(key, None)
    st.session_state.pop(F_SHOW_GHOSTS, None)
    st.rerun()


def _state_active(state: Mapping[str, Any]) -> bool:
    if state.get(F_SEARCH):
        return True
    for key in FILTER_KEYS:
        if key == F_SEARCH:
            continue
        if _selected_from(state, key):
            return True
    return False


def filters_active(df: pd.DataFrame | None = None) -> bool:
    """True when any filter widget currently restricts the fleet scope."""

    if _state_active(st.session_state):
        return True
    return bool(st.session_state.get(F_SHOW_GHOSTS))


def apply_filter_state(df: pd.DataFrame, state: Mapping[str, Any]) -> pd.DataFrame:
    """AND-compose all active filters in ``state`` against df (pure pandas).

    ``state`` maps widget keys to values — session_state-agnostic so tests can
    drive it directly. Ghost rows are excluded unless ``F_SHOW_GHOSTS`` is
    truthy (QUARANTINED by default, ADR v2 R5).
    """

    if df is None or len(df) == 0:
        return df
    out = df

    # Ghost quarantine first (default OFF).
    if not state.get(F_SHOW_GHOSTS) and "is_ghost" in out.columns:
        out = out[~_bool_col(out, "is_ghost")]
        if len(out) == 0:
            return out

    orgs = _selected_from(state, F_ORGS)
    if orgs and "organization_name" in out.columns:
        out = out[out["organization_name"].astype("string").isin(orgs)]

    search = str(state.get(F_SEARCH) or "").strip()
    if search and "cluster_name" in out.columns:
        names = out["cluster_name"].astype("string")
        out = out[names.str.contains(search, case=False, na=False)]

    for key, column in (
        (F_PROVIDER, "provider"),
        (F_REGION, "region"),
        (F_STATUS, "status"),
        (F_AGENT, "agent_status"),
        (F_WA, "workload_autoscaler_status"),
    ):
        chosen = _selected_from(state, key)
        if chosen and column in out.columns:
            out = out[out[column].astype("string").isin(chosen)]

    automation = _selected_from(state, F_AUTOMATION)
    if automation:
        buckets = _series_automation(out)
        out = out[buckets.isin(automation)]

    freshness = _selected_from(state, F_FRESHNESS)
    if freshness:
        buckets = _series_freshness(out)
        out = out[buckets.isin(freshness)]

    attention = [c for c in _selected_from(state, F_ATTENTION) if c in ATTENTION_OPTIONS]
    if attention and len(out):
        masks = attention_masks(out)
        combined = pd.Series(False, index=out.index)
        for chip in attention:
            combined |= masks[chip]
        out = out[combined]

    return out


def apply_filters(df: pd.DataFrame) -> pd.DataFrame:
    """AND-compose all active session filters against df (pure pandas, no I/O)."""

    return apply_filter_state(df, st.session_state)


def render_filters(df: pd.DataFrame) -> pd.DataFrame:
    """Render the filter bar and return the filtered fleet frame."""

    with st.container():
        head_left, head_right = st.columns([6, 1])
        head_left.subheader("Filters")
        head_right.button(
            "Reset filters",
            key="flt_reset_btn",
            on_click=reset_filters,
            help="Clear every filter (empty = everything)",
        )

        row1 = st.columns([3, 2, 2, 2, 2])
        row1[0].multiselect(
            "Organization",
            _options(df, "organization_name"),
            key=F_ORGS,
            placeholder="All organizations",
            help=_HELP_AND,
        )
        row1[1].multiselect(
            "Provider",
            _options(df, "provider"),
            key=F_PROVIDER,
            placeholder="All providers",
            help=_HELP_AND,
        )
        row1[2].multiselect(
            "Region",
            _options(df, "region"),
            key=F_REGION,
            placeholder="All regions",
            help=_HELP_AND,
        )
        row1[3].multiselect(
            "Status",
            _options(df, "status"),
            key=F_STATUS,
            placeholder="All statuses",
            help=_HELP_AND,
        )
        row1[4].multiselect(
            "Agent status",
            _options(df, "agent_status"),
            key=F_AGENT,
            placeholder="All agent statuses",
            help=_HELP_AND,
        )

        row2 = st.columns([2, 2, 2, 5])
        row2[0].multiselect(
            "Workload autoscaler",
            _options(df, "workload_autoscaler_status"),
            key=F_WA,
            placeholder="All WA statuses",
            help=_HELP_AND,
        )
        row2[1].multiselect(
            "Automation",
            AUTOMATION_OPTIONS,
            key=F_AUTOMATION,
            placeholder="All automation states",
            help="Derived from status + agent_status: Automating (expected) · "
                 "Halted (failed|warning) · Hibernating · Agent disconnected · "
                 "Connecting · NA. " + _HELP_AND,
        )
        row2[2].multiselect(
            "Data freshness",
            FRESHNESS_OPTIONS,
            key=F_FRESHNESS,
            placeholder="All freshness",
            help="fresh (<60m) · stale (≥60m) · unknown. " + _HELP_AND,
        )
        row2[3].text_input(
            "Search cluster name",
            key=F_SEARCH,
            placeholder="🔎 Search cluster name…",
            help=_HELP_SEARCH,
        )

        pills_col, ghost_col = st.columns([5, 1])
        with pills_col:
            st.pills(
                "Needs attention",
                ATTENTION_OPTIONS,
                selection_mode="multi",
                key=F_ATTENTION,
                help="Chips OR together; AND with the filters above. A chip whose "
                     "source column has not loaded yet matches nothing. Ghost rows "
                     "are quarantined by default — enable the toggle at right.",
            )
        ghost_col.toggle(
            "Show ghost rows",
            key=F_SHOW_GHOSTS,
            help="UNSPECIFIED-status ghost rows are quarantined from filters and "
                 "KPIs by default (ADR v2 R5).",
        )

    return apply_filters(df)
