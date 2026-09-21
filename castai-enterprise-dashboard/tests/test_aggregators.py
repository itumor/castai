"""Compatibility shim: the aggregation suite lives in tests/test_aggregations.py
(owned filename). Runbooks that invoke ``pytest tests/test_aggregators.py``
still get a green, import-checked suite from this path."""

from __future__ import annotations

from data import aggregators


def test_aggregation_module_surface():
    for name in (
        "sum_or_na",
        "weighted_ratio",
        "enterprise_kpis",
        "cost_by_organization",
        "trend_from_org_report",
    ):
        assert callable(getattr(aggregators, name))


def test_enterprise_kpis_key_contract():
    kpi = aggregators.enterprise_kpis(None)
    assert set(kpi) == {
        "organizations",
        "clusters",
        "nodes_total",
        "monthly_cost",
        # ADR v2 R8 renames (v1: cpu_efficiency / memory_efficiency)
        "cpu_utilization_pct",
        "memory_utilization_pct",
        # v2 request-efficiency + NA-coverage ratios
        "cpu_request_efficiency_pct",
        "memory_request_efficiency_pct",
        "na_coverage_pct",
        # savings: NET headline + v2 trio (ADR R5)
        "potential_savings_monthly",
        "potential_savings_pct",
        "gross_savings_opportunity",
        "headroom_savings",
        "headroom_clusters",
        "clusters_with_positive_savings",
        # v2 waste totals (USD/window)
        "waste_cpu_usd",
        "waste_ram_usd",
        "waste_storage_usd",
        "waste_total_usd",
        "spot_coverage",
        "wa_coverage",
        "clusters_with_unscheduled_pods",
        "unschedulable_pods_total",
        "orgs_unavailable",
    }
