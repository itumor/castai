"""CAST AI Enterprise Dashboard — single-page Streamlit app.

Layout & behavior contract: docs/ux-design.md + docs/ux-v2.md (normative).
Rerun invariants:
  I1 table interactions (sort/filter/search/paginate/picker) → 0 API calls
     (fleet frame comes solely from cached org-level loaders; all filtering
     is in-memory pandas).
  I2 cluster row selection → the two Tier-1 loaders (Overview, Resources)
     only, each @st.cache_data-keyed by (org, cluster, range, refresh_token).
  I3 Tier-2 tabs (Cost, Savings, Workload Autoscaler, Node Autoscaler, Nodes,
     Workloads, Issues, History — 12 armable loader ids: Wave-C tab families
     cost/pricing, savings/savings_est, issues/notifications/oom share one
     button per tab) render a "Load … data" button until armed via
     ``st.session_state[f"tab_armed_{cluster_id}_{tab}"]`` — the FLAG, not the
     click, drives rendering (st.tabs is NOT lazy; it re-executes all bodies).
     Data Quality renders with 0 API calls from the merged fleet row only.
  I4 filter edits with a selection open → 0 API calls (same cache keys).
  I5 the ⟳ Refresh button (bumping ``refresh_token``) is the SOLE cache
     invalidation path; it also clears all enrichment batches (stale windows).
  I6 enrichment batch loaders are callable ONLY from the enrichment-expander
     handlers (``st.session_state["_enr"][kind]`` is the only store; there is
     exactly ONE ``run_enrichment`` call site in this app, inside
     ``_run_enrichment_batch``) and from drill-down arming handlers. Page
     load, filter edits, sorts, and selections fire ZERO batch calls.

Caching (architecture.md §7): clients are built INSIDE cached functions from
``load_settings()`` so the API key never participates in a cache key, never
lands in session_state, and is never rendered.

Import safety: this module must import cleanly without a Streamlit runtime,
without config, and while sibling services are still skeletons (parallel
builders land them); nothing executable happens at import time — everything
runs under ``main()``.
"""

from __future__ import annotations

import os
import time
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Mapping

import pandas as pd
import streamlit as st

from config.settings import load_settings
from services.castai_client import CastAIClient
from services.cluster_service import build_fleet_dataframe
from services.cost_service import (
    enterprise_kpis,
    notifications_summary,
    org_oom_totals,
)
from services.enrichment_service import run_enrichment
from services.optimization_service import (
    build_issues_feed,
    count_node_phases,
    estimated_history_frame,
    load_cluster_cost,
    load_cluster_estimated_history,
    load_cluster_issues,
    load_cluster_na_policies,
    load_cluster_node_history,
    load_cluster_node_pricing,
    load_cluster_nodes,
    load_cluster_notifications,
    load_cluster_oom_events,
    load_cluster_overview,
    load_cluster_realized_savings,
    load_cluster_resources,
    load_cluster_wa,
    load_cluster_workload_costs,
    trend_from_cluster_savings,
)
from services.organization_service import discover_enterprise_hierarchy
from ui.cards import (
    compute_kpi_extras,
    render_health_banner_v2,
    render_kpis_v2,
)
from ui.charts import (
    cost_by_org_bar,
    cumulative_realized_line,
    current_vs_optimal_bar,
    daily_cost_trend,
    estimated_history_lines,
    node_count_history_area,
    realized_savings_area,
    spot_adoption_area,
)
from ui.filters import filters_active, render_filters
from ui.tables import (
    data_age_label,
    node_state_chips,
    render_fleet_table,
    render_issues_feed,
    render_node_pricing_table,
    render_nodes_table,
    render_wa_workloads_table,
    render_workload_costs_table,
)
from utils.errors import ConfigError, sanitize_message
from utils.formatting import fmt_count, fmt_gib, fmt_money_compact, fmt_na, fmt_pct

# The daily-cost trend is derived from the fleet sweep's OWN per-org report
# payloads (FleetResult.reports) — no second API sweep (final-review MAJOR-2).
from services.cost_service import trend_from_reports
# Cost-change banner + top movers ride the SAME report payloads (ADR v2 R4 —
# 0 additional calls).
from services.history_service import (
    spot_trend_from_org_efficiency,
    top_movers_from_reports,
    window_pct_from_reports,
)

# ------------------------------------------------------------------- cache layer


@st.cache_resource(show_spinner=False)
def build_client(base_url: str) -> CastAIClient:
    """One shared API client per base_url; key read only inside (SEC-2.3)."""

    settings = load_settings()  # env-first, fail closed
    return CastAIClient(base_url, settings.get_api_key())


@st.cache_data(ttl=900, show_spinner="Discovering enterprise organizations…")
def cached_hierarchy(base_url: str, enterprise_id: str | None, refresh_token: int):
    del refresh_token  # cache-busting argument only (invariant I5)
    return discover_enterprise_hierarchy(build_client(base_url), enterprise_id)


@st.cache_data(ttl=900, show_spinner="Loading enterprise fleet (organization sweep)…")
def cached_fleet(
    base_url: str,
    enterprise_id: str | None,
    start: str,
    end: str,
    max_workers: int,
    refresh_token: int,
    enable_org_efficiency: bool = True,
):
    hierarchy = cached_hierarchy(base_url, enterprise_id, refresh_token)
    return build_fleet_dataframe(
        build_client(base_url),
        hierarchy.organizations,
        start,
        end,
        max_workers=max_workers,
        # The flag participates in the cache key so env flips invalidate
        # correctly (Wave-A audit gap; ADR v2 R2 1+6N budget).
        include_org_efficiency=bool(enable_org_efficiency),
    )


# -------------------------------------------------- flag-gated Tier-1 extras
# notifications_summary / org_oom_totals keep their Tier-1 service variants
# but stay FLAG-GATED loaders (ADR v2 R2/R7): they are NEVER called from the
# sweep — only through these wrappers, and only when the env/settings flag is
# explicitly enabled. ``enabled`` rides the cache key so a flag flip cannot
# serve a stale "off" result.


@st.cache_data(ttl=300, show_spinner=False)
def cached_notifications_summary(
    base_url: str,
    org_pairs: tuple,
    refresh_token: int,
    enabled: bool,
):
    del refresh_token
    if not enabled:
        return {}, []
    orgs = [SimpleNamespace(organization_id=o, organization_name=n) for o, n in org_pairs]
    return notifications_summary(build_client(base_url), orgs)


@st.cache_data(ttl=900, show_spinner=False)
def cached_oom_totals(
    base_url: str,
    org_pairs: tuple,
    start: str,
    end: str,
    refresh_token: int,
    enabled: bool,
):
    del refresh_token
    if not enabled:
        return {}, []
    orgs = [SimpleNamespace(organization_id=o, organization_name=n) for o, n in org_pairs]
    return org_oom_totals(build_client(base_url), orgs, start, end)


@st.cache_data(ttl=900, show_spinner=False)
def cached_spot_trend(
    base_url: str,
    org_pairs: tuple,
    start: str,
    end: str,
    max_workers: int,
    refresh_token: int,
):
    """Fleet spot-CPU-share daily series — opt-in History scope (ADR v2 R4);
    cached 15 min keyed by (orgs, window). Only called from the expander's
    button handler (never auto-fired)."""

    del refresh_token
    orgs = [SimpleNamespace(organization_id=o, organization_name=n) for o, n in org_pairs]
    return spot_trend_from_org_efficiency(
        build_client(base_url), orgs, start, end, max_workers=max_workers
    )


# Drill-down loaders — one cached wrapper per loader family (perf-v2 §4.3
# max_entries=128; R10 TTLs: 600 default, notifications 300, OOM/events 900,
# history/immutable series 6 h). Each cached wrapper fires its GET(s) ONLY when
# the owning tab is armed (I3); wrappers shared across tabs (cost, savings,
# estimated history) dedupe through st.cache_data keys.

@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_overview(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_overview(build_client(base_url), org_id, cluster_id, start, end)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_resources(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_resources(build_client(base_url), org_id, cluster_id, start, end)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_cost(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_cost(build_client(base_url), org_id, cluster_id, start, end)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_pricing(base_url, org_id, cluster_id, start, end, refresh_token):
    del start, end, refresh_token
    return load_cluster_node_pricing(build_client(base_url), org_id, cluster_id)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_savings(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    # REALIZED savings only (…/savings, daily buckets) — never mixed with the
    # estimated family (finops §1 realized/estimated separation).
    return load_cluster_realized_savings(build_client(base_url), org_id, cluster_id, start, end)


@st.cache_data(ttl=21600, max_entries=128, show_spinner=False)
def cached_drilldown_est_history(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_estimated_history(build_client(base_url), org_id, cluster_id, start, end)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_wa(base_url, org_id, cluster_id, start, end, refresh_token):
    del start, end, refresh_token
    return load_cluster_wa(build_client(base_url), org_id, cluster_id)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_na(base_url, org_id, cluster_id, start, end, refresh_token):
    del start, end, refresh_token
    return load_cluster_na_policies(build_client(base_url), org_id, cluster_id)


@st.cache_data(ttl=900, max_entries=128, show_spinner=False)
def cached_waste_crosscheck(base_url, org_id, start, end, refresh_token):
    """ADR v2 R2 cross-check: org `/efficiency/summary` totalWaste (1 GET/org)."""
    del refresh_token
    client = build_client(base_url)
    getter = getattr(client, "get_org_efficiency_summary", None)
    if getter is None:
        return None
    try:
        payload = getter(org_id, start, end) or {}
    except Exception:  # noqa: BLE001 - cross-check is advisory, never fatal
        return None
    raw = payload.get("totalWaste")
    if raw is None and isinstance(payload.get("summary"), dict):
        raw = payload["summary"].get("totalWaste")
    try:
        return {"total_waste_summary": float(raw)} if raw is not None else None
    except (TypeError, ValueError):
        return None


def _waste_drift(frame_sum, summary_total):
    """Pure drift math: (drift_fraction|None, exceeds_5pct|None).

    Either side missing or frame_sum <= 0 -> (None, None): no verdict possible.
    """
    try:
        if frame_sum is None or summary_total is None:
            return None, None
        fs = float(frame_sum)
        st_ = float(summary_total)
    except (TypeError, ValueError):
        return None, None
    if fs <= 0:
        return None, None
    drift = abs(st_ - fs) / fs
    return drift, drift > 0.05


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_nodes(base_url, org_id, cluster_id, start, end, refresh_token):
    del start, end, refresh_token
    return load_cluster_nodes(build_client(base_url), org_id, cluster_id)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_workload_costs(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_workload_costs(build_client(base_url), org_id, cluster_id, start, end)


@st.cache_data(ttl=600, max_entries=128, show_spinner=False)
def cached_drilldown_issues(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_issues(build_client(base_url), org_id, cluster_id)


@st.cache_data(ttl=300, max_entries=128, show_spinner=False)
def cached_drilldown_notifications(base_url, org_id, cluster_id, start, end, refresh_token):
    del start, end, refresh_token
    return load_cluster_notifications(build_client(base_url), org_id, cluster_id)


@st.cache_data(ttl=900, max_entries=128, show_spinner=False)
def cached_drilldown_oom(base_url, org_id, cluster_id, start, end, refresh_token):
    del start, refresh_token
    return load_cluster_oom_events(build_client(base_url), org_id, cluster_id, end)


@st.cache_data(ttl=21600, max_entries=128, show_spinner=False)
def cached_drilldown_node_history(base_url, org_id, cluster_id, start, end, refresh_token):
    del refresh_token
    return load_cluster_node_history(build_client(base_url), org_id, cluster_id, start, end)


# ------------------------------------------------------- session-state helpers

# 12 armable drill-down ids (Wave-C): ux-v2 §5's 8 (cost, savings, wa, na,
# nodes, workloads, issues, history) extended by the Wave-C loader families
# (pricing, notifications, oom) + savings_est. Overview/Resources stay Tier-1
# auto-load (I2 — no flag); Data Quality renders with 0 API calls (no flag).
_TAB_IDS = (
    "cost", "pricing", "savings", "savings_est", "wa", "na",
    "nodes", "workloads", "issues", "notifications", "oom", "history",
)

_ENR_KINDS = ("realized", "na_policies", "wa_coverage", "health")
# (kind, verb, calls-per-cluster) — button label verbs per the v2 panel.
_ENR_KIND_META = (
    ("realized", "Compute realized savings", 1),
    ("na_policies", "Load NA status", 1),
    ("wa_coverage", "Load WA coverage", 1),
    ("health", "Load cluster health", 3),
)
_ENR_CAPS = {"realized": 100, "na_policies": 400, "wa_coverage": 400, "health": 400}
_ENR_REALIZED_LARGE_CAP = 400


def _settings_flag(settings: Any, attr: str, env_name: str, default: bool = False) -> bool:
    """Resolve a boolean feature flag: Settings attribute first (config/
    settings.py naming is reused), then the process environment."""

    value = getattr(settings, attr, None)
    if value is not None:
        return bool(value)
    raw = os.environ.get(env_name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def merge_enrichment(df: pd.DataFrame, session_dict: Mapping[str, Any]) -> pd.DataFrame:
    """ONE pure left-join of session enrichment into the fleet frame.

    ``session_dict["_enr"][kind]`` maps ``(organization_id, cluster_id) ->
    {field: value}`` (the exact ``EnrichmentResult.values`` shape stored by the
    enrichment-expander handlers). Every field joins as a prefixed
    ``enr_<kind>_<field>`` column; clusters without a batch row join as
    missing (the UI renders "—" / "n/a — load" — partial failures never
    fabricate values). Called ONCE per rerun, before KPIs + filters + table
    so KPI cards, needs-attention pills, and the table see the same columns.
    """

    if df is None or len(df) == 0:
        return df
    try:
        store = session_dict.get("_enr")
    except AttributeError:
        return df
    if not isinstance(store, dict) or not store:
        return df
    if "organization_id" not in df.columns or "cluster_id" not in df.columns:
        return df

    merged = df.copy()
    org_keys = df["organization_id"].astype("string").tolist()
    cluster_keys = df["cluster_id"].astype("string").tolist()

    for kind, per_key in store.items():
        if not isinstance(per_key, dict) or not per_key:
            continue
        normalized: dict[tuple[str, str], dict] = {}
        for key, value in per_key.items():
            if not isinstance(value, dict):
                continue
            if isinstance(key, tuple) and len(key) == 2:
                normalized[(str(key[0]), str(key[1]))] = value
            elif isinstance(key, str) and "|" in key:
                org_id, cluster_id = key.split("|", 1)
                normalized[(org_id, cluster_id)] = value
            elif isinstance(key, str):
                normalized[("", key)] = value
        if not normalized:
            continue
        fields = sorted({field for value in normalized.values() for field in value})
        for field in fields:
            column = f"enr_{kind}_{field}"
            joined = []
            for org_id, cluster_id in zip(org_keys, cluster_keys):
                row = normalized.get((org_id, cluster_id)) or normalized.get(("", cluster_id))
                joined.append(row.get(field) if isinstance(row, dict) else None)
            merged[column] = pd.array(joined, dtype="object")
    return merged


def _sync_enrichment_scope(refresh_token: int, start: str, end: str) -> None:
    """Clear enrichment + opt-in series when the refresh token bumps or the
    date window changes (ux-v2 I5-per-enrichment rule: both invalidate
    windowed batches; point-in-time batches ride on refresh too — a bump
    means "re-fetch everything")."""

    signature = (int(refresh_token), str(start), str(end))
    if st.session_state.get("_enr_scope_sig") != signature:
        st.session_state["_enr_scope_sig"] = signature
        for key in ("_enr", "_enr_stats", "_spot_trend"):
            st.session_state.pop(key, None)


def _round5(value: float) -> int:
    """Round to the nearest 5 with a floor of 5 (ETA label math, perf-v2 §2.4)."""

    return max(5, int(round(value / 5.0)) * 5)


def _enr_button_label(verb: str, n: int, calls_per_cluster: int) -> str:
    """Exact v2 button label: '<verb> for {n} filtered clusters · ~{calls} API
    calls · ~{lo}–{hi}s' with lo = round5(calls/7.9*0.9), hi =
    round5(calls/7.9*1.4+2) (measured 7.9 calls/s — perf-v2 §0/§2.4)."""

    calls = n * calls_per_cluster
    lo = _round5(calls / 7.9 * 0.9)
    hi = _round5(calls / 7.9 * 1.4 + 2)
    return f"{verb} for {n} filtered clusters · ~{calls} API calls · ~{lo}–{hi}s"


def _enr_batch_rows(filtered: pd.DataFrame, start: str, end: str) -> list[dict]:
    """Minimal row dicts for the batch runner over the CURRENT filtered scope
    (perf-v2 §2.2: never "all clusters"). Presence-checked fields only."""

    pass_through = (
        "status", "agent_status", "reporting_state", "workload_autoscaler_status",
        "organization_name",
    )
    rows: list[dict] = []
    records = filtered.to_dict("records")
    for record in records:
        row = {
            "organization_id": record.get("organization_id"),
            "cluster_id": record.get("cluster_id"),
            "start": start,
            "end": end,
        }
        for key in pass_through:
            value = record.get(key)
            if value is not None and not (isinstance(value, float) and pd.isna(value)) and str(value) != "<NA>":
                row[key] = value
        rows.append(row)
    return rows


def _run_enrichment_batch(
    kind: str,
    filtered: pd.DataFrame,
    base_url: str,
    max_workers: int,
    start: str,
    end: str,
    *,
    allow_large: bool = False,
) -> None:
    """Handler for ONE enrichment-button click (THE ONLY ``run_enrichment``
    call site in the whole app — I6 grep-guard asserts this).

    Sequential, synchronous within this rerun: a ThreadPoolExecutor lives and
    dies inside; the completion callback never touches session_state from a
    worker thread (only the main thread calls it). Results land in
    ``st.session_state["_enr"][kind]`` (the sole enrichment store — the fleet
    sweep is never re-run) followed by ONE ``st.rerun()`` so cards/table merge
    them in place.
    """

    verb = dict((k, v) for k, v, _c in _ENR_KIND_META)[kind]
    rows = _enr_batch_rows(filtered, start, end)
    total = len(rows)
    progress = st.progress(0.0, text=f"{verb}: 0/{total} clusters")

    def _progress(done: int, total_clusters: int, _elapsed: float, _eta: float) -> None:
        try:
            progress.progress(
                done / max(total_clusters, 1),
                text=f"{verb}: {done}/{total_clusters} clusters",
            )
        except Exception:  # noqa: BLE001 - progress must never break the batch
            pass

    st.session_state["_enr_running"] = kind
    try:
        result = run_enrichment(
            kind,
            build_client(base_url),
            rows,
            max_workers=max_workers,
            progress_cb=_progress,
            allow_large=allow_large,
        )
    except ValueError as exc:  # pre-flight cap refusal — never a half-run
        st.error(sanitize_message(str(exc)))
        st.session_state.pop("_enr_running", None)
        return  # the handler only; the rest of the page keeps rendering
    finally:
        st.session_state.pop("_enr_running", None)
        try:
            progress.empty()
        except Exception:  # noqa: BLE001
            pass

    st.session_state.setdefault("_enr", {})[kind] = result.values
    st.session_state.setdefault("_enr_stats", {})[kind] = {
        "attempted": result.attempted,
        "succeeded": result.succeeded,
        "failed": len(result.errors),
        "caps": dict(result.caps or {}),
        "messages": [getattr(err, "message", "") for err in result.errors[:5]],
        "fetched_at": time.time(),  # drill-down "refreshed by batch · age" badge
    }
    st.rerun()


def _render_enrichment_panel(filtered: pd.DataFrame, settings: Any, start: str, end: str) -> None:
    """On-demand enrichment expander (ux-v2 §4): the ONLY place batch loaders
    can fire (I6). Buttons are disabled/annotated pre-flight so the runner's
    ValueError refusal is a safety net, not the UX."""

    n = len(filtered) if filtered is not None else 0
    stats = st.session_state.get("_enr_stats") or {}
    running = st.session_state.get("_enr_running")

    with st.expander("On-demand enrichment — batched per-cluster API calls", expanded=False):
        st.caption(
            f"Scope: {n:,} filtered cluster{'s' if n != 1 else ''} — batches run over the "
            "current filter scope only; narrow filters first to cut calls. Results land as "
            "extra columns (enr_*) for this session until refresh/window change."
        )
        if n == 0:
            st.caption("No clusters in the filtered scope.")
            return

        allow_large = False
        for kind, verb, calls_per_cluster in _ENR_KIND_META:
            cap = _ENR_CAPS[kind]
            label = _enr_button_label(verb, n, calls_per_cluster)
            over_cap = n > cap
            disabled = bool(running) or over_cap
            if kind == "realized" and n > cap:
                allow_large = st.checkbox(
                    f"Run realized batch on all {n:,} clusters anyway "
                    f"(raises the realized cap 100 → {_ENR_REALIZED_LARGE_CAP}; "
                    "may take several minutes)",
                    key="enr_allow_large_realized",
                    disabled=n > _ENR_REALIZED_LARGE_CAP,
                )
                if allow_large and n <= _ENR_REALIZED_LARGE_CAP:
                    disabled = bool(running)
                    label = _enr_button_label(verb, n, calls_per_cluster)
            key = f"enr_btn_{kind}"
            clicked = st.button(label, key=key, disabled=disabled,
                                help=f"~{calls_per_cluster} API call{'s' if calls_per_cluster != 1 else ''} per cluster; "
                                     f"cap {cap} clusters (perf-v2 §2).")
            if over_cap and not (kind == "realized" and allow_large):
                st.caption(f"Disabled: {n:,} clusters exceeds the {cap}-cluster cap — narrow the filter (org/provider/status).")
            if clicked:
                _run_enrichment_batch(kind, filtered, settings.base_url,
                                      settings.max_workers, start, end,
                                      allow_large=allow_large and kind == "realized")

        # Status funnel (one line, same dict the KPI cards read — no drift).
        parts = []
        for kind, verb, _c in _ENR_KIND_META:
            entry = stats.get(kind)
            if not entry:
                parts.append(f"{verb.replace('Load ', '').replace('Compute ', '')} — not loaded")
            else:
                note = f" ({entry['failed']} failed)" if entry.get("failed") else ""
                parts.append(f"{verb.replace('Load ', '').replace('Compute ', '')} ✓ "
                             f"{entry['succeeded']}/{entry['attempted']}{note}")
        st.caption("Status: " + " · ".join(parts))

        failed = sum(int(e.get("failed", 0)) for e in stats.values())
        if failed:
            with st.expander(f"Per-cluster failures ({failed})", expanded=False):
                for kind, entry in stats.items():
                    for message in entry.get("messages", [])[:5]:
                        st.markdown(f"- `{kind}`: {message}")
                st.caption("Retry by re-clicking the batch; failed clusters contribute no values.")

        # Realized savings rollup (the KPI grid carries no realized card — the
        # total surfaces here once the batch has run; pre-batch guidance lives
        # in the button label + status line).
        realized_store = (st.session_state.get("_enr") or {}).get("realized")
        if realized_store:
            realized = pd.Series(
                [v.get("realized_savings") for v in realized_store.values() if isinstance(v, dict)],
                dtype="Float64",
            ).dropna()
            if len(realized):
                st.markdown(
                    f"**Realized savings over the window:** {fmt_money_compact(realized.sum())} "
                    f"across {len(realized)} cluster{'s' if len(realized) != 1 else ''} "
                    "(realized bucket — never summed with estimated/potential; finops §0 rule 5)."
                )
        else:
            st.caption("Realized savings: not computed — run 'Compute realized savings' above.")




def _reset_tab_flags() -> None:
    """Drop every tab_armed_* flag (called when the selected cluster changes)."""

    for key in [k for k in list(st.session_state.keys()) if k.startswith("tab_armed_")]:
        del st.session_state[key]


def _write_query_params(selected: tuple[str, str] | None) -> None:
    """Mirror the selection into st.query_params (lossy deep-linking)."""

    try:
        if selected:
            st.query_params["org"] = selected[0]
            st.query_params["cluster"] = selected[1]
        else:
            for name in ("org", "cluster"):
                if name in st.query_params:
                    del st.query_params[name]
    except Exception:  # deep-linking is best-effort, never blocks the page
        pass


def _seed_selection_from_query_params() -> None:
    if st.session_state.get("selected"):
        return
    org = st.query_params.get("org")
    cluster = st.query_params.get("cluster")
    if org and cluster:
        st.session_state["selected"] = (str(org), str(cluster))


# ------------------------------------------------------------- render helpers


def _scalar_rows(payload: Any, *, limit: int = 24) -> list[tuple[str, str]]:
    """Flatten a payload dict's top scalar leaves into (path, text) rows.

    Only scalar leaves are taken (lists of objects are rendered as tables
    elsewhere); strings are capped so nothing unbounded reaches the UI.
    """

    rows: list[tuple[str, str]] = []

    def walk(obj: Any, path: str) -> None:
        if len(rows) >= limit:
            return
        if isinstance(obj, dict):
            for key, value in obj.items():
                if str(key).startswith("_"):
                    continue
                walk(value, f"{path}.{key}" if path else str(key))
        elif isinstance(obj, bool):
            rows.append((path, "yes" if obj else "no"))
        elif isinstance(obj, (int, float)):
            rows.append((path, fmt_na(obj)))
        elif isinstance(obj, str):
            text = obj if len(obj) <= 60 else obj[:57] + "…"
            if text:
                rows.append((path, text))

    walk(payload, "")
    return rows


def _render_scalar_summary(payload: Any, *, label: str) -> None:
    rows = _scalar_rows(payload)
    if not rows:
        st.caption("No scalar fields exposed by the API for this section.")
        return
    frame = pd.DataFrame(rows, columns=["Field", "Value"])
    st.dataframe(frame, width="stretch", hide_index=True, height=min(400, 36 * len(rows) + 40))
    st.caption(label)


def _render_payload_errors(payload: dict) -> None:
    errors = payload.get("errors") if isinstance(payload, dict) else None
    if errors:
        joined = "; ".join(f"{op}: {msg}" for op, msg in list(errors.items())[:5])
        st.caption(f"Some endpoints failed: {joined}")


def _guard_loader(fn, *args):
    """Call a cached drilldown loader; render a sanitized warning on failure.

    Loaders normally never raise (they return {"available": False}), but a
    skeleton or an unexpected error must never surface a traceback in the UI.
    """

    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 - defensive UI boundary
        st.warning(f"Could not load this section: {sanitize_message(exc)}")
        return None


def _availability(payload: Any) -> dict | None:
    """None (with st.info rendered) when a loader dict reports unavailable."""

    if not isinstance(payload, dict):
        return None
    if payload.get("available") is False:
        reason = payload.get("reason") or "no data returned"
        st.info(f"Data unavailable for this cluster — {reason}.")
        return None
    return payload


def _find_timeseries(payload: Any) -> pd.DataFrame | None:
    """Locate the first list[dict] with timestamp+value keys in a payload."""

    if isinstance(payload, dict):
        for key in ("totalDailyCost", "dailyCost", "items"):
            value = payload.get(key)
            if isinstance(value, list) and value and isinstance(value[0], dict) and "timestamp" in value[0]:
                frame = pd.DataFrame(value)
                if "value" in frame.columns:
                    return frame[["timestamp", "value"]]
        for value in payload.values():
            found = _find_timeseries(value)
            if found is not None:
                return found
    return None


# ----------------------------------------------------- drill-down v2 helpers


def _present(value: Any) -> bool:
    """True when a fleet-row value carries data (not None/NA/NaN/empty-NA)."""

    if value is None:
        return False
    try:
        if bool(pd.isna(value)):
            return False
    except (TypeError, ValueError):
        pass
    if isinstance(value, str) and value.strip() in ("", "<NA>", "nan", "N/A"):
        return False
    return True


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return False
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("true", "yes", "1")


def _bool_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "N/A"
    return "Enabled" if _truthy(value) else "Disabled"


def _arm_gate(cluster_id: str, tab: str, label: str, caption: str, arms: tuple[str, ...]) -> bool:
    """v1 arming pattern (I3): render a 'Load …' button until the session flag
    is set; the FLAG, not the click, drives rendering (st.tabs is NOT lazy).
    One button may arm several loader-family ids (e.g. Issues arms
    issues+notifications+oom)."""

    keys = tuple(f"tab_armed_{cluster_id}_{t}" for t in arms)
    if all(st.session_state.get(k) for k in keys):
        return True
    if st.button(label, key=f"btn_load_{tab}_{cluster_id}"):
        for key in keys:
            st.session_state[key] = True
        return True
    st.caption(caption)
    return False


def _enr_batch_badge(kind: str, org_id: str, cluster_id: str) -> str | None:
    """'refreshed by batch · Nm' when the session enrichment store covers this
    cluster (merged session dict — 0 API calls, I6 intact)."""

    store = st.session_state.get("_enr") or {}
    per_key = store.get(kind)
    if not isinstance(per_key, dict) or not per_key:
        return None
    candidates = ((org_id, cluster_id), f"{org_id}|{cluster_id}", ("", cluster_id), cluster_id)
    if not any(key in per_key for key in candidates):
        return None
    stats = (st.session_state.get("_enr_stats") or {}).get(kind) or {}
    fetched_at = stats.get("fetched_at")
    if isinstance(fetched_at, (int, float)):
        age_min = max(0, int((time.time() - float(fetched_at)) // 60))
        return f"refreshed by batch · {age_min}m ago"
    return "refreshed by batch"


# ------------------------------------------------------------ tab fragments


@st.fragment
def _overview_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str, fleet_row: dict) -> None:
    # Tier-1: renders immediately on selection (I2) — cached loader.
    cols = st.columns(6)
    cols[0].metric("Nodes", fmt_count(fleet_row.get("nodes_total")), border=True)
    cols[1].metric("vCPU provisioned", fmt_na(fleet_row.get("cpu_provisioned")), border=True)
    cols[2].metric("Memory provisioned", fmt_gib(fleet_row.get("memory_provisioned_gib")), border=True)
    cols[3].metric("Agent status", fmt_na(fleet_row.get("agent_status")), border=True)
    cols[4].metric("WA status", fmt_na(fleet_row.get("workload_autoscaler_status")), border=True)
    cols[5].metric("Unschedulable pods", fmt_count(fleet_row.get("unschedulable_pods")), border=True)

    # v2 second row: agent health, k8s short+known, reporting state, WA display.
    row2 = st.columns(4)
    row2[0].metric("Agent health", fmt_na(fleet_row.get("agent_health")), border=True)
    k8s_short = fleet_row.get("kubernetes_version_short")
    k8s_known = _truthy(fleet_row.get("kubernetes_version_known"))
    row2[1].metric(
        "Kubernetes",
        (fmt_na(k8s_short) if k8s_known or _present(k8s_short) else "unknown"),
        delta=None if k8s_known or not _present(fleet_row.get("kubernetes_version")) else "unparsed version string",
        delta_color="off",
        border=True,
    )
    row2[2].metric("Reporting state", fmt_na(fleet_row.get("reporting_state")), border=True)
    drift = _truthy(fleet_row.get("wa_version_drift"))
    row2[3].metric(
        "WA display",
        fmt_na(fleet_row.get("wa_display")),
        delta="version drift" if drift else None,
        delta_color="inverse" if drift else "off",
        border=True,
    )

    # Freshness line + classic metadata caption (Wave-C: agent health / sync age).
    meta_bits = []
    for label, key in (("Provider", "provider"), ("Region", "region"),
                       ("Kubernetes", "kubernetes_version"), ("Data status", "data_status"),
                       ("Reporting state", "reporting_state")):
        value = fleet_row.get(key)
        if _present(value):
            meta_bits.append(f"{label}: **{value}**")
    if meta_bits:
        st.caption(" · ".join(meta_bits))
    freshness_bits = []
    if _present(fleet_row.get("latest_sync_time")):
        freshness_bits.append(f"latest sync: **{fleet_row.get('latest_sync_time')}**")
    if _present(fleet_row.get("snapshot_age_minutes")):
        chip = data_age_label(fleet_row.get("snapshot_age_minutes"))
        freshness_bits.append(f"age: {chip}")
    elif _present(fleet_row.get("data_freshness_status")):
        freshness_bits.append(f"freshness: {fleet_row.get('data_freshness_status')}")
    if freshness_bits:
        st.caption("Freshness — " + " · ".join(freshness_bits))

    # Session-merged enrichment values (enr_* columns, 0 refetch — I6).
    enr_bits = []
    if _present(fleet_row.get("enr_health_problematic_nodes_count")) or _present(
        fleet_row.get("enr_health_problematic_workloads_count")
    ):
        enr_bits.append(
            "health ✓ problematic nodes "
            + fmt_count(fleet_row.get("enr_health_problematic_nodes_count"))
            + " · workloads "
            + fmt_count(fleet_row.get("enr_health_problematic_workloads_count"))
        )
    if _present(fleet_row.get("enr_realized_realized_savings")):
        enr_bits.append(
            f"realized (window) {fmt_money_compact(fleet_row.get('enr_realized_realized_savings'))}"
        )
    if _present(fleet_row.get("enr_na_policies_na_enabled")):
        enr_bits.append(f"na policies ✓ enabled={fleet_row.get('enr_na_policies_na_enabled')}")
    if _present(fleet_row.get("enr_wa_coverage_wa_coverage_pct")):
        enr_bits.append(f"wa coverage {fmt_pct(fleet_row.get('enr_wa_coverage_wa_coverage_pct'))}")
    if enr_bits:
        st.caption("Session enrichment (merged in memory — no refetch): " + " · ".join(enr_bits))

    payload = _guard_loader(cached_drilldown_overview, base_url, org_id, cluster_id,
                            start, end, st.session_state.get("refresh_token", 0))
    if payload is None:
        return
    if _availability(payload) is None:
        return
    data = payload.get("data")
    if isinstance(data, dict):
        with st.expander("Cluster overview metrics (CAST AI API)", expanded=True):
            _render_scalar_summary(data, label=f"Source: clusters/{cluster_id}/overview, window {start} → {end}.")
    else:
        st.caption("Overview endpoint returned no detail payload.")


@st.fragment
def _resources_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str,
                   fleet_row: dict | None = None) -> None:
    # Tier-1: renders immediately on selection (I2) — cached loader.
    payload = _guard_loader(cached_drilldown_resources, base_url, org_id, cluster_id,
                            start, end, st.session_state.get("refresh_token", 0))
    if payload is None or _availability(payload) is None:
        return
    _render_payload_errors(payload)
    summary = payload.get("summary")
    usage = payload.get("usage")
    if isinstance(summary, dict):
        st.markdown("**Current composition (summary)**")
        _render_scalar_summary(summary, label=f"Source: clusters/{cluster_id}/summary (current state).")
    else:
        st.caption("Summary endpoint unavailable for this cluster.")

    # Storage block (fleet row from the T1 sweep — 0 extra calls).
    row = fleet_row or {}
    storage_present = any(
        _present(row.get(key))
        for key in ("storage_provisioned_gib", "storage_claimed_gib",
                    "storage_active_claimed_gib", "storage_commit_pct")
    )
    if storage_present:
        st.markdown("**Storage (from the enterprise summary)**")
        cols = st.columns(4)
        cols[0].metric("Provisioned", fmt_gib(row.get("storage_provisioned_gib")), border=True)
        cols[1].metric("Claimed (PVC)", fmt_gib(row.get("storage_claimed_gib")), border=True)
        cols[2].metric("Active-claimed", fmt_gib(row.get("storage_active_claimed_gib")), border=True)
        cols[3].metric("Commit", fmt_pct(row.get("storage_commit_pct"), scale="fraction"), border=True)
        st.caption("storage_used_gib: N/A — API has no used-PVC metric "
                   "(resource-metrics; commit = claimed/provisioned, never 'utilization').")

    # Request-efficiency gauges (used/requested, ADR R8 — stored 0–1).
    gauges = False
    gauge_cols = st.columns(2)
    for col, key, label in (
        (gauge_cols[0], "cpu_request_efficiency_pct", "CPU used/requested"),
        (gauge_cols[1], "memory_request_efficiency_pct", "Memory used/requested"),
    ):
        value = row.get(key)
        if not _present(value):
            col.metric(label, "N/A", delta="no usage data", delta_color="off", border=True)
            continue
        try:
            ratio = max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            col.metric(label, "N/A", delta="no usage data", delta_color="off", border=True)
            continue
        col.metric(label, fmt_pct(value), border=True)
        col.progress(ratio)
        gauges = True
    if not gauges:
        st.caption("Request-efficiency gauges show N/A until usage metrics arrive for this cluster.")

    if isinstance(usage, dict):
        with st.expander("Resource usage over the selected window", expanded=False):
            ts = _find_timeseries(usage)
            if ts is not None and len(ts) > 0:
                daily_cost_trend(ts, key=f"dd_res_usage_{cluster_id}")
            _render_scalar_summary(usage, label=f"Source: clusters/{cluster_id}/resource-usage, window {start} → {end}.")
    elif summary is None:
        st.caption("Usage endpoint unavailable for this cluster.")


@st.fragment
def _cost_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str,
              fleet_df: pd.DataFrame | None = None) -> None:
    if not _arm_gate(cluster_id, "cost", "Load Cost data",
                     "Cost data loads on demand for the selected date range.",
                     ("cost", "pricing")):
        return
    token = st.session_state.get("refresh_token", 0)
    payload = _guard_loader(cached_drilldown_cost, base_url, org_id, cluster_id,
                            start, end, token)
    if payload is None or _availability(payload) is None:
        return
    data = payload.get("data")
    if not isinstance(data, dict):
        st.caption("Cost endpoint returned no detail payload.")
        return
    ts = _find_timeseries(data)
    if ts is not None and len(ts) > 0:
        st.markdown("**Daily cost over the selected window**")
        daily_cost_trend(ts, key=f"dd_cost_trend_{cluster_id}")
    _render_scalar_summary(data, label=f"Source: clusters/{cluster_id}/cost, window {start} → {end}.")

    # Node pricing table (Wave-C: GET /v1/pricing/clusters/{id}/nodes, 1 GET,
    # own cached loader — its failure never blanks the cost trend above).
    st.markdown("**Node pricing (current, USD/hour)**")
    pricing = _guard_loader(cached_drilldown_pricing, base_url, org_id, cluster_id,
                            start, end, token)
    if pricing is not None and _availability(pricing) is not None:
        period = pricing.get("pricing_period") or {}
        if isinstance(period, dict) and (period.get("startTime") or period.get("endTime")):
            st.caption(f"Pricing period: {period.get('startTime', '?')} → {period.get('endTime', '?')}")
        render_node_pricing_table(
            pricing.get("pricing"),
            node_count=int(pricing.get("node_count") or 0),
            shown=int(pricing.get("shown") or 0),
        )

    # Namespace cost: the summaries endpoint is POST-only (spec-verified) —
    # read-only posture keeps it OUT (ADR v2): informational placeholder only.
    st.info(
        "Namespace cost breakdown is unavailable: `namespace-cost-summaries` is a "
        "POST endpoint and requires a read-semantics flag this dashboard does not "
        "use (read-only posture, data-model §7). No request was issued."
    )

    # ADR v2 R2 cross-check (1 GET/org, ttl 900): org efficiency/summary
    # totalWaste vs the Tier-1 waste column sums over this org's clusters —
    # >5% drift means one of the two sources is stale/incomplete.
    if isinstance(fleet_df, pd.DataFrame) and len(fleet_df) and {
        "organization_id", "waste_total_usd",
    } <= set(fleet_df.columns):
        org_rows = fleet_df.loc[
            fleet_df["organization_id"].astype("string") == str(org_id)
        ]
        frame_sum = org_rows["waste_total_usd"].sum(min_count=1)
        xs = _guard_loader(cached_waste_crosscheck, base_url, org_id, start, end, token)
        drift, exceeded = _waste_drift(frame_sum, (xs or {}).get("total_waste_summary"))
        if exceeded is True:
            st.warning(
                f"Waste cross-check drift **{drift * 100:.1f}%** (>5%): organization "
                f"summary reports a different total waste than the per-cluster Tier-1 "
                "rows — treat waste figures for this organization as provisional."
            )
        elif exceeded is False:
            st.caption(
                f"Waste cross-check passed (drift {drift * 100:.1f}% vs organization summary, within 5%)."
            )


@st.fragment
def _savings_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str,
                 fleet_row: dict | None = None) -> None:
    if not _arm_gate(cluster_id, "savings", "Load Savings data",
                     "Savings data loads on demand.", ("savings", "savings_est")):
        return
    token = st.session_state.get("refresh_token", 0)
    row = fleet_row or {}

    # STRICT separation (finops §1 §C): realized (actual window) vs estimated
    # (model) — separate headers, separate axes/units, never summed together.
    st.markdown(f"**Realized (actual window {start} → {end})** — `…/savings`")
    realized = _guard_loader(cached_drilldown_savings, base_url, org_id, cluster_id,
                             start, end, token)
    if realized is not None and _availability(realized) is not None:
        summary = realized.get("summary") or {}
        cols = st.columns(3)
        cols[0].metric("Total realized savings", fmt_money_compact(summary.get("total_savings")), border=True)
        cols[1].metric("Window cost", fmt_money_compact(summary.get("total_cost")), border=True)
        ts = trend_from_cluster_savings(realized)
        cols[2].metric("Daily buckets", fmt_count(len(ts)), border=True)
        if len(ts):
            realized_savings_area(ts, key=f"dd_sav_real_{cluster_id}")
        else:
            st.caption("No realized savings buckets in this window.")
    st.caption("Realized = achieved amounts (USD/window, additive). Never summed "
               "with the estimated panel below.")

    st.markdown("**Estimated (model)** — `…/estimated-savings-history`")
    est = _guard_loader(cached_drilldown_est_history, base_url, org_id, cluster_id,
                        start, end, token)
    if est is not None and _availability(est) is not None:
        frame = estimated_history_frame(est)
        if len(frame):
            estimated_history_lines(frame, key=f"dd_sav_est_{cluster_id}")
        else:
            st.caption("No estimated-savings history entries for this cluster/window.")
    st.caption("Estimated = modeled costPerHour lines (USD/h, evaluation "
               "snapshots; irregular cadence kept — no fabrication).")

    # NEGATIVE callout (finops §2 rule 9: raw value, unclamped, never green).
    if _truthy(row.get("has_negative_savings")):
        raw = row.get("potential_savings")
        raw_text = fmt_money_compact(raw) if _present(raw) else "N/A"
        st.warning(
            "No savings opportunity — the optimized configuration is estimated to "
            f"cost MORE than the current one (raw {raw_text}/mo, shown unclamped; "
            "typical for over-utilized READ_ONLY/DISCOVERED clusters where the "
            "rightsized optimum legitimately costs more — finops-model §2)."
        )


@st.fragment
def _wa_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str) -> None:
    if not _arm_gate(cluster_id, "wa", "Load Workload Autoscaler data",
                     "Workload-autoscaler data loads on demand.", ("wa",)):
        return
    payload = _guard_loader(cached_drilldown_wa, base_url, org_id, cluster_id,
                            start, end, st.session_state.get("refresh_token", 0))
    if payload is None or _availability(payload) is None:
        return
    _render_payload_errors(payload)

    # Coverage banner (workloads-summary with includeCosts=true).
    kpis = payload.get("wa_kpis") or {}
    cols = st.columns(5)
    cols[0].metric("Workloads", fmt_count(kpis.get("total")), border=True)
    cols[1].metric("Optimized", fmt_count(kpis.get("optimized")), border=True)
    cols[2].metric("Coverage", fmt_pct(kpis.get("coverage"), scale="fraction"), border=True)
    cols[3].metric("Requested $/h",
                   fmt_money_compact(kpis.get("cost_requested_hourly")) if _present(kpis.get("cost_requested_hourly")) else "N/A",
                   border=True)
    cols[4].metric("Recommended $/h",
                   fmt_money_compact(kpis.get("cost_recommended_hourly")) if _present(kpis.get("cost_recommended_hourly")) else "N/A",
                   border=True)
    if not _present(kpis.get("cost_requested_hourly")):
        st.caption("costsPerHour not present in this workloads-summary payload (includeCosts data absent).")

    st.markdown("**Workload table** (requested vs recommended; managed by CAST AI WA)")
    render_wa_workloads_table(payload.get("workloads"), truncated=bool(payload.get("workloads_truncated")))

    wa_summary = payload.get("wa_summary")
    if isinstance(wa_summary, dict):
        with st.expander("Raw workloads-summary scalars", expanded=False):
            _render_scalar_summary(wa_summary, label=f"Source: workload-autoscaling/clusters/{cluster_id}/workloads-summary.")


@st.fragment
def _na_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str,
            fleet_row: dict | None = None) -> None:
    if not _arm_gate(cluster_id, "na", "Load Node Autoscaler data",
                     "Node-autoscaler policies load on demand.", ("na",)):
        return
    payload = _guard_loader(cached_drilldown_na, base_url, org_id, cluster_id,
                            start, end, st.session_state.get("refresh_token", 0))
    if payload is None or _availability(payload) is None:
        return
    policies = payload.get("policies") or {}

    cols = st.columns(6)
    cols[0].metric("Node autoscaler", _bool_text(policies.get("enabled")), border=True)
    cols[1].metric("Spot instances", _bool_text(policies.get("spot_instances_enabled")), border=True)
    cols[2].metric("Downscaler", _bool_text(policies.get("node_downscaler_enabled")), border=True)
    cols[3].metric("Scoped mode", _bool_text(policies.get("is_scoped_mode")), border=True)
    evictor = policies.get("evictor") or {}
    cols[4].metric("Evictor", _bool_text(evictor.get("enabled")), border=True)
    cols[5].metric("Evictor dry-run", _bool_text(evictor.get("dry_run")), border=True)
    if _present(evictor.get("status")):
        st.caption(f"Evictor status: **{evictor.get('status')}**")
    if _present(policies.get("default_node_template_version")):
        st.caption(f"Default node template version: **{policies.get('default_node_template_version')}**")

    # Managed coverage from the T1 org summary (ADR R6 — 0 extra calls).
    row = fleet_row or {}
    managed = row.get("na_managed_nodes")
    total = row.get("nodes_total")
    if _present(managed) and _present(total):
        st.metric(
            "NA-managed nodes",
            f"{fmt_count(managed)} / {fmt_count(total)}",
            delta=fmt_pct(row.get("na_coverage_pct")) if _present(row.get("na_coverage_pct")) else None,
            delta_color="off",
            border=True,
        )
        st.caption("Managed counts from the organization clusters/summary payload "
                   "(nodeCount*Castai counters) — computed at the fleet sweep.")
    else:
        st.caption("NA-managed coverage: N/A — org summary counters absent for this cluster.")

    badge = _enr_batch_badge("na_policies", org_id, cluster_id)
    if badge:
        st.caption(f"🔄 This cluster's policies are also covered by the session "
                   f"enrichment batch ({badge}).")


@st.fragment
def _nodes_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str) -> None:
    if not _arm_gate(cluster_id, "nodes", "Load Nodes data",
                     "Node data loads on demand.", ("nodes",)):
        return
    df = _guard_loader(cached_drilldown_nodes, base_url, org_id, cluster_id,
                       start, end, st.session_state.get("refresh_token", 0))
    if df is None:
        return
    # State classification chips (same phase∪unschedulable logic as the health
    # enrichment batch — module-level helper import only, 0 extra calls).
    node_state_chips(count_node_phases(df))
    render_nodes_table(df, page_key=f"nodes_page_{cluster_id}")


@st.fragment
def _workloads_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str) -> None:
    if not _arm_gate(cluster_id, "workloads", "Load Workload cost data",
                     "Workload cost data loads on demand for the selected date range.",
                     ("workloads",)):
        return
    payload = _guard_loader(cached_drilldown_workload_costs, base_url, org_id, cluster_id,
                            start, end, st.session_state.get("refresh_token", 0))
    if payload is None or _availability(payload) is None:
        return
    reason = payload.get("no_data_reason")
    if _present(reason):
        st.caption(f"API noDataReason: **{reason}**")
    render_workload_costs_table(payload.get("workload_costs"), truncated=bool(payload.get("truncated")))


@st.fragment
def _issues_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str) -> None:
    if not _arm_gate(cluster_id, "issues", "Load Issues data",
                     "Issue data loads on demand (problems, notifications, OOM events).",
                     ("issues", "notifications", "oom")):
        return
    token = st.session_state.get("refresh_token", 0)
    # Merged feed per reliability-model §7: three sources, each with its own
    # cached loader + per-source failure isolation (partial data NEVER blanks
    # the tab — error chips ride the feed).
    issues = _guard_loader(cached_drilldown_issues, base_url, org_id, cluster_id,
                           start, end, token)
    notifications = _guard_loader(cached_drilldown_notifications, base_url, org_id, cluster_id,
                                  start, end, token)
    oom = _guard_loader(cached_drilldown_oom, base_url, org_id, cluster_id,
                        start, end, token)
    _render_payload_errors(issues if isinstance(issues, dict) else {})
    feed = build_issues_feed(issues, notifications, oom)
    summary = feed.get("summary") or {}
    cols = st.columns(5)
    cols[0].metric("Issue count", fmt_count(summary.get("issue_count")), border=True)
    cols[1].metric("OOM kills 24h", fmt_count(summary.get("oom_kills_24h")), border=True)
    cols[2].metric("OOM kills 7d", fmt_count(summary.get("oom_kills_7d")), border=True)
    cols[3].metric("Notifications (crit/err)", fmt_count(summary.get("critical_notifications")), border=True)
    cols[4].metric("Unacked notifications", fmt_count(summary.get("unacked_notifications")), border=True)
    st.caption("24h tile derived from the same 7d daily-bucket series (one call).")
    render_issues_feed(feed)


@st.fragment
def _history_tab(base_url: str, org_id: str, cluster_id: str, start: str, end: str) -> None:
    if not _arm_gate(cluster_id, "history", "Load History data",
                     "History series load on demand (all daily-step; 6 h cache).",
                     ("history",)):
        return
    token = st.session_state.get("refresh_token", 0)

    st.markdown("**Node-count history** (daily) — `node-count-history`")
    history = _guard_loader(cached_drilldown_node_history, base_url, org_id, cluster_id,
                            start, end, token)
    if history is not None and _availability(history) is not None:
        frame = history.get("node_history")
        n_buckets = len(frame) if frame is not None else 0
        if n_buckets and n_buckets < 14:
            # historical-model §1.2: aggregates over <14 buckets are N/A —
            # the raw series still renders, coverage aggregates stay unsaid.
            st.caption(f"Short series: {n_buckets} daily buckets (<14) — coverage "
                       "aggregates N/A (never extrapolated); the raw series is shown.")
        node_count_history_area(frame, key=f"dd_hist_nodes_{cluster_id}")
        first_seen = None
        for source in history.get("sources") or []:
            if isinstance(source, dict) and source.get("firstCollectedAt"):
                first_seen = source.get("firstCollectedAt")
                break
        caption_bits = []
        if _present(history.get("last_snapshot_at")):
            caption_bits.append(f"last snapshot {history.get('last_snapshot_at')}")
        if first_seen:
            caption_bits.append(f"data since {first_seen}")
        if caption_bits:
            st.caption("Source fidelity: " + " · ".join(caption_bits))

    # Realized savings — SHARED cached wrapper with the Savings tab (same key,
    # 0 extra GETs when both are armed), cumulative client-side derivation.
    st.markdown(f"**Realized savings (cumulative, {start} → {end})** — `savings`")
    realized = _guard_loader(cached_drilldown_savings, base_url, org_id, cluster_id,
                             start, end, token)
    if realized is not None and _availability(realized) is not None:
        daily = trend_from_cluster_savings(realized)
        if len(daily):
            cumulative_realized_line(daily, key=f"dd_hist_real_{cluster_id}")
        else:
            st.info("No realized savings buckets in this window.")

    # Daily cost — SHARED cached wrapper with the Cost tab (same key).
    st.markdown("**Daily cost** — `cost`")
    cost = _guard_loader(cached_drilldown_cost, base_url, org_id, cluster_id,
                         start, end, token)
    if cost is not None and _availability(cost) is not None:
        ts = _find_timeseries(cost.get("data"))
        if ts is not None and len(ts) > 0:
            daily_cost_trend(ts, key=f"dd_hist_cost_{cluster_id}")
        else:
            st.info("No daily-cost series for this window.")

    # Estimated savings history — SHARED cached wrapper with the Savings tab.
    st.markdown("**Estimated savings history (model)** — `estimated-savings-history`")
    est = _guard_loader(cached_drilldown_est_history, base_url, org_id, cluster_id,
                        start, end, token)
    if est is not None and _availability(est) is not None:
        frame = estimated_history_frame(est)
        if len(frame):
            estimated_history_lines(frame, key=f"dd_hist_est_{cluster_id}")
        else:
            st.info("No estimated-savings history entries for this cluster/window.")


def _dq_tab(fleet_row: dict) -> None:
    # Data Quality — renders from the merged fleet row ONLY (NO API calls,
    # ux-v2 §5 #11; asserted by tests).
    row = fleet_row or {}
    st.markdown("**Data completeness checklist**")
    checks = [
        ("Resource data", _present(row.get("cpu_provisioned")) or _present(row.get("memory_provisioned_gib"))),
        ("Cost data", _present(row.get("monthly_cost")) or _present(row.get("cost_hourly"))),
        ("Savings opportunity", _present(row.get("potential_savings_hourly")) or _present(row.get("potential_savings"))),
        ("WA status", _present(row.get("workload_autoscaler_status")) or _present(row.get("wa_display"))),
        ("Waste data", _present(row.get("waste_total_usd"))),
        ("Node data", _present(row.get("nodes_total"))),
        ("Storage data", _present(row.get("storage_provisioned_gib"))),
        ("Freshness data", _present(row.get("latest_sync_time"))),
    ]
    present_count = sum(1 for _label, ok in checks if ok)
    pct = present_count / len(checks) if checks else 0.0
    st.progress(pct)
    st.caption(f"data_completeness: {present_count}/{len(checks)} source families present "
               f"({pct:.0%}) — derived from this row's fields, 0 API calls.")
    for label, ok in checks:
        st.caption(f"{'✅' if ok else '⬜'} {label}")

    st.markdown("**Freshness**")
    cols = st.columns(3)
    cols[0].metric("Latest sync", fmt_na(row.get("latest_sync_time")), border=True)
    cols[1].metric("Snapshot age",
                   data_age_label(row.get("snapshot_age_minutes")) if _present(row.get("snapshot_age_minutes")) else "unknown",
                   border=True)
    cols[2].metric("Freshness", fmt_na(row.get("data_freshness_status")), border=True)

    st.markdown("**Source envelope**")
    cols = st.columns(4)
    cols[0].metric("Data status", fmt_na(row.get("data_status")), border=True)
    cols[1].metric("Reporting state", fmt_na(row.get("reporting_state")), border=True)
    cols[2].metric("Last updated", fmt_na(row.get("last_updated")), border=True)
    cols[3].metric("Phase 2", _bool_text(row.get("is_phase2")) if _present(row.get("is_phase2")) else "N/A", border=True)

    if _truthy(row.get("is_ghost")):
        st.warning("👻 Ghost row — reporting CLUSTER_STATE_UNSPECIFIED: quarantined from "
                   "fleet KPIs/filters (ADR v2 R5); shown here for transparency.")
    if _truthy(row.get("has_negative_savings")):
        st.caption("Negative savings flag is on for this cluster (raw kept unclamped; "
                   "see the Savings tab callout).")

    st.markdown("**Sentinel legend** (unknown ≠ 0)")
    st.markdown(
        "| Sentinel | Meaning |\n"
        "|---|---|\n"
        "| `0` | measured zero — a real reading |\n"
        "| `N/A` / `—` | absent — no claim either way |\n"
        "| `n/a — load` | available on demand (drill-down tab or batch button) |\n"
        "| `No-data` | the window/endpoint has no data |\n"
        "| `Disconnected` | cluster/agent unreachable |\n"
        "| `Unknown` | field exists but its value is unknown |\n"
        "| `Not installed` | the component is absent |\n"
        "| `Org error` | the organization failed to fetch |\n"
        "| `No savings opportunity` | estimated ≤ 0 (raw value kept) |\n"
        "| `−$X (cost increase)` | negative raw, never clamped |"
    )


# ------------------------------------------------------------ fleet table fragment


@st.fragment
def _fleet_table_section(filtered: pd.DataFrame) -> None:
    """Table fragment: sorting/selection reruns only this region (I1).

    A *selection change* additionally bumps the full app (st.rerun(scope="app"))
    so the drill-down fragments below re-render for the new cluster; pure
    sorting stays fragment-local.
    """

    selected = render_fleet_table(filtered)
    if selected is None:
        return
    previous = st.session_state.get("selected")
    if previous != (selected[0], selected[1]):
        st.session_state["selected"] = (selected[0], selected[1])
        _reset_tab_flags()
        _write_query_params(st.session_state["selected"])
        st.rerun(scope="app")


# ------------------------------------------------------------------ drill-down


def _lookup_fleet_row(fleet_df: pd.DataFrame | None, org_id: str, cluster_id: str) -> dict:
    if fleet_df is None or len(fleet_df) == 0:
        return {}
    if "organization_id" not in fleet_df.columns or "cluster_id" not in fleet_df.columns:
        return {}
    mask = (fleet_df["organization_id"].astype("string") == org_id) & (
        fleet_df["cluster_id"].astype("string") == cluster_id
    )
    rows = fleet_df.loc[mask]
    if rows.empty:
        return {}
    return rows.iloc[0].to_dict()


_DRILLDOWN_TAB_LABELS = [
    "Overview", "Resources", "Cost", "Savings",
    "Workload Autoscaler", "Node Autoscaler", "Nodes", "Workloads",
    "Issues", "History", "Data Quality",
]


def _render_drilldown(
    settings,
    merged_df: pd.DataFrame | None,
    filtered: pd.DataFrame | None,
    start: str,
    end: str,
) -> None:
    """11-tab drill-down (ux-v2 §5 + Wave-C). ``merged_df`` is the
    enrichment-MERGED fleet frame, so every tab reads ``enr_*`` session values
    from the passed row dict — 0 refetch (I6)."""
    selected = st.session_state.get("selected")
    if not selected:
        return
    org_id, cluster_id = str(selected[0]), str(selected[1])
    fleet_row = _lookup_fleet_row(merged_df, org_id, cluster_id)
    org_label = fleet_row.get("organization_name") or org_id
    cluster_label = fleet_row.get("cluster_name") or cluster_id

    head_left, head_right = st.columns([6, 1])
    head_left.markdown(f"### Cluster drill-down — **{org_label} / {cluster_label}**")
    if filtered is not None and len(filtered):
        in_scope = (
            (filtered["organization_id"].astype("string") == org_id)
            & (filtered["cluster_id"].astype("string") == cluster_id)
        ).any() if {"organization_id", "cluster_id"}.issubset(filtered.columns) else False
        if not in_scope:
            head_left.caption("Cluster not in current filter scope.")
    if head_right.button("✕ Clear selection", key="clear_selection"):
        st.session_state.pop("selected", None)
        _reset_tab_flags()
        _write_query_params(None)
        st.rerun(scope="app")

    tabs = st.tabs(_DRILLDOWN_TAB_LABELS)
    base_url = settings.base_url
    with tabs[0]:  # Overview (T1 auto)
        _overview_tab(base_url, org_id, cluster_id, start, end, fleet_row)
    with tabs[1]:  # Resources (T1 auto)
        _resources_tab(base_url, org_id, cluster_id, start, end, fleet_row)
    with tabs[2]:  # Cost (armed: cost+pricing)
        _cost_tab(base_url, org_id, cluster_id, start, end, merged_df)
    with tabs[3]:  # Savings (armed: savings+savings_est)
        _savings_tab(base_url, org_id, cluster_id, start, end, fleet_row)
    with tabs[4]:  # Workload Autoscaler (armed: wa)
        _wa_tab(base_url, org_id, cluster_id, start, end)
    with tabs[5]:  # Node Autoscaler (armed: na)
        _na_tab(base_url, org_id, cluster_id, start, end, fleet_row)
    with tabs[6]:  # Nodes (armed: nodes)
        _nodes_tab(base_url, org_id, cluster_id, start, end)
    with tabs[7]:  # Workloads (armed: workloads)
        _workloads_tab(base_url, org_id, cluster_id, start, end)
    with tabs[8]:  # Issues (armed: issues+notifications+oom)
        _issues_tab(base_url, org_id, cluster_id, start, end)
    with tabs[9]:  # History (armed: history; shares cost/savings/est caches)
        _history_tab(base_url, org_id, cluster_id, start, end)
    with tabs[10]:  # Data Quality — 0 API calls, no arm flag
        _dq_tab(fleet_row)


# ------------------------------------------------------------------------ main


def main() -> None:
    st.set_page_config(
        page_title="CAST AI Enterprise",
        page_icon="📊",
        layout="wide",
        initial_sidebar_state="collapsed",
    )

    # --- configuration (fail closed; generic message, SEC-1.4 / SEC-5.3) ---
    try:
        settings = load_settings()
    except ConfigError:
        st.error("Dashboard is not configured. Contact the administrator.")
        st.stop()

    st.session_state.setdefault("refresh_token", 0)
    st.session_state.setdefault("_enr", {})
    _seed_selection_from_query_params()
    token = st.session_state["refresh_token"]

    # --- Tier-1 data: hierarchy (fatal on failure) ---
    try:
        hierarchy = cached_hierarchy(settings.base_url, settings.enterprise_id, token)
    except Exception as exc:  # noqa: BLE001 - UI boundary
        st.error("Could not load CAST AI data. Check the API key and network connectivity.")
        st.caption(f"Detail: {sanitize_message(exc)}")
        if st.button("Retry", key="retry_hierarchy"):
            st.session_state["refresh_token"] += 1
            st.rerun()
        st.stop()

    # --- header ---
    head_title, head_date, head_refresh = st.columns([6, 3, 1])
    head_title.title("CAST AI Enterprise")
    head_title.caption(
        f"{hierarchy.enterprise.name} · {len(hierarchy.organizations)} organizations ·"
        " data may be ≤15 min old"
    )

    today = datetime.now(timezone.utc).date()
    default_range = (today - timedelta(days=30), today)
    picked = head_date.date_input(
        "Date range (cost & savings)",
        value=default_range,
        max_value=today,
        help="Applies to cost/savings KPIs, charts, and drill-down cost tabs. "
             "Cluster inventory is point-in-time.",
    )
    if isinstance(picked, tuple) and len(picked) == 2 and all(
        isinstance(d, date) for d in picked
    ):
        start_date, end_date = picked
    elif isinstance(picked, tuple) and len(picked) == 1 and isinstance(picked[0], date):
        start_date = end_date = picked[0]
    elif isinstance(picked, date):
        start_date = end_date = picked
    else:
        start_date, end_date = default_range
    start = f"{start_date.isoformat()}T00:00:00Z"
    end = f"{end_date.isoformat()}T23:59:59Z"

    if head_refresh.button("⟳ Refresh", type="primary", key="refresh_button",
                           help="Re-fetch everything from the CAST AI API now "
                                "(also clears enrichment batches)"):
        st.session_state["refresh_token"] += 1
        st.rerun(scope="app")

    # --- I5/I6: refresh bump or window change clears every batch store BEFORE
    # anything renders (merge below reads the cleared session state).
    _sync_enrichment_scope(token, start, end)

    # --- Tier-1 data: fleet sweep (partial failure is non-fatal) ---
    try:
        fleet = cached_fleet(
            settings.base_url,
            settings.enterprise_id,
            start,
            end,
            settings.max_workers,
            token,
            settings.enable_org_efficiency,
        )
    except Exception as exc:  # noqa: BLE001 - UI boundary
        st.error("Could not load CAST AI cluster data. Nothing was rendered from partial state.")
        st.caption(f"Detail: {sanitize_message(exc)}")
        if st.button("Retry", key="retry_fleet"):
            st.session_state["refresh_token"] += 1
            st.rerun()
        st.stop()

    st.caption(f"Last refreshed: {fleet.fetched_at or 'N/A'}")

    fleet_df = fleet.df if isinstance(getattr(fleet, "df", None), pd.DataFrame) else None
    all_errors = list(getattr(hierarchy, "errors", []) or []) + list(getattr(fleet, "errors", []) or [])

    rows_per_org = (
        fleet_df.groupby("organization_id").size().astype(int).to_dict()
        if fleet_df is not None and len(fleet_df) and "organization_id" in fleet_df.columns
        else {}
    )

    if fleet_df is None or len(fleet_df) == 0:
        st.warning(
            "No clusters were returned for this enterprise. Check that the API key "
            "has the documented read scopes on the child organizations, that "
            "clusters exist, and that no organization-scoped key restriction hides them."
        )
        render_health_banner_v2(all_errors, rows_per_org)
        st.stop()

    # --- grouped health banner (GAP-A/B): never suppressed while errors exist.
    render_health_banner_v2(all_errors, rows_per_org)

    # --- enrich → filter (ONE merge per rerun, before KPIs + filters + table,
    # so the cards, needs-attention pills, and table read the same columns).
    merged = merge_enrichment(fleet_df, st.session_state)

    # --- filters (pure pandas; I1/I4) ---
    filtered = render_filters(merged)
    if filtered is None:
        filtered = merged

    # --- flag-gated optional loaders (notifications / OOM — never in the sweep)
    org_pairs = tuple(
        (str(o.organization_id), str(o.organization_name)) for o in hierarchy.organizations
    )
    notifications_enabled = _settings_flag(
        settings, "enable_organization_notifications", "CASTAI_ENABLE_NOTIFICATIONS",
        default=bool(getattr(settings, "enable_notifications", False)),
    )
    oom_enabled = _settings_flag(settings, "enable_cluster_history", "CASTAI_ENABLE_CLUSTER_HISTORY", False)
    oom_total: int | None = None
    if oom_enabled:
        try:
            oom_map, oom_errors = cached_oom_totals(
                settings.base_url, org_pairs, start, end, token, True
            )
            if isinstance(oom_map, dict):
                total_value = oom_map.get("__enterprise__")
                if isinstance(total_value, dict):
                    total_value = total_value.get("total")
                if total_value is None:
                    numeric = [
                        v.get("total") if isinstance(v, dict) else v
                        for v in oom_map.values()
                    ]
                    numeric = [float(v) for v in numeric if isinstance(v, (int, float))]
                    total_value = sum(numeric) if numeric else None
                oom_total = int(total_value) if total_value is not None else None
        except Exception:  # noqa: BLE001 - optional card data must never break the page
            oom_total = None
    # notifications_summary is consciously NOT consumed by any v2 card yet —
    # the loader is wired and cached so a future card costs 0 extra calls.
    if notifications_enabled:
        try:
            cached_notifications_summary(settings.base_url, org_pairs, token, True)
        except Exception:  # noqa: BLE001
            pass

    # --- KPI cards v2 (derived from filtered rows) ---
    try:
        kpis = enterprise_kpis(filtered) if len(filtered) else {}
        aggregation_failed = False
    except Exception:  # noqa: BLE001 - aggregation layer may be a skeleton
        kpis = {}
        aggregation_failed = True
    if aggregation_failed:
        st.info("Cost aggregation is unavailable right now; the fleet table below is unaffected.")
    extras = compute_kpi_extras(filtered, oom_total=oom_total, oom_enabled=oom_enabled)
    scope_caption = None
    if filters_active(merged):
        scope_caption = f"Filtered scope: {len(filtered):,} of {len(merged):,} clusters"
    render_kpis_v2(kpis, extras, scope_caption=scope_caption)

    # --- On-demand enrichment panel (I6: the ONLY batch entry point) ---
    _render_enrichment_panel(filtered, settings, start, end)

    # --- charts ---
    st.markdown("---")
    chart_left, chart_right = st.columns([3, 2])
    with chart_left:
        st.markdown("**Monthly cost by organization**")
        try:
            cost_by_org_bar(filtered)
        except Exception:  # noqa: BLE001
            st.info("Cost chart unavailable in the current scope.")
    with chart_right:
        st.markdown("**Current vs optimal cost (top clusters)**")
        try:
            current_vs_optimal_bar(filtered)
        except Exception:  # noqa: BLE001
            st.info("Comparison chart unavailable in the current scope.")

    with st.expander("Daily cost over the selected range (enterprise)", expanded=False):
        # Final-review MAJOR-2: derived from the fleet sweep's own per-org report
        # payloads (FleetResult.reports) — zero additional API calls.
        try:
            trend_df = trend_from_reports(getattr(fleet, "reports", None))
        except Exception:  # noqa: BLE001
            trend_df = None
        if trend_df is None or len(trend_df) == 0:
            st.info("No daily-cost series for the selected range.")
        else:
            try:
                daily_cost_trend(trend_df, key="fleet_daily_trend")
            except Exception:  # noqa: BLE001
                st.info("Trend chart unavailable for the selected range.")

    # --- cost change banner + top movers (0 extra calls — FleetResult.reports) ---
    reports = getattr(fleet, "reports", None) or {}
    try:
        _cur_sum, window_pct = window_pct_from_reports(reports)
    except Exception:  # noqa: BLE001
        window_pct = None
    try:
        movers = top_movers_from_reports(reports, n=5)
    except Exception:  # noqa: BLE001
        movers = None
    if window_pct is not None:
        st.markdown(
            f"**Cost change vs prior equal window:** {fmt_pct(window_pct, scale='percent')} "
            "(ratio-of-sums over report payloads; orgs without a pct are excluded pairwise)."
        )
    if movers is not None and len(movers):
        st.markdown("**Top cost movers (clusters, by |Δ| vs prior window)**")
        org_names = (
            merged.groupby("organization_id")["organization_name"].first().to_dict()
            if "organization_id" in merged.columns and "organization_name" in merged.columns
            else {}
        )
        table = movers.copy()
        table.insert(0, "organization_name", table["organization_id"].map(org_names).fillna(table["organization_id"]))
        st.dataframe(
            table[["organization_name", "cluster_name", "period_cost",
                   "previous_period_cost", "delta_cost"]],
            width="stretch",
            hide_index=True,
            column_config={
                "organization_name": st.column_config.TextColumn("Organization"),
                "cluster_name": st.column_config.TextColumn("Cluster"),
                "period_cost": st.column_config.NumberColumn("This window", format="$%d"),
                "previous_period_cost": st.column_config.NumberColumn("Prior window", format="$%d"),
                "delta_cost": st.column_config.NumberColumn("Δ", format="$%d"),
            },
        )

    # --- fleet spot-adoption trend (opt-in; +1 call/org, History scope) ---
    with st.expander("Fleet spot adoption", expanded=False):
        trend_series = st.session_state.get("_spot_trend")
        if st.button(
            "Load fleet spot trend · ~1 call/org",
            key="btn_spot_trend",
            help=f"Fetches one daily org-efficiency series per organization "
                 f"({len(org_pairs)} orgs) over the selected window; cached 15 min.",
        ):
            try:
                frame = cached_spot_trend(
                    settings.base_url, org_pairs, start, end,
                    settings.max_workers, token,
                )
            except Exception as exc:  # noqa: BLE001 - UI boundary
                st.warning(f"Could not load spot trend: {sanitize_message(exc)}")
                frame = None
            st.session_state["_spot_trend"] = (
                frame if isinstance(frame, pd.DataFrame) and len(frame) else None
            )
            st.rerun()
        trend_series = st.session_state.get("_spot_trend")
        if trend_series is None:
            st.caption("Not loaded — the button fetches one efficiency series per org "
                       "(+1 call/org); results are cached for 15 minutes per window.")
        else:
            try:
                spot_adoption_area(trend_series)
            except Exception:  # noqa: BLE001
                st.info("Spot trend chart unavailable.")

    # --- fleet table (fragment) + drill-down ---
    st.markdown("---")
    _fleet_table_section(filtered)
    # Drill-down reads the ENRICHMENT-MERGED frame (enr_* columns, 0 refetch).
    _render_drilldown(settings, merged, filtered, start, end)


if __name__ == "__main__":
    main()
