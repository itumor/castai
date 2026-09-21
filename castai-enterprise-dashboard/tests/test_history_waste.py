"""history/waste/notifications/OOM loaders — specs: historical-model §1/§2.3,
finops-model §4, reliability-model §3/§4.

Covers: window ratio-of-sums (incl. −100% exclusion), top movers ranking,
spot-trend shares with min_count NA discipline, waste sums + drift flag,
notification 3-count pattern (limit=1 reads), OOM fleet totals (no clusterId),
cluster history bundle, and the FetchError.kind (GAP-B) contract on all four
raise sites.
"""

from __future__ import annotations

import pytest

from models import Organization
from services import cluster_service, cost_service, history_service
from tests import fixtures_api as fx
from utils.errors import ServerError


def _org(org_id, name):
    return Organization(
        organization_id=org_id, organization_name=name,
        parent_id="root", organization_type=fx.TYPE_CHILD,
    )


ORGS = [_org("org-1", "Org One"), _org("org-2", "Org Two")]


class OrgScopedStub:
    """(method, org_id) -> payload/exception stub; records calls."""

    def __init__(self, payloads=None, fail=None):
        self._payloads = dict(payloads or {})
        self._fail = set(fail or set())
        self.calls: list[tuple] = []

    def _get(self, method, org_id, *args, **kwargs):
        self.calls.append((method, org_id, kwargs))
        if (method, org_id) in self._fail or method in self._fail:
            raise ServerError("synthetic upstream failure (500).")
        return self._payloads.get((method, org_id), {})

    def get_all_org_cluster_efficiency(self, org_id, start, end, limit=500):
        return self._get("eff_items", org_id)

    def get_org_efficiency_summary(self, org_id, start, end):
        return self._get("eff_summary", org_id)

    def get_notifications(self, org_id, **kw):
        self.calls.append(("notifications", org_id, kw))
        if ("notifications", org_id) in self._fail:
            raise ServerError("synthetic upstream failure (500).")
        sev = kw.get("severities")
        if sev == ["CRITICAL", "ERROR"]:
            return {"items": [], "count": 4, "countUnacked": 2}
        if sev == ["WARNING"]:
            return {"items": [], "count": 9, "countUnacked": 5}
        return {"items": [], "count": 30, "countUnacked": 7}

    def get_org_workload_event_metrics(self, org_id, metrics=None, event_types=None,
                                       start=None, end=None, step_seconds=86400):
        self.calls.append(("oom", org_id, {"event_types": event_types}))
        if ("oom", org_id) in self._fail:
            raise ServerError("synthetic upstream failure (500).")
        return self._payloads.get(("oom", org_id), {"series": []})

    def get_org_efficiency(self, org_id, start, end, step_seconds=86400):
        self.calls.append(("eff_series", org_id, {"step_seconds": step_seconds}))
        if ("eff_series", org_id) in self._fail:
            raise ServerError("synthetic upstream failure (500).")
        return self._payloads.get(("eff_series", org_id), {"items": []})

    def get_cluster_node_count_history(self, org_id, cluster_id, start, end, step_seconds=86400):
        return self._get("node_history", org_id)

    def get_cluster_estimated_savings_history(self, org_id, cluster_id, from_dt, to_dt):
        return self._get("est_history", org_id)

    def get_cluster_realized_savings(self, org_id, cluster_id, start, end, step_seconds=86400):
        self.calls.append(("realized", org_id, {}))
        if "realized" in self._fail:
            raise ServerError("synthetic upstream failure (500).")
        return self._payloads.get(("realized", org_id), {})


# --------------------------------------------------------------- window math
class TestWindowPct:
    def test_ratio_of_sums_fixture_reports(self):
        reports = {"org-a": fx.REPORT_A, "org-b": fx.REPORT_B}
        cur, pct = history_service.window_pct_from_reports(reports)
        assert cur == pytest.approx(550.5 + 40.0)
        prev_a = 550.5 / 0.92
        prev_b = 40.0 / 1.015
        assert pct == pytest.approx(((550.5 + 40.0) / (prev_a + prev_b) - 1.0) * 100.0)

    def test_minus_100_pct_org_excluded_from_pct_but_kept_in_current(self):
        reports = {
            "org-a": fx.REPORT_A,  # normal
            "org-b": {"summary": {"totalCost": "50", "totalCostPercentChange": "-100"}, "clusters": []},
        }
        cur, pct = history_service.window_pct_from_reports(reports)
        assert cur == pytest.approx(550.5 + 50.0)  # current sum keeps the org
        prev_a = 550.5 / 0.92
        assert pct == pytest.approx((550.5 / prev_a - 1.0) * 100.0)  # pct pairwise-only

    def test_missing_pct_excluded_pairwise(self):
        reports = {
            "org-a": fx.REPORT_A,
            "org-b": {"summary": {"totalCost": "40"}, "clusters": []},  # no pct at all
        }
        cur, pct = history_service.window_pct_from_reports(reports)
        assert cur == pytest.approx(590.5)
        prev_a = 550.5 / 0.92
        assert pct == pytest.approx((550.5 / prev_a - 1.0) * 100.0)

    def test_all_negative_100_yields_none_pct(self):
        reports = {"org-x": {"summary": {"totalCost": "10", "totalCostPercentChange": "-100"}}}
        cur, pct = history_service.window_pct_from_reports(reports)
        assert cur == pytest.approx(10.0)
        assert pct is None

    def test_empty_reports(self):
        cur, pct = history_service.window_pct_from_reports({})
        assert cur is None and pct is None


class TestTopMovers:
    def test_ranked_by_abs_delta_and_capped(self):
        reports = {"org-a": fx.REPORT_A, "org-b": fx.REPORT_B}
        df = history_service.top_movers_from_reports(reports, n=2)
        assert len(df) == 2
        # C1: 420.5 vs prev=420.5/0.877 -> |delta| ~58.98 dominates.
        assert list(df["cluster_id"]) == [fx.C1_ID, fx.C2_ID]
        first = df.iloc[0]
        assert first["delta_cost"] == pytest.approx(420.5 - 420.5 / 0.877)
        assert first["period_cost"] == pytest.approx(420.5)
        assert first["previous_period_cost"] == pytest.approx(420.5 / 0.877)

    def test_minus_100_rows_excluded_never_imputed(self):
        reports = {
            "org-a": {
                "clusters": [
                    {"clusterId": "c-zero", "clusterName": "zero",
                     "summary": {"totalCost": "10", "totalCostPercentChange": "-100"}},
                    {"clusterId": "c-ok", "clusterName": "ok",
                     "summary": {"totalCost": "10", "totalCostPercentChange": "100"}},
                ]
            }
        }
        df = history_service.top_movers_from_reports(reports, n=5)
        assert list(df["cluster_id"]) == ["c-ok"]
        assert df.iloc[0]["previous_period_cost"] == pytest.approx(5.0)

    def test_empty(self):
        df = history_service.top_movers_from_reports({}, n=5)
        assert len(df) == 0


# ------------------------------------------------------------------ spot trend
class TestSpotTrend:
    DAY1 = "2026-09-18T00:00:00Z"
    DAY2 = "2026-09-19T00:00:00Z"

    @staticmethod
    def _item(ts, spot=None, od=None, fb=None):
        item = {"timestamp": ts}
        for key, value in (("spot", spot), ("onDemand", od), ("fallback", fb)):
            if value is not None:
                item[key] = {"cpuResources": {"provisioned": value}}
        return item

    def test_shares_are_ratio_of_sums(self):
        client = OrgScopedStub(payloads={
            ("eff_series", "org-1"): {"items": [self._item(self.DAY1, spot=4.0, od=6.0, fb=0.0)]},
            ("eff_series", "org-2"): {"items": [self._item(self.DAY1, spot=6.0, od=4.0, fb=0.0)]},
        })
        df = history_service.spot_trend_from_org_efficiency(client, ORGS, "s", "e")
        assert len(df) == 1
        row = df.iloc[0]
        assert row["spot"] == pytest.approx(10.0)
        assert row["on_demand"] == pytest.approx(10.0)
        assert row["spot_share"] == pytest.approx(0.5)
        assert row["on_demand_share"] == pytest.approx(0.5)
        assert row["fallback_share"] == pytest.approx(0.0)

    def test_min_count_missing_class_is_na_never_rebased(self):
        client = OrgScopedStub(payloads={
            ("eff_series", "org-1"): {"items": [self._item(self.DAY1, od=8.0)]},  # no spot block
        })
        df = history_service.spot_trend_from_org_efficiency(client, ORGS, "s", "e")
        assert len(df) == 1
        row = df.iloc[0]
        assert row["on_demand"] == pytest.approx(8.0)
        assert row["on_demand_share"] == pytest.approx(1.0)
        assert row["spot"] != row["spot"] or row["spot"] is None  # NA (min_count=1)
        assert row["spot_share"] != row["spot_share"] or row["spot_share"] is None

    def test_failing_org_absent_others_contribute(self):
        client = OrgScopedStub(payloads={
            ("eff_series", "org-1"): {"items": [self._item(self.DAY1, spot=3.0, od=7.0)]},
        }, fail={("eff_series", "org-2")})
        df = history_service.spot_trend_from_org_efficiency(client, ORGS, "s", "e")
        assert len(df) == 1
        assert df.iloc[0]["spot_share"] == pytest.approx(0.3)

    def test_one_call_per_org_with_daily_step(self):
        client = OrgScopedStub()
        history_service.spot_trend_from_org_efficiency(client, ORGS, "s", "e")
        assert sorted(c for c in client.calls) == [
            ("eff_series", "org-1", {"step_seconds": 86400}),
            ("eff_series", "org-2", {"step_seconds": 86400}),
        ]


# ----------------------------------------------------------------------- waste
class TestWasteByOrganization:
    EFF_ITEMS = [
        {"clusterId": "c1", "wasted": {"cpu": 40.0, "ram": 30.0, "storage": 10.0}},
        {"clusterId": "c2", "wasted": {"cpu": 15.5, "ram": 4.5, "storage": 0.0}},
    ]

    def _client(self, eff_items=None, summaries=None, fail=None):
        payloads = {}
        if eff_items is not None:
            payloads[("eff_items", "org-1")] = eff_items
        if summaries is not None:
            payloads[("eff_summary", "org-1")] = summaries
        return OrgScopedStub(payloads=payloads, fail=fail)

    def test_waste_sums_and_drift_flag_true_over_5_pct(self):
        # derived 80.0 vs API totalWaste 60.0 -> 33% drift => flagged.
        client = OrgScopedStub(payloads={
            ("eff_items", "org-1"): self.EFF_ITEMS,
            ("eff_summary", "org-1"): {"totalWaste": 60.0},
        })
        df, errors = cost_service.waste_by_organization(client, ORGS[:1], "s", "e")
        assert errors == []
        row = df.iloc[0]
        assert row["waste_cpu_usd"] == pytest.approx(55.5)
        assert row["waste_ram_usd"] == pytest.approx(34.5)
        assert row["waste_storage_usd"] == pytest.approx(10.0)
        assert row["waste_total_usd"] == pytest.approx(100.0)
        assert row["api_total_waste_usd"] == pytest.approx(60.0)
        assert row["waste_drift_flag"] is True or row["waste_drift_flag"] == True

    def test_waste_sums_drift_within_threshold_not_flagged(self):
        client = OrgScopedStub(payloads={
            ("eff_items", "org-1"): self.EFF_ITEMS,
            ("eff_summary", "org-1"): {"totalWaste": 97.5},  # |100-97.5|/97.5 ~ 2.6%
        })
        df, _ = cost_service.waste_by_organization(client, ORGS[:1], "s", "e")
        assert df.iloc[0]["waste_drift_flag"] in (False, 0)

    def test_missing_class_makes_total_na_min_count(self):
        client = OrgScopedStub(payloads={
            ("eff_items", "org-1"): [{"clusterId": "c1", "wasted": {"cpu": 5.0, "ram": 2.0}}],
            ("eff_summary", "org-1"): {"totalWaste": 7.0},
        })
        df, _ = cost_service.waste_by_organization(client, ORGS[:1], "s", "e")
        row = df.iloc[0]
        assert row["waste_cpu_usd"] == pytest.approx(5.0)
        assert row["waste_total_usd"] != row["waste_total_usd"] or row["waste_total_usd"] is None

    def test_failure_isolation_records_kind(self):
        client = OrgScopedStub(fail={("eff_items", "org-1")})
        df, errors = cost_service.waste_by_organization(client, ORGS[:1], "s", "e")
        assert len(df) == 0
        assert len(errors) == 1
        assert errors[0].kind == "ServerError"  # GAP-B
        assert errors[0].operation == "waste"


# ---------------------------------------------------------------- notifications
class TestNotificationsSummary:
    def test_three_limit1_reads_per_org_and_totals(self):
        client = OrgScopedStub()
        out, errors = cost_service.notifications_summary(client, ORGS)
        assert errors == []
        calls = [c for c in client.calls if c[0] == "notifications"]
        assert len(calls) == 3 * 2  # 3 limit=1 reads per org
        assert all(c[2].get("limit") == 1 for c in calls)
        per_org = {p["organization_id"]: p for p in out["per_org"]}
        assert per_org["org-1"]["notifications_unacked"] == 7
        assert per_org["org-1"]["notifications_critical"] == 4
        assert per_org["org-1"]["notifications_warning"] == 9
        assert out["totals"] == {
            "unacked": 14, "critical": 8, "warning": 18,
            "organizations_ok": 2, "organizations_failed": 0,
        }

    def test_unacked_read_uses_is_expired_false(self):
        client = OrgScopedStub()
        cost_service.notifications_summary(client, ORGS[:1])
        calls = [c for c in client.calls if c[0] == "notifications"]
        unacked = [c for c in calls if not c[2].get("severities")]
        assert len(unacked) == 1
        assert unacked[0][2]["is_expired"] is False

    def test_per_org_failure_isolated_and_counted(self):
        client = OrgScopedStub(fail={("notifications", "org-2")})
        out, errors = cost_service.notifications_summary(client, ORGS)
        assert len(errors) == 1 and errors[0].kind == "ServerError"  # GAP-B
        assert out["totals"]["organizations_ok"] == 1
        assert out["totals"]["organizations_failed"] == 1
        assert out["totals"]["unacked"] == 7


# ------------------------------------------------------------------------ oom
class TestOrgOomTotals:
    PAYLOAD = {
        "series": [
            {"eventType": "OOMKilled", "items": [
                {"timestamp": "t1", "eventCount": "3"},
                {"timestamp": "t2", "eventCount": "2"},
            ]},
            {"eventType": "OOMKilled", "items": [{"timestamp": "t3", "eventCount": "4"}]},
        ]
    }

    def test_fleet_totals_only_no_cluster_attribution(self):
        client = OrgScopedStub(payloads={("oom", "org-1"): self.PAYLOAD, ("oom", "org-2"): self.PAYLOAD})
        totals, errors = cost_service.org_oom_totals(
            client, ORGS, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z",
        )
        assert errors == []
        assert totals["oom_kills_30d"] == 18  # string eventCounts summed
        assert totals["organizations_ok"] == 2
        # fleet totals ONLY: the org response has no clusterId and the
        # function never tries to attribute per cluster.
        assert not any(k.startswith("cluster") for k in totals)

    def test_window_label_hours(self):
        client = OrgScopedStub(payloads={("oom", "org-1"): self.PAYLOAD})
        totals, _ = cost_service.org_oom_totals(
            client, ORGS[:1], "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z",
        )
        assert totals["oom_kills_24h"] == 9
        assert totals["window"] == "24h"

    def test_validation_and_failure_isolation(self):
        client = OrgScopedStub(fail={("oom", "org-2")})
        totals, errors = cost_service.org_oom_totals(
            client, ORGS, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z",
            step_seconds=86400,
        )
        assert len(errors) == 1 and errors[0].kind == "ServerError"
        assert totals["organizations_failed"] == 1
        assert totals["oom_kills_30d"] == 0  # failed org contributes nothing
        with pytest.raises(ValueError):
            cost_service.org_oom_totals(
                OrgScopedStub(), ORGS[:1], "s", "e", event_types={"BogusReason"}
            )


# ------------------------------------------------------------- history bundle
class TestClusterHistoryBundle:
    def test_all_three_payloads_efficient_parallelism(self):
        client = OrgScopedStub(payloads={
            ("node_history", "org-1"): {"items": [{"timestamp": "t", "nodeCountSpot": 4}]},
            ("est_history", "org-1"): {"items": [{"createdAt": "t", "current": {"costPerHour": 1.5}}]},
            ("realized", "org-1"): {"summary": {"totalCost": "100.0", "totalSavings": "12.0"}},
        })
        out = history_service.get_cluster_history_bundle(client, "org-1", "c1", "s", "e")
        assert out["available"] is True
        assert out["node_count_history"]["items"][0]["nodeCountSpot"] == 4
        assert out["estimated_savings_history"]["items"][0]["current"]["costPerHour"] == 1.5
        assert out["realized_savings"]["summary"]["totalSavings"] == "12.0"
        assert out["errors"] == {}

    def test_partial_failure_keeps_bundle_available(self):
        client = OrgScopedStub(payloads={
            ("node_history", "org-1"): {"items": []},
            ("est_history", "org-1"): {"items": []},
        }, fail={"realized"})
        out = history_service.get_cluster_history_bundle(client, "org-1", "c1", "s", "e")
        assert out["available"] is True
        assert out["realized_savings"] is None
        assert "realized_savings" in out["errors"]

    def test_total_failure_reports_unavailable_never_raises(self):
        client = OrgScopedStub(fail={"node_history", "est_history", "realized"})
        out = history_service.get_cluster_history_bundle(client, "org-1", "c1", "s", "e")
        assert out["available"] is False
        assert len(out["errors"]) == 3


# ------------------------------------------------------------- FetchError.kind
class TestFetchErrorKindSites:
    """GAP-B: kind = type(exc).__name__ at the four exception/payload sites."""

    def test_site_1_bundle_endpoint_exception(self):
        class C:
            def get_clusters(self, org_id): raise ServerError("x")
            def get_org_clusters_summary(self, org_id): return {}
            def get_org_overview(self, org_id, s, e): return {}
            def get_org_clusters_report(self, org_id, s, e): return {}
            def get_org_wa_agent_statuses(self, org_id): return {}
            def get_org_efficiency_summary(self, org_id, s, e): return {}

        result = cluster_service.build_fleet_dataframe(C(), ORGS[:1], "s", "e")
        kinds = {e.operation: e.kind for e in result.errors}
        assert kinds["clusters"] == "ServerError"

    def test_site_2_sweep_future_exception(self, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("future blew up")

        monkeypatch.setattr(cluster_service, "_org_rows", boom)

        class C:  # never reached — _org_rows explodes first
            pass

        result = cluster_service.build_fleet_dataframe(C(), ORGS[:1], "s", "e")
        assert len(result.errors) == 1
        assert result.errors[0].operation == "org_bundle"
        assert result.errors[0].kind == "RuntimeError"

    def test_site_3_and_4_reports_method_and_payload(self):
        class C:
            def get_org_clusters_report(self, org_id, s, e):
                if org_id == "org-1":
                    raise ServerError("x")
                return ["not-a-dict"]  # non-object payload site

        _reports, errors = cluster_service.build_org_reports(C(), ORGS, "s", "e")
        kinds = {e.organization_id: e.kind for e in errors}
        assert kinds["org-1"] == "ServerError"
        assert kinds["org-2"] == "PayloadError"
