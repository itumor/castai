"""KPI cards and org-health banner (docs/ux-design.md §2, §3).

Contract:
  * ``render_kpis(kpis)`` renders exactly 2 rows x 5 ``st.metric(border=True)``
    cards. The ``kpis`` dict keys follow ``data.aggregators.enterprise_kpis``
    (frozen in ``tests/test_aggregations.py``)::

        organizations, clusters, nodes_total, monthly_cost,
        cpu_efficiency (0..1 ratio), memory_efficiency (0..1 ratio),
        potential_savings_monthly, potential_savings_pct (0..1 ratio),
        spot_coverage (0..1 ratio), wa_coverage (0..1 ratio),
        clusters_with_unscheduled_pods, orgs_unavailable

  * Every value is None/NA-safe: missing renders "N/A" via fmt_na semantics
    (docs/metrics.md — missing never becomes 0, 0 never becomes blank).
  * ``render_org_health_banner(errors, kpis)`` renders a warning expander when
    any organization failed to load; nothing otherwise (ux-design.md §4).
  * No unsafe_allow_html anywhere (security-requirements.md SEC-5.4).
"""

from __future__ import annotations

from typing import Any, Iterable

import pandas as pd
import streamlit as st

from utils.formatting import fmt_count, fmt_money_compact, fmt_na, fmt_pct, fmt_percent

__all__ = [
    "render_kpis",
    "render_kpis_v2",
    "render_org_health_banner",
    "render_health_banner_v2",
    "group_fleet_errors",
    "compute_kpi_extras",
    "render_fleet_health_metrics",
    "AUTH_ERROR_KINDS",
]

# GAP-A/B: error kinds that map to "Permission denied" (utils/errors.py classes
# AuthError / PermissionDeniedError; "CastAIAuthError" kept for legacy rows).
AUTH_ERROR_KINDS = frozenset({"AuthError", "PermissionDeniedError", "CastAIAuthError"})


def _pct_ratio(value: Any) -> str:
    """Render a 0..1 ratio as a percent string (NA-safe)."""

    if value is None:
        return fmt_na(None)
    try:
        f = float(value)
    except (TypeError, ValueError):
        return fmt_na(None)
    return fmt_percent(f * 100.0)


def _safe_int(value: Any) -> Any:
    """Best-effort int for delta display; None when not numeric."""

    try:
        if value is None:
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def render_kpis(kpis: dict | None, *, scope_caption: str | None = None) -> None:
    """Render the 2x5 enterprise KPI card grid.

    All values come from ``data.aggregators.enterprise_kpis`` over the
    *filtered* fleet frame (ux-design.md: KPIs derive from filtered rows).
    ``scope_caption`` (e.g. "filtered scope: 12 of 1,000 clusters") is shown
    once below the cards so a scoped KPI is never mistaken for global truth.
    """

    k = dict(kpis or {})

    def _metric(column, label, value, *, delta=None, delta_color="off", help_text):
        column.metric(label, value, delta=delta, delta_color=delta_color,
                      help=help_text, border=True)

    src = "aggregated from organization-level API data, filtered scope"

    # Row 1 — scale & money.
    row1 = st.columns(5)
    _metric(row1[0], "Organizations", fmt_count(k.get("organizations")),
            help_text=f"Distinct organizations with at least one cluster row; {src}.")
    _metric(row1[1], "Clusters", fmt_count(k.get("clusters")),
            help_text=f"Clusters in scope; {src}.")
    _metric(row1[2], "Nodes", fmt_count(k.get("nodes_total")),
            help_text=f"Sum of nodeCountOnDemand + nodeCountSpot (unknown nodes excluded); {src}.")
    _metric(row1[3], "Monthly cost", fmt_money_compact(k.get("monthly_cost")),
            help_text=f"Run-rate: sum of cluster costHourly x 730 h, USD/month; {src}.")
    _metric(row1[4], "CPU efficiency", _pct_ratio(k.get("cpu_efficiency")),
            help_text=f"Weighted ratio SUM(cpu_used)/SUM(cpu_allocatable), pairwise-complete rows; {src}.")

    # Row 2 — quality & savings.
    row2 = st.columns(5)
    _metric(row2[0], "Memory efficiency", _pct_ratio(k.get("memory_efficiency")),
            help_text=f"Weighted ratio SUM(ram_used)/SUM(ram_allocatable), pairwise-complete rows; {src}.")
    ps_delta = None
    ps_pct = k.get("potential_savings_pct")
    if ps_pct is not None:
        try:
            ps_delta = fmt_percent(float(ps_pct) * 100.0) + " of current cost"
        except (TypeError, ValueError):
            ps_delta = None
    _metric(row2[1], "Potential savings / mo",
            fmt_money_compact(k.get("potential_savings_monthly")),
            delta=ps_delta, delta_color="normal",
            help_text=f"Estimated (scheduling) savings: SUM(costHourly - optimalCostHourly) x 730 h; {src}.")
    _metric(row2[2], "Spot coverage", _pct_ratio(k.get("spot_coverage")),
            help_text=f"Weighted share SUM(nodes_spot)/SUM(nodes_total); {src}.")
    _metric(row2[3], "WA coverage", _pct_ratio(k.get("wa_coverage")),
            help_text=f"Share of clusters with workload-autoscaler agent RUNNING; {src}.")
    unsched = _safe_int(k.get("clusters_with_unscheduled_pods"))
    _metric(row2[4], "Clusters w/ unscheduled pods", fmt_count(unsched),
            delta="needs attention" if (unsched or 0) > 0 else None,
            delta_color="inverse",
            help_text=f"Clusters reporting unschedulablePodCount > 0; {src}.")

    if scope_caption:
        st.caption(scope_caption)
    st.caption("N/A = no reliable API source at this scope; no value is estimated.")


def render_fleet_health_metrics(kpis: dict | None) -> None:
    """Deprecated alias kept for backwards compatibility; forwards to render_kpis."""

    render_kpis(kpis)


def _error_to_row(err: Any) -> tuple[str, str, str]:
    """FetchError-or-dict -> (org label, operation, message) strings."""

    get = getattr(err, "get", None)
    if callable(get):
        org = get("organization_name") or get("organization_id") or "?"
        return (str(org), str(get("operation") or ""), str(get("message") or ""))
    org = (
        getattr(err, "organization_name", None)
        or getattr(err, "organization_id", None)
        or "?"
    )
    return (
        str(org),
        str(getattr(err, "operation", "") or ""),
        str(getattr(err, "message", "") or ""),
    )


def render_org_health_banner(
    errors: Iterable[Any] | None,
    kpis: dict | None = None,
    *,
    total_organizations: int | None = None,
) -> None:
    """Partial-failure banner (ux-design.md §4): never silently drop failed orgs.

    Shown when ``kpis['orgs_unavailable'] > 0`` (or, without a kpis dict, when
    the errors list is non-empty). Messages are pre-sanitized by the services
    layer (FetchError.message never carries headers/secrets).
    """

    error_list = list(errors or [])
    k = kpis or {}
    affected = _safe_int(k.get("orgs_unavailable"))
    if affected is None:
        affected = len(error_list)
    if affected <= 0:
        return

    if total_organizations:
        headline = (
            f"{affected} of {total_organizations} organizations failed to load —"
            " figures below exclude them"
        )
    else:
        headline = (
            f"{affected} organization{'s' if affected != 1 else ''} failed to load —"
            " figures below exclude them"
        )

    with st.warning(headline, icon="⚠️"):
        if error_list:
            with st.expander(f"Details ({len(error_list)})", expanded=False):
                for err in error_list:
                    org, operation, message = _error_to_row(err)
                    op_part = f" — {operation}" if operation else ""
                    msg_part = f": {message}" if message else ""
                    st.markdown(f"- **{org}**{op_part}{msg_part}")


# =====================================================================
# v2 — 3-row KPI grid (docs/ux-v2.md §2) + grouped health banner (GAP-A/B)
# =====================================================================


def _first(mapping: dict, *names: str) -> Any:
    """First non-None value among candidate keys (column-rename tolerance)."""

    for name in names:
        value = mapping.get(name)
        if value is not None:
            return value
    return None


def _err_kind(err: Any) -> str:
    """FetchError literal/attr tolerant kind reader (GAP-B)."""

    get = getattr(err, "get", None)
    if callable(get):
        return str(get("kind") or "")
    return str(getattr(err, "kind", "") or "")


def _err_org_id(err: Any) -> str:
    get = getattr(err, "get", None)
    if callable(get):
        return str(get("organization_id") or get("organization_name") or "?")
    return str(
        getattr(err, "organization_id", None)
        or getattr(err, "organization_name", None)
        or "?"
    )


def group_fleet_errors(
    errors: Iterable[Any] | None,
    rows_per_org: dict[str, int] | None,
) -> list[dict]:
    """Group fleet FetchErrors by organization into the v2 banner buckets.

    Bucket rule per affected organization (GAP-A/B, ADR v2 R5):
      * 0 rows AND any error kind is auth-flavored -> ``"permission"``.
      * 0 rows, other error kinds                -> ``"unavailable"``.
      * >0 rows but errors exist                 -> ``"partial"``.

    Returns a list of ``{org_id, org, bucket, ops, errors}`` dicts, sorted by
    org name. Pure — no Streamlit calls (unit-testable).
    """

    groups: dict[str, dict] = {}
    for err in list(errors or []):
        org, operation, message = _error_to_row(err)
        org_id = _err_org_id(err)
        entry = groups.setdefault(
            org_id,
            {
                "org_id": org_id,
                "org": org,
                "bucket": None,
                "ops": [],
                "auth": False,
                "errors": [],
            },
        )
        if operation and operation not in entry["ops"]:
            entry["ops"].append(operation)
        if _err_kind(err) in AUTH_ERROR_KINDS:
            entry["auth"] = True
        entry["errors"].append((operation, message))

    out: list[dict] = []
    rows_map = rows_per_org or {}
    for org_id, entry in groups.items():
        rows = rows_map.get(org_id, 0)
        if rows <= 0:
            entry["bucket"] = "permission" if entry["auth"] else "unavailable"
        else:
            entry["bucket"] = "partial"
        out.append(entry)
    out.sort(key=lambda e: (e["bucket"] != "permission", e["bucket"] != "unavailable", e["org"]))
    return out


_HEALTH_BUCKET_LABELS = {
    "permission": "Permission denied",
    "unavailable": "Temporarily unavailable — retry on refresh",
    "partial": "Partial data",
}
_HEALTH_CAP = 5  # error lines per organization


def render_health_banner_v2(
    errors: Iterable[Any] | None,
    rows_per_org: dict[str, int] | None,
) -> None:
    """Grouped fleet health banner (GAP-A/B). NEVER suppressed while errors
    exist; the headline counts DISTINCT organizations per bucket."""

    groups = group_fleet_errors(errors, rows_per_org)
    if not groups:
        return

    counts = {"permission": 0, "unavailable": 0, "partial": 0}
    for entry in groups:
        counts[entry["bucket"]] += 1
    parts = [
        f"**{counts['permission']}** permission denied" if counts["permission"] else "",
        f"**{counts['unavailable']}** temporarily unavailable" if counts["unavailable"] else "",
        f"**{counts['partial']}** partial data" if counts["partial"] else "",
    ]
    headline = (
        f"Data health — {' · '.join(p for p in parts if p)} "
        f"({len(groups)} organization{'s' if len(groups) != 1 else ''} affected)"
    )

    with st.warning(headline, icon="⚠️"):
        for entry in groups:
            label = _HEALTH_BUCKET_LABELS.get(entry["bucket"], entry["bucket"])
            if entry["bucket"] == "partial" and entry["ops"]:
                line = f"- **{entry['org']}** — {label} — failed: {', '.join(entry['ops'])}"
            else:
                line = f"- **{entry['org']}** — {label}"
            st.markdown(line)
            detail = entry["errors"][:_HEALTH_CAP]
            for operation, message in detail:
                op_part = f"`{operation}`" if operation else "request"
                msg_part = f": {message}" if message else ""
                st.markdown(f"  - {op_part}{msg_part}")
            extra = len(entry["errors"]) - len(detail)
            if extra > 0:
                st.markdown(f"  - …and {extra} more (see logs)")


def compute_kpi_extras(
    filtered: Any,
    *,
    oom_total: int | None = None,
    oom_enabled: bool = False,
) -> dict:
    """Pure extras for the v2 KPI grid — every read is column-presence-safe
    (the Wave-A column contract lands while this UI is already live).

    Money values are summed with min_count=1 semantics (all-missing -> None,
    never silently 0). Returns raw numbers; the renderer formats.
    """

    out: dict[str, Any] = {
        "net_savings_monthly": None,
        "net_savings_pairs": 0,
        "gross_opportunity_monthly": None,
        "gross_opportunity_count": 0,
        "headroom_monthly": None,
        "headroom_count": 0,
        "waste_total": None,
        "waste_present": False,
        "problematic_nodes": None,
        "problematic_loaded": False,
        "data_ok": 0,
        "data_partial": 0,
        "data_unavailable": 0,
        "unschedulable_pods_total": None,
        "oom_enabled": bool(oom_enabled),
        "oom_total": oom_total if oom_enabled else None,
    }
    if filtered is None or len(filtered) == 0 or not isinstance(filtered, pd.DataFrame):
        return out

    def _num(col: str) -> pd.Series | None:
        if col in filtered.columns:
            return pd.to_numeric(filtered[col], errors="coerce")
        return None

    # --- potential savings: net / gross opportunity / headroom (finops §2)
    savings = _num("potential_savings")
    if savings is not None:
        present = savings.dropna()
        pairs = int(len(present))
        out["net_savings_pairs"] = pairs
        if pairs:
            out["net_savings_monthly"] = float(present.sum())
            positives = present[present > 0]
            negatives = present[present < 0]  # always value<0 — never flag-driven
            if "has_positive_savings_opportunity" in filtered.columns:
                # Green rendering is gated by the flag (finops §2 / ux-v2 §2):
                # gross opportunity only counts rows the source marked positive.
                flag = filtered["has_positive_savings_opportunity"]
                flag_true = filtered.loc[flag.fillna(False).astype(bool)].index
                positives = positives.loc[positives.index.intersection(flag_true)]
            out["gross_opportunity_monthly"] = (
                float(positives.sum()) if len(positives) else 0.0
            )
            out["gross_opportunity_count"] = int(len(positives))
            out["headroom_monthly"] = float(negatives.sum()) if len(negatives) else None
            out["headroom_count"] = int(len(negatives))

    # --- waste (window USD; frozen Wave-A columns waste_*_usd)
    waste = _num("waste_total_usd")
    if waste is not None:
        present = waste.dropna()
        out["waste_present"] = True
        if len(present):
            out["waste_total"] = float(present.sum())

    # --- enrichment: problematic counts (health batch)
    nodes = _num("enr_health_problematic_nodes_count")
    out["problematic_loaded"] = nodes is not None
    if nodes is not None:
        present = nodes.dropna()
        out["problematic_nodes"] = float(present.sum()) if len(present) else 0.0

    pods = _num("unschedulable_pods")
    if pods is not None:
        present = pods.dropna()
        if len(present):
            out["unschedulable_pods_total"] = float(present.sum())

    # --- data coverage (ok / partial / unavailable counts)
    if "data_status" in filtered.columns:
        status = filtered["data_status"].astype("string").str.lower()
        out["data_ok"] = int((status == "ok").sum())
        out["data_partial"] = int((status == "partial").sum())
        out["data_unavailable"] = int((status == "unavailable").sum())
    return out


def render_kpis_v2(
    kpis: dict | None,
    extras: dict | None = None,
    *,
    scope_caption: str | None = None,
) -> None:
    """Render the v2 KPI grid: 3 grouped rows — Scale (5) / FinOps (5) /
    Efficiency·Health·Data quality (6) = 16 cards max (ux-v2 §2).

    Every card degrades to ``value="N/A"`` (+ hint delta, ``delta_color="off"``)
    when its source is unavailable; no value is ever fabricated.
    """

    k = dict(kpis or {})
    e = dict(extras or {})

    def _metric(column, label, value, *, delta=None, delta_color="off", help_text):
        column.metric(label, value, delta=delta, delta_color=delta_color,
                      help=help_text, border=True)

    src = "aggregated from organization-level API data, filtered scope"

    # ------------------------------------------------ Row 1 — Scale (5)
    st.caption("**Scale**")
    row1 = st.columns(5)
    _metric(row1[0], "Organizations", fmt_count(k.get("organizations")),
            help_text=f"Distinct organizations with at least one cluster row; {src}.")
    _metric(row1[1], "Clusters", fmt_count(k.get("clusters")),
            help_text=f"Clusters in scope; {src}.")
    _metric(row1[2], "Nodes", fmt_count(k.get("nodes_total")),
            help_text=f"Sum of on-demand + spot nodes (unknown nodes excluded); {src}.")
    _metric(row1[3], "Spot coverage", fmt_pct(_first(k, "spot_coverage"), scale="fraction"),
            help_text=f"Weighted share SUM(nodes_spot)/SUM(nodes_total), pairwise-complete rows; {src}.")
    _metric(row1[4], "WA coverage", fmt_pct(_first(k, "wa_coverage"), scale="fraction"),
            help_text=f"Share of clusters with workload-autoscaler agent RUNNING; {src}.")

    # ------------------------------------------------ Row 2 — FinOps (5)
    st.caption("**FinOps** (run-rate = current snapshot × 730 h; savings are NET — negatives included)")
    row2 = st.columns(5)
    _metric(row2[0], "Monthly run rate", fmt_money_compact(_first(k, "monthly_cost", "monthly_run_rate")),
            help_text=f"Run-rate: sum of cluster costHourly x 730 h, USD/month; {src}.")
    # NET / gross / headroom: aggregator keys first (ghost-masked per ADR v2
    # R5), computed extras as fallback (extended enterprise_kpis() extension).
    net = _first(k, "potential_savings_monthly") if "potential_savings_monthly" in k else e.get("net_savings_monthly")
    gross = _first(k, "gross_savings_opportunity") if "gross_savings_opportunity" in k else e.get("gross_opportunity_monthly")
    gross_count = _first(k, "clusters_with_positive_savings") if "clusters_with_positive_savings" in k else e.get("gross_opportunity_count", 0)
    headroom = _first(k, "headroom_savings") if "headroom_savings" in k else e.get("headroom_monthly")
    headroom_count = _first(k, "headroom_clusters") if "headroom_clusters" in k else (e.get("headroom_count", 0) or 0)
    net_delta = None
    net_color = "off"
    if net is not None and gross_count:
        net_delta = f"{gross_count} clusters with opportunity"
        net_color = "normal" if net > 0 else "off"
    _metric(row2[1], "Potential savings (net) / mo", fmt_money_compact(net),
            delta=net_delta, delta_color=net_color,
            help_text=f"NET estimated savings: SUM(costHourly - optimalCostHourly) x 730 h, "
                      f"negatives included; {src}.")
    _metric(row2[2], "Gross opportunity / mo", fmt_money_compact(gross),
            delta=f"{gross_count} clusters" if gross_count else None,
            help_text=f"Sum of POSITIVE potential savings only (gross identified opportunity); {src}.")
    has_savings_scope = bool(e.get("net_savings_pairs")) or k.get("potential_savings_monthly") is not None
    _metric(row2[3], "Over-optimized headroom", fmt_money_compact(headroom) if headroom is not None else ("$0" if has_savings_scope else "N/A"),
            delta=f"{headroom_count} clusters" if headroom_count else ("no negative rows" if has_savings_scope else None),
            delta_color="off",
            help_text="Sum of NEGATIVE potential savings (optimized configuration would cost "
                      "more) — informational, never clamped, never green (finops §2).")
    waste_value_raw = _first(k, "waste_total_usd")
    waste_present = e.get("waste_present") or waste_value_raw is not None
    if waste_present:
        waste_value = fmt_money_compact(waste_value_raw if waste_value_raw is not None else e.get("waste_total"))
        waste_delta = None
        waste_help = (f"CPU+RAM+storage waste over the report window (waste is a "
                      f"third lens — never summed with spend or savings); {src}.")
    else:
        waste_value = "N/A"
        waste_delta = "waste columns not available"
        waste_help = ("Waste per-cluster columns are not loaded yet; the card "
                      "renders only when the Wave-A waste fields (waste_*_usd) "
                      "are present in the fleet frame.")
    _metric(row2[4], "Total waste (window)", waste_value, delta=waste_delta,
            help_text=waste_help)

    # ------------------------------------ Row 3 — Efficiency · Health · DQ (6)
    st.caption("**Efficiency · Health · Data quality**")
    row3 = st.columns(6)
    cpu_util = _first(k, "cpu_utilization_pct", "cpu_efficiency")
    _metric(row3[0], "CPU utilization", fmt_pct(cpu_util, scale="fraction"),
            delta="target 60%" if cpu_util is not None else None,
            help_text=f"Weighted ratio SUM(cpu_used)/SUM(cpu_allocatable), pairwise-complete rows; {src}.")
    mem_util = _first(k, "memory_utilization_pct", "memory_efficiency")
    _metric(row3[1], "Memory utilization", fmt_pct(mem_util, scale="fraction"),
            delta="target 60%" if mem_util is not None else None,
            help_text=f"Weighted ratio SUM(ram_used)/SUM(ram_allocatable), pairwise-complete rows; {src}.")
    if e.get("problematic_loaded"):
        _metric(row3[2], "Problematic nodes", fmt_count(e.get("problematic_nodes")),
                delta="needs attention" if (e.get("problematic_nodes") or 0) > 0 else None,
                delta_color="inverse",
                help_text="Sum over clusters from the cluster-health enrichment batch.")
    else:
        _metric(row3[2], "Problematic nodes", "n/a — load",
                delta="run 'Load cluster health'", delta_color="off",
                help_text="Problematic node counts arrive via the enrichment panel: Load cluster health.")
    unsched = _first(k, "unschedulable_pods_total")
    if unsched is None:
        unsched = e.get("unschedulable_pods_total")
    _metric(row3[3], "Unschedulable pods", fmt_count(unsched),
            delta="needs attention" if (unsched or 0) > 0 else None,
            delta_color="inverse",
            help_text=f"Sum of unschedulablePodCount across the filtered scope; {src}.")
    if e.get("oom_enabled"):
        _metric(row3[4], "OOM kills (window)", fmt_count(e.get("oom_total")),
                delta="needs attention" if (e.get("oom_total") or 0) > 0 else None,
                delta_color="inverse",
                help_text="Enterprise OOMKilled event count over the window (flag-enabled org query).")
    else:
        _metric(row3[4], "OOM kills (window)", "N/A", delta_color="off",
                help_text="Disabled — enable the cluster-history/OOM flag to load org OOM totals.")
    data_ok = e.get("data_ok", 0)
    data_partial = e.get("data_partial", 0)
    data_unavailable = e.get("data_unavailable", 0)
    total_rows = data_ok + data_partial + data_unavailable
    if total_rows:
        _metric(row3[5], "Data coverage", f"{data_ok}/{total_rows} ok",
                delta=f"{data_partial} partial · {data_unavailable} unavailable"
                      if (data_partial or data_unavailable) else "all rows ok",
                delta_color="normal" if not (data_partial or data_unavailable) else "off",
                help_text="Per-cluster data_status counts over the filtered scope.")
    else:
        _metric(row3[5], "Data coverage", "N/A", delta_color="off",
                help_text="data_status column not present in the fleet frame.")

    if scope_caption:
        st.caption(scope_caption)
    st.caption("N/A = no reliable API source at this scope; no value is estimated.")
