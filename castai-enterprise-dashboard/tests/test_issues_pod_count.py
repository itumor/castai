"""Regression: unscheduled-pod count (reliability agent found int(array) -> always None)."""

from __future__ import annotations

from services.optimization_service import load_cluster_issues


class _FakeClient:
    def __init__(self, pods_items):
        self._pods_items = pods_items

    def get_problematic_nodes(self, org_id, cluster_id):
        return {"nodes": [{"name": "n1"}], "hasProblems": True}

    def get_problematic_workloads(self, org_id, cluster_id):
        return {"controllers": [], "standalonePods": [], "hasProblems": False}

    def get_unscheduled_pods(self, org_id, cluster_id):
        return {"items": self._pods_items}

    def get_cluster_agent_status(self, org_id, cluster_id):
        return {"statuses": []}


def test_pod_count_counts_array_elements():
    client = _FakeClient([
        {"name": "deploy/a", "namespace": "ns1", "unscheduledPods": [{"name": "p1"}, {"name": "p2"}]},
        {"name": "sts/b", "namespace": "ns2", "unscheduledPods": [{"name": "p3"}]},
    ])
    res = load_cluster_issues(client, "o1", "c1")
    assert res["available"] is True
    assert res["unscheduled_pod_count"] == 3


def test_pod_count_handles_empty_and_missing_arrays():
    client = _FakeClient([{"name": "deploy/a", "unscheduledPods": []}, {"name": "deploy/b"}])
    res = load_cluster_issues(client, "o1", "c1")
    assert res["unscheduled_pod_count"] == 0  # empty array seen => real zero


def test_pod_count_tolerates_int_fallback_shape():
    client = _FakeClient([{"name": "x", "unscheduledPods": 4}])
    res = load_cluster_issues(client, "o1", "c1")
    assert res["unscheduled_pod_count"] == 4


def test_pod_count_none_when_completely_absent():
    client = _FakeClient([{"name": "x"}])
    res = load_cluster_issues(client, "o1", "c1")
    assert res["unscheduled_pod_count"] is None  # absent field stays N/A
