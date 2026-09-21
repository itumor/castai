"""api-delta-v2 client methods — wire shapes, envelopes, pre-wire validation.

Everything is respx-mocked: no network, no credentials. Covers: new GET
families (efficiency incl. summary/series/clusters, notifications filters,
workload-event-metrics org+cluster, realized savings, estimated-savings
history, node-count history, idle disks), the ``nextPage{limit,cursor}``
pagination DELTA, the ``workloads[]`` envelope DELTA, and pre-wire ValueError
posture for eventTypes / stepSeconds / severities (unknown => HTTP 400
server-side, so the client rejects first).
"""

from __future__ import annotations

import httpx
import pytest
import respx

from services.castai_client import (
    ALLOWED_EVENT_TYPES,
    ALLOWED_STEP_SECONDS,
    CastAIClient,
)

KEY = "test-key-0123456789abcdef012345"
ORG = "org-child-0001"
CLUSTER = "c-00000000-1111-2222-3333-444444444444"
BASE = "https://api.eu.cast.ai"
START = "2026-09-01T00:00:00Z"
END = "2026-09-30T00:00:00Z"


@pytest.fixture
def client():
    instance = CastAIClient(BASE, KEY)
    yield instance
    instance.close()


def _json(payload, status=200):
    return httpx.Response(status, json=payload)


# ------------------------------------------------------------- efficiency
class TestEfficiencyFamily:
    @respx.mock
    def test_org_cluster_efficiency_params_and_wasted_doubles(self, client):
        payload = {
            "items": [{"clusterId": CLUSTER, "wasted": {"cpu": 12.5, "ram": 7.25, "storage": 1.5}}],
            "nextCursor": "c2",
            "count": "1",
        }
        route = respx.get(f"{BASE}/v1/cost-reports/organization/clusters/efficiency").mock(
            return_value=_json(payload)
        )
        out = client.get_org_cluster_efficiency(ORG, START, END, limit=500, cursor="c1")
        params = route.calls.last.request.url.params
        assert params["startTime"] == START and params["endTime"] == END
        assert params["page.limit"] == "500" and params["page.cursor"] == "c1"
        wasted = out["items"][0]["wasted"]
        assert wasted == {"cpu": 12.5, "ram": 7.25, "storage": 1.5}  # DOUBLES, not strings

    @respx.mock
    def test_org_efficiency_summary_total_waste_passthrough(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/efficiency/summary").mock(
            return_value=_json({"totalWaste": 96.4, "storageCost": {"cost": 40.0}})
        )
        out = client.get_org_efficiency_summary(ORG, START, END)
        assert out["totalWaste"] == 96.4
        params = route.calls.last.request.url.params
        assert params["startTime"] == START and params["endTime"] == END
        assert "stepSeconds" not in params  # summary has no step param

    @respx.mock
    def test_org_efficiency_series_step_seconds(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/efficiency").mock(
            return_value=_json({"items": []})
        )
        client.get_org_efficiency(ORG, START, END, step_seconds=3600)
        params = route.calls.last.request.url.params
        assert params["stepSeconds"] == "3600"

    @respx.mock
    def test_get_all_org_cluster_efficiency_nextcursor_loop(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/clusters/efficiency").mock(
            side_effect=[
                _json({"items": [{"clusterId": "a"}], "nextCursor": "page2"}),
                _json({"items": [{"clusterId": "b"}]}),
            ]
        )
        items = client.get_all_org_cluster_efficiency(ORG, START, END)
        assert [i["clusterId"] for i in items] == ["a", "b"]
        assert route.call_count == 2
        assert route.calls[1].request.url.params["page.cursor"] == "page2"


# ------------------------------------------------------------ notifications
class TestNotificationsV2:
    @respx.mock
    def test_filters_encoded(self, client):
        route = respx.get(f"{BASE}/v1/notifications").mock(
            return_value=_json({"items": [], "countUnacked": 7, "count": 3, "hasAny": True})
        )
        out = client.get_notifications(
            ORG,
            severities=["CRITICAL", "ERROR"],
            cluster_id=CLUSTER,
            is_acked=False,
            is_expired=False,
            limit=1,
            cursor="p2",
        )
        params = route.calls.last.request.url.params
        assert params.get_list("filter.severities") == ["CRITICAL", "ERROR"]
        assert params["filter.clusterId"] == CLUSTER
        assert params["filter.isAcked"] == "false"
        assert params["filter.isExpired"] == "false"
        assert params["page.limit"] == "1" and params["page.cursor"] == "p2"
        assert out["countUnacked"] == 7  # exact-count reads rely on the envelope

    @respx.mock(assert_all_called=False)
    def test_unknown_severity_rejected_pre_wire(self, client):
        route = respx.get(f"{BASE}/v1/notifications").mock(return_value=_json({}))
        with pytest.raises(ValueError):
            client.get_notifications(ORG, severities=["CRITICAL", "MEH"])
        assert route.call_count == 0  # rejected BEFORE any byte hit the wire


# ------------------------------------------------------- workload-event metrics
class TestWorkloadEventMetrics:
    @respx.mock
    def test_org_event_metrics_params(self, client):
        payload = {"series": [{"eventType": "OOMKilled", "items": [{"timestamp": START, "eventCount": "5"}]}]}
        route = respx.get(f"{BASE}/v1/cost-reports/organization/workload-event-metrics").mock(
            return_value=_json(payload)
        )
        out = client.get_org_workload_event_metrics(
            ORG, event_types=["OOMKilled"], start=START, end=END
        )
        params = route.calls.last.request.url.params
        assert params.get_list("eventTypes") == ["OOMKilled"]
        assert params["startTime"] == START and params["endTime"] == END
        assert params["stepSeconds"] == "86400"
        assert out["series"][0]["items"][0]["eventCount"] == "5"  # string uint64

    @respx.mock
    def test_metrics_and_event_types_union_deduped(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/workload-event-metrics").mock(
            return_value=_json({"series": []})
        )
        client.get_org_workload_event_metrics(
            ORG, metrics=["OOMKilled", "BackOff"], event_types=["OOMKilled", "Evicted"],
            start=START, end=END, step_seconds=300,
        )
        params = route.calls.last.request.url.params
        assert params.get_list("eventTypes") == ["OOMKilled", "BackOff", "Evicted"]
        assert params["stepSeconds"] == "300"

    @respx.mock(assert_all_called=False)
    def test_unknown_event_type_rejected_pre_wire(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/workload-event-metrics").mock(
            return_value=_json({})
        )
        with pytest.raises(ValueError):
            client.get_org_workload_event_metrics(
                ORG, event_types=["NotAK8sReason"], start=START, end=END
            )
        assert route.call_count == 0

    @respx.mock(assert_all_called=False)
    @pytest.mark.parametrize("bad_step", [60, 123, -1, 86401, "bogus"])
    def test_step_seconds_allow_list_pre_wire(self, client, bad_step):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/workload-event-metrics").mock(
            return_value=_json({})
        )
        with pytest.raises(ValueError):
            client.get_org_workload_event_metrics(
                ORG, event_types=["OOMKilled"], start=START, end=END, step_seconds=bad_step
            )
        assert route.call_count == 0

    @respx.mock
    def test_step_seconds_zero_auto_allowed(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/workload-event-metrics").mock(
            return_value=_json({"series": []})
        )
        client.get_org_workload_event_metrics(ORG, start=START, end=END, step_seconds=0)
        assert route.calls.last.request.url.params["stepSeconds"] == "0"

    @respx.mock
    def test_cluster_event_metrics_bucket_timestamp(self, client):
        route = respx.get(
            f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/workload-event-metrics"
        ).mock(return_value=_json({"series": [], "clusterId": CLUSTER}))
        client.get_cluster_workload_event_metrics(
            ORG, CLUSTER, event_types=["OOMKilled"], start=START, end=END,
            bucket_timestamp="2026-09-15T00:00:00Z",
        )
        params = route.calls.last.request.url.params
        assert params["bucketTimestamp"] == "2026-09-15T00:00:00Z"
        assert params.get_list("eventTypes") == ["OOMKilled"]

    @respx.mock(assert_all_called=False)
    def test_cluster_event_validation_pre_wire(self, client):
        route = respx.get(
            f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/workload-event-metrics"
        ).mock(return_value=_json({}))
        with pytest.raises(ValueError):
            client.get_cluster_workload_event_metrics(
                ORG, CLUSTER, event_types=["Nope"], start=START, end=END
            )
        assert route.call_count == 0

    def test_allow_lists_cover_documented_defaults(self):
        assert "OOMKilled" in ALLOWED_EVENT_TYPES
        assert {"FailedScheduling", "BackOff", "Killing", "Evicted"} <= ALLOWED_EVENT_TYPES
        assert ALLOWED_STEP_SECONDS == {0, 30, 300, 600, 900, 3600, 86400}


# ------------------------------------------------------------- history family
class TestClusterHistoryMethods:
    @respx.mock
    def test_realized_savings_path_params(self, client):
        payload = {
            "items": [{"timestamp": START, "downscalingSavings": "10.5", "spotSavings": "3.25"}],
            "summary": {"totalCost": "100.0", "totalSavings": "13.75"},
        }
        route = respx.get(f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/savings").mock(
            return_value=_json(payload)
        )
        out = client.get_cluster_realized_savings(ORG, CLUSTER, START, END)
        params = route.calls.last.request.url.params
        assert params["startTime"] == START and params["endTime"] == END
        assert params["stepSeconds"] == "86400"
        assert out["summary"]["totalSavings"] == "13.75"  # proto3 string USD

    @respx.mock(assert_all_called=False)
    def test_realized_savings_step_validation(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/savings").mock(
            return_value=_json({})
        )
        with pytest.raises(ValueError):
            client.get_cluster_realized_savings(ORG, CLUSTER, START, END, step_seconds=42)
        assert route.call_count == 0

    @respx.mock
    def test_estimated_savings_history_from_to(self, client):
        payload = {
            "clusterId": CLUSTER,
            "items": [{"createdAt": START, "current": {"costPerHour": 1.5, "totalNodeCount": 4.0}}],
        }
        route = respx.get(
            f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/estimated-savings-history"
        ).mock(return_value=_json(payload))
        out = client.get_cluster_estimated_savings_history(ORG, CLUSTER, START, END)
        params = route.calls.last.request.url.params
        assert params["fromDate"] == START and params["toDate"] == END
        assert out["items"][0]["current"]["costPerHour"] == 1.5  # double USD/hr

    @respx.mock
    def test_node_count_history_read_timeout_and_params(self, client):
        payload = {
            "items": [{"timestamp": START, "nodeCountOnDemand": 2, "nodeCountSpot": 6,
                       "nodeCountFallback": 0, "nodeCountUnknown": 0, "source": "AGENT"}],
            "sources": [{"source": "AGENT", "firstCollectedAt": START, "lastCollectedAt": END}],
            "lastSnapshotAt": END,
        }
        route = respx.get(
            f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/node-count-history"
        ).mock(return_value=_json(payload))
        out = client.get_cluster_node_count_history(ORG, CLUSTER, START, END, step_seconds=86400)
        params = route.calls.last.request.url.params
        assert params["stepSeconds"] == "86400"
        assert client._timeout_for(f"/v1/cost-reports/clusters/{CLUSTER}/node-count-history").read == 60.0
        assert out["items"][0]["nodeCountSpot"] == 6


# --------------------------------------------------------------- idle disks
class TestIdleDisks:
    _PAGE1 = {
        "idleDisks": [
            {"name": "disk-1", "cloud": "aws", "region": "eu-central-1",
             "status": "UNATTACHED", "storageSizeBytes": "10737418240",
             "storageCostMonthly": "1.20"}
        ],
        "nextPage": {"limit": "500", "cursor": "disks-p2"},
    }
    _PAGE2 = {
        "idleDisks": [
            {"name": "disk-2", "cloud": "gcp", "region": "europe-west1",
             "status": "UNATTACHED", "storageSizeBytes": "21474836480",
             "storageCostMonthly": "2.40"}
        ]
        # DELTA: last page omits nextPage entirely (no nextCursor anywhere)
    }

    @respx.mock
    def test_next_page_envelope_not_next_cursor(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/idle-resources/disks").mock(
            return_value=_json(self._PAGE1)
        )
        out = client.get_org_idle_disks(ORG)
        assert "nextCursor" not in out
        assert out["nextPage"] == {"limit": "500", "cursor": "disks-p2"}
        assert out["idleDisks"][0]["storageCostMonthly"] == "1.20"  # USD/month already
        params = route.calls.last.request.url.params
        assert params["page.limit"] == "500"

    @respx.mock
    def test_get_all_idle_disks_follows_next_page(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/idle-resources/disks").mock(
            side_effect=[_json(self._PAGE1), _json(self._PAGE2)]
        )
        disks = client.get_all_org_idle_disks(ORG)
        assert [d["name"] for d in disks] == ["disk-1", "disk-2"]
        assert route.call_count == 2
        assert route.calls[1].request.url.params["page.cursor"] == "disks-p2"


# --------------------------------------------------------------- workloads[]
class TestWaWorkloadsEnvelope:
    @respx.mock
    def test_get_all_wa_workloads_reads_workloads_key(self, client):
        """DELTA (api-delta-v2 §4.5): the envelope list key is workloads[]."""
        url = f"{BASE}/v1/workload-autoscaling/clusters/{CLUSTER}/workloads"
        route = respx.get(url).mock(
            side_effect=[
                _json({"workloads": [{"id": "w1", "name": "api"}], "nextCursor": "wp2"}),
                _json({"workloads": [{"id": "w2", "name": "worker"}]}),
            ]
        )
        items = client.get_all_wa_workloads(ORG, CLUSTER)
        assert [w["id"] for w in items] == ["w1", "w2"]
        assert route.call_count == 2
        assert route.calls[1].request.url.params["page.cursor"] == "wp2"

    @respx.mock
    def test_workloads_summary_include_costs_on(self, client):
        route = respx.get(
            f"{BASE}/v1/workload-autoscaling/clusters/{CLUSTER}/workloads-summary"
        ).mock(
            return_value=_json({
                "totalCount": 10, "optimizedCount": 6,
                "costsPerHour": {"requested": "2.0", "recommended": "1.4"},
            })
        )
        out = client.get_wa_workloads_summary(ORG, CLUSTER)
        assert route.calls.last.request.url.params["includeCosts"] == "true"
        assert out["optimizedCount"] == 6


# --------------------------------------------------------------- rate sanity
class TestGateWiring:
    @respx.mock
    def test_clean_run_never_halves(self, client):
        respx.get(f"{BASE}/v1/organizations").mock(return_value=_json({"organizations": []}))
        client.get_organizations()
        client.get_organizations()
        assert client._gate._limit == 8  # untouched on clean calls (no halving)
        assert client._gate._inflight == 0

    def test_gate_default_permits(self, client):
        assert client._gate._limit == 8  # init = max_permits default
        assert client._gate._cap == 16
