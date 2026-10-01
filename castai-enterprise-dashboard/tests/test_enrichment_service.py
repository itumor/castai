"""Enrichment batch runner (performance-v2 §2) — caps, isolation, extraction.

Mock client stubs the client-API method level (no HTTP, no credentials):
method-name -> payload or exception, plus a thread-safe call log. Per-cluster
failure isolation, cap refusal (pre-flight ValueError, zero calls), pre-skip
predicates and each kind's extraction math are covered here.
"""

from __future__ import annotations

import threading

import pytest

from services.enrichment_service import run_enrichment
from utils.errors import ServerError

START = "2026-09-01T00:00:00Z"
END = "2026-09-30T00:00:00Z"


class StubClient:
    def __init__(self, payloads=None, fail_methods=None):
        self._payloads = dict(payloads or {})
        self._fail_methods = dict(fail_methods or {})
        self._lock = threading.Lock()
        self.calls: list[tuple] = []

    def __getattr__(self, name):
        def _call(*args, **kwargs):
            with self._lock:
                self.calls.append((name, args))
            exc = self._fail_methods.get(name)
            if exc is not None:
                raise exc
            return self._payloads.get(name, {})

        return _call


def _row(oid, cid, **extras):
    row = {"organization_id": oid, "organization_name": f"org-{oid}", "cluster_id": cid}
    row.update(extras)
    return row


# ------------------------------------------------------------------ cap refusal
class TestCaps:
    def test_realized_refuses_over_100(self):
        client = StubClient()
        rows = [_row("o1", f"c{n}") for n in range(101)]
        with pytest.raises(ValueError, match="100"):
            run_enrichment("realized", client, rows)
        assert client.calls == []  # refused PRE-FLIGHT: zero client calls

    def test_realized_allow_large_raises_cap_to_400(self):
        client = StubClient(payloads={"get_cluster_realized_savings": {"summary": {}}})
        rows = [_row("o1", f"c{n}", start=START, end=END) for n in range(200)]
        out = run_enrichment("realized", client, rows, allow_large=True)
        assert out.caps["cluster_cap"] == 400
        assert out.attempted == 200

    def test_health_refuses_when_estimated_calls_over_800(self):
        client = StubClient()
        rows = [_row("o1", f"c{n}") for n in range(267)]  # 267 x 3 = 801 > 800
        with pytest.raises(ValueError, match="800"):
            run_enrichment("health", client, rows)
        assert client.calls == []

    def test_health_cluster_cap_is_400(self):
        client = StubClient()
        rows = [_row("o1", f"c{n}") for n in range(401)]
        with pytest.raises(ValueError, match="400"):
            run_enrichment("health", client, rows)
        assert client.calls == []

    def test_unknown_kind_rejected(self):
        with pytest.raises(ValueError, match="unknown"):
            run_enrichment("bogus", StubClient(), [_row("o1", "c1")])

    def test_caps_recorded(self):
        client = StubClient(payloads={"get_cluster_policies": {}})
        out = run_enrichment("na_policies", client, [_row("o1", "c1")])
        assert out.caps["cluster_cap"] == 400
        assert out.caps["call_cap"] == 800
        assert out.caps["estimated_calls"] == 1


# ------------------------------------------------------------- failure isolation
class TestFailureIsolation:
    def test_middle_cluster_failure_isolated_with_kind(self):
        client = StubClient(
            payloads={
                "get_cluster_realized_savings": {
                    "summary": {"totalCost": "100.0", "totalSavings": "25.0"}
                }
            },
        )
        rows = [
            _row("o1", "c1", start=START, end=END),
            _row("o1", "c2", start=START, end=END),
            _row("o1", "c3", start=START, end=END),
        ]
        # c2's task raises: patch the row to carry a poison pill the stub sees.
        orig = client.get_cluster_realized_savings

        def poisoned(org_id, cluster_id, *a, **k):
            if cluster_id == "c2":
                raise ServerError("synthetic upstream (500).")
            return orig(org_id, cluster_id, *a, **k)

        client.get_cluster_realized_savings = poisoned
        out = run_enrichment("realized", client, rows)
        assert out.attempted == 3
        assert out.succeeded == 2
        assert len(out.errors) == 1
        assert out.errors[0].kind == "ServerError"  # GAP-B
        assert out.errors[0].operation == "enrichment:realized"
        assert "synthetic upstream" in out.errors[0].message  # sanitized, present
        assert ("o1", "c1") in out.values and ("o1", "c3") in out.values
        assert ("o1", "c2") not in out.values

    def test_runner_never_raises_on_client_chaos(self):
        client = StubClient(fail_methods={"get_cluster_policies": RuntimeError("boom")})
        out = run_enrichment("na_policies", client, [_row("o1", "c1"), _row("o1", "c2")])
        assert out.attempted == 2 and out.succeeded == 0
        assert len(out.errors) == 2
        assert all(e.kind == "RuntimeError" for e in out.errors)
        assert out.values == {}


# ------------------------------------------------------------------- realized
class TestRealizedKind:
    PAYLOAD = {
        "items": [
            {"timestamp": "2026-09-01T00:00:00Z", "downscalingSavings": "6.0", "spotSavings": "3.0"},
            {"timestamp": "2026-09-02T00:00:00Z", "downscalingSavings": "0.75", "spotSavings": "1.0"},
        ],
        "summary": {"totalCost": "100.0", "totalSavings": "10.75"},
    }

    def _run(self, payload=PAYLOAD, **row_kw):
        client = StubClient(payloads={"get_cluster_realized_savings": payload})
        row = _row("o1", "c1", start=START, end=END, **row_kw)
        out = run_enrichment("realized", client, [row])
        return out.values[("o1", "c1")]

    def test_extraction_summary_authoritative(self):
        v = self._run()
        assert v["realized_savings"] == pytest.approx(10.75)
        assert v["realized_window_cost"] == pytest.approx(100.0)
        assert v["realized_downscaling"] == pytest.approx(6.75)
        assert v["realized_spot"] == pytest.approx(4.0)
        # pct denominator = totalCost + totalSavings (baseline framing, finops §3)
        assert v["realized_savings_pct"] == pytest.approx(10.75 / 110.75)

    def test_fallback_to_item_sums_when_summary_absent(self):
        v = self._run(payload={"items": self.PAYLOAD["items"]})
        assert v["realized_savings"] == pytest.approx(10.75)
        assert v["realized_savings_pct"] is None  # no totalCost -> no baseline

    def test_pct_na_when_denominator_not_positive(self):
        v = self._run(payload={"summary": {"totalCost": "0", "totalSavings": "0"}})
        assert v["realized_savings"] == pytest.approx(0.0)
        assert v["realized_savings_pct"] is None  # never clamped, never div-by-0

    @pytest.mark.parametrize(
        "kw",
        [
            {"status": "disconnected"},
            {"agent_status": "disconnecting"},
            {"reporting_state": "CLUSTER_STATE_DISCONNECTED"},
        ],
    )
    def test_disconnected_rows_pre_skipped(self, kw):
        client = StubClient(payloads={"get_cluster_realized_savings": self.PAYLOAD})
        rows = [_row("o1", "dead", start=START, end=END, **kw),
                _row("o1", "live", start=START, end=END)]
        out = run_enrichment("realized", client, rows)
        assert out.attempted == 1
        assert out.caps["skipped"] == 1
        assert set(out.values) == {("o1", "live")}
        fetches = [c for c in client.calls if c[0] == "get_cluster_realized_savings"]
        assert all(fetch[1][1] == "live" for fetch in fetches)


# ----------------------------------------------------------------- na_policies
class TestNaPoliciesKind:
    def test_extraction_flat_layout(self):
        client = StubClient(payloads={
            "get_cluster_policies": {
                "enabled": True,
                "spotInstances": {"enabled": True},
                "evictor": {"enabled": False},
                "nodeDownscaler": {"enabled": True},
            }
        })
        out = run_enrichment("na_policies", client, [_row("o1", "c1")])
        v = out.values[("o1", "c1")]
        assert v["na_enabled"] is True
        assert v["na_spot_enabled"] is True
        assert v["evictor_enabled"] is False
        assert v["evictor_status"] == "disabled"
        assert v["node_downscaler_enabled"] is True

    def test_extraction_nested_evictor_layout(self):
        client = StubClient(payloads={
            "get_cluster_policies": {
                "enabled": True,
                "nodeDownscaler": {"enabled": True, "evictor": {"enabled": True}},
            }
        })
        v = run_enrichment("na_policies", client, [_row("o1", "c1")]).values[("o1", "c1")]
        assert v["evictor_enabled"] is True
        assert v["evictor_status"] == "enabled"
        assert v["na_spot_enabled"] is None  # absent block -> honest None


# --------------------------------------------------------------------- health
class TestHealthKind:
    NODES = {
        "items": [
            {"state": {"phase": "ready"}},
            {"state": {"phase": "ready"}},
            {"state": {"phase": "not_ready"}},
            {"state": {"phase": "creating"}},
            {"state": {"phase": "pending"}},
            {"state": {"phase": "draining"}},
            {"state": {"phase": "deleting"}},
            {"state": {"phase": "interrupted"}},
            {"state": {"phase": "cordoned"}},
            {"state": {"phase": "ready"}, "unschedulable": True},  # union cordon
            {"state": {"phase": "some_unknown_phase"}},
            {"state": {}},  # phase absent -> unknown
        ]
    }

    def _client(self):
        return StubClient(payloads={
            "get_cluster_nodes": self.NODES,
            "get_problematic_nodes": {"nodes": [{"nodeId": "n1", "name": "n1", "problems": ["disk pressure"]}]},
            "get_problematic_workloads": {
                "controllers": [{"name": "deploy-x", "kind": "Deployment", "problems": ["crashloop", "oom adjacency"]}],
                "standalonePods": [],
            },
        })

    def test_phase_classification_and_cordoned_union(self):
        out = run_enrichment("health", self._client(), [_row("o1", "c1")])
        v = out.values[("o1", "c1")]
        assert v["nodes_ready"] == 2  # the unschedulable ready node lands in cordoned
        assert v["nodes_not_ready"] == 1
        assert v["nodes_creating"] == 1
        assert v["nodes_pending"] == 1
        assert v["nodes_draining"] == 1
        assert v["nodes_deleting"] == 1
        assert v["nodes_interrupted"] == 1
        assert v["nodes_cordoned"] == 2  # phase cordoned OR unschedulable
        assert v["nodes_other"] == 1     # unrecognized phase string
        assert v["nodes_unknown"] == 1   # missing phase
        assert v["nodes_total_classified"] == 12

    def test_problematic_counts_and_reasons(self):
        v = run_enrichment("health", self._client(), [_row("o1", "c1")]).values[("o1", "c1")]
        assert v["problematic_nodes_count"] == 1
        assert v["problematic_workloads_count"] == 1
        assert v["problematic_reasons"] == ["disk pressure", "crashloop", "oom adjacency"]

    def test_three_serial_calls_per_cluster(self):
        client = self._client()
        run_enrichment("health", client, [_row("o1", "c1")])
        methods = sorted(c[0] for c in client.calls)
        assert methods == ["get_cluster_nodes", "get_problematic_nodes", "get_problematic_workloads"]

    def test_partial_failure_yields_no_values_and_error(self):
        client = self._client()
        client._fail_methods["get_problematic_workloads"] = ServerError("synthetic (500).")
        out = run_enrichment("health", client, [_row("o1", "c1")])
        assert out.attempted == 1 and out.succeeded == 0
        assert len(out.errors) == 1 and out.errors[0].kind == "ServerError"
        assert out.values == {}


# ------------------------------------------------------------------ wa_coverage
class TestWaCoverageKind:
    SUMMARY = {
        "totalCount": 10,
        "optimizedCount": 4,
        "costsPerHour": {"requested": "2.0", "recommended": "1.25"},
    }

    def test_only_running_wa_rows_attempted(self):
        client = StubClient(payloads={"get_wa_workloads_summary": self.SUMMARY})
        rows = [
            _row("o1", "on", workload_autoscaler_status="AGENT_STATUS_RUNNING"),
            _row("o1", "off", workload_autoscaler_status="AGENT_STATUS_PROBLEM"),
            _row("o1", "none", workload_autoscaler_status="Not installed"),
        ]
        out = run_enrichment("wa_coverage", client, rows)
        assert out.attempted == 1
        assert out.caps["skipped"] == 2
        assert set(out.values) == {("o1", "on")}

    def test_extraction_math(self):
        client = StubClient(payloads={"get_wa_workloads_summary": self.SUMMARY})
        v = run_enrichment(
            "wa_coverage", client,
            [_row("o1", "c1", workload_autoscaler_status="AGENT_STATUS_RUNNING")],
        ).values[("o1", "c1")]
        assert v["wa_total_workloads"] == 10
        assert v["wa_optimized_workloads"] == 4
        assert v["wa_coverage_pct"] == pytest.approx(0.4)
        # savings = costsPerHour.requested - recommended (finops §, costs incl.)
        assert v["wa_estimated_savings_hourly"] == pytest.approx(0.75)

    def test_missing_costs_or_zero_total_honest_none(self):
        client = StubClient(payloads={"get_wa_workloads_summary": {"totalCount": 0, "optimizedCount": 0}})
        v = run_enrichment(
            "wa_coverage", client,
            [_row("o1", "c1", workload_autoscaler_status="RUNNING")],
        ).values[("o1", "c1")]
        assert v["wa_coverage_pct"] is None           # 0-total -> NA
        assert v["wa_estimated_savings_hourly"] is None  # costs absent -> NA

    # ---- v2-OPS extended keys (full workloads-summary surface, NA-safe) ----
    FULL_SUMMARY = {
        "totalCount": 12,
        "optimizedCount": 6,
        "hpaOptimizedCount": "2",
        "vpaOptimizedCount": "3",
        "hpaVpaOptimizedCount": "1",
        "apiManagedCount": "5",
        "annotationManagedCount": "4",
        "cpuCoresDifference": "1.75",
        "memoryDifference": "0.5",
        "originalRequestedCpuCores": "9.0",
        "originalRequestedMemoryGibs": "18.5",
        "usageCpuCores": "4.2",
        "usageMemoryGibs": "8.75",
        "costsPerHour": {"requested": 2.0, "recommended": 1.25, "originalRequested": 2.4},
    }

    EXTENDED_KEYS = (
        "wa_optimized_vpa_count", "wa_optimized_hpa_count", "wa_optimized_both_count",
        "wa_api_managed_count", "wa_annotation_managed_count",
        "wa_cpu_cores_difference", "wa_memory_difference",
        "wa_original_requested_cpu", "wa_original_requested_ram_gib",
        "wa_usage_cpu_cores", "wa_usage_memory_gib",
    )

    def test_extended_keys_extracted_na_safely(self):
        client = StubClient(payloads={"get_wa_workloads_summary": self.FULL_SUMMARY})
        v = run_enrichment(
            "wa_coverage", client,
            [_row("o1", "c1", workload_autoscaler_status="AGENT_STATUS_RUNNING")],
        ).values[("o1", "c1")]
        # pre-existing keys unchanged (no clash — merge_enrichment stays generic)
        assert v["wa_total_workloads"] == 12
        assert v["wa_optimized_workloads"] == 6
        # extended keys: proto3 strings + numerics both parse
        assert v["wa_optimized_vpa_count"] == pytest.approx(3.0)
        assert v["wa_optimized_hpa_count"] == pytest.approx(2.0)
        assert v["wa_optimized_both_count"] == pytest.approx(1.0)
        assert v["wa_api_managed_count"] == pytest.approx(5.0)
        assert v["wa_annotation_managed_count"] == pytest.approx(4.0)
        assert v["wa_cpu_cores_difference"] == pytest.approx(1.75)
        assert v["wa_memory_difference"] == pytest.approx(0.5)
        assert v["wa_original_requested_cpu"] == pytest.approx(9.0)
        assert v["wa_original_requested_ram_gib"] == pytest.approx(18.5)
        assert v["wa_usage_cpu_cores"] == pytest.approx(4.2)
        assert v["wa_usage_memory_gib"] == pytest.approx(8.75)

    def test_extended_keys_absent_fields_are_none_never_zero(self):
        client = StubClient(payloads={"get_wa_workloads_summary": {"totalCount": 3}})
        v = run_enrichment(
            "wa_coverage", client,
            [_row("o1", "c1", workload_autoscaler_status="AGENT_STATUS_RUNNING")],
        ).values[("o1", "c1")]
        for key in self.EXTENDED_KEYS:
            assert key in v, key
            assert v[key] is None, key  # absent -> None (renders —, never 0)


# -------------------------------------------------------------------- progress
class TestProgress:
    def test_progress_cb_monotonic_done_total(self):
        client = StubClient(payloads={"get_cluster_policies": {}})
        rows = [_row("o1", f"c{n}") for n in range(6)]
        seen = []
        run_enrichment(
            "na_policies", client, rows, max_workers=2,
            progress_cb=lambda done, total, elapsed, eta: seen.append((done, total)),
        )
        assert sorted(d for d, _ in seen) == [1, 2, 3, 4, 5, 6]
        assert all(t == 6 for _, t in seen)

    def test_empty_scope_is_a_clean_noop(self):
        client = StubClient()
        out = run_enrichment("realized", client, [])
        assert out.attempted == 0 and out.succeeded == 0
        assert out.values == {} and out.errors == []
        assert client.calls == []
