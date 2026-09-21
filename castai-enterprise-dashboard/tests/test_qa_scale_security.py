"""QA final-phase gap tests (SUB-AGENT 7) — scale, retry/pagination edges,
lazy-import safety, currency boundary behavior.

Non-duplicative additions to the master plan (existing suites own the rest):
  * Scale: a synthetic 1,000-cluster fleet across 6 orgs (duplicate cluster
    NAMES across orgs, unique composite keys) runs through
    ``data.normalizers.build_fleet_row`` and the ratio-of-sums aggregators well
    under the ~2 s aggregation budget (docs/performance.md §5, docs/
    architecture.md §10) with EXACT hand-verifiable totals.
  * Transport: ``httpx.TimeoutException`` retry-then-succeed on a GET, and a
    persistent 500 exhausting a *configured* max-attempts staircase then
    raising — distinct from tests/test_client.py which pins the default
    4-attempt shape with ReadTimeout/503 variants.
  * Pagination: client-level ``page.cursor`` passthrough on
    ``CastAIClient.get_cluster_nodes`` (the wire contract the
    ``optimization_service.load_cluster_nodes`` cursor loop depends on).
  * Lazy loading: ``ui.*`` modules and ``app`` import in-process with any
    httpx request rigged to raise — imports MUST succeed (app.py's documented
    "Import safety" contract; rerun invariants I1–I5 rely on it).
  * Currency/formatting boundary characterization: >1e12 (T bucket), tiny
    fractions, negative magnitudes, and float('inf')/nan handling, pinned to
    the ACTUAL contract of utils/formatting.py (no forcing new behavior).

No real network, no credentials, no Streamlit server.
"""

from __future__ import annotations

import importlib
import math
import sys
import time

import httpx
import pandas as pd
import pytest
import respx

from data.aggregators import cost_by_organization, enterprise_kpis
from data.normalizers import build_fleet_row
from services.castai_client import CastAIClient
from utils.errors import ApiTimeoutError, ServerError
from utils.formatting import (
    fmt_cores,
    fmt_count,
    fmt_gib,
    fmt_money_compact,
    fmt_money_usd,
    fmt_na,
    fmt_percent,
)

BASE = "https://api.eu.cast.ai"
KEY = "test-key-qa-scale-0123456789abcdef"  # synthetic; never a real key
ORG = "org-child-0001"
CLUSTER = "c-00000000-1111-2222-3333-444444444444"
NA = "N/A"
FETCHED = "2026-09-21T12:00:00Z"

N_CLUSTERS = 1_000
N_ORGS = 6


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    """Retries never actually sleep in tests (same pattern as test_client.py)."""

    monkeypatch.setattr(time, "sleep", lambda *_args, **_kwargs: None)


@pytest.fixture
def client():
    instance = CastAIClient(BASE, KEY)
    yield instance
    instance.close()


# ===================================================================== scale
def _synthetic_fleet_row(i: int) -> dict:
    """One fully synthetic fleet row with a KNOWN cost/CPU/node pattern.

    Per row: summary costHourlyOnDemand="2" -> cost_hourly 2.0, monthly 1460;
    cpu allocatable 10 / used 5 -> efficiency 0.5; nodes 1 on-demand + 1 spot
    -> total 2, spot share 0.5; overview cost 2 / optimal 1 -> savings 1.0/h,
    savings pct 0.5 (pairwise). Cluster NAMES repeat every 25 rows (duplicate
    names across orgs by design); the (org_id, cluster_id) key stays unique.
    """

    org_idx = i % N_ORGS
    cid = f"c-{i:04d}"
    return build_fleet_row(
        organization_id=f"org-{org_idx + 1}",
        organization_name=f"Org {org_idx + 1}",
        cluster_item={
            "id": cid,
            "name": f"fleet-node-{i % 25}",  # 25 names, reused across orgs
            "providerType": "eks",
            "region": {"name": "eu-central-1"},
            "status": "ready",
            "agentStatus": "online",
            "isPhase2": True,
        },
        summary_item={
            "clusterId": cid,
            "nodeCountOnDemand": "1",
            "nodeCountSpot": "1",
            "cpuAllocatableOnDemand": "10",
            "cpuUsed": "5",
            "costHourlyOnDemand": "2",
            "unschedulablePodCount": "0",
            "podCount": "10",
        },
        overview_item={
            "clusterId": cid,
            "state": "CLUSTER_STATE_OPTIMIZED",
            "costHourly": "2",
            "optimalCostHourly": "1",
        },
        wa_status="AGENT_STATUS_RUNNING" if i % 2 == 0 else None,
        fetched_at=FETCHED,
    )


@pytest.fixture(scope="module")
def scale_df() -> pd.DataFrame:
    """The 1,000-row synthetic fleet frame, built once per module."""

    return pd.DataFrame([_synthetic_fleet_row(i) for i in range(N_CLUSTERS)])


class TestFleetScaleUnderBudget:
    def test_shape_and_composite_key_uniqueness_at_scale(self, scale_df):
        assert len(scale_df) == N_CLUSTERS
        # Cluster names deliberately duplicate, incl. across org boundaries;
        # the composite key must remain unique (data-model.md §0.1 rule).
        assert scale_df.duplicated(subset=["cluster_name"]).any()
        assert not scale_df.duplicated(subset=["organization_id", "cluster_id"]).any()

    def test_aggregators_within_time_budget_and_exact_totals(self, scale_df):
        t0 = time.perf_counter()
        kpi = enterprise_kpis(scale_df)
        kpi_seconds = time.perf_counter() - t0
        t0 = time.perf_counter()
        per_org = cost_by_organization(scale_df)
        rollup_seconds = time.perf_counter() - t0

        # docs/performance.md §5: aggregation of a 1k x ~41 frame is ms-scale;
        # ~2 s is a generous regression ceiling, and is what was specified.
        assert kpi_seconds < 2.0, f"enterprise_kpis took {kpi_seconds:.2f}s"
        assert rollup_seconds < 2.0, f"cost_by_organization took {rollup_seconds:.2f}s"

        # EXACT hand-verifiable numbers (known pattern: cost 2 USD/h per row):
        assert kpi["clusters"] == N_CLUSTERS
        assert kpi["organizations"] == N_ORGS
        assert kpi["monthly_cost"] == pytest.approx(N_CLUSTERS * 2.0 * 730)  # 1,460,000
        assert kpi["nodes_total"] == pytest.approx(N_CLUSTERS * 2.0)  # 2,000
        assert kpi["cpu_utilization_pct"] == pytest.approx(0.5)  # Σ5 / Σ10 (ADR v2 R8 rename)
        assert kpi["spot_coverage"] == pytest.approx(0.5)  # Σspot 1000 / Σtotal 2000
        assert kpi["potential_savings_monthly"] == pytest.approx(N_CLUSTERS * 1.0 * 730)
        assert kpi["potential_savings_pct"] == pytest.approx(0.5)  # Σ1 / Σ2, pairwise
        assert kpi["wa_coverage"] == pytest.approx(0.5)  # RUNNING on even rows
        assert kpi["clusters_with_unscheduled_pods"] == 0  # measured 0, not missing
        assert kpi["orgs_unavailable"] == 0

        # Per-org rollup: 1,000 = 6*166 + 4 -> orgs 1..4 get 167, orgs 5..6 166.
        assert len(per_org) == N_ORGS
        assert per_org["clusters"].sum() == N_CLUSTERS
        assert per_org["monthly_cost"].sum() == pytest.approx(1_460_000.0)
        by_id = per_org.set_index("organization_id")
        assert by_id.loc["org-1", "clusters"] == 167
        assert by_id.loc["org-1", "monthly_cost"] == pytest.approx(167 * 2.0 * 730)
        assert by_id.loc["org-6", "clusters"] == 166
        assert by_id.loc["org-6", "monthly_cost"] == pytest.approx(166 * 2.0 * 730)
        assert per_org["potential_savings_pct"].tolist() == pytest.approx([0.5] * N_ORGS)

    def test_scale_frame_still_carries_full_column_contract(self, scale_df):
        from services.cluster_service import FLEET_COLUMNS

        for col in FLEET_COLUMNS:
            assert col in scale_df.columns
        assert set(scale_df["data_status"]) == {"ok"}


# ============================================================ transport edges
class TestTimeoutRetryGaps:
    @respx.mock
    def test_timeout_exception_retries_then_succeeds_on_get(self, client):
        # Base-class httpx.TimeoutException (e.g. a pool checkout stall) must
        # take the exact same retriable -> ApiTimeoutError path as ReadTimeout.
        route = respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=[
                httpx.TimeoutException("pool checkout timed out"),
                httpx.Response(200, json={"organizations": [{"id": "o1"}]}),
            ]
        )
        assert client.get_organizations() == {"organizations": [{"id": "o1"}]}
        assert route.call_count == 2

    @respx.mock
    def test_generic_timeout_exhausts_attempts_then_raises(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=httpx.TimeoutException("every attempt stalled")
        )
        with pytest.raises(ApiTimeoutError):
            client.get_organizations()
        assert route.call_count == 4  # 1 + 3 retries, then raise

    @respx.mock
    def test_500_retied_max_attempts_then_raise(self):
        # Max-attempts staircase honors the CONFIGURED attempts (max_retries=2):
        # exactly 2 wire attempts, then ServerError — never an infinite loop.
        instance = CastAIClient(BASE, KEY, max_retries=2)
        try:
            route = respx.get(f"{BASE}/v1/organizations").mock(
                return_value=httpx.Response(500, json={})
            )
            with pytest.raises(ServerError):
                instance.get_organizations()
            assert route.call_count == 2
        finally:
            instance.close()


# -------------------------------------------------------------- pagination
class TestNodePaginationPassthrough:
    """Client-level wire contract for the cursor loop in
    ``optimization_service.load_cluster_nodes``: the first call carries only
    ``page.limit=500``; subsequent calls MUST pass ``page.cursor`` verbatim.
    (The loader's loop iteration itself is covered by the B3 service suite.)
    """

    @respx.mock
    def test_page_cursor_passthrough_two_page_scenario(self, client):
        url = f"{BASE}/v1/kubernetes/external-clusters/{CLUSTER}/nodes"
        route = respx.get(url).mock(
            side_effect=[
                httpx.Response(
                    200,
                    json={"items": [{"id": "n-1", "name": "node-1"}], "nextCursor": "cursor-2"},
                ),
                httpx.Response(
                    200,
                    json={"items": [{"id": "n-2", "name": "node-2"}]},
                ),
            ]
        )
        page1 = client.get_cluster_nodes(ORG, CLUSTER)
        page2 = client.get_cluster_nodes(ORG, CLUSTER, **{"page.cursor": "cursor-2"})

        assert page1["nextCursor"] == "cursor-2"
        assert len(page1["items"]) == len(page2["items"]) == 1
        assert route.call_count == 2

        first = route.calls[0].request.url.params
        assert first["page.limit"] == "500"
        assert "page.cursor" not in first  # first page: no cursor on the wire

        second = route.calls[1].request.url.params
        assert second["page.cursor"] == "cursor-2"  # verbatim passthrough
        assert second["page.limit"] == "500"  # default limit survives the cursor

    @respx.mock
    def test_page_limit_filter_override_passthrough(self, client):
        route = respx.get(
            f"{BASE}/v1/kubernetes/external-clusters/{CLUSTER}/nodes"
        ).mock(return_value=httpx.Response(200, json={"items": []}))
        client.get_cluster_nodes(ORG, CLUSTER, **{"page.limit": 100, "page.cursor": "c9"})
        params = route.calls.last.request.url.params
        assert params["page.limit"] == "100"  # explicit filter beats default
        assert params["page.cursor"] == "c9"


# ------------------------------------------------------------ lazy imports
class TestLazyImportSafety:
    """Importing the UI layer must be side-effect-free: NO network.

    app.py documents "nothing executable happens at import time". We reload
    each module in-process with every httpx transport entry point rigged to
    raise — any import-time request fails the test loudly.
    """

    @pytest.mark.parametrize("name", ["ui.cards", "ui.charts", "ui.filters", "ui.tables", "app"])
    def test_module_import_has_no_network_side_effects(self, monkeypatch, name):
        def _boom(*args, **kwargs):
            raise AssertionError(f"network attempted while importing {name!r}")

        monkeypatch.setattr(httpx.Client, "request", _boom)
        monkeypatch.setattr(httpx.Client, "get", _boom)
        monkeypatch.setattr(httpx.Client, "post", _boom)
        monkeypatch.setattr(httpx, "get", _boom)
        monkeypatch.setattr(httpx, "post", _boom)

        module = sys.modules.get(name)
        if module is not None:  # re-execute top level of an imported module
            importlib.reload(module)
        else:
            importlib.import_module(name)


# ------------------------------------------------------- currency boundaries
class TestCurrencyBoundaries:
    @pytest.mark.parametrize(
        "fn", [fmt_money_usd, fmt_money_compact, fmt_percent, fmt_gib, fmt_cores, fmt_count]
    )
    def test_non_finite_renders_na(self, fn):
        # _to_float's finite gate: +/-inf and nan -> "N/A" for every formatter.
        assert fn(math.inf) == NA
        assert fn(-math.inf) == NA
        assert fn(math.nan) == NA
        assert fn("inf") == NA  # proto3 wire-string form too
        assert fn("nan") == NA

    def test_fmt_na_passes_non_finite_through_as_text(self):
        # ACTUAL contract: fmt_na is the identity renderer — a non-finite float
        # is not parseable so it is surfaced (repr-style), unlike the numeric
        # formatters above. Pinned to document the asymmetry.
        assert fmt_na(math.inf) == "inf"
        assert fmt_na(-math.inf) == "-inf"

    def test_compact_trillion_bucket(self):
        assert fmt_money_compact(1e12) == "$1.0T"
        assert fmt_money_compact(2.5e12) == "$2.5T"
        assert fmt_money_compact(-1e12) == "-$1.0T"
        # Overflow beyond T stays in the T bucket (documented behavior).
        assert fmt_money_compact(1e15) == "$1000.0T"

    def test_usd_huge_values_stay_full_precision(self):
        assert fmt_money_usd(1e12) == "$1,000,000,000,000.00"
        assert fmt_money_usd(123_456_789.5) == "$123,456,789.50"

    def test_tiny_fractions_collapse_to_zero_display(self):
        assert fmt_money_usd(0.001) == "$0.00"
        assert fmt_money_usd(-0.001) == "$0.00"  # collapses -$0.00 too
        assert fmt_money_usd(0.0051) == "$0.01"
        assert fmt_money_compact(0.0049) == "$0"
        assert fmt_money_compact(0.009) == "$0.01"
        assert fmt_money_compact(-0.4) == "-$0.4"

    def test_compact_k_boundary_excluded_ranges(self):
        assert fmt_money_compact(999) == "$999"  # below the K bucket
        assert fmt_money_compact(1000) == "$1.0K"  # boundary inclusive
        assert fmt_money_compact(2500) == "$2.5K"

    def test_string_numeric_with_thousands_separators(self):
        assert fmt_money_compact("1,200") == "$1.2K"
        assert fmt_money_usd("$1,234.5") == "$1,234.50"
