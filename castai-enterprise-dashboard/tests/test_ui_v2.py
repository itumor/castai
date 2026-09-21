"""Wave-B UI v2 tests — KPI grid, banner rollup, enrichment merge, picker/
export contract, filters v2, I6 grep-guard, and two full-page AppTest runs.

No real network, no credentials: AppTest scripts patch ``app.build_client``
(and, for the hermetic run, the two cached Tier-1 loaders) so the whole page
renders from synthetic frames / the fixture FakeClient.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import pandas as pd
import pytest

import app as app_module
from services.organization_service import FetchError
from ui import cards as cards_mod
from ui import filters as filters_mod
from ui import tables as tables_mod
from utils.formatting import fmt_pct

PROJECT_ROOT = Path(__file__).resolve().parent.parent

APITEST_TIMEOUT = 60


# ============================================================ pure: fmt_pct
def test_fmt_pct_fraction_scale():
    assert fmt_pct(0.473, scale="fraction") == "47.3%"
    assert fmt_pct(0, scale="fraction") == "0.0%"
    assert fmt_pct(None, scale="fraction") == "N/A"
    assert fmt_pct("nonsense", scale="fraction") == "N/A"


def test_fmt_pct_percent_scale():
    # report_cost_pct_change ships already on the 0–100 scale (ADR v2 R5).
    assert fmt_pct(-12.4, scale="percent") == "-12.4%"
    assert fmt_pct(3.256, scale="percent") == "3.3%"
    assert fmt_pct(None, scale="percent") == "N/A"
    with pytest.raises(ValueError):
        fmt_pct(1.0, scale="bogus")


# ==================================================== pure: merge_enrichment
def _frame(keys: list[tuple[str, str]]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "organization_name": [f"Org {o}" for o, _ in keys],
            "organization_id": [o for o, _ in keys],
            "cluster_name": [f"c-{c}" for _, c in keys],
            "cluster_id": [c for _, c in keys],
            "status": ["ready"] * len(keys),
            "agent_status": ["online"] * len(keys),
        }
    )


def test_merge_enrichment_joins_and_partials():
    df = _frame([("o1", "c1"), ("o1", "c2"), ("o2", "c3")])
    session = {
        "_enr": {
            "health": {
                ("o1", "c1"): {"problematic_nodes_count": 2, "problematic_workloads_count": 1},
                # c2 failed mid-batch (partial) -> no row at all -> joins None
                ("o2", "c3"): {"problematic_nodes_count": 0},
            },
            "realized": {("o1", "c1"): {"realized_savings": 42.5}},
        }
    }
    merged = app_module.merge_enrichment(df, session)
    nodes = merged["enr_health_problematic_nodes_count"].tolist()
    assert nodes == [2, None, 0]  # partial failure stays missing, never 0-fabricated
    assert merged["enr_health_problematic_workloads_count"].tolist() == [1, None, None]
    assert merged["enr_realized_realized_savings"].tolist() == [42.5, None, None]
    # source columns untouched (session-join only — perf-v2 REJECT #6)
    assert "enr_health_problematic_nodes_count" not in df.columns


def test_merge_enrichment_clear_semantics():
    df = _frame([("o1", "c1")])
    assert app_module.merge_enrichment(df, {"_enr": {}}) is df
    assert app_module.merge_enrichment(df, {}) is df
    assert app_module.merge_enrichment(df, {"_enr": {"health": {("o1", "c1"): {"x": 1}}}})[
        "enr_health_x"
    ].tolist() == [1]
    # string keys tolerated ("org|cluster")
    out = app_module.merge_enrichment(df, {"_enr": {"health": {"o1|c1": {"x": 7}}}})
    assert out["enr_health_x"].tolist() == [7]


# ================================================== pure: CSV export contract
def test_fleet_csv_export_full_raw_and_capped():
    rows = 600
    df = pd.DataFrame(
        {
            "organization_id": [f"o{i}" for i in range(rows)],
            "cluster_id": [f"c{i}" for i in range(rows)],
            "overview_cost_hourly": [1.25] * rows,  # audit #1: must ship raw
            "potential_savings": [-9.0 if i % 7 == 0 else 12.0 for i in range(rows)],
        }
    )
    data, shown, total = tables_mod.fleet_csv_export(df)
    assert total == 600
    assert shown == tables_mod.EXPORT_ROW_CAP == 500
    parsed = pd.read_csv(io.BytesIO(data))
    assert "overview_cost_hourly" in parsed.columns
    assert len(parsed) == 500
    assert -9.0 in parsed["potential_savings"].tolist()  # negatives unclamped


# ==================================================== pure: banner grouping
def _err(org, op, kind, msg="boom", name=None):
    return FetchError(
        organization_id=org, organization_name=name or org,
        operation=op, message=msg, kind=kind,
    )


def test_group_fleet_errors_buckets():
    errors = [
        _err("o1", "summary", "AuthError"),
        _err("o1", "report", "PermissionDeniedError"),
        _err("o2", "clusters", "ServerError"),
        _err("o3", "woa", "ApiTimeoutError"),
        _err("o3", "report", "ServerError"),
    ]
    rows_per_org = {"o1": 0, "o2": 0, "o3": 4}
    groups = cards_mod.group_fleet_errors(errors, rows_per_org)
    by_org = {g["org_id"]: g for g in groups}
    assert by_org["o1"]["bucket"] == "permission"        # 0 rows + auth kinds
    assert by_org["o2"]["bucket"] == "unavailable"       # 0 rows, transport-ish
    assert by_org["o3"]["bucket"] == "partial"           # rows exist + errors
    assert by_org["o3"]["ops"] == ["woa", "report"]      # distinct failed ops


def test_enrichment_button_label_formula():
    """Exact perf-v2 §2.4 ETA formula: lo = round5(calls/7.9*0.9),
    hi = round5(calls/7.9*1.4+2), embedded in the button label."""

    label = app_module._enr_button_label("Compute realized savings", 57, 1)
    assert label == (
        "Compute realized savings for 57 filtered clusters · ~57 API calls · ~5–10s"
    )
    health = app_module._enr_button_label("Load cluster health", 2, 3)
    assert health == "Load cluster health for 2 filtered clusters · ~6 API calls · ~5–5s"


def test_banner_never_suppressed_while_errors_exist():
    # Mixed failure that v1 would hide behind kpis=None: errors but zero
    # "unavailable" orgs. group_fleet_errors must STILL return rows.
    groups = cards_mod.group_fleet_errors([_err("o9", "woa", "HTTPStatusError")], {"o9": 3})
    assert len(groups) == 1 and groups[0]["bucket"] == "partial"


# ============================================================= pure: filters
def _filter_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "organization_name": ["A", "A", "B", "B"],
            "organization_id": ["o1", "o1", "o2", "o2"],
            "cluster_name": ["web", "db", "cache", "ghost-1"],
            "cluster_id": ["c1", "c2", "c3", "c4"],
            "provider": ["eks", "eks", "gke", "aks"],
            "region": ["eu-central-1"] * 4,
            "status": ["ready", "failed", "disconnected", "ready"],
            "agent_status": ["online", "online", "disconnected", "online"],
            "workload_autoscaler_status": ["AGENT_STATUS_RUNNING", "Not installed", pd.NA, "AGENT_STATUS_RUNNING"],
            "cpu_utilization_pct": [0.4, 0.5, 0.3, 0.6],
            "cluster_score": [87.5, 42.0, 15.0, 95.0],
            "memory_utilization_pct": [0.5, 0.4, 0.3, 0.7],
            "nodes_total": [2, 4, 1, 1],
            "nodes_spot": [1, 2, 0, 0],
            "monthly_cost": [100.0, 200.0, 50.0, 10.0],
            "unschedulable_pods": [0, 3, 0, 0],
            "potential_savings": [100.0, -50.0, 0.0, 10.0],
            "has_negative_savings": [False, True, False, False],
            "data_freshness_status": ["fresh", "stale", "fresh", "unknown"],
            "is_ghost": [False, False, False, True],
        }
    )


def test_automation_bucket_mapping():
    assert filters_mod.automation_bucket("ready", "online") == "Automating"
    assert filters_mod.automation_bucket("failed", "online") == "Halted"
    assert filters_mod.automation_bucket("ready", "warning") == "Halted"
    assert filters_mod.automation_bucket("hibernating", "online") == "Hibernating"
    assert filters_mod.automation_bucket("disconnected", "online") == "Agent disconnected"
    assert filters_mod.automation_bucket("connecting", pd.NA) == "Connecting"
    assert filters_mod.automation_bucket(None, None) == "NA"


def test_ghost_rows_excluded_by_default():
    df = _filter_frame()
    out = filters_mod.apply_filter_state(df, {})
    assert "ghost-1" not in out["cluster_name"].tolist()
    out_shown = filters_mod.apply_filter_state(
        df, {filters_mod.F_SHOW_GHOSTS: True}
    )
    assert "ghost-1" in out_shown["cluster_name"].tolist()


def test_attention_pills_or_semantics():
    df = _filter_frame()
    masks = filters_mod.attention_masks(df)
    assert masks["Negative savings"].tolist() == [False, True, False, False]
    assert masks["Has issues"].tolist() == [False, True, True, False]  # pods + disconnected
    assert masks["Not installed WA"].tolist() == [False, True, False, False]
    assert masks["Stale data"].tolist() == [False, True, False, False]
    out = filters_mod.apply_filter_state(
        df, {filters_mod.F_ATTENTION: ["Negative savings", "Stale data"]}
    )
    assert sorted(out["cluster_id"].tolist()) == ["c2"]  # OR within the chip set


def test_freshness_and_automation_filters():
    df = _filter_frame()
    stale = filters_mod.apply_filter_state(df, {filters_mod.F_FRESHNESS: ["stale"]})
    assert stale["cluster_id"].tolist() == ["c2"]
    halted = filters_mod.apply_filter_state(df, {filters_mod.F_AUTOMATION: ["Halted"]})
    assert halted["cluster_id"].tolist() == ["c2"]


# ============================================================ pure: KPI extras
def test_compute_kpi_extras_polarity_and_waste():
    df = pd.DataFrame(
        {
            "organization_id": ["o1", "o1", "o1"],
            "cluster_id": ["c1", "c2", "c3"],
            "potential_savings": [100.0, -25.0, pd.NA],
            "waste_total_usd": [10.0, 5.0, pd.NA],
            "unschedulable_pods": [0, 2, 0],
            "data_status": ["ok", "partial", "unavailable"],
        }
    )
    extras = cards_mod.compute_kpi_extras(df)
    assert extras["net_savings_monthly"] == pytest.approx(75.0)   # NET, negatives in
    assert extras["gross_opportunity_monthly"] == pytest.approx(100.0)
    assert extras["gross_opportunity_count"] == 1
    assert extras["headroom_monthly"] == pytest.approx(-25.0)     # never clamped
    assert extras["headroom_count"] == 1
    assert extras["waste_present"] is True
    assert extras["waste_total"] == pytest.approx(15.0)
    assert extras["problematic_loaded"] is False                  # no health batch
    assert extras["unschedulable_pods_total"] == pytest.approx(2.0)
    assert (extras["data_ok"], extras["data_partial"], extras["data_unavailable"]) == (1, 1, 1)
    assert extras["oom_total"] is None and extras["oom_enabled"] is False

    sparse = cards_mod.compute_kpi_extras(df.drop(columns=["waste_total_usd"]))
    assert sparse["waste_present"] is False  # Total-waste card degrades to N/A


def test_compute_kpi_extras_enrichment_health_loaded():
    df = pd.DataFrame(
        {
            "cluster_id": ["c1", "c2"],
            "enr_health_problematic_nodes_count": [3, None],
        }
    )
    extras = cards_mod.compute_kpi_extras(df)
    assert extras["problematic_loaded"] is True
    assert extras["problematic_nodes"] == pytest.approx(3.0)


# ==================================================== pure: display builders
def test_display_cells_and_default_18():
    assert tables_mod.data_age_label(12) == "🟢 12m"
    assert tables_mod.data_age_label(47) == "🟡 47m"
    assert tables_mod.data_age_label(620) == "🔴 10h"
    assert tables_mod.data_age_label(None) == "unknown"
    assert tables_mod.savings_display_label(None) == "—"
    assert tables_mod.savings_display_label(-1234.0) == "🔻 −$1.2K (cost increase)"
    assert tables_mod.savings_display_label(0) == "$0"

    df = _filter_frame()
    display, ids = tables_mod.prepare_fleet_display(df)
    assert len(ids) == 4
    assert len(display.columns) == len(tables_mod.DEFAULT_VISIBLE_COLUMNS) == 19
    assert list(display.columns[:3]) == ["health", "organization_name", "cluster_name"]
    assert "cluster_score" in display.columns  # CAST AI score default-visible
    # Pre-batch health column renders the load affordance, never a T2 badge
    assert set(display["problematic_display"].tolist()) == {"n/a — load"}
    assert "T2" not in display.to_string()


# =============================================================== I6 guard
def test_i6_run_enrichment_single_call_site():
    """Batch loaders may be called ONLY from the enrichment-expander handler
    (I6 grep-guard): exactly one run_enrichment call in app.py, none in ui/."""

    app_source = Path(app_module.__file__).read_text(encoding="utf-8")
    call_sites = [
        line.strip() for line in app_source.splitlines()
        if "run_enrichment(" in line and "import" not in line and "_run_enrichment_batch(" not in line
    ]
    assert call_sites == ["result = run_enrichment("], call_sites
    ui_dir = Path(tables_mod.__file__).parent
    for path in ui_dir.glob("*.py"):
        assert "run_enrichment(" not in path.read_text(encoding="utf-8"), path


# ================================================================= AppTest
_APPT_HEADER = f"""
import os, sys
sys.path.insert(0, {str(PROJECT_ROOT)!r})
os.environ.setdefault("CASTAI_API_KEY", "test-key-apptest-ui-v2")
import pandas as pd
import app
"""

# Row-source strings are injected verbatim into the AppTest scripts below
# (AppTest executes a standalone script — it cannot see this test module's
# helpers). Both use only pd + literals.
_ROW_V1_SRC = '''
def _row(org, cluster):
    # Pre-Wave-A shape: NO new columns, OLD efficiency names.
    return {
        "organization_name": "Org " + org, "organization_id": org,
        "cluster_name": cluster, "cluster_id": org + "-" + cluster,
        "provider": "eks", "region": "eu-central-1",
        "status": "ready", "agent_status": "online", "kubernetes_version": "v1.29.1",
        "cpu_provisioned": 10, "cpu_allocatable": 9, "cpu_requested": 5, "cpu_used": 4,
        "cpu_efficiency": 0.44,
        "memory_provisioned_gib": 64, "memory_allocatable_gib": 60,
        "memory_requested_gib": 30, "memory_used_gib": 24, "memory_efficiency": 0.4,
        "nodes_total": 2, "nodes_spot": 1, "nodes_on_demand": 1, "nodes_fallback": 0,
        "cost_hourly": 2.0, "monthly_cost": 1460.0,
        "potential_savings_hourly": 1.0, "potential_savings_percentage": 0.5,
        "workload_autoscaler_status": "AGENT_STATUS_RUNNING", "node_autoscaler_status": "T2",
        "problematic_nodes": "T2", "problematic_workloads": "T2", "unschedulable_pods": 0,
        "data_status": "ok", "last_updated": pd.Timestamp("2026-09-21T12:00:00Z"),
        "reporting_state": "CLUSTER_STATE_OPTIMIZED", "optimal_cost_hourly": 1.0,
        "is_phase2": True, "pod_count": 10, "nodes_unknown": 0, "potential_savings": 730.0,
        "overview_cost_hourly": 2.0, "report_period_cost": 12.0, "report_cost_pct_change": 3.2,
    }
'''

_ROW_V2_SRC = '''
def _row(org, cluster, ghost=False, fresh="fresh"):
    # Full v1 + v2 column set (post Wave-A renames).
    return {
        "organization_name": "Org " + org, "organization_id": org,
        "cluster_name": cluster, "cluster_id": org + "-" + cluster,
        "provider": "eks", "region": "eu-central-1",
        "status": "ready", "agent_status": "online", "kubernetes_version": "v1.34.9",
        "cpu_provisioned": 10, "cpu_allocatable": 9, "cpu_requested": 5, "cpu_used": 4,
        "cpu_utilization_pct": 0.444,
        "memory_provisioned_gib": 64, "memory_allocatable_gib": 60,
        "memory_requested_gib": 30, "memory_used_gib": 24, "memory_utilization_pct": 0.4,
        "nodes_total": 2, "nodes_spot": 1, "nodes_on_demand": 1, "nodes_fallback": 0,
        "cost_hourly": 2.0, "monthly_cost": 1460.0,
        "potential_savings_hourly": 1.0, "potential_savings_percentage": 0.5,
        "workload_autoscaler_status": "AGENT_STATUS_RUNNING", "node_autoscaler_status": pd.NA,
        "problematic_nodes": pd.NA, "problematic_workloads": pd.NA, "unschedulable_pods": 1,
        "data_status": "ok", "last_updated": pd.Timestamp.now(tz="UTC"),
        "reporting_state": "CLUSTER_STATE_UNSPECIFIED" if ghost else "CLUSTER_STATE_OPTIMIZED",
        "optimal_cost_hourly": 1.0, "is_phase2": True, "pod_count": 10,
        "nodes_unknown": 0, "potential_savings": 730.0, "overview_cost_hourly": 2.0,
        "cpu_request_efficiency_pct": 0.8, "memory_request_efficiency_pct": 0.8,
        "na_managed_nodes": 1, "na_coverage_pct": 0.5,
        "storage_provisioned_gib": 100.0, "storage_claimed_gib": 50.0,
        "storage_active_claimed_gib": 40.0, "storage_commit_pct": 0.5,
        "storage_cost_hourly": 0.1,
        "waste_cpu_usd": 3.0, "waste_ram_usd": 2.0, "waste_storage_usd": 1.0,
        "waste_total_usd": 6.0,
        "wa_display": "Running", "wa_agent_version": "v1.2.3", "wa_version_drift": False,
        "wa_in_place_resize": True, "wa_last_reported": pd.Timestamp.now(tz="UTC"),
        "agent_health": "Connected", "latest_sync_time": pd.Timestamp.now(tz="UTC"),
        "snapshot_age_minutes": 12.0, "data_freshness_status": fresh,
        "is_ghost": ghost,
        "has_positive_savings_opportunity": True, "has_negative_savings": False,
        "kubernetes_version_short": "1.34", "kubernetes_version_known": True,
        "report_period_cost": 12.0, "report_cost_pct_change": 3.2,
    }
'''

_HIER_PATCH = """
from models import Enterprise, Organization
from services.organization_service import DiscoveryResult
from services.cluster_service import FleetResult

_root = Organization("root", "Root", None, "ORGANIZATION_TYPE_ENTERPRISE")
_org_a = Organization("org-a", "Org A", "root", "ORGANIZATION_TYPE_CHILD")
_org_b = Organization("org-b", "Org B", "root", "ORGANIZATION_TYPE_CHILD")
_HIER = DiscoveryResult(
    enterprise=Enterprise(id="root", name="Root"),
    organizations=[_root, _org_a, _org_b],
    errors=[],
)
app.cached_hierarchy = lambda base_url, enterprise_id, token: _HIER
app.cached_fleet = lambda *a, **k: FleetResult(
    df=_FRAME, errors=[], fetched_at="2026-09-21T12:00:00Z", reports={}
)
app.main()
"""


def _run_apptest(script: str):
    from streamlit.testing.v1 import AppTest

    at = AppTest.from_string(_APPT_HEADER + script, default_timeout=APITEST_TIMEOUT)
    at.run()
    return at


def test_full_page_apptest_missing_v2_columns_renders():
    """Defensive contract: a frame LACKING all Wave-A columns (and carrying the
    OLD efficiency names) must still render the full v2 page with 0 raises."""

    body = (
        _ROW_V1_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1"), _row("org-b", "db-1")])\n'
        + _HIER_PATCH
    )
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert len(at.metric) == 16  # Scale 5 + FinOps 5 + Eff/Health 6


def test_full_page_apptest_full_v2_frame_renders():
    body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame([\n'
          '    _row("org-a", "web-1"),\n'
          '    _row("org-a", "db-1", fresh="stale"),\n'
          '    _row("org-b", "cache-1", ghost=True),\n'
          "])\n"
        + _HIER_PATCH
    )
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert len(at.metric) == 16
    labels = {m.label for m in at.metric}
    assert "Organizations" in labels
    assert "Potential savings (net) / mo" in labels
    assert "Total waste (window)" in labels
    assert "Data coverage" in labels
    waste = next(m for m in at.metric if m.label == "Total waste (window)")
    assert waste.value != "N/A"  # waste columns present -> real value
    assert waste.value == "$12"  # 3 clean rows x $6 (ghost excluded by default)


def test_full_page_apptest_fakeclient_end_to_end():
    """Full page through the REAL services with the fixture FakeClient:
    hierarchy + fleet sweep + v2 render must complete with zero raises (the
    post-rename full-page guard)."""

    script = _APPT_HEADER + """
from tests.test_enterprise_service import FakeClient
from tests import fixtures_api as fx
_CLIENT = FakeClient(
    organizations_payload=fx.organization_tree(),
    payloads=fx.fleet_payload_map(),
)
app.build_client = lambda base_url: _CLIENT
app.main()
"""
    from streamlit.testing.v1 import AppTest

    at = AppTest.from_string(script, default_timeout=APITEST_TIMEOUT)
    at.run()
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert len(at.metric) == 16


def test_enrichment_button_click_flow():
    """I6 happy path: clicking the realized batch button runs the handler,
    lands values in st.session_state["_enr"]["realized"], and the page
    re-renders cleanly with the merged columns."""

    body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1"), _row("org-b", "db-1")])\n'
        + """
class _StubClient:
    def get_cluster_realized_savings(self, org_id, cluster_id, start, end, **kw):
        return {"summary": {"totalCost": "100.0", "totalSavings": "25.0"}, "items": []}

app.build_client = lambda base_url: _StubClient()
"""
        + _HIER_PATCH
    )
    at = _run_apptest(body)
    assert not at.exception
    button = at.button(key="enr_btn_realized")
    assert button is not None
    assert button.label.startswith("Compute realized savings for 2 filtered clusters · ~2 API calls")
    button.click().run()
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    store = at.session_state["_enr"]
    assert "realized" in store
    assert len(store["realized"]) == 2
    values = list(store["realized"].values())
    assert all(v.get("realized_savings") == 25.0 for v in values)
    stats = at.session_state["_enr_stats"]["realized"]
    assert stats["attempted"] == 2 and stats["failed"] == 0
    # merged columns now visible to the rest of the page without re-raising
    assert len(at.metric) == 16
