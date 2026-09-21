"""Service-level suite: discovery -> fleet build -> cost rollups (Builder B3).

Stubs at the CLIENT API level with a hand-rolled FakeClient (method+org_id ->
fixture dict, thread-safe call log) — no HTTP, no respx, no real credentials.
Wire payloads live in tests/fixtures_api.py (proto3 string numerics).

Covered contracts:
  * organization_service: root resolution (unique ENTERPRISE / override /
    ambiguity / DEFAULT+orphan exclusion / orgs-call failure propagation).
  * cluster_service.build_fleet_dataframe: per-org row counts, composite-key
    uniqueness across duplicate names, per-org failure isolation, data_status
    matrix, report extras columns, progress callback, union-of-payloads rows.
  * cost_service: KPI/rollup delegation, savings scope math (hand-verified),
    cost trend summed by timestamp.
"""

from __future__ import annotations

import threading

import pandas as pd
import pytest

from data import aggregators
from models import Organization
from services import cluster_service, cost_service, organization_service
from tests import fixtures_api as fx
from utils.errors import CastAIError, ServerError


# ----------------------------------------------------------------- FakeClient
class FakeClient:
    """Method->fixture stub with a thread-safe (method, org_id) call log.

    payloads:            {(method_name, org_id): wire dict} (default {})
    fail_orgs:           {org_id: exception} -> raised for fleet-era methods
    fail_methods:        {(method, org_id): exception} -> raised for one method
    organizations_payload / organizations_error: GET /v1/organizations stub
    """

    def __init__(
        self,
        *,
        payloads=None,
        fail_orgs=None,
        fail_methods=None,
        organizations_payload=None,
        organizations_error=None,
    ):
        self._payloads = dict(payloads or {})
        self._fail_orgs = dict(fail_orgs or {})
        self._fail_methods = dict(fail_methods or {})
        self._organizations_payload = organizations_payload
        self._organizations_error = organizations_error
        self._lock = threading.Lock()
        self.calls: list[tuple[str, str | None]] = []

    def _call(self, method: str, org_id: str | None):
        with self._lock:
            self.calls.append((method, org_id))
        if method == "get_organizations":
            if self._organizations_error is not None:
                raise self._organizations_error
            return (
                self._organizations_payload
                if self._organizations_payload is not None
                else {"organizations": []}
            )
        exc = self._fail_methods.get((method, org_id))
        if exc is not None:
            raise exc
        if org_id in self._fail_orgs:
            raise self._fail_orgs[org_id]
        return self._payloads.get((method, org_id), {})

    # --- hierarchy ---
    def get_organizations(self):
        return self._call("get_organizations", None)

    # --- Tier-1 bundle (the 5 fleet endpoints) ---
    def get_clusters(self, org_id):
        return self._call(fx.GET_CLUSTERS, org_id)

    def get_org_clusters_summary(self, org_id):
        return self._call(fx.GET_SUMMARY, org_id)

    def get_org_overview(self, org_id, start, end):
        return self._call(fx.GET_OVERVIEW, org_id)

    def get_org_clusters_report(self, org_id, start, end):
        return self._call(fx.GET_REPORT, org_id)

    def get_org_wa_agent_statuses(self, org_id):
        return self._call(fx.GET_WA, org_id)

    def get_org_cluster_efficiency(self, org_id, start, end):
        return self._call(fx.GET_EFFICIENCY, org_id)

    def get_org_efficiency_summary(self, org_id, start, end):
        return self._call(fx.GET_EFFICIENCY_SUMMARY, org_id)


# ------------------------------------------------------------------- helpers
def _client(**overrides) -> FakeClient:
    kwargs = {
        "organizations_payload": fx.organization_tree(),
        "payloads": fx.fleet_payload_map(),
    }
    kwargs.update(overrides)
    return FakeClient(**kwargs)


def _discover(client: FakeClient, **kwargs):
    return organization_service.discover_enterprise_hierarchy(client, **kwargs)


def _orgs_by_id(client: FakeClient) -> dict[str, Organization]:
    return {o.organization_id: o for o in _discover(client).organizations}


def _select(client: FakeClient, *org_ids: str) -> list[Organization]:
    by_id = _orgs_by_id(client)
    return [by_id[oid] for oid in org_ids]


def _fleet(client: FakeClient, orgs, **kwargs) -> cluster_service.FleetResult:
    return cluster_service.build_fleet_dataframe(client, orgs, fx.START, fx.END, **kwargs)


def _by_cluster_id(df: pd.DataFrame) -> pd.DataFrame:
    return df.set_index("cluster_id", drop=False)


# -------------------------------------------------------------- discovery
class TestDiscovery:
    def test_root_resolved_by_unique_enterprise_type(self):
        result = _discover(_client())
        assert result.enterprise.id == fx.ROOT_ID
        assert result.enterprise.name == fx.ROOT_NAME
        scope_ids = [o.organization_id for o in result.organizations]
        assert scope_ids[0] == fx.ROOT_ID  # root first

    def test_enterprise_id_override_wins(self):
        client = _client(organizations_payload=fx.organization_tree_dual_enterprise())
        result = _discover(client, enterprise_id=fx.ROOT2_ID)
        assert result.enterprise.id == fx.ROOT2_ID
        assert [o.organization_id for o in result.organizations] == [fx.ROOT2_ID]

    def test_ambiguous_enterprise_roots_raise(self):
        client = _client(organizations_payload=fx.organization_tree_dual_enterprise())
        with pytest.raises(CastAIError):
            _discover(client)

    def test_no_enterprise_root_raises(self):
        client = _client(organizations_payload=fx.organization_tree_no_enterprise())
        with pytest.raises(CastAIError):
            _discover(client)

    def test_override_to_non_enterprise_org_raises(self):
        with pytest.raises(CastAIError):
            _discover(_client(), enterprise_id=fx.ORG_A_ID)

    def test_default_and_orphan_orgs_excluded(self):
        result = _discover(_client())
        scope_ids = {o.organization_id for o in result.organizations}
        assert scope_ids == {
            fx.ROOT_ID,
            fx.ORG_A_ID,
            fx.ORG_B_ID,
            fx.ORG_EMPTY_ID,
            fx.ORG_PARTIAL_ID,
            fx.ORG_FAIL_ID,
        }
        assert fx.ORG_DEFAULT_ID not in scope_ids
        assert fx.ORG_ORPHAN_ID not in scope_ids

    def test_organizations_call_failure_propagates(self):
        client = _client(
            organizations_error=ServerError("CAST AI upstream error (500) [GET /v1/organizations].")
        )
        with pytest.raises(CastAIError):
            _discover(client)


# ----------------------------------------------------------- fleet building
class TestFleetBuild:
    def test_row_per_cluster_across_orgs(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID, fx.ORG_EMPTY_ID)
        result = _fleet(client, orgs)

        assert result.errors == []
        assert len(result.df) == 4  # A: C1+C2, B: C3+C4, EMPTY: 0
        counts = result.df["organization_id"].value_counts().to_dict()
        assert counts == {fx.ORG_A_ID: 2, fx.ORG_B_ID: 2}

        # Exactly the 6-call bundle per org (ADR v2 R2 / perf-v2 §1.1: the
        # per-cluster clusters/efficiency items call joins Tier-1 by default
        # -> budget 1 + 6×N).
        fleet_calls = [c for c in client.calls if c[0] != "get_organizations"]
        assert len(fleet_calls) == 6 * 3
        assert set(fleet_calls) == {
            (fx.GET_CLUSTERS, fx.ORG_A_ID), (fx.GET_SUMMARY, fx.ORG_A_ID),
            (fx.GET_OVERVIEW, fx.ORG_A_ID), (fx.GET_REPORT, fx.ORG_A_ID), (fx.GET_WA, fx.ORG_A_ID),
            (fx.GET_EFFICIENCY, fx.ORG_A_ID),
            (fx.GET_CLUSTERS, fx.ORG_B_ID), (fx.GET_SUMMARY, fx.ORG_B_ID),
            (fx.GET_OVERVIEW, fx.ORG_B_ID), (fx.GET_REPORT, fx.ORG_B_ID), (fx.GET_WA, fx.ORG_B_ID),
            (fx.GET_EFFICIENCY, fx.ORG_B_ID),
            (fx.GET_CLUSTERS, fx.ORG_EMPTY_ID), (fx.GET_SUMMARY, fx.ORG_EMPTY_ID),
            (fx.GET_OVERVIEW, fx.ORG_EMPTY_ID), (fx.GET_REPORT, fx.ORG_EMPTY_ID), (fx.GET_WA, fx.ORG_EMPTY_ID),
            (fx.GET_EFFICIENCY, fx.ORG_EMPTY_ID),
        }

        # fetched_at: UTC, second precision, Z suffix
        assert isinstance(result.fetched_at, str)
        assert result.fetched_at.endswith("Z")
        assert "+" not in result.fetched_at

    def test_composite_key_unique_despite_duplicate_names(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        df = _fleet(client, orgs).df

        dup_named = df.loc[df["cluster_name"] == fx.DUP_CLUSTER_NAME]
        assert len(dup_named) == 2  # C1 and C3
        assert set(dup_named["organization_id"]) == {fx.ORG_A_ID, fx.ORG_B_ID}
        assert not df.duplicated(subset=["organization_id", "cluster_id"]).any()

    def test_failing_org_zero_rows_other_org_intact(self):
        client = _client(
            fail_orgs={fx.ORG_FAIL_ID: ServerError("synthetic upstream failure (500); X-API-Key: testsecret123")}
        )
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_FAIL_ID)
        result = _fleet(client, orgs)

        assert len(result.df) == 2
        assert set(result.df["organization_id"]) == {fx.ORG_A_ID}
        assert len(result.errors) == 6  # every endpoint of the failing org recorded
        assert {e.organization_id for e in result.errors} == {fx.ORG_FAIL_ID}
        assert {e.organization_name for e in result.errors} == {fx.ORG_FAIL_NAME}
        assert {e.operation for e in result.errors} == {
            "clusters", "summary", "overview", "report", "woa", "org_efficiency",
        }
        for err in result.errors:
            assert "testsecret123" not in err.message  # sanitized (SEC-2.7)
            assert err.kind == "ServerError"  # GAP-B: exception class tag set

    def test_empty_org_zero_rows_no_error(self):
        client = _client()
        orgs = _select(client, fx.ORG_EMPTY_ID)
        result = _fleet(client, orgs)
        assert len(result.df) == 0
        assert result.errors == []

    def test_data_status_matrix(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        df = _by_cluster_id(_fleet(client, orgs).df)

        assert df.loc[fx.C1_ID, "data_status"] == "ok"          # summary present
        assert df.loc[fx.C2_ID, "data_status"] == "partial"     # overview only, no summary
        assert df.loc[fx.C3_ID, "data_status"] == "ok"
        assert df.loc[fx.C4_ID, "data_status"] == "unavailable"  # inventory only

        # WA sentinels: absent entry -> "Not installed" (never confused with UNKNOWN)
        assert df.loc[fx.C1_ID, "workload_autoscaler_status"] == "AGENT_STATUS_RUNNING"
        assert df.loc[fx.C3_ID, "workload_autoscaler_status"] == "AGENT_STATUS_RUNNING"
        assert df.loc[fx.C2_ID, "workload_autoscaler_status"] == "Not installed"
        assert df.loc[fx.C4_ID, "workload_autoscaler_status"] == "Not installed"

        # Spot-check normalized numerics (proto3 string -> float; GiB unchanged)
        assert df.loc[fx.C1_ID, "cpu_provisioned"] == pytest.approx(25.0)
        assert df.loc[fx.C1_ID, "cpu_allocatable"] == pytest.approx(23.0)
        assert df.loc[fx.C1_ID, "memory_used_gib"] == pytest.approx(30.0)
        assert df.loc[fx.C1_ID, "cost_hourly"] == pytest.approx(3.1)
        assert df.loc[fx.C1_ID, "monthly_cost"] == pytest.approx(2263.0)
        assert df.loc[fx.C1_ID, "potential_savings_hourly"] == pytest.approx(1.0)
        assert df.loc[fx.C1_ID, "potential_savings_percentage"] == pytest.approx(1.0 / 3.0)
        assert df.loc[fx.C3_ID, "nodes_total"] == pytest.approx(2.0)
        assert pd.isna(df.loc[fx.C2_ID, "cost_hourly"])  # missing never becomes 0

    def test_report_extras_columns_appended(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        df = _fleet(client, orgs).df

        from data.normalizers import EXTRA_COLUMNS

        assert list(df.columns) == (
            list(cluster_service.FLEET_COLUMNS)
            + list(EXTRA_COLUMNS)
            + list(cluster_service.REPORT_EXTRA_COLUMNS)
        )
        by_id = _by_cluster_id(df)
        assert by_id.loc[fx.C1_ID, "report_period_cost"] == pytest.approx(420.5)
        assert by_id.loc[fx.C1_ID, "report_cost_pct_change"] == pytest.approx(-12.3)
        assert by_id.loc[fx.C2_ID, "report_period_cost"] == pytest.approx(130.0)
        assert by_id.loc[fx.C3_ID, "report_period_cost"] == pytest.approx(40.0)
        assert pd.isna(by_id.loc[fx.C4_ID, "report_period_cost"])

    def test_progress_cb_called_per_org(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID, fx.ORG_EMPTY_ID)
        seen: list[tuple[str, int, int]] = []
        _fleet(client, orgs, progress_cb=lambda name, done, total: seen.append((name, done, total)))

        assert len(seen) == 3
        assert {name for name, _, _ in seen} == {fx.ORG_A_NAME, fx.ORG_B_NAME, fx.ORG_EMPTY_NAME}
        assert sorted(done for _, done, _ in seen) == [1, 2, 3]
        assert all(total == 3 for _, _, total in seen)

    def test_cluster_list_failure_still_yields_rows_from_other_payloads(self):
        client = _client(
            fail_methods={(fx.GET_CLUSTERS, fx.ORG_PARTIAL_ID): ServerError("synthetic upstream failure (500).")}
        )
        orgs = _select(client, fx.ORG_PARTIAL_ID)
        result = _fleet(client, orgs)

        # Row exists from summary/overview/report/WA keys; org stamped from scope.
        assert len(result.df) == 1
        row = result.df.iloc[0]
        assert row["organization_id"] == fx.ORG_PARTIAL_ID
        assert row["organization_name"] == fx.ORG_PARTIAL_NAME
        assert row["cluster_id"] == fx.P1_ID
        assert row["data_status"] == "ok"  # summary payload arrived
        assert row["report_period_cost"] == pytest.approx(18.0)
        assert pd.isna(row["provider"])   # inventory fields honestly absent
        assert len(result.errors) == 1
        assert result.errors[0].operation == "clusters"

    def test_row_count_is_union_of_clusters_seen_in_any_payload(self):
        # ORG_A: inventory {C1, C2} == union (C2's report/overview entries are
        # known ids). ORG_B: union {C1..C4} minus... union = {C3, C4} (C3 in
        # every payload, C4 inventory-only). Totals already asserted per-org;
        # here the UNION itself is the contract.
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        df = _fleet(client, orgs).df
        assert set(df["cluster_id"]) == {fx.C1_ID, fx.C2_ID, fx.C3_ID, fx.C4_ID}
        assert len(df) == 4

    def test_empty_sweep_still_carries_full_columns(self):
        from data.normalizers import EXTRA_COLUMNS

        client = _client()
        result = _fleet(client, [])
        assert list(result.df.columns) == (
            list(cluster_service.FLEET_COLUMNS)
            + list(EXTRA_COLUMNS)
            + list(cluster_service.REPORT_EXTRA_COLUMNS)
        )
        assert len(result.df) == 0
        assert result.errors == []

    # --------------------------------------------------- org-efficiency flag
    def test_org_efficiency_default_on_carries_payloads(self):
        """ADR v2 R2: PER-CLUSTER clusters/efficiency joins Tier-1 BY DEFAULT."""
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        result = _fleet(client, orgs)
        assert set(result.org_efficiency) == {fx.ORG_A_ID, fx.ORG_B_ID}
        # whole payload is carried out (items[] with waste doubles, USD/window)
        assert result.org_efficiency[fx.ORG_A_ID]["items"][0]["wasted"] == {
            "cpu": 40.0, "ram": 30.0, "storage": 10.0,
        }
        assert result.org_efficiency[fx.ORG_B_ID]["items"][0]["wasted"]["cpu"] == pytest.approx(2.5)

    def test_org_efficiency_items_feed_fleet_waste_columns(self):
        """The matched efficiency items land on the row as waste_*_usd (ADR R2)."""
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        df = _by_cluster_id(_fleet(client, orgs).df)

        assert df.loc[fx.C1_ID, "waste_cpu_usd"] == pytest.approx(40.0)
        assert df.loc[fx.C1_ID, "waste_ram_usd"] == pytest.approx(30.0)
        assert df.loc[fx.C1_ID, "waste_storage_usd"] == pytest.approx(10.0)
        assert df.loc[fx.C1_ID, "waste_total_usd"] == pytest.approx(80.0)
        assert df.loc[fx.C3_ID, "waste_total_usd"] == pytest.approx(4.0)
        # measured-zero storage waste stays 0 (a zero is data, not missing)
        assert df.loc[fx.C3_ID, "waste_storage_usd"] == pytest.approx(0.0)
        # C2/C4 absent from the efficiency payloads -> NA, never 0
        assert pd.isna(df.loc[fx.C2_ID, "waste_total_usd"])
        assert pd.isna(df.loc[fx.C4_ID, "waste_total_usd"])

    def test_org_efficiency_flag_off_restores_5_call_bundle(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID, fx.ORG_EMPTY_ID)
        result = _fleet(client, orgs, include_org_efficiency=False)
        fleet_calls = [c for c in client.calls if c[0] != "get_organizations"]
        assert len(fleet_calls) == 5 * 3  # v1 budget back: 1 + 5×N
        assert all(c[0] != fx.GET_EFFICIENCY for c in fleet_calls)
        assert result.org_efficiency == {}
        assert result.errors == []
        # waste columns are honestly NA when the efficiency slot is disabled
        assert result.df["waste_total_usd"].isna().all()

    def test_org_efficiency_env_override_off(self, monkeypatch):
        """Env-first resolution mirrors settings precedence (service-side)."""
        monkeypatch.setenv("CASTAI_ENABLE_ORG_EFFICIENCY", "false")
        client = _client()
        orgs = _select(client, fx.ORG_A_ID)
        result = _fleet(client, orgs)
        fleet_calls = [c for c in client.calls if c[0] != "get_organizations"]
        assert len(fleet_calls) == 5
        assert result.org_efficiency == {}

    def test_org_efficiency_failure_is_isolated_from_rows(self):
        """A failing efficiency call never costs fleet rows (optional slot)."""
        client = _client(
            fail_methods={(fx.GET_EFFICIENCY, fx.ORG_A_ID): ServerError("synthetic 500.")}
        )
        orgs = _select(client, fx.ORG_A_ID)
        result = _fleet(client, orgs)
        assert len(result.df) == 2  # rows intact from the 5 base payloads
        assert result.org_efficiency == {}
        assert result.df["waste_total_usd"].isna().all()  # waste NA, not 0
        assert len(result.errors) == 1
        assert result.errors[0].operation == "org_efficiency"
        assert result.errors[0].kind == "ServerError"  # GAP-B tag set here too


# ------------------------------------------------------------------ cost svc
class TestCostService:
    @pytest.fixture
    def fleet_df(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID, fx.ORG_EMPTY_ID)
        return _fleet(client, orgs).df

    def test_enterprise_kpis_delegates(self, fleet_df):
        ours = cost_service.enterprise_kpis(fleet_df)
        theirs = aggregators.enterprise_kpis(fleet_df)
        assert ours == theirs  # pure delegation
        assert ours["monthly_cost"] == pytest.approx(2263.0 + 365.0)
        assert ours["wa_coverage"] == pytest.approx(0.5)
        assert ours["organizations"] == 2
        assert ours["clusters"] == 4

    def test_cost_by_organization_ordering(self, fleet_df):
        ours = cost_service.cost_by_organization(fleet_df)
        pd.testing.assert_frame_equal(ours, aggregators.cost_by_organization(fleet_df))

        assert list(ours["organization_name"]) == [fx.ORG_A_NAME, fx.ORG_B_NAME]
        costs = list(ours["monthly_cost"])
        assert costs[0] == pytest.approx(2263.0)
        assert costs[1] == pytest.approx(365.0)
        assert costs[0] >= costs[1]  # descending

    def test_savings_by_organization_weighted_pct(self, fleet_df):
        out = cost_service.savings_by_organization(fleet_df)
        assert list(out.columns) == [
            "organization_name", "organization_id", "clusters_with_savings",
            "monthly_cost", "potential_savings_monthly", "potential_savings_pct",
        ]
        assert list(out["organization_id"]) == [fx.ORG_A_ID, fx.ORG_B_ID]  # sorted desc

        by_id = out.set_index("organization_id")
        # ORG A: scope = {C1, C2} (both have ps);  monthly over scope = C1 only;
        # pct = Σps/Σ(overview cost) on pairwise rows (final-review MAJOR-1):
        # C1 ov 3.0 (ps 1.0) + C2 ov 4.0 (ps 1.0) -> 2/7 (C2 is IN scope;
        # its own overview cost is the denominator, not the missing summary).
        assert by_id.loc[fx.ORG_A_ID, "clusters_with_savings"] == 2
        assert by_id.loc[fx.ORG_A_ID, "monthly_cost"] == pytest.approx(2263.0)
        assert by_id.loc[fx.ORG_A_ID, "potential_savings_monthly"] == pytest.approx(1460.0)
        assert by_id.loc[fx.ORG_A_ID, "potential_savings_pct"] == pytest.approx(2.0 / 7.0)
        # ORG B: scope = {C3}; pct = 0.1/0.5.
        assert by_id.loc[fx.ORG_B_ID, "clusters_with_savings"] == 1
        assert by_id.loc[fx.ORG_B_ID, "potential_savings_monthly"] == pytest.approx(73.0)
        assert by_id.loc[fx.ORG_B_ID, "potential_savings_pct"] == pytest.approx(0.2)

    def test_savings_by_organization_empty(self):
        out = cost_service.savings_by_organization(pd.DataFrame())
        assert list(out.columns) == [
            "organization_name", "organization_id", "clusters_with_savings",
            "monthly_cost", "potential_savings_monthly", "potential_savings_pct",
        ]
        assert len(out) == 0

    def test_get_cost_trend_sums_by_timestamp(self):
        client = _client()
        orgs = _select(client, fx.ORG_A_ID, fx.ORG_B_ID)
        trend = cost_service.get_cost_trend(client, orgs, fx.START, fx.END)

        assert list(trend.columns) == ["timestamp", "value"]
        assert len(trend) == 3
        timestamps = list(trend["timestamp"])
        assert timestamps == sorted(timestamps)
        assert [pd.Timestamp(ts).strftime("%Y-%m-%d") for ts in timestamps] == [
            "2026-09-18", "2026-09-19", "2026-09-20",
        ]
        assert [float(v) for v in trend["value"]] == pytest.approx([11.0, 22.0, 33.0])

    def test_get_cost_trend_empty_when_nothing_arrived(self):
        client = FakeClient()  # no fixtures at all
        org = Organization(
            organization_id="ghost", organization_name="Ghost",
            parent_id=None, organization_type=fx.TYPE_CHILD,
        )
        trend = cost_service.get_cost_trend(client, [org], fx.START, fx.END)
        assert list(trend.columns) == ["timestamp", "value"]
        assert len(trend) == 0
        assert str(trend["timestamp"].dtype).startswith("datetime64")
