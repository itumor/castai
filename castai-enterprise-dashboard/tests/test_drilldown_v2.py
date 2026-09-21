"""Wave-C drill-down v2 tests — 11-tab drill-down.

Coverage:
  * per-loader unit tests (node pricing USD-string parse, NA policies incl.
    nested evictor, WA workloads envelope, notifications cluster filter, OOM
    24h/7d derivation, realized trend, estimated history, node-count history,
    workload-costs GET) — all failure-isolated, never raising.
  * merged issues feed: ordering + exact §7 shape + per-source failure isolation.
  * node-state classification (cordon = phase ∪ unschedulable — shared logic).
  * arming contract: 12 armable ids, one-button-per-tab, reset clears all.
  * worst-case fully-armed GET budget ≤ 18 (counted at the client boundary).
  * AppTest: select cluster → arm every tab (12 ids) → zero uncaught
    exceptions; negative-savings callout; <14-bucket history caption.
  * I6 grep-guard: no batch loader reachable from drill-down code.

No network, no credentials: everything goes through recording stub clients.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import pytest

import app as app_module
from services import optimization_service as opt
from services.castai_client import CastAIClient
from utils.errors import ServerError

PROJECT_ROOT = Path(__file__).resolve().parent.parent

APITEST_TIMEOUT = 90

START = "2026-09-01T00:00:00Z"
END = "2026-09-24T00:00:00Z"
NOW = "2026-09-24T12:00:00Z"


# ---------------------------------------------------------------- stub client
class StubClient:
    """Recording stub: every drill-down method returns its configured payload
    (value or exception). Unknown attributes raise AttributeError on purpose."""

    def __init__(self, **payloads):
        self._payloads = dict(payloads)
        self.calls: list[tuple[str, tuple, dict]] = []

    def _answer(self, name):
        value = self._payloads.get(name, {})
        if isinstance(value, BaseException):
            raise value
        return value

    def get_cluster_node_pricing(self, org_id, cluster_id, node_ids=None, pricing_as_of=None):
        self.calls.append(("get_cluster_node_pricing", (org_id, cluster_id), {}))
        return self._answer("pricing")

    def get_cluster_policies(self, org_id, cluster_id):
        self.calls.append(("get_cluster_policies", (org_id, cluster_id), {}))
        return self._answer("policies")

    def get_wa_workloads_summary(self, org_id, cluster_id):
        self.calls.append(("get_wa_workloads_summary", (org_id, cluster_id), {}))
        return self._answer("wa_summary")

    def get_wa_workloads(self, org_id, cluster_id, **filters):
        self.calls.append(("get_wa_workloads", (org_id, cluster_id), dict(filters)))
        return self._answer("wa_workloads")

    def get_notifications(self, org_id, *, severities=None, cluster_id=None,
                          is_acked=None, is_expired=None, limit=500, cursor=None):
        self.calls.append(("get_notifications", (org_id,), {
            "severities": severities, "cluster_id": cluster_id,
            "is_expired": is_expired, "limit": limit,
        }))
        return self._answer("notifications")

    def get_cluster_workload_event_metrics(self, org_id, cluster_id, metrics=None,
                                           event_types=None, start=None, end=None,
                                           step_seconds=86400, bucket_timestamp=None):
        self.calls.append(("get_cluster_workload_event_metrics", (org_id, cluster_id), {
            "event_types": event_types, "start": start, "end": end, "step_seconds": step_seconds,
        }))
        return self._answer("oom")

    def get_cluster_realized_savings(self, org_id, cluster_id, start, end, step_seconds=86400):
        self.calls.append(("get_cluster_realized_savings", (org_id, cluster_id), {
            "start": start, "end": end, "step_seconds": step_seconds,
        }))
        return self._answer("realized")

    def get_cluster_estimated_savings_history(self, org_id, cluster_id, from_dt, to_dt):
        self.calls.append(("get_cluster_estimated_savings_history", (org_id, cluster_id), {}))
        return self._answer("est_history")

    def get_cluster_node_count_history(self, org_id, cluster_id, start, end, step_seconds=86400):
        self.calls.append(("get_cluster_node_count_history", (org_id, cluster_id), {
            "start": start, "end": end, "step_seconds": step_seconds,
        }))
        return self._answer("node_history")

    def get(self, path, *, org_id=None, params=None):
        self.calls.append(("GET", (path,), {"org_id": org_id, "params": params}))
        return self._answer(f"GET {path}")


# ====================================================== node pricing (Cost tab)
_PRICING_PAYLOAD = {
    "nodes": [
        {"id": "n1", "name": "ip-10-0-0-1", "basePrice": "0.096", "totalPrice": "0.091",
         "components": [{"type": "cpu"}], "pricingPeriod": {"startTime": "2026-09-01T00:00:00Z"}},
        {"id": "n2", "name": "ip-10-0-0-2", "basePrice": "1.536", "totalPrice": "1.460",
         "components": [{"type": "cpu"}, {"type": "gpu"}]},
        {"id": "n3", "basePrice": "garbage", "totalPrice": None},
    ]
}


def test_load_cluster_node_pricing_parses_usd_strings_and_sorts():
    client = StubClient(pricing=_PRICING_PAYLOAD, )
    out = opt.load_cluster_node_pricing(client, "o1", "c1")
    assert out["available"] is True
    df = out["pricing"]
    assert out["node_count"] == 3 and out["shown"] == 3
    prices = df["total_price_hourly"].tolist()
    assert prices[0] == 1.460 and prices[1] == 0.091      # desc by price
    assert pd.isna(prices[2])                              # unparsable → NaN, never fabricated
    assert df["base_price_hourly"].tolist()[0] == 1.536
    assert df["node_name"].tolist()[0] == "ip-10-0-0-2"
    assert out["pricing_period"] == {"startTime": "2026-09-01T00:00:00Z"}
    assert client.calls[0][0] == "get_cluster_node_pricing"


def test_load_cluster_node_pricing_failure_unavailable():
    client = StubClient(pricing=ServerError("boom"))
    out = opt.load_cluster_node_pricing(client, "o1", "c1")
    assert out["available"] is False and "boom" in out["reason"]


# ==================================================== NA policies (NA tab)
_POLICIES = {
    "enabled": True,
    "spotInstances": {"enabled": True},
    "nodeDownscaler": {"enabled": False, "evictor": {"enabled": True, "dryRun": True}},
    "isScopedMode": False,
    "defaultNodeTemplateVersion": "tmpl-v3",
}


def test_load_cluster_na_policies_nested_evictor():
    client = StubClient(policies=_POLICIES)
    out = opt.load_cluster_na_policies(client, "o1", "c1")
    p = out["policies"]
    assert p["enabled"] is True
    assert p["spot_instances_enabled"] is True
    assert p["evictor"] == {"enabled": True, "dry_run": True, "status": None}
    assert p["node_downscaler_enabled"] is False
    assert p["is_scoped_mode"] is False
    assert p["default_node_template_version"] == "tmpl-v3"


def test_load_cluster_na_policies_top_level_evictor_and_failure():
    client = StubClient(policies={
        "enabled": False,
        "evictor": {"enabled": False, "dryRun": False, "status": "paused"},
    })
    out = opt.load_cluster_na_policies(client, "o1", "c1")
    assert out["policies"]["evictor"]["status"] == "paused"
    assert out["policies"]["spot_instances_enabled"] is None
    failing = StubClient(policies=ServerError("denied"))
    assert opt.load_cluster_na_policies(failing, "o1", "c1")["available"] is False


# =========================================================== WA tab loaders
_WA_SUMMARY = {
    "totalCount": "20", "optimizedCount": "7",
    "costsPerHour": {"requested": "12.50", "recommended": "8.25"},
}

_WA_WORKLOADS = {
    "workloads": [
        {
            "namespace": "billing", "name": "api-7d9f", "kind": "Deployment",
            "scalingPolicyName": "prod-cpu",
            "containers": [
                {"resources": {"requests": {"cpuCores": "0.5", "memoryGib": "1.0"}},
                 "recommendation": {"requests": {"cpuCores": "0.2", "memoryGib": "0.5"}}},
                {"resources": {"requests": {"cpuCores": "0.5", "memoryGib": "1.0"}},
                 "recommendation": {"requests": {"cpuCores": "0.3", "memoryGib": "0.7"}}},
            ],
            "recommendationStatus": {"type": "APPLIED", "lowConfidence": False},
            "managedBy": "API",
        },
        {
            "namespace": "core", "name": "db", "kind": "StatefulSet",
            "scalingPolicyName": "prod-mem",
            "containers": [
                {"resources": {"requests": {"cpuCores": "2.0", "memoryGib": "4.0"}}},
            ],
            "recommendationStatus": {"type": "WAITING"},
        },
    ],
    "nextCursor": "page-2",
}


def test_load_cluster_wa_banner_kpis():
    client = StubClient(wa_summary=_WA_SUMMARY, wa_workloads={"workloads": []})
    out = opt.load_cluster_wa(client, "o1", "c1")
    kpis = out["wa_kpis"]
    assert kpis["total"] == 20.0 and kpis["optimized"] == 7.0
    assert kpis["coverage"] == pytest.approx(0.35)
    assert kpis["cost_requested_hourly"] == 12.50 and kpis["cost_recommended_hourly"] == 8.25


def test_load_cluster_wa_workloads_envelope_and_used_na():
    client = StubClient(wa_summary=_WA_SUMMARY, wa_workloads=_WA_WORKLOADS)
    out = opt.load_cluster_wa(client, "o1", "c1")
    assert out["workloads_truncated"] is True  # nextCursor → capped at 500
    df = out["workloads"]
    assert len(df) == 2
    first = df.iloc[0]
    assert first["requested_cpu"] == pytest.approx(1.0)     # containers summed
    assert first["recommended_cpu"] == pytest.approx(0.5)
    assert first["requested_mem_gib"] == pytest.approx(2.0)
    assert first["status"] == "APPLIED"
    assert set(df["used"]) == {"N/A"}                       # never fabricated
    second = df.iloc[1]
    assert pd.isna(second["recommended_cpu"])            # no rec block → NA, never 0
    # one 500-row page request only
    wa_calls = [c for c in client.calls if c[0] == "get_wa_workloads"]
    assert len(wa_calls) == 1 and wa_calls[0][2]["page.limit"] == 500


def test_load_cluster_wa_all_sources_failed():
    client = StubClient(wa_summary=ServerError("x"), wa_workloads=ServerError("y"))
    out = opt.load_cluster_wa(client, "o1", "c1")
    assert out["available"] is False


# =================================================== notifications (Issues tab)
def test_load_cluster_notifications_sends_cluster_filter_and_severities():
    payload = {
        "count": 2, "countUnacked": 1,
        "items": [
            {"id": "n1", "name": "Spot interruption", "severity": "CRITICAL",
             "message": "node reclaimed", "createdAt": "2026-09-24T10:00:00Z"},
            {"id": "n2", "name": "Rebalance done", "severity": "WARNING",
             "message": "3 nodes moved", "createdAt": "2026-09-23T09:00:00Z",
             "ackedBy": "ops@corp"},
        ],
    }
    client = StubClient(notifications=payload)
    out = opt.load_cluster_notifications(client, "o1", "c1")
    name, _args, kwargs = client.calls[0]
    assert name == "get_notifications"
    assert kwargs["cluster_id"] == "c1"
    assert kwargs["severities"] == ["CRITICAL", "ERROR", "WARNING"]
    assert kwargs["is_expired"] is False and kwargs["limit"] == 50
    assert out["available"] is True
    assert out["count"] == 2 and out["count_unacked"] == 1
    assert [i["severity"] for i in out["items"]] == ["CRITICAL", "WARNING"]
    assert out["items"][1]["acked"] is True and out["items"][0]["acked"] is False


def test_load_cluster_notifications_failure_unavailable():
    client = StubClient(notifications=ServerError("nope"))
    assert opt.load_cluster_notifications(client, "o1", "c1")["available"] is False


# ========================================================= OOM events (Issues)
_OOM_SERIES = {
    "series": [{
        "eventType": "OOMKilled",
        "items": [
            {"timestamp": "2026-09-24T00:00:00Z", "eventCount": "3",
             "byWorkload": [{"workloadName": "api", "workloadType": "Deployment",
                             "namespace": "billing", "container": "api", "eventCount": "3"}]},
            {"timestamp": "2026-09-20T00:00:00Z", "eventCount": "4",
             "byWorkload": [{"workloadName": "db", "workloadType": "StatefulSet",
                             "namespace": "core", "eventCount": "4"}]},
        ],
    }]
}


def test_load_cluster_oom_24h_derived_from_7d_single_call():
    client = StubClient(oom=_OOM_SERIES)
    out = opt.load_cluster_oom_events(client, "o1", "c1", END)
    assert out["available"] is True
    assert out["oom_kills_7d"] == 7
    assert out["oom_kills_24h"] == 3       # only the 2026-09-24 bucket is in the last 24h
    assert len(out["oom_items"]) == 2
    assert out["oom_items"][0]["container"] == "api"
    calls = [c for c in client.calls if c[0] == "get_cluster_workload_event_metrics"]
    assert len(calls) == 1                  # ONE 7d call, 24h derived from buckets
    assert calls[0][2]["event_types"] == ["OOMKilled"]
    assert calls[0][2]["step_seconds"] == 86400


def test_load_cluster_oom_failure_unavailable():
    client = StubClient(oom=ServerError("no events"))
    out = opt.load_cluster_oom_events(client, "o1", "c1", END)
    assert out["available"] is False


# ============================================ realized savings (Savings/History)
_REALIZED = {
    "summary": {"totalCost": "100.00", "totalSavings": "12.34"},
    "items": [
        {"timestamp": "2026-09-23T00:00:00Z", "downscalingSavings": "1.5", "spotSavings": "2.5"},
        {"timestamp": "2026-09-23T12:00:00Z", "downscalingSavings": "0.5", "spotSavings": "0.5"},
        {"timestamp": "2026-09-24T00:00:00Z", "downscalingSavings": "3.0", "spotSavings": "0"},
    ],
}


def test_load_cluster_realized_savings_summary_parsed():
    client = StubClient(realized=_REALIZED)
    out = opt.load_cluster_realized_savings(client, "o1", "c1", START, END)
    assert out["summary"] == {"total_cost": 100.0, "total_savings": 12.34}
    assert out["window"] == {"start": START, "end": END}
    name, _a, kwargs = client.calls[0]
    assert name == "get_cluster_realized_savings"
    assert kwargs["step_seconds"] == 86400


def test_trend_from_cluster_savings_sums_by_day():
    trend = opt.trend_from_cluster_savings(_REALIZED)
    assert len(trend) == 2                                   # 2 UTC days
    day1 = trend.iloc[0]
    assert day1["downscaling"] == pytest.approx(2.0)         # 1.5 + 0.5 summed
    assert day1["spot"] == pytest.approx(3.0)
    assert str(trend["timestamp"].dtype).startswith("datetime64")
    empty = opt.trend_from_cluster_savings({"items": []})
    assert len(empty) == 0 and list(empty.columns) == ["timestamp", "downscaling", "spot"]


# ================================================= estimated savings history
_EST_HISTORY = {
    "items": [
        {"createdAt": "2026-09-23T08:00:00Z",
         "current": {"costPerHour": 2.0},
         "optimizedLayman": {"costPerHour": 1.5},
         "optimizedSpotInstances": {"costPerHour": 1.1}},
        {"createdAt": "2026-09-23T20:00:00Z",                # same day → wins (last entry)
         "current": {"costPerHour": 2.1},
         "optimizedLayman": {"costPerHour": 1.6},
         "optimizedSpotInstances": {"costPerHour": 1.2},
         "optimizedSpotOnly": {"costPerHour": 0.9}},
        {"createdAt": "2026-09-24T08:00:00Z",
         "current": {"costPerHour": 3.0}},
    ]
}


def test_estimated_history_frame_last_entry_per_day_and_gaps():
    frame = opt.estimated_history_frame(_EST_HISTORY)
    assert len(frame) == 2                                    # last-entry-per-day
    assert frame.iloc[0]["current_cph"] == 2.1                # 20:00 entry wins
    assert frame.iloc[0]["optimized_spot_only_cph"] == 0.9
    # second day has no optimized blocks → NA, never fabricated
    assert pd.isna(frame.iloc[1]["optimized_layman_cph"])
    assert frame.iloc[1]["current_cph"] == 3.0


def test_load_cluster_estimated_history_and_failure():
    client = StubClient(est_history=_EST_HISTORY)
    out = opt.load_cluster_estimated_history(client, "o1", "c1", START, END)
    assert out["available"] is True and len(out["items"]) == 3
    failing = StubClient(est_history=ServerError("gone"))
    assert opt.load_cluster_estimated_history(failing, "o1", "c1", START, END)["available"] is False


# ================================================================ node history
def test_load_cluster_node_history_parses_counts_and_sources(monkeypatch):
    payload = {
        "items": [
            {"timestamp": "2026-09-23T00:00:00Z", "nodeCountOnDemand": "5",
             "nodeCountSpot": "2", "nodeCountFallback": "0", "nodeCountUnknown": "1"},
            {"timestamp": "2026-09-22T00:00:00Z", "nodeCountOnDemand": "4",
             "nodeCountSpot": "2", "nodeCountFallback": "1", "nodeCountUnknown": "0"},
        ],
        "sources": [{"source": "AGENT", "firstCollectedAt": "2026-08-01T00:00:00Z"}],
        "lastSnapshotAt": "2026-09-24T11:00:00Z",
    }
    client = StubClient(node_history=payload)
    out = opt.load_cluster_node_history(client, "o1", "c1", START, END)
    frame = out["node_history"]
    assert len(frame) == 2
    assert frame.iloc[0]["timestamp"] <= frame.iloc[1]["timestamp"]  # sorted
    assert frame.iloc[0]["on_demand"] == 4.0 and frame.iloc[1]["unknown"] == 1.0
    assert out["last_snapshot_at"] == "2026-09-24T11:00:00Z"
    assert out["sources"][0]["source"] == "AGENT"


# ================================================================ workload costs
def test_load_cluster_workload_costs_get_parsed_and_sorted():
    payload = {
        "items": [
            {"namespace": "core", "workloadName": "db", "workloadType": "StatefulSet",
             "summary": {"totalCost": "40.5", "avgCost": "1.0", "avgCpuCost": "0.7", "avgRamCost": "0.3"}},
            {"namespace": "billing", "workloadName": "api", "workloadType": "Deployment",
             "summary": {"totalCost": "90.0", "avgCost": "2.0"}},
        ],
        "nextCursor": "page-2",
    }
    client = StubClient(**{"GET /v1/cost-reports/clusters/c1/workload-costs": payload})
    out = opt.load_cluster_workload_costs(client, "o1", "c1", START, END)
    assert out["available"] is True and out["truncated"] is True
    name, args, kwargs = client.calls[0]
    assert name == "GET" and args[0] == "/v1/cost-reports/clusters/c1/workload-costs"
    assert kwargs["params"]["startTime"] == START and kwargs["params"]["endTime"] == END
    assert kwargs["params"]["page.limit"] == 500
    df = out["workload_costs"]
    assert df["cost_window"].tolist() == [90.0, 40.5]       # desc by window cost
    assert df.iloc[0]["namespace"] == "billing"
    assert pd.isna(df.iloc[1]["avg_cost_hourly"]) or df.iloc[0]["avg_cost_hourly"] == 2.0


# ============================================================ node phase counts
def test_count_node_phases_cordon_union_rule():
    df = pd.DataFrame(
        {
            "node_state_phase": ["ready", "ready", "pending", "cordoned", "not_ready",
                                  "draining", "interrupted", "mystery", None, "deleting"],
            "unschedulable": [False, True, False, False, False, False, True, False, None, False],
        }
    )
    counts = opt.count_node_phases(df)
    # cordoned = phase=="cordoned" ∪ unschedulable: rows 3 (phase), 1 + 6 (flag)
    assert counts["cordoned"] == 3
    assert counts["ready"] == 1
    assert counts["pending"] == 1
    assert counts["not_ready"] == 1
    assert counts["draining"] == 1
    assert counts["deleting"] == 1
    assert counts["other"] == 1            # "mystery" phase is not in the enum
    assert counts["unknown"] == 1          # None phase counts as unknown
    assert "interrupted" in counts and counts["interrupted"] == 0  # row was cordoned instead


def test_count_node_phases_empty_and_missing_column():
    assert sum(opt.count_node_phases(pd.DataFrame()).values()) == 0
    assert opt.count_node_phases(None)["ready"] == 0


# ============================================================== merged feed
_ISSUES_PAYLOAD = {
    "available": True,
    "problematic_node_count": 1,
    "problematic_nodes": [{"name": "node-1", "problems": ["instance terminated"]}],
    "problematic_workload_count": 1,
    "problematic_workloads": [{"name": "api", "namespace": "billing", "problems": ["crashloop"], "kind": "Deployment"}],
    "unscheduled_pod_count": 2,
    "unscheduled_pods": [{"name": "deploy/x", "namespace": "core",
                          "unscheduledPods": [{"name": "p1"}, {"name": "p2"}],
                          "events": [{"lastTimestamp": "2026-09-24T11:00:00Z"}]}],
    "agent_components": [
        {"name": "castai-agent", "status": "Running", "totalPods": "3", "runningPods": "2",
         "totalRestarts": "5", "lastRestartTime": "2026-09-24T09:00:00Z"},
        {"name": "castai-cluster-controller", "status": "Running", "totalPods": "1",
         "runningPods": "1", "totalRestarts": "0"},
    ],
}

_NOTIFICATIONS_PAYLOAD = {
    "available": True,
    "count_unacked": 1,
    "items": [
        {"id": "n9", "name": "interruption", "severity": "CRITICAL",
         "reason": "spot reclaimed", "timestamp": "2026-09-24T10:30:00Z", "acked": False},
        {"id": "n8", "name": "warning", "severity": "WARNING",
         "reason": "node pool reached limit", "timestamp": "2026-09-24T08:00:00Z", "acked": False},
    ],
}

_OOM_PAYLOAD = {
    "available": True, "oom_kills_24h": 3, "oom_kills_7d": 7,
    "oom_items": [{"workload": "api", "workload_type": "Deployment",
                   "namespace": "billing", "container": "api", "count": 3,
                   "timestamp": "2026-09-24T00:00:00Z"}],
}


def test_build_issues_feed_shape_and_severity_ordering():
    feed = opt.build_issues_feed(_ISSUES_PAYLOAD, _NOTIFICATIONS_PAYLOAD, _OOM_PAYLOAD)
    items = feed["items"]
    assert len(items) == 7
    # severity order: critical (oom + notification) → error → warning
    severities = [i["severity"] for i in items]
    assert severities == ["critical", "critical", "error", "error", "warning", "warning", "warning"]
    ranks = [i["severity_rank"] for i in items]
    assert ranks == sorted(ranks)
    # critical family: newest timestamp first (notification 10:30 > oom 00:00)
    assert items[0]["kind"] == "notification" and items[1]["kind"] == "oom"
    kinds = {i["kind"] for i in items}
    assert kinds == {"node", "workload", "pod", "oom", "notification", "component"}
    # canonical item field set
    for item in items:
        assert set(item.keys()) == {
            "kind", "resource", "namespace", "reason", "detail", "severity", "timestamp", "severity_rank",
        }
    # component present because it is degraded; healthy one excluded
    components = [i for i in items if i["kind"] == "component"]
    assert len(components) == 1 and "2/3 running" in components[0]["reason"]
    assert components[0]["namespace"] == "castai-agent"


def test_build_issues_feed_summary_and_issue_count():
    feed = opt.build_issues_feed(_ISSUES_PAYLOAD, _NOTIFICATIONS_PAYLOAD, _OOM_PAYLOAD)
    s = feed["summary"]
    assert s["problematic_nodes"] == 1 and s["problematic_workloads"] == 1
    assert s["unscheduled_pods"] == 2
    assert s["oom_kills_24h"] == 3 and s["oom_kills_7d"] == 7
    assert s["critical_notifications"] == 1 and s["warning_notifications"] == 1
    assert s["unacked_notifications"] == 1
    assert s["agent_health"] == "degraded"
    assert s["issue_count"] == 1 + 1 + 2 + 3 + 1  # §5 plain pairwise sum


def test_build_issues_feed_per_source_failure_isolation():
    # notifications loader failed → error chip recorded, other sources intact.
    feed = opt.build_issues_feed(
        _ISSUES_PAYLOAD,
        {"available": False, "reason": "Permission denied"},
        _OOM_PAYLOAD,
    )
    assert feed["errors"] == {"notifications": "Permission denied"}
    assert feed["summary"]["critical_notifications"] is None
    assert any(i["kind"] == "oom" for i in feed["items"])
    # issues source absent entirely; oom unavailable; notifications ok
    feed2 = opt.build_issues_feed(None, _NOTIFICATIONS_PAYLOAD, {"available": False, "reason": "404"})
    assert feed2["errors"]["issues"] == "loader failed"
    assert feed2["errors"]["oom"] == "404"
    assert all(i["kind"] == "notification" for i in feed2["items"])
    # all sources failed → empty feed but never raises
    feed3 = opt.build_issues_feed(None, None, None)
    assert feed3["items"] == [] and len(feed3["errors"]) == 3
    assert feed3["summary"]["issue_count"] is None


# ==================================================================== AppTest
_APPT_HEADER = f"""
import os, sys, time
sys.path.insert(0, {str(PROJECT_ROOT)!r})
os.environ.setdefault("CASTAI_API_KEY", "test-key-drilldown-v2")
import pandas as pd
import streamlit as st
import app
st.cache_data.clear()
"""

# Full v2 row (same column contract as test_ui_v2._ROW_V2_SRC, negative-savings
# variant switchable). Sources embedded verbatim: AppTest runs a standalone script.
_ROW_DD_SRC = '''
def _row(org, cluster, negative=False):
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
        "potential_savings_hourly": -0.05 if negative else 1.0,
        "potential_savings_percentage": -0.02 if negative else 0.5,
        "workload_autoscaler_status": "AGENT_STATUS_RUNNING", "node_autoscaler_status": pd.NA,
        "problematic_nodes": pd.NA, "problematic_workloads": pd.NA, "unschedulable_pods": 1,
        "data_status": "ok", "last_updated": pd.Timestamp.now(tz="UTC"),
        "reporting_state": "CLUSTER_STATE_OPTIMIZED",
        "optimal_cost_hourly": 2.05 if negative else 1.0, "is_phase2": True, "pod_count": 10,
        "nodes_unknown": 0, "potential_savings": -36.5 if negative else 730.0,
        "overview_cost_hourly": 2.0,
        "cpu_request_efficiency_pct": 0.8, "memory_request_efficiency_pct": 0.8,
        "na_managed_nodes": 1, "na_coverage_pct": 0.5,
        "storage_provisioned_gib": 100.0, "storage_claimed_gib": 50.0,
        "storage_active_claimed_gib": 40.0, "storage_commit_pct": 0.5,
        "storage_cost_hourly": 0.1,
        "waste_cpu_usd": 3.0, "waste_ram_usd": 2.0, "waste_storage_usd": 1.0,
        "waste_total_usd": 6.0,
        "wa_display": "Running", "wa_agent_version": "v1.2.2",
        "wa_version_drift": True, "wa_in_place_resize": True,
        "wa_last_reported": pd.Timestamp.now(tz="UTC"),
        "agent_health": "Connected", "latest_sync_time": pd.Timestamp.now(tz="UTC"),
        "snapshot_age_minutes": 12.0, "data_freshness_status": "fresh",
        "is_ghost": False,
        "has_positive_savings_opportunity": not negative, "has_negative_savings": negative,
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
_HIER = DiscoveryResult(
    enterprise=Enterprise(id="root", name="Root"),
    organizations=[_root, _org_a],
    errors=[],
)
app.cached_hierarchy = lambda base_url, enterprise_id, token: _HIER
"""

# A full drill-down stub client (all Wave-C loaders' methods, call-logged).
_DD_CLIENT_SRC = '''
class DrillClient:
    def __init__(self):
        self.dd_calls = []

    def _rec(self, name, payload):
        self.dd_calls.append(name)
        return payload

    def get_cluster_overview(self, org, cid, start, end):
        return self._rec("overview", {"cpuCount": "4"})

    def get_cluster_summary(self, org, cid):
        return self._rec("resources_summary", {"cpuCount": "4"})

    def get_cluster_resource_usage(self, org, cid, start, end):
        return self._rec("resources_usage", {"items": []})

    def get_cluster_cost(self, org, cid, start, end):
        return self._rec("cost", {"totalDailyCost": [
            {"timestamp": "2026-09-22T00:00:00Z", "value": "10.0"},
            {"timestamp": "2026-09-23T00:00:00Z", "value": "11.0"},
        ]})

    def get_cluster_node_pricing(self, org, cid, node_ids=None, pricing_as_of=None):
        return self._rec("pricing", {"nodes": [
            {"id": "n1", "name": "node-1", "basePrice": "0.1", "totalPrice": "0.09",
             "components": [{"type": "cpu"}],
             "pricingPeriod": {"startTime": "2026-09-01T00:00:00Z"}},
        ]})

    def get_cluster_realized_savings(self, org, cid, start, end, step_seconds=86400):
        return self._rec("savings", {
            "summary": {"totalCost": "100.0", "totalSavings": "12.0"},
            "items": [{"timestamp": "2026-09-23T00:00:00Z",
                       "downscalingSavings": "2.0", "spotSavings": "3.0"}],
        })

    def get_cluster_estimated_savings_history(self, org, cid, from_dt, to_dt):
        return self._rec("est_history", {"items": [
            {"createdAt": "2026-09-23T08:00:00Z",
             "current": {"costPerHour": 2.0},
             "optimizedLayman": {"costPerHour": 1.5},
             "optimizedSpotInstances": {"costPerHour": 1.2}},
        ]})

    def get_cluster_node_count_history(self, org, cid, start, end, step_seconds=86400):
        return self._rec("node_history", {"items": [
            {"timestamp": "2026-09-2%dT00:00:00Z" % d,
             "nodeCountOnDemand": "5", "nodeCountSpot": "2",
             "nodeCountFallback": "0", "nodeCountUnknown": "0"}
            for d in range(0, 5)],   # 5 buckets < 14 -> N/A caption expected
            "sources": [{"source": "AGENT", "firstCollectedAt": "2026-08-01T00:00:00Z"}],
            "lastSnapshotAt": "2026-09-24T11:00:00Z"})

    def get_wa_workloads_summary(self, org, cid):
        return self._rec("wa_summary", {
            "totalCount": "10", "optimizedCount": "5",
            "costsPerHour": {"requested": "12.5", "recommended": "8.25"}})

    def get_wa_workloads(self, org, cid, **filters):
        return self._rec("wa_workloads", {"workloads": [{
            "namespace": "billing", "name": "api", "kind": "Deployment",
            "scalingPolicyName": "prod",
            "containers": [{"resources": {"requests": {"cpuCores": "0.5", "memoryGib": "1.0"}},
                            "recommendation": {"requests": {"cpuCores": "0.3",
                                                            "memoryGib": "0.7"}}}],
            "recommendationStatus": {"type": "APPLIED"}}]})

    def get_cluster_policies(self, org, cid):
        return self._rec("policies", {
            "enabled": True, "spotInstances": {"enabled": True},
            "nodeDownscaler": {"enabled": True,
                               "evictor": {"enabled": True, "dryRun": False}},
            "isScopedMode": False})

    def get_cluster_nodes(self, org, cid, **filters):
        return self._rec("nodes", {"items": [{
            "id": "n1", "name": "node-1", "instanceType": "m5.large",
            "state": {"phase": "ready"}, "resources": {},
            "spotConfig": {"isSpot": True}}]})

    def get(self, path, *, org_id=None, params=None):
        if path.endswith("/nodes"):
            return self._rec("nodes_page", {"items": [{
                "id": "n1", "name": "node-1", "instanceType": "m5.large",
                "state": {"phase": "ready"}, "resources": {},
                "spotConfig": {"isSpot": True}}]})
        if path.endswith("/workload-costs"):
            return self._rec("workload_costs", {"items": [{
                "namespace": "billing", "workloadName": "api", "workloadType": "Deployment",
                "summary": {"totalCost": "90.0", "avgCost": "2.0"}}]})
        raise KeyError(path)

    def get_problematic_nodes(self, org, cid):
        return self._rec("p_nodes", {"nodes": [{"name": "node-1",
                                                "problems": ["instance terminated"]}],
                                     "hasProblems": True})

    def get_problematic_workloads(self, org, cid):
        return self._rec("p_workloads", {"controllers": [], "standalonePods": [],
                                         "hasProblems": False})

    def get_unscheduled_pods(self, org, cid):
        return self._rec("pods", {"items": []})

    def get_cluster_agent_status(self, org, cid):
        return self._rec("agent_status", {"statuses": [
            {"name": "castai-agent", "status": "Running", "totalPods": "2",
             "runningPods": "2", "totalRestarts": "0"}]})

    def get_notifications(self, org, *, severities=None, cluster_id=None, is_acked=None,
                          is_expired=None, limit=500, cursor=None):
        return self._rec("notifications", {
            "count": 1, "countUnacked": 1,
            "items": [{"id": "n1", "name": "Spot interruption", "severity": "CRITICAL",
                       "message": "node reclaimed", "createdAt": "2026-09-24T10:00:00Z"}]})

    def get_cluster_workload_event_metrics(self, org, cid, metrics=None, event_types=None,
                                           start=None, end=None, step_seconds=86400,
                                           bucket_timestamp=None):
        return self._rec("oom", {"series": [{"eventType": "OOMKilled", "items": [
            {"timestamp": end[:10] + "T00:00:00Z" if end else "2026-09-24T00:00:00Z",
             "eventCount": "2",
             "byWorkload": [{"workloadName": "api", "workloadType": "Deployment",
                             "namespace": "billing", "container": "api", "eventCount": "2"}]}]}]})

_CLIENT = DrillClient()
app.build_client = lambda base_url: _CLIENT
st.session_state["__client__"] = _CLIENT
'''


def _run_apptest(script: str):
    from streamlit.testing.v1 import AppTest

    at = AppTest.from_string(_APPT_HEADER + script, default_timeout=APITEST_TIMEOUT)
    at.run()
    return at


_FRAME_PATCH = (
    '\n_FRAME = pd.DataFrame([_row("org-a", "web-1"), _row("org-a", "db-1")])\n'
    + _HIER_PATCH
    + """
app.cached_fleet = lambda *a, **k: FleetResult(
    df=_FRAME, errors=[], fetched_at="2026-09-24T12:00:00Z", reports={}
)
"""
)


# Expected fully-armed drill-down call map (client method name -> #GETs).
_EXPECTED_ARMED_CALLS = {
    "cost": 1, "pricing": 1, "savings": 1, "est_history": 1,
    "wa_summary": 1, "wa_workloads": 1, "policies": 1, "nodes_page": 1,
    "workload_costs": 1,
    "p_nodes": 1, "p_workloads": 1, "pods": 1, "agent_status": 1,
    "notifications": 1, "oom": 1, "node_history": 1,
}


def test_apptest_select_arm_all_12_ids_zero_exceptions_and_budget():
    """Select a cluster, arm every one of the 12 ids, assert zero uncaught
    exceptions AND the fully-armed drill-down GET count ≤ 18 (shared wrappers
    dedupe the History tab's cost/savings/est-history reads)."""

    body = (
        _ROW_DD_SRC
        + _FRAME_PATCH
        + _DD_CLIENT_SRC
        + """
st.session_state["selected"] = ("org-a", "org-a-web-1")
for _t in app._TAB_IDS:
    st.session_state[f"tab_armed_org-a-web-1_{_t}"] = True
app.main()
"""
    )
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert len(app_module._TAB_IDS) == 12
    # 11 tab labels rendered
    labels = [t.label for t in at.tabs]
    assert len(labels) == 11
    assert "Data Quality" in labels and "Workload Autoscaler" in labels and "Node Autoscaler" in labels
    client = at.session_state["__client__"]
    from collections import Counter

    counts = Counter(client.dd_calls)
    for name, expected in _EXPECTED_ARMED_CALLS.items():
        assert counts.get(name, 0) == expected, f"{name}: {counts.get(name, 0)} != {expected}"
    armed_total = sum(counts[n] for n in _EXPECTED_ARMED_CALLS)
    assert armed_total == 16
    assert armed_total <= 18  # perf-v2 §4 hard budget, all tabs armed
    # T1 auto set stays at exactly 3 (I2 intact)
    assert counts.get("overview", 0) == 1
    assert counts.get("resources_summary", 0) == 1 and counts.get("resources_usage", 0) == 1
    # shared wrappers deduped across Savings/History tabs is implicit in ==16.


def test_apptest_buttons_arm_their_tabs():
    """Clicking each tab's Load button arms its loader id(s); all 12 ids end
    set; zero uncaught exceptions with the stub client; <14-bucket caption."""

    body = _ROW_DD_SRC + _FRAME_PATCH + _DD_CLIENT_SRC + """
st.session_state["selected"] = ("org-a", "org-a-web-1")
app.main()
"""
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    cluster = "org-a-web-1"
    assert not any(
        at.session_state.get(f"tab_armed_{cluster}_{t}") for t in app_module._TAB_IDS
    )
    for tab in ("cost", "savings", "wa", "na", "nodes", "workloads", "issues", "history"):
        btn = at.button(key=f"btn_load_{tab}_{cluster}")
        assert btn is not None, tab
        btn.click().run()
        assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert all(
        at.session_state.get(f"tab_armed_{cluster}_{t}") for t in app_module._TAB_IDS
    )
    client = at.session_state["__client__"]
    assert set(_EXPECTED_ARMED_CALLS) <= set(client.dd_calls)  # every loader fired
    # short node-history series (<14 buckets) renders the N/A caption
    captions = " ".join(c.value for c in at.caption)
    assert "<14" in captions


def test_apptest_negative_savings_callout():
    """Negative-savings cluster: arming the Savings tab renders the honesty
    callout with the RAW unclamped number (finops §2 rule 9)."""

    body = (
        _ROW_DD_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1", negative=True)])\n'
        + _HIER_PATCH
        + """
app.cached_fleet = lambda *a, **k: FleetResult(
    df=_FRAME, errors=[], fetched_at="2026-09-24T12:00:00Z", reports={}
)
"""
        + _DD_CLIENT_SRC
        + """
st.session_state["selected"] = ("org-a", "org-a-web-1")
st.session_state["tab_armed_org-a-web-1_savings"] = True
st.session_state["tab_armed_org-a-web-1_savings_est"] = True
app.main()
"""
    )
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    warnings = " ".join(w.value for w in at.warning)
    assert "cost MORE" in warnings
    assert "unclamped" in warnings


def test_apptest_positive_cluster_has_no_negative_callout():
    body = (
        _ROW_DD_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1")])\n'
        + _HIER_PATCH
        + """
app.cached_fleet = lambda *a, **k: FleetResult(
    df=_FRAME, errors=[], fetched_at="2026-09-24T12:00:00Z", reports={}
)
"""
        + _DD_CLIENT_SRC
        + """
st.session_state["selected"] = ("org-a", "org-a-web-1")
st.session_state["tab_armed_org-a-web-1_savings"] = True
st.session_state["tab_armed_org-a-web-1_savings_est"] = True
app.main()
"""
    )
    at = _run_apptest(body)
    assert not at.exception
    assert not any("cost MORE" in w.value for w in at.warning)


def test_apptest_selection_change_resets_all_12_ids():
    """Reset contract (I3): _reset_tab_flags drops every tab_armed_* flag —
    all 12 armable ids — without touching other session keys."""

    body = _ROW_DD_SRC + _FRAME_PATCH + _DD_CLIENT_SRC + """
st.session_state["selected"] = ("org-a", "org-a-web-1")
for _t in app._TAB_IDS:
    st.session_state[f"tab_armed_org-a-web-1_{_t}"] = True
st.session_state["unrelated_key"] = "keep-me"
app._reset_tab_flags()
st.session_state["__after_reset_ids__"] = sorted(
    k for k in st.session_state.keys() if str(k).startswith("tab_armed_")
)
app.main()
"""
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert at.session_state["__after_reset_ids__"] == []
    assert at.session_state["unrelated_key"] == "keep-me"


def test_apptest_data_quality_tab_makes_zero_api_calls():
    """DQ tab renders from the fleet row only: no drill-down GET may fire."""

    body = _ROW_DD_SRC + _FRAME_PATCH + _DD_CLIENT_SRC + """
st.session_state["selected"] = ("org-a", "org-a-web-1")
app.main()
"""
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    client = at.session_state["__client__"]
    # Only the T1 auto-loaders may have fired (selection), nothing armed.
    assert set(client.dd_calls) <= {"overview", "resources_summary", "resources_usage"}
    assert len(client.dd_calls) == 3
    texts = " ".join(c.value for c in at.markdown)
    assert "Sentinel legend" in texts


def test_apptest_na_tab_enrichment_badge():
    """NA tab shows the 'refreshed by batch' badge when the session na_policies
    store covers the cluster (enr merged values, 0 refetch)."""

    body = _ROW_DD_SRC + _FRAME_PATCH + _DD_CLIENT_SRC + """
from datetime import datetime, timedelta, timezone
_today = datetime.now(timezone.utc).date()
_start = f"{(_today - timedelta(days=30)).isoformat()}T00:00:00Z"
_end = f"{_today.isoformat()}T23:59:59Z"
st.session_state["selected"] = ("org-a", "org-a-web-1")
st.session_state["_enr_scope_sig"] = (0, _start, _end)  # pre-match the scope sync
st.session_state["_enr"] = {"na_policies": {("org-a", "org-a-web-1"): {"na_enabled": True}}}
st.session_state["_enr_stats"] = {"na_policies": {"attempted": 1, "succeeded": 1,
                                                  "failed": 0, "caps": {}, "messages": [],
                                                  "fetched_at": time.time() - 60}}
st.session_state["tab_armed_org-a-web-1_na"] = True
app.main()
"""
    at = _run_apptest(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    captions = " ".join(c.value for c in at.caption)
    assert "refreshed by batch" in captions


# ======================================================= static / grep guards
def test_tab_ids_are_12_and_flags_reset_covers_them():
    assert len(app_module._TAB_IDS) == 12
    assert set(app_module._TAB_IDS) == {
        "cost", "pricing", "savings", "savings_est", "wa", "na",
        "nodes", "workloads", "issues", "notifications", "oom", "history",
    }
    # flags are pattern-cleared by _reset_tab_flags (source guard).
    source = Path(app_module.__file__).read_text(encoding="utf-8")
    assert 'k.startswith("tab_armed_")' in source


def test_cached_loader_ttls_pinned_by_decorator():
    """R10/perf-v2 TTL pins: default 600, notifications 300, OOM 900,
    immutable history series 6 h (21600 s). Source-grep guard."""
    source = Path(app_module.__file__).read_text(encoding="utf-8")

    def _ttl_of(wrapper: str) -> str:
        marker = f"def cached_drilldown_{wrapper}("
        idx = source.index(marker)
        head = source.rfind("@st.cache_data(", 0, idx)
        return source[head:idx]

    assert "ttl=300" in _ttl_of("notifications")
    assert "ttl=900" in _ttl_of("oom")
    assert "ttl=21600" in _ttl_of("node_history")
    assert "ttl=21600" in _ttl_of("est_history")
    for wrapper in ("overview", "resources", "cost", "pricing", "savings",
                    "wa", "na", "nodes", "workload_costs", "issues"):
        assert "ttl=600" in _ttl_of(wrapper), wrapper
    assert "max_entries=128" in source


def test_i6_no_batch_loader_in_drilldown_path():
    """I6 grep-guard extended (Wave-C): run_enrichment may ONLY be called from
    the single enrichment-panel handler in app.py — never from drill-down
    loaders (services) or UI modules."""
    app_source = Path(app_module.__file__).read_text(encoding="utf-8")
    call_sites = [
        line.strip() for line in app_source.splitlines()
        if "run_enrichment(" in line
        and "import" not in line
        and "_run_enrichment_batch(" not in line
        and "run_enrichment_batch_handlers" not in line
    ]
    assert call_sites == ["result = run_enrichment("], call_sites
    opt_source = Path(opt.__file__).read_text(encoding="utf-8")
    assert "run_enrichment(" not in opt_source
    # drill-down must import only module-level helpers from enrichment_service
    imports = [
        line.strip() for line in opt_source.splitlines()
        if "enrichment_service" in line and "import" in line
    ]
    assert imports == ["from services.enrichment_service import NODE_PHASES  # module-level helper only"], imports
    # the new v2 service loaders never call the batch kinds
    for banned in ("_na_policies(", "_wa_coverage(", "_realized("):
        if f"def {banned}" in opt_source:
            raise AssertionError(f"batch runner handler leaked into optimization_service: {banned}")


def test_client_node_pricing_method_builds_get_path():
    """get_cluster_node_pricing: GET-only, /v1 path, org header routing."""
    import unittest.mock as mock

    captured = {}

    def _fake_request(self, method, path, *, org_id=None, params=None, json_body=None):
        captured.update(method=method, path=path, org_id=org_id, params=params)
        return {"nodes": []}

    with mock.patch.object(CastAIClient, "_request", _fake_request):
        real = CastAIClient("https://api.eu.cast.ai", "redacted-test-key")
        payload = real.get_cluster_node_pricing("org-1", "cluster-9")
        assert payload == {"nodes": []}
        assert captured["method"] == "GET"
        assert captured["path"] == "/v1/pricing/clusters/cluster-9/nodes"
        assert captured["org_id"] == "org-1"
        real.get_cluster_node_pricing("org-1", "cluster-9", node_ids=["n1", "n2"])
        assert captured["params"]["nodeIds"] == ["n1", "n2"]
        real.get_cluster_node_pricing(
            "org-1", "cluster-9", pricing_as_of="2026-09-01T00:00:00Z"
        )
        assert captured["params"]["pricingAsOf"] == "2026-09-01T00:00:00Z"
