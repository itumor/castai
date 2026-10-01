"""v2-OPS wave tests (ADR v2 R11) — client method, settings flag, rebalancing
+ overprovision drill-down loaders, and the pure WA savings-math tile fn.

No network, no credentials: respx for the transport-level client test; small
in-file stub clients for the service loaders (same pattern as
tests/test_drilldown_v2.py — unknown attributes raise AttributeError).
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
import respx

import app as app_module
from services import optimization_service as opt
from services.castai_client import API_KEY_HEADER, ORG_HEADER, CastAIClient
from utils.errors import ConfigError, PermissionDeniedError, ServerError

BASE = "https://api.eu.cast.ai"
ORG = "org-child-op1"
CLUSTER = "c-00000000-0000-4000-8000-00000000c0de"
KEY = "test-key-ops-visibility-0000000000"


# ---------------------------------------------------------------- stub client
class StubClient:
    """Per-method payload stub; BaseException payloads raise."""

    def __init__(self, **payloads):
        self._payloads = dict(payloads)
        self.calls: list[tuple[str, tuple, dict]] = []

    def _answer(self, name):
        value = self._payloads.get(name, {})
        if isinstance(value, BaseException):
            raise value
        return value

    def get_rebalancing_schedules(self, org_id):
        self.calls.append(("get_rebalancing_schedules", (org_id,), {}))
        return self._answer("rebalance_schedules")

    def get_wa_workloads_summary(self, org_id, cluster_id):
        self.calls.append(("get_wa_workloads_summary", (org_id, cluster_id), {}))
        return self._answer("wa_summary")

    def get_wa_workloads(self, org_id, cluster_id, **filters):
        self.calls.append(("get_wa_workloads", (org_id, cluster_id), dict(filters)))
        return self._answer("wa_workloads")

    def get(self, path, *, org_id=None, params=None):
        self.calls.append(("GET", (path,), {"org_id": org_id, "params": params}))
        return self._answer(f"GET {path}")


_PROBE_PATH = f"GET /v1/kubernetes/clusters/{CLUSTER}/rebalancing-jobs"
_EFFICIENCY_PATH = f"GET /v1/cost-reports/clusters/{CLUSTER}/efficiency"


# ------------------------------------------------------------ client method
class TestGetRebalancingSchedules:
    @respx.mock
    def test_get_path_and_org_header_and_payload_passthrough(self):
        payload = {
            "schedules": [
                {
                    "id": "sch-1",
                    "name": "nightly-binpack",
                    "schedule": {"cron": "0 3 * * *"},
                    "nextTriggerAt": "2026-09-22T03:00:00Z",
                    "lastTriggerAt": "2026-09-21T03:00:00Z",
                    "jobs": [{"any": "opaque-shape"}],
                    "launchConfiguration": {
                        "selector": {
                            "nodeSelectorTerms": [
                                {"matchExpressions": [
                                    {"key": "team", "operator": "In", "values": ["core"]}
                                ]}
                            ]
                        }
                    },
                    "triggerConditions": {"savingsThreshold": 10.0},
                }
            ]
        }
        route = respx.get(f"{BASE}/v1/rebalancing-schedules").mock(
            return_value=httpx.Response(200, json=payload)
        )
        client = CastAIClient(BASE, KEY)
        try:
            out = client.get_rebalancing_schedules(ORG)
        finally:
            client.close()
        request = route.calls.last.request
        assert request.headers[API_KEY_HEADER] == KEY
        assert request.headers[ORG_HEADER] == ORG  # org-scoped via the header
        assert route.call_count == 1               # GET-only, no retry noise
        # payload rides through VERBATIM (parsing belongs to the normalizers)
        assert out == payload
        assert out["schedules"][0]["jobs"] == [{"any": "opaque-shape"}]


# ------------------------------------------------------------- settings flag
class TestRebalanceSchedulesSettingsFlag:
    def _load(self):
        from config.settings import load_settings

        return load_settings()

    def test_default_on(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", "x" * 24)
        monkeypatch.delenv("CASTAI_ENABLE_REBALANCE_SCHEDULES", raising=False)
        monkeypatch.setattr("config.settings._secrets_get", lambda key: None)
        assert self._load().enable_rebalance_schedules is True

    def test_env_off(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", "x" * 24)
        monkeypatch.setenv("CASTAI_ENABLE_REBALANCE_SCHEDULES", "false")
        monkeypatch.setattr("config.settings._secrets_get", lambda key: None)
        assert self._load().enable_rebalance_schedules is False
        assert "enable_rebalance_schedules=False" in repr(self._load())

    def test_env_garbage_fails_closed(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", "x" * 24)
        monkeypatch.setenv("CASTAI_ENABLE_REBALANCE_SCHEDULES", "not-a-bool")
        monkeypatch.setattr("config.settings._secrets_get", lambda key: None)
        with pytest.raises(ConfigError):
            self._load()

    def test_cached_fleet_cache_key_carries_both_flags(self):
        """Regression note (no pre-existing cache-key test): cached_fleet's
        cache key = its full signature — BOTH Tier-1 flags must participate so
        a flip never serves a stale frame (same pattern as org-efficiency).

        Source-based (NOT inspect.signature): AppTest scripts in other suites
        replace ``app.cached_fleet`` with lambdas in-process, which would leak
        into a runtime attribute read.
        """
        source = Path(app_module.__file__).read_text(encoding="utf-8")
        idx = source.index("def cached_fleet(")
        signature = source[idx : source.index("):", idx)]
        assert "enable_org_efficiency" in signature
        assert "enable_rebalance_schedules" in signature
        # ... and BOTH flags are forwarded into the sweep call below it.
        call = source[idx : source.index("return build_fleet_dataframe", idx) + 1500]
        assert "include_org_efficiency=bool(enable_org_efficiency)" in call
        assert "include_rebalance_schedules=bool(enable_rebalance_schedules)" in call

    def test_ttl_900_rebalance_loader_pinned(self):
        """R10 TTL pin for the two NEW 15-min drill-down loaders (source-grep,
        same pattern as test_cached_loader_ttls_pinned_by_decorator)."""
        source = Path(app_module.__file__).read_text(encoding="utf-8")
        for wrapper in ("rebalance", "overprovision"):
            marker = f"def cached_drilldown_{wrapper}("
            idx = source.index(marker)
            head = source.rfind("@st.cache_data(", 0, idx)
            assert "ttl=900" in source[head:idx], wrapper


# ------------------------------------------------------- rebalance fixtures
_SCHEDULES = {
    "schedules": [
        {
            "id": "sch-1",
            "name": "nightly-binpack",
            "schedule": {"cron": "0 3 * * *"},
            "nextTriggerAt": "2026-09-24T03:00:00Z",
            "lastTriggerAt": "2026-09-23T03:00:00Z",
            "jobs": [{"id": "EMBEDDED-OPAQUE", "clusterId": "must-not-be-read"}],
            "launchConfiguration": {"selector": {"nodeSelectorTerms": []}},
            "triggerConditions": {"savingsThreshold": 10.0},
        },
        {
            "id": "sch-2",
            "name": "weekly-evict",
            "schedule": {"cron": "0 6 * * 0"},
            "nextTriggerAt": "2026-09-28T06:00:00Z",
            # no lastTriggerAt (never triggered)
            "jobs": [],
            "launchConfiguration": {},
            "triggerConditions": {},
        },
    ]
}

_JOBS = {
    "jobs": [
        {
            "id": "j-old",
            "clusterId": CLUSTER,
            "rebalancingScheduleId": "sch-2",
            "enabled": True,
            "status": "JobStatusFailed",
            "lastTriggerAt": "2026-09-20T06:00:00Z",
            "nextTriggerAt": "2026-09-28T06:00:00Z",
        },
        {
            "id": "j-new",
            "clusterId": CLUSTER,
            "rebalancingScheduleId": "sch-1",
            "enabled": True,
            "status": "JobStatusFinished",
            "lastTriggerAt": "2026-09-23T03:00:00Z",
            "nextTriggerAt": "2026-09-24T03:00:00Z",
        },
    ]
}


# -------------------------------------------------- load_cluster_rebalance
class TestLoadClusterRebalance:
    def test_schedules_parse_and_opaque_jobs_never_read(self):
        client = StubClient(rebalance_schedules=_SCHEDULES, **{_PROBE_PATH: _JOBS})
        out = opt.load_cluster_rebalance(client, ORG, CLUSTER)
        assert out["available"] is True
        schedules = out["schedules"]
        assert [s["name"] for s in schedules] == ["nightly-binpack", "weekly-evict"]
        assert schedules[0]["cron"] == "0 3 * * *"
        assert schedules[0]["last_trigger_at"] == "2026-09-23T03:00:00Z"
        assert schedules[0]["next_trigger_at"] == "2026-09-24T03:00:00Z"
        assert schedules[1]["last_trigger_at"] is None  # never triggered -> N/A
        # opaque embedded jobs[] must NOT leak anywhere into the output
        assert "EMBEDDED-OPAQUE" not in str(out)
        assert "must-not-be-read" not in str(out)

    def test_cluster_jobs_linked_by_schedule_id_and_latest_selected(self):
        client = StubClient(rebalance_schedules=_SCHEDULES, **{_PROBE_PATH: _JOBS})
        out = opt.load_cluster_rebalance(client, ORG, CLUSTER)
        jobs = out["jobs"]
        assert len(jobs) == 2
        # linkage resolved via the DECLARED cluster-job field only
        assert jobs[0]["schedule_name"] == "weekly-evict"
        assert jobs[1]["schedule_name"] == "nightly-binpack"
        latest = out["latest_job"]
        assert latest["id"] == "j-new"  # max lastTriggerAt wins
        assert latest["status"] == "JobStatusFinished"
        assert latest["last_trigger_at"] == "2026-09-23T03:00:00Z"

    def test_jobs_empty_is_available_with_na_latest(self):
        client = StubClient(rebalance_schedules=_SCHEDULES, **{_PROBE_PATH: {"jobs": []}})
        out = opt.load_cluster_rebalance(client, ORG, CLUSTER)
        assert out["available"] is True  # the schedule inventory still renders
        assert out["jobs"] == []
        assert out["latest_job"] is None  # caller renders the N/A caption

    def test_perm_denied_jobs_is_isolated_from_schedules(self):
        client = StubClient(
            rebalance_schedules=_SCHEDULES,
            **{_PROBE_PATH: PermissionDeniedError("CAST AI API key lacks the required scope (403).")},
        )
        out = opt.load_cluster_rebalance(client, ORG, CLUSTER)
        assert out["available"] is True          # schedules side survives
        assert len(out["schedules"]) == 2
        assert out["jobs"] == []
        assert "rebalancing-jobs" in out["errors"]

    def test_both_sides_failed_unavailable(self):
        client = StubClient(
            rebalance_schedules=ServerError("synthetic 500."),
            **{_PROBE_PATH: ServerError("synthetic 503.")},
        )
        out = opt.load_cluster_rebalance(client, ORG, CLUSTER)
        assert out["available"] is False
        assert out["reason"]

    def test_missing_client_method_isolated_never_raises(self):
        """A client WITHOUT get_rebalancing_schedules: that side degrades to an
        error entry; the jobs side still works."""

        class BareGetClient:
            def get(self, path, *, org_id=None, params=None):
                assert path.endswith("/rebalancing-jobs")
                return _JOBS

        out = opt.load_cluster_rebalance(BareGetClient(), ORG, CLUSTER)
        assert out["available"] is True
        assert out["schedules"] == []
        assert len(out["jobs"]) == 2
        assert "rebalancing-schedules" in out["errors"]

    def test_jobs_without_any_trigger_fall_back_to_next_trigger(self):
        payload = {
            "jobs": [
                {"id": "j1", "rebalancingScheduleId": "sch-9",
                 "status": "JobStatusPending", "nextTriggerAt": "2026-10-01T00:00:00Z"},
                {"id": "j2", "rebalancingScheduleId": "sch-9",
                 "status": "JobStatusPending", "nextTriggerAt": "2026-09-29T00:00:00Z"},
            ]
        }
        client = StubClient(rebalance_schedules={"schedules": []}, **{_PROBE_PATH: payload})
        out = opt.load_cluster_rebalance(client, ORG, CLUSTER)
        assert out["latest_job"]["id"] == "j2"  # soonest next trigger
        assert out["latest_job"]["schedule_name"] is None  # unmatched schedule id


# ----------------------------------------------- overplanned absolutes loader
_EFFICIENCY_ITEMS = {
    "items": [
        {
            "timestamp": "2026-09-21T00:00:00Z",
            "cpuOverprovisioningOnDemand": "9.9",
            "ramOverprovisioningOnDemand": "9.9",
            "storageOverprovisioning": "9.9",
        },
        {
            "timestamp": "2026-09-23T00:00:00Z",  # latest = "current"
            "cpuOverprovisioningOnDemand": "2.0",
            "cpuOverprovisioningSpot": "1.5",
            "cpuOverprovisioningSpotFallback": "0.5",
            "ramOverprovisioningOnDemand": "4.0",
            "ramOverprovisioningSpot": "2.0",
            "storageOverprovisioning": "10.0",
        },
    ]
}


class TestLoadClusterOverprovision:
    def test_latest_item_lifecycle_sum(self):
        client = StubClient(**{_EFFICIENCY_PATH: _EFFICIENCY_ITEMS})
        out = opt.load_cluster_overprovision(client, ORG, CLUSTER, "s", "e")
        assert out["available"] is True
        assert out["timestamp"] == "2026-09-23T00:00:00Z"
        # latest item only; Σ over 3 lifecycles (min_count=1)
        assert out["cpu_overprovisioned_cores"] == pytest.approx(4.0)
        assert out["ram_overprovisioned_gib"] == pytest.approx(6.0)
        assert out["storage_overprovisioned_gib"] == pytest.approx(10.0)
        assert out["items_count"] == 2

    def test_measured_zero_stays_zero(self):
        payload = {"items": [
            {"timestamp": "2026-09-23T00:00:00Z",
             "cpuOverprovisioningOnDemand": "0", "storageOverprovisioning": "0"},
        ]}
        client = StubClient(**{_EFFICIENCY_PATH: payload})
        out = opt.load_cluster_overprovision(client, ORG, CLUSTER, "s", "e")
        assert out["cpu_overprovisioned_cores"] == pytest.approx(0.0)
        assert out["storage_overprovisioned_gib"] == pytest.approx(0.0)
        assert out["ram_overprovisioned_gib"] is None  # fully absent lifecycle -> NA

    def test_empty_items_unavailable_skip_caption(self):
        client = StubClient(**{_EFFICIENCY_PATH: {"items": [], "noDataReason": "NO_DATA"}})
        out = opt.load_cluster_overprovision(client, ORG, CLUSTER, "s", "e")
        assert out["available"] is False
        assert out["reason"] == "NO_DATA"

    def test_endpoint_failure_unavailable_never_raises(self):
        client = StubClient(**{_EFFICIENCY_PATH: ServerError("synthetic 500.")})
        out = opt.load_cluster_overprovision(client, ORG, CLUSTER, "s", "e")
        assert out["available"] is False
        assert out["reason"]


# ------------------------------------------------- pure savings tile fn
class TestWaEstimatedMonthlySavings:
    def test_math(self):
        # (2.0 − 1.25) × 730 = 547.5
        assert opt.wa_estimated_monthly_savings(2.0, 1.25) == pytest.approx(547.5)

    def test_proto3_strings_accepted(self):
        assert opt.wa_estimated_monthly_savings("12.50", "8.25") == pytest.approx(4.25 * 730)

    @pytest.mark.parametrize(
        "requested, recommended",
        [
            (None, 1.0),          # includeCosts absent side
            (1.0, None),
            (None, None),
            ("garbage", 1.0),
            (float("nan"), 1.0),  # non-finite never surfaces
            (float("inf"), 0.0),
        ],
    )
    def test_missing_sides_are_none_never_fabricated(self, requested, recommended):
        assert opt.wa_estimated_monthly_savings(requested, recommended) is None

    def test_negative_delta_passes_through(self):
        # recommended MORE expensive than requested is data, not an error
        assert opt.wa_estimated_monthly_savings(1.0, 2.0) == pytest.approx(-730.0)


# -------------------------------------------------- WA loader extended kpis
_WA_FULL_SUMMARY = {
    "totalCount": "12",
    "optimizedCount": "6",
    "hpaOptimizedCount": "2",
    "vpaOptimizedCount": "3",
    "hpaVpaOptimizedCount": "1",
    "apiManagedCount": "5",
    "annotationManagedCount": "4",
    "cpuCoresDifference": "1.75",
    "memoryDifference": "0.5",
    "originalRequestedCpuCores": "9.0",
    "originalRequestedMemoryGibs": "18.5",
    "requestedCpuCores": "7.25",
    "requestedMemory": "14.0",
    "recommendedCpuCores": "5.5",
    "recommendedMemory": "13.5",
    "usageCpuCores": "4.2",
    "usageMemoryGibs": "8.75",
    "costsPerHour": {"requested": 2.0, "recommended": 1.25, "originalRequested": 2.4},
}


def test_load_cluster_wa_kpis_carry_full_summary_surface():
    client = StubClient(wa_summary=_WA_FULL_SUMMARY, wa_workloads={"workloads": []})
    kpis = opt.load_cluster_wa(client, ORG, CLUSTER)["wa_kpis"]
    assert kpis["optimized_vpa_count"] == pytest.approx(3.0)
    assert kpis["optimized_hpa_count"] == pytest.approx(2.0)
    assert kpis["optimized_both_count"] == pytest.approx(1.0)
    assert kpis["api_managed_count"] == pytest.approx(5.0)
    assert kpis["annotation_managed_count"] == pytest.approx(4.0)
    assert kpis["cpu_cores_difference"] == pytest.approx(1.75)
    assert kpis["memory_difference"] == pytest.approx(0.5)
    assert kpis["original_requested_cpu"] == pytest.approx(9.0)
    assert kpis["original_requested_memory_gib"] == pytest.approx(18.5)
    assert kpis["requested_cpu_cores"] == pytest.approx(7.25)
    assert kpis["requested_memory_gib"] == pytest.approx(14.0)
    assert kpis["recommended_cpu_cores"] == pytest.approx(5.5)
    assert kpis["recommended_memory_gib"] == pytest.approx(13.5)
    assert kpis["usage_cpu_cores"] == pytest.approx(4.2)
    assert kpis["usage_memory_gib"] == pytest.approx(8.75)
    assert kpis["cost_original_requested_hourly"] == pytest.approx(2.4)
    # monthly tile math recomposed from the same kpis
    monthly = opt.wa_estimated_monthly_savings(
        kpis["cost_requested_hourly"], kpis["cost_recommended_hourly"]
    )
    assert monthly == pytest.approx(0.75 * 730)


def test_load_cluster_wa_kpis_na_safe_when_fields_absent():
    client = StubClient(wa_summary={"totalCount": "3"}, wa_workloads={"workloads": []})
    kpis = opt.load_cluster_wa(client, ORG, CLUSTER)["wa_kpis"]
    for key in (
        "optimized_vpa_count", "optimized_hpa_count", "optimized_both_count",
        "api_managed_count", "annotation_managed_count",
        "cpu_cores_difference", "memory_difference",
        "original_requested_cpu", "original_requested_memory_gib",
        "usage_cpu_cores", "usage_memory_gib", "cost_original_requested_hourly",
    ):
        assert kpis[key] is None, key  # absent -> None (UI renders N/A)
