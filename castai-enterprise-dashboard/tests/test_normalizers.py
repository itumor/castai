"""Tests for data/normalizers.py — self-contained wire-shape fixtures only.

Fixtures mirror the real wire shapes documented in docs/api-matrix.md:
  §2.1 external-clusters items[] / §3.1 organization/clusters/summary items[] /
  §3.6 organization/overview clusters[] / §7.2 WA clusterAgentStatuses[] status.
All cost-report numerics are JSON strings (proto3 idiom) by design.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from data.normalizers import (
    EXTRA_COLUMNS,
    HOURS_PER_MONTH,
    TIER2_SENTINEL,
    WA_NOT_INSTALLED,
    agent_health_value,
    build_fleet_row,
    kubernetes_version_short,
    normalize_cluster_item,
    parse_number,
    wa_display,
)
from services.cluster_service import FLEET_COLUMNS

FETCHED = "2026-09-21T12:00:00Z"
ORG = {"organization_id": "org-1", "organization_name": "Org One"}


# ---------------------------------------------------------------- fixtures

def make_cluster_item(**overrides):
    item = {
        "id": "c-1",
        "name": "dev-vlab-cluster",
        "organizationId": "org-1",
        "providerType": "eks",
        "region": {"name": "eu-central-1", "displayName": "EU (Frankfurt)"},
        "status": "ready",
        "agentStatus": "online",
        "kubernetesVersion": "1.29",
        "isPhase2": True,
        "createdAt": "2025-11-01T00:00:00Z",
        "agentSnapshotReceivedAt": "2026-09-21T11:58:00Z",
    }
    item.update(overrides)
    return item


def make_summary_item(**overrides):
    item = {
        "clusterId": "c-1",
        "nodeCountOnDemand": "2",
        "nodeCountSpot": "8",
        "nodeCountOnDemandCastai": "1",
        "nodeCountSpotCastai": "6",
        "nodeCountSpotFallbackCastai": "1",
        "unknownNodeCount": "3",
        "cpuProvisionedOnDemand": "4",
        "cpuProvisionedSpot": "32",
        "cpuProvisionedSpotFallback": "2.5",
        "cpuAllocatableOnDemand": "3.5",
        "cpuAllocatableSpot": "30",
        "cpuAllocatableSpotFallback": "2",
        "cpuRequestedOnDemand": "1",
        "cpuRequestedSpot": "10",
        "cpuRequestedSpotFallback": "0.5",
        "cpuUsed": "12.5",
        "ramProvisionedOnDemand": "32",
        "ramProvisionedSpot": "128",
        "ramProvisionedSpotFallback": "8",
        "ramAllocatableOnDemand": "30",
        "ramAllocatableSpot": "120",
        "ramAllocatableSpotFallback": "7",
        "ramRequestedOnDemand": "8",
        "ramRequestedSpot": "40",
        "ramRequestedSpotFallback": "2",
        "ramUsed": "50",
        "costHourlyOnDemand": "0.40",
        "costHourlySpot": "1.10",
        "costHourlySpotFallback": "0.10",
        "podCount": "120",
        "unschedulablePodCount": "3",
        "clusterScore": "0.91",
        # v2 storage block (string numerics; storageRequested = ACTIVE claims trap)
        "storageProvisioned": "1000",
        "storageClaimed": "620",
        "storageRequested": "500",
        "storageCostHourly": "0.08",
    }
    item.update(overrides)
    return item


def make_overview_item(**overrides):
    item = {
        "clusterId": "c-1",
        "clusterName": "dev-vlab-cluster",
        "provider": "eks",
        "region": "eu-central-1",
        "kubernetesVersion": "1.29",
        "state": "CLUSTER_STATE_OPTIMIZED",
        "costHourly": "1.60",
        "optimalCostHourly": "1.20",
        "sources": [{"source": "agent", "lastCollectedAt": "2026-09-21T11:59:00Z"}],
        "primarySource": "agent",
    }
    item.update(overrides)
    return item


# ---------------------------------------------------------------- parse_number

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("12.5", 12.5),          # proto3 string numeric
        ("0", 0.0),              # returned true zero stays zero
        (" 3.25 ", 3.25),        # whitespace tolerated
        ("1e3", 1000.0),         # scientific notation is legitimate wire data
        (7, 7.0),                # int
        (2.5, 2.5),              # float
        (0, 0.0),                # numeric zero stays zero
    ],
)
def test_parse_number_valid(raw, expected):
    assert parse_number(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [None, "", "   ", "abc", "--", "N/A", "nan", "inf", "-inf", True, False, pd.NA],
)
def test_parse_number_invalid_returns_none(raw):
    # booleans are flags, not measurements; non-finite and garbage rejected.
    assert parse_number(raw) is None


# ---------------------------------------------------------------- normalize_cluster_item

def test_normalize_cluster_item_maps_wire_fields():
    c = normalize_cluster_item("org-1", "Org One", make_cluster_item())
    assert c.organization_id == "org-1"
    assert c.organization_name == "Org One"
    assert c.cluster_id == "c-1"
    assert c.cluster_name == "dev-vlab-cluster"
    assert c.provider == "eks"          # <- providerType
    assert c.region == "eu-central-1"   # <- region.name (canonical)
    assert c.status == "ready"


def test_normalize_cluster_item_defensive_missing_fields():
    c = normalize_cluster_item("org-1", "Org One", {"id": "c-9"})
    assert c.cluster_id == "c-9"
    assert c.provider == "" and c.region == "" and c.status == ""
    c_none = normalize_cluster_item("org-1", "Org One", None)
    assert c_none.cluster_id == "" and c_none.organization_id == "org-1"


# ---------------------------------------------------------------- build_fleet_row

def test_build_fleet_row_full_join():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(),
        summary_item=make_summary_item(),
        overview_item=make_overview_item(),
        wa_status="AGENT_STATUS_RUNNING",
        fetched_at=FETCHED,
    )
    # exact contract keys: FLEET_COLUMNS first, then approved extras
    assert list(row.keys()) == FLEET_COLUMNS + EXTRA_COLUMNS

    # identity & inventory
    assert row["organization_id"] == "org-1"
    assert row["organization_name"] == "Org One"
    assert row["cluster_id"] == "c-1"
    assert row["cluster_name"] == "dev-vlab-cluster"
    assert row["provider"] == "eks"
    assert row["region"] == "eu-central-1"
    assert row["status"] == "ready"
    assert row["agent_status"] == "online"
    assert row["kubernetes_version"] == "1.29"

    # CPU: Σ over the three lifecycles, string numerics parsed ("12.5" etc.)
    assert row["cpu_provisioned"] == pytest.approx(4 + 32 + 2.5)
    assert row["cpu_allocatable"] == pytest.approx(3.5 + 30 + 2)
    assert row["cpu_requested"] == pytest.approx(1 + 10 + 0.5)
    assert row["cpu_used"] == pytest.approx(12.5)
    # ADR v2 R8 rename: same value as the v1 cpu_efficiency golden (12.5/35.5)
    assert row["cpu_utilization_pct"] == pytest.approx(12.5 / 35.5)

    # RAM unit handling: ClusterSummary is already GiB — pass-through, no scaling.
    assert row["memory_provisioned_gib"] == pytest.approx(32 + 128 + 8)
    assert row["memory_allocatable_gib"] == pytest.approx(30 + 120 + 7)
    assert row["memory_requested_gib"] == pytest.approx(8 + 40 + 2)
    assert row["memory_used_gib"] == pytest.approx(50)
    assert row["memory_utilization_pct"] == pytest.approx(50 / 157)  # was memory_efficiency

    # nodes: total = on_demand + spot; unknownNodeCount EXCLUDED from total
    assert row["nodes_total"] == 10
    assert row["nodes_spot"] == 8
    assert row["nodes_on_demand"] == 2
    assert row["nodes_fallback"] == 1

    # money: Σ costHourly*; monthly = x730 run-rate
    assert row["cost_hourly"] == pytest.approx(1.60)
    assert row["monthly_cost"] == pytest.approx(1.60 * HOURS_PER_MONTH)

    # savings: pairwise from the overview item's own costHourly/optimalCostHourly
    assert row["potential_savings_hourly"] == pytest.approx(0.40)
    assert row["potential_savings_percentage"] == pytest.approx(0.25)

    # WA pass-through; sentinels; resilience; freshness
    assert row["workload_autoscaler_status"] == "AGENT_STATUS_RUNNING"
    assert row["node_autoscaler_status"] == TIER2_SENTINEL == "T2"
    assert row["problematic_nodes"] == TIER2_SENTINEL
    assert row["problematic_workloads"] == TIER2_SENTINEL
    assert row["unschedulable_pods"] == 3
    assert row["data_status"] == "ok"
    assert isinstance(row["last_updated"], pd.Timestamp)
    assert str(row["last_updated"].tz) == "UTC"


def test_build_fleet_row_extras_present_when_payloads_carry_them():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(),
        summary_item=make_summary_item(),
        overview_item=make_overview_item(),
        wa_status="AGENT_STATUS_RUNNING",
        fetched_at=FETCHED,
    )
    assert row["reporting_state"] == "CLUSTER_STATE_OPTIMIZED"
    assert row["optimal_cost_hourly"] == pytest.approx(1.20)
    assert row["is_phase2"] is True
    assert row["pod_count"] == 120
    assert row["nodes_unknown"] == 3
    assert row["potential_savings"] == pytest.approx(0.40 * HOURS_PER_MONTH)


def test_build_fleet_row_extras_na_safe_when_payloads_missing():
    row = build_fleet_row(
        **ORG,
        cluster_item={"id": "c-9", "name": "only-inventory"},  # no isPhase2
        summary_item=None,
        overview_item=None,
        wa_status=None,
        fetched_at=FETCHED,
    )
    for key in EXTRA_COLUMNS:
        assert key in row
    # Every payload-derived EXTRA stays NA (missing never becomes 0) ...
    for key in set(EXTRA_COLUMNS) - DETERMINISTIC_EXTRAS - FRESHNESS_EXTRAS:
        assert pd.isna(row[key]), key
    # ... freshness falls back to the sweep ts when the agent snapshot is absent:
    assert row["latest_sync_time"] == pd.Timestamp(FETCHED)
    assert pd.notna(row["snapshot_age_minutes"])
    assert row["data_freshness_status"] in {"fresh", "stale"}  # wall-clock dependent
    # ... while the derived constants stay DETERMINISTIC (never fabricated data):
    assert row["agent_health"] == "Unknown"                # no status/agent_status
    assert row["is_ghost"] is False                        # reporting_state absent -> not ghost
    assert row["kubernetes_version_known"] is False        # raw version absent
    assert row["wa_display"] == "Not installed"            # payload arrived (default), no row


def test_build_fleet_row_missing_summary_keeps_na():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(),
        summary_item=None,
        overview_item=make_overview_item(),
        wa_status="AGENT_STATUS_UNKNOWN",
        fetched_at=FETCHED,
    )
    for col in (
        "cpu_provisioned", "cpu_allocatable", "cpu_requested", "cpu_used",
        "cpu_utilization_pct", "memory_provisioned_gib", "memory_allocatable_gib",
        "memory_requested_gib", "memory_used_gib", "memory_utilization_pct",
        "nodes_total", "nodes_spot", "nodes_on_demand", "nodes_fallback",
        "cost_hourly", "monthly_cost", "unschedulable_pods",
    ):
        assert pd.isna(row[col]), col
    # savings still come from the overview item (independent of summary)
    assert row["potential_savings_hourly"] == pytest.approx(0.40)
    assert row["data_status"] == "partial"


def test_build_fleet_row_missing_overview_keeps_savings_na_and_status_ok():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(),
        summary_item=make_summary_item(),
        overview_item=None,
        wa_status=None,
        fetched_at=FETCHED,
    )
    assert pd.isna(row["potential_savings_hourly"])
    assert pd.isna(row["potential_savings_percentage"])
    assert row["data_status"] == "ok"  # summary is THE fleet source
    assert row["workload_autoscaler_status"] == WA_NOT_INSTALLED == "Not installed"


def test_build_fleet_row_data_status_matrix():
    base = dict(fetched_at=FETCHED)
    full = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                           summary_item=make_summary_item(),
                           overview_item=make_overview_item(),
                           wa_status="AGENT_STATUS_RUNNING", **base)
    assert full["data_status"] == "ok"
    summary_only = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                                   summary_item=make_summary_item(), **base)
    assert summary_only["data_status"] == "ok"
    overview_and_wa = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                                      overview_item=make_overview_item(),
                                      wa_status="AGENT_STATUS_UNKNOWN", **base)
    assert overview_and_wa["data_status"] == "partial"
    wa_only = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                              wa_status="AGENT_STATUS_UNKNOWN", **base)
    assert wa_only["data_status"] == "partial"
    inventory_only = build_fleet_row(**ORG, cluster_item=make_cluster_item(), **base)
    assert inventory_only["data_status"] == "unavailable"


def test_build_fleet_row_unavailable_keeps_inventory_and_na():
    row = build_fleet_row(
        organization_id="org-dead",
        organization_name="Dead Org",
        cluster_item=make_cluster_item(),
        summary_item=None,
        overview_item=None,
        wa_status=None,
        fetched_at=FETCHED,
    )
    assert row["organization_id"] == "org-dead"  # stamped from REQUEST scope
    assert row["cluster_id"] == "c-1"
    assert row["status"] == "ready"
    assert row["data_status"] == "unavailable"
    assert pd.isna(row["cost_hourly"])
    assert pd.isna(row["potential_savings_hourly"])
    assert row["workload_autoscaler_status"] == WA_NOT_INSTALLED
    assert row["node_autoscaler_status"] == TIER2_SENTINEL


def test_build_fleet_row_kubernetes_version_nullable():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(kubernetesVersion=None),
        summary_item=make_summary_item(),
        fetched_at=FETCHED,
    )
    assert pd.isna(row["kubernetes_version"])


def test_build_fleet_row_partial_summary_uses_min_count_semantics():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            cpuProvisionedSpot=None, cpuProvisionedSpotFallback="", cpuProvisionedOnDemand="4",
            nodeCountSpot=None,
        ),
        fetched_at=FETCHED,
    )
    # present lifecycle values still sum (sparse != 0)
    assert row["cpu_provisioned"] == pytest.approx(4)
    # nodes_total = Σ present = on_demand only
    assert row["nodes_total"] == 2


def test_build_fleet_row_zero_denominator_efficiency_is_na_not_zero():
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            cpuAllocatableOnDemand="0", cpuAllocatableSpot="0",
            cpuAllocatableSpotFallback="0", cpuUsed="0",
        ),
        fetched_at=FETCHED,
    )
    assert row["cpu_allocatable"] == 0
    assert pd.isna(row["cpu_utilization_pct"])  # 0/0 -> NA, never 0%


def test_build_fleet_row_duplicate_names_distinct_rows():
    args = dict(summary_item=make_summary_item(), fetched_at=FETCHED)
    row_a = build_fleet_row(organization_id="org-1", organization_name="Org One",
                            cluster_item=make_cluster_item(), **args)
    row_b = build_fleet_row(organization_id="org-2", organization_name="Org Two",
                            cluster_item=make_cluster_item(id="c-2"), **args)
    assert row_a["cluster_name"] == row_b["cluster_name"]  # not unique — verified live
    assert (row_a["organization_id"], row_a["cluster_id"]) == ("org-1", "c-1")
    assert (row_b["organization_id"], row_b["cluster_id"]) == ("org-2", "c-2")
    assert row_a["organization_name"] != row_b["organization_name"]


# ================================================================ v2 surface

# Derived-constant EXTRAS that are intentionally NEVER pd.NA (deterministic
# per row shape; everything else in EXTRA_COLUMNS is payload-driven and NA-safe).
DETERMINISTIC_EXTRAS = {
    "agent_health", "is_ghost", "kubernetes_version_known", "wa_display",
}

# Freshness trio: NA only when BOTH the agent snapshot AND the sweep ts are
# absent (sweep ts acts as the documented fallback).
FRESHNESS_EXTRAS = {"latest_sync_time", "snapshot_age_minutes", "data_freshness_status"}

EXPECTED_EXTRA_COLUMNS = [
    "reporting_state", "optimal_cost_hourly", "is_phase2", "pod_count",
    "nodes_unknown", "cluster_score", "potential_savings", "overview_cost_hourly",
    "cpu_request_efficiency_pct", "memory_request_efficiency_pct",
    "na_managed_nodes", "na_coverage_pct",
    "storage_provisioned_gib", "storage_claimed_gib",
    "storage_active_claimed_gib", "storage_commit_pct", "storage_cost_hourly",
    "waste_cpu_usd", "waste_ram_usd", "waste_storage_usd", "waste_total_usd",
    "wa_display", "wa_agent_version", "wa_version_drift",
    "wa_in_place_resize", "wa_last_reported",
    "agent_health",
    "latest_sync_time", "snapshot_age_minutes", "data_freshness_status",
    "is_ghost",
    "has_positive_savings_opportunity", "has_negative_savings",
    "kubernetes_version_short", "kubernetes_version_known",
    # v2-OPS wave (ADR v2 R11): overprovisioning trio, provider coverage,
    # org-level rebalancing (NA at row level until cluster-resolved).
    "overprovisioned_cpu_pct", "overprovisioned_ram_pct", "overprovisioned_storage_pct",
    "nodes_provider_managed",
    "rebalance_schedule_name", "rebalance_last_trigger", "rebalance_next_trigger",
]

NOW = datetime(2026, 9, 21, 12, 0, 0, tzinfo=timezone.utc)  # pinned wall clock


@pytest.fixture
def pin_now(monkeypatch):
    monkeypatch.setattr("data.normalizers._utc_now", lambda: NOW)


def test_extra_columns_literal_contract():
    # THE contract the UI builder consumes — pin it byte-for-byte.
    assert EXTRA_COLUMNS == EXPECTED_EXTRA_COLUMNS


# ------------------------------------------------- request efficiency (R8)

def test_request_efficiency_goldens(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), summary_item=make_summary_item(),
        fetched_at=FETCHED,
    )
    # requested: cpu = 1+10+0.5 = 11.5, ram = 8+40+2 = 50
    assert row["cpu_request_efficiency_pct"] == pytest.approx(12.5 / 11.5)
    assert row["memory_request_efficiency_pct"] == pytest.approx(50 / 50)


def test_request_efficiency_zero_requested_is_na_not_zero(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            cpuRequestedOnDemand="0", cpuRequestedSpot="0", cpuRequestedSpotFallback="0",
            ramRequestedOnDemand="0", ramRequestedSpot="0", ramRequestedSpotFallback="0",
        ),
        fetched_at=FETCHED,
    )
    assert row["cpu_requested"] == 0
    assert row["memory_requested_gib"] == 0
    assert pd.isna(row["cpu_request_efficiency_pct"])     # "no requests", never 0%
    assert pd.isna(row["memory_request_efficiency_pct"])


def test_request_efficiency_missing_inputs_stay_na(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(cpuRequestedSpot=None, cpuUsed=None),
        fetched_at=FETCHED,
    )
    assert pd.isna(row["cpu_request_efficiency_pct"])  # used absent -> NA


# ------------------------------------------------------- NA coverage (R6)

def test_na_managed_nodes_min_count_sum_and_coverage(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), summary_item=make_summary_item(),
        fetched_at=FETCHED,
    )
    assert row["na_managed_nodes"] == pytest.approx(1 + 6 + 1)  # Castai counters
    assert row["na_coverage_pct"] == pytest.approx(8 / 10)      # nodes_total = 2+8


def test_na_managed_nodes_all_counters_absent_is_na(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            nodeCountOnDemandCastai=None, nodeCountSpotCastai=None,
            nodeCountSpotFallbackCastai=None,
        ),
        fetched_at=FETCHED,
    )
    assert pd.isna(row["na_managed_nodes"])   # min_count=1: not a measured 0
    assert pd.isna(row["na_coverage_pct"])


def test_na_coverage_zero_total_nodes_is_na(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(nodeCountOnDemand="0", nodeCountSpot="0"),
        fetched_at=FETCHED,
    )
    assert row["nodes_total"] == 0
    assert pd.isna(row["na_coverage_pct"])  # undefined, never 0%


# ------------------------------------------------------------ storage block

def test_storage_passthrough_commit_and_trap_column(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), summary_item=make_summary_item(),
        fetched_at=FETCHED,
    )
    assert row["storage_provisioned_gib"] == pytest.approx(1000)
    assert row["storage_claimed_gib"] == pytest.approx(620)
    # TRAP: wire `storageRequested` ships as ACTIVE claims (accessed by a
    # workload) — never as a scheduler-style request column.
    assert row["storage_active_claimed_gib"] == pytest.approx(500)
    assert "storage_requested" not in row
    assert row["storage_cost_hourly"] == pytest.approx(0.08)
    assert row["storage_commit_pct"] == pytest.approx(620 / 1000)


def test_storage_commit_zero_provisioned_is_na(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(storageProvisioned="0", storageClaimed="0"),
        fetched_at=FETCHED,
    )
    assert pd.isna(row["storage_commit_pct"])  # 0/0 -> NA
    assert row["storage_claimed_gib"] == 0     # measured zero stays data


# ------------------------------------------------------------- waste (R2)

def make_efficiency_item(**overrides):
    item = {"clusterId": "c-1", "wasted": {"cpu": 12.5, "ram": 7.25, "storage": 1.5}}
    item.update(overrides)
    return item


def test_waste_columns_from_efficiency_item_doubles(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), summary_item=make_summary_item(),
        efficiency_item=make_efficiency_item(), fetched_at=FETCHED,
    )
    assert row["waste_cpu_usd"] == pytest.approx(12.5)      # JSON double
    assert row["waste_ram_usd"] == pytest.approx(7.25)
    assert row["waste_storage_usd"] == pytest.approx(1.5)
    assert row["waste_total_usd"] == pytest.approx(21.25)


def test_waste_absent_efficiency_item_is_all_na(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), summary_item=make_summary_item(),
        efficiency_item=None, fetched_at=FETCHED,
    )
    for col in ("waste_cpu_usd", "waste_ram_usd", "waste_storage_usd", "waste_total_usd"):
        assert pd.isna(row[col]), col


def test_waste_total_min_count_never_rebased(pin_now):
    # one waste class absent -> total sums the present classes only
    row = build_fleet_row(
        **ORG, efficiency_item=make_efficiency_item(wasted={"cpu": 5.0, "ram": 2.0}),
        fetched_at=FETCHED,
    )
    assert row["waste_total_usd"] == pytest.approx(7.0)
    assert pd.isna(row["waste_storage_usd"])
    # all classes absent -> total NA (never silently re-based from cost fields)
    row2 = build_fleet_row(
        **ORG, efficiency_item=make_efficiency_item(wasted={}), fetched_at=FETCHED,
    )
    assert pd.isna(row2["waste_total_usd"])


# ------------------------------------------------------ WA display (Agent 6)

@pytest.mark.parametrize(
    "status, entry, expected",
    [
        ("AGENT_STATUS_RUNNING", {"currentVersion": "v1"}, "Running"),
        ("AGENT_STATUS_UNKNOWN", {"currentVersion": "v1"}, "Installed (status unknown)"),
        ("AGENT_STATUS_UNKNOWN", {"installedAt": "2026-01-01T00:00:00Z"}, "Installed (status unknown)"),
        ("AGENT_STATUS_UNKNOWN", {"currentVersion": "", "installedAt": ""}, "Unknown"),
        ("AGENT_STATUS_UNKNOWN", {}, "Unknown"),  # stub row
        ("AGENT_STATUS_INVALID", {"currentVersion": "v1"}, "Invalid"),
        (None, {}, "Not installed"),              # payload arrived, no row
    ],
)
def test_wa_display_mapping(status, entry, expected):
    assert wa_display(status, entry) == expected


def test_wa_display_failed_org_call_is_pd_na():
    # MAJOR-3 stands: wa_entry None (org WA payload failed) -> pd.NA.
    assert pd.isna(wa_display("AGENT_STATUS_RUNNING", None))
    assert pd.isna(wa_display(None, None))


def test_wa_entry_family_columns(pin_now):
    entry = {
        "clusterId": "c-1", "status": "AGENT_STATUS_UNKNOWN",
        "currentVersion": "v0.35.2", "latestVersion": "v0.35.3",
        "installedAt": "2026-01-05T10:00:00Z", "updatedAt": "2026-09-12T08:30:00Z",
        "inPlaceResizeEnabled": True,
    }
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), wa_entry=entry, fetched_at=FETCHED,
    )
    assert row["workload_autoscaler_status"] == "AGENT_STATUS_UNKNOWN"  # raw col unchanged
    assert row["wa_display"] == "Installed (status unknown)"
    assert row["wa_agent_version"] == "v0.35.2"
    assert row["wa_version_drift"] is True      # current != latest
    assert row["wa_in_place_resize"] is True
    assert row["wa_last_reported"] == pd.Timestamp("2026-09-12T08:30:00Z")


def test_wa_entry_no_drift_and_na_fields(pin_now):
    entry = {
        "clusterId": "c-1", "status": "AGENT_STATUS_RUNNING",
        "currentVersion": "v0.35.3", "latestVersion": "v0.35.3",
    }
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), wa_entry=entry, fetched_at=FETCHED,
    )
    assert row["wa_display"] == "Running"
    assert row["wa_version_drift"] is False
    assert pd.isna(row["wa_in_place_resize"])   # absent from payload -> NA
    assert pd.isna(row["wa_last_reported"])     # no updatedAt -> NaT


def test_wa_entry_missing_versions_drift_na(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        wa_entry={"clusterId": "c-1", "status": "AGENT_STATUS_RUNNING"},
        fetched_at=FETCHED,
    )
    assert pd.isna(row["wa_version_drift"])  # both versions absent -> NA


def test_wa_unavailable_hides_display_family(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        wa_status=None, wa_available=False, fetched_at=FETCHED,
    )
    assert pd.isna(row["workload_autoscaler_status"])  # MAJOR-3
    assert pd.isna(row["wa_display"])                   # MAJOR-3 on the display twin


def test_wa_status_kwarg_backward_compatible(pin_now):
    # legacy callers passing ONLY wa_status still map correctly (ma entry {})
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        wa_status="AGENT_STATUS_RUNNING", fetched_at=FETCHED,
    )
    assert row["wa_display"] == "Running"
    assert pd.isna(row["wa_agent_version"])


# ---------------------------------------------------- agent_health (Agent 7)

@pytest.mark.parametrize(
    "status, agent_status, snap_age, expected",
    [
        ("failed", "online", 1.0, "Failed"),
        ("hibernated", "online", 2.0, "Hibernated"),
        ("hibernating", None, None, "Hibernated"),
        ("resuming", "disconnected", None, "Hibernated"),  # lifecycle outranks link state
        ("connecting", None, None, "Connecting"),
        ("ready", "waiting-connection", None, "Connecting"),
        ("ready", "disconnected", None, "Disconnected"),
        ("ready", "disconnecting", None, "Disconnected"),
        ("ready", "non-responding", None, "Non-responding"),
        ("warning", "online", 1.0, "Non-responding"),      # degraded family
        ("ready", "online", 1.0, "Connected"),
        ("ready", "online", None, "Connected"),            # no snapshot ts: never stale
        ("ready", "online", 45.0, "Non-responding"),       # stale snapshot
        ("ready", "online", 30.0, "Non-responding"),       # boundary: >=30 is stale
        ("ready", None, None, "Unknown"),
        (None, None, None, "Unknown"),
        ("ready", "some-new-wire-value", None, "Unknown"), # forward-compatible
    ],
)
def test_agent_health_row_shapes(status, agent_status, snap_age, expected):
    assert agent_health_value(status, agent_status, snap_age) == expected


def test_agent_health_column_uses_snapshot_age(pin_now):
    # snapshot 70 min old at the pinned clock -> stale -> Non-responding
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(
            agentSnapshotReceivedAt="2026-09-21T10:50:00Z", agentStatus="online",
        ),
        fetched_at=FETCHED,
    )
    assert row["agent_health"] == "Non-responding"
    row_fresh = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(
            agentSnapshotReceivedAt="2026-09-21T11:58:00Z", agentStatus="online",
        ),
        fetched_at=FETCHED,
    )
    assert row_fresh["agent_health"] == "Connected"


# ----------------------------------------------------------- freshness (R5)

def test_freshness_fresh_from_snapshot(pin_now):
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(agentSnapshotReceivedAt="2026-09-21T11:58:00Z"),
        fetched_at=FETCHED,
    )
    assert row["latest_sync_time"] == pd.Timestamp("2026-09-21T11:58:00Z")
    assert row["snapshot_age_minutes"] == pytest.approx(2.0)
    assert row["data_freshness_status"] == "fresh"
    # last_updated stays the sweep ts — untouched by the new columns
    assert row["last_updated"] == pd.Timestamp(FETCHED)


def test_freshness_boundary_30_minutes_is_stale(pin_now):
    row = build_fleet_row(
        **ORG,
        cluster_item=make_cluster_item(agentSnapshotReceivedAt="2026-09-21T11:30:00Z"),
        fetched_at=FETCHED,
    )
    assert row["snapshot_age_minutes"] == pytest.approx(30.0)
    assert row["data_freshness_status"] == "stale"


def test_freshness_falls_back_to_sweep_ts(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(agentSnapshotReceivedAt=None),
        fetched_at="2026-09-21T11:00:00Z",  # sweep ts 60 min old
    )
    assert row["latest_sync_time"] == pd.Timestamp("2026-09-21T11:00:00Z")
    assert row["snapshot_age_minutes"] == pytest.approx(60.0)
    assert row["data_freshness_status"] == "stale"


def test_freshness_unknown_when_both_missing(pin_now):
    row = build_fleet_row(**ORG, cluster_item=make_cluster_item(agentSnapshotReceivedAt=None),
                          fetched_at=None)
    assert pd.isna(row["latest_sync_time"])
    assert pd.isna(row["snapshot_age_minutes"])
    assert row["data_freshness_status"] == "unknown"


# --------------------------------------------------------------- ghosts (R5)

@pytest.mark.parametrize(
    "state, expected",
    [
        ("CLUSTER_STATE_UNSPECIFIED", True),   # audit #10: exactly these rows
        ("CLUSTER_STATE_OPTIMIZED", False),
        ("CLUSTER_STATE_DISCOVERED", False),
        (None, False),
        ("cluster_state_unspecified", False),  # case-exact wire enum, no fuzzing
    ],
)
def test_is_ghost_exact_reporting_state(state, expected, pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        overview_item=make_overview_item(state=state), fetched_at=FETCHED,
    )
    assert row["is_ghost"] is expected
    if state is None:
        assert pd.isna(row["reporting_state"])
    else:
        assert row["reporting_state"] == state


# ------------------------------------------------- savings polarity (finops)

def test_savings_polarity_booleans(pin_now):
    pos = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                          overview_item=make_overview_item(costHourly="1.60", optimalCostHourly="1.20"),
                          fetched_at=FETCHED)
    assert pos["has_positive_savings_opportunity"] is True
    assert pos["has_negative_savings"] is False
    neg = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                          overview_item=make_overview_item(costHourly="1.60", optimalCostHourly="2.00"),
                          fetched_at=FETCHED)
    assert neg["potential_savings_hourly"] == pytest.approx(-0.40)  # never clamped
    assert neg["has_positive_savings_opportunity"] is False
    assert neg["has_negative_savings"] is True
    flat = build_fleet_row(**ORG, cluster_item=make_cluster_item(),
                           overview_item=make_overview_item(costHourly="1.60", optimalCostHourly="1.60"),
                           fetched_at=FETCHED)
    assert flat["has_positive_savings_opportunity"] is False  # 0 is neither
    assert flat["has_negative_savings"] is False


def test_savings_polarity_na_when_savings_absent(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        overview_item=make_overview_item(optimalCostHourly=None), fetched_at=FETCHED,
    )
    assert pd.isna(row["potential_savings_hourly"])
    assert pd.isna(row["has_positive_savings_opportunity"])  # NA stays NA
    assert pd.isna(row["has_negative_savings"])


# ----------------------------------------------------- k8s version short (R5)

@pytest.mark.parametrize(
    "raw, short, known",
    [
        ("v1.34.9", "1.34", True),     # AKS patch flavor with 'v' prefix
        ("1.35", "1.35", True),        # minor-only flavor
        ("1.29.3", "1.29", True),
        ("v1.30.1-gke.100", "1.30", True),
        ("garbage", None, False),
        ("1", None, False),
        ("", None, False),
        (None, None, False),
    ],
)
def test_kubernetes_version_short(raw, short, known):
    out_short, out_known = kubernetes_version_short(raw)
    assert (pd.isna(out_short) if short is None else out_short == short)
    assert out_known is known


def test_kubernetes_version_columns_keep_raw(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(kubernetesVersion="v1.34.9"),
        fetched_at=FETCHED,
    )
    assert row["kubernetes_version"] == "v1.34.9"      # raw column kept verbatim
    assert row["kubernetes_version_short"] == "1.34"
    assert row["kubernetes_version_known"] is True


def test_cluster_score_parses_string_to_float(pin_now):
    # summary.clusterScore is a proto3 string numeric (spec: "Cluster score.")
    row = build_fleet_row(
        organization_id="o1", organization_name="Org One",
        summary_item={"clusterId": "c1", "clusterScore": "87.5"},
    )
    assert row["cluster_score"] == pytest.approx(87.5)


def test_cluster_score_absent_stays_na(pin_now):
    row = build_fleet_row(organization_id="o1", organization_name="Org One",
                          summary_item={"clusterId": "c1"})
    assert pd.isna(row["cluster_score"])  # missing -> N/A, never 0


# --------------------------------------------- v2-OPS overprovisioning trio
def _efficiency_item(**overrides):
    item = {
        "clusterId": "c-1",
        "wasted": {"cpu": 10.0, "ram": 5.0, "storage": 1.0},
        "cpuOverprovisionedPercent": 42.5,
        "ramOverprovisionedPercent": 31.0,
        "storageOverprovisionedPercent": 0.0,
    }
    item.update(overrides)
    return item


def test_overprovisioned_trio_percent_passthrough(pin_now):
    """FLAT JSON doubles ride the wire on the 0–100 scale — passed through
    verbatim (NOT converted to a 0–1 ratio); measured-zero stays 0."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        efficiency_item=_efficiency_item(), fetched_at=FETCHED,
    )
    assert row["overprovisioned_cpu_pct"] == pytest.approx(42.5)
    assert row["overprovisioned_ram_pct"] == pytest.approx(31.0)
    assert row["overprovisioned_storage_pct"] == pytest.approx(0.0)  # zero is data
    # waste join untouched
    assert row["waste_total_usd"] == pytest.approx(16.0)


def test_overprovisioned_trio_absent_stays_na(pin_now):
    """Efficiency row present but percent fields missing -> NA, never 0;
    no efficiency row at all -> NA too."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        efficiency_item={"clusterId": "c-1", "wasted": {"cpu": 1.0}},
        fetched_at=FETCHED,
    )
    assert pd.isna(row["overprovisioned_cpu_pct"])
    assert pd.isna(row["overprovisioned_ram_pct"])
    assert pd.isna(row["overprovisioned_storage_pct"])
    row_none = build_fleet_row(**ORG, cluster_item=make_cluster_item(), fetched_at=FETCHED)
    assert pd.isna(row_none["overprovisioned_cpu_pct"])


def test_overprovisioned_trio_string_and_garbage_tolerance(pin_now):
    """Defensive: string numerics parse; garbage/non-finite -> NA."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        efficiency_item=_efficiency_item(
            cpuOverprovisionedPercent="12.5",
            ramOverprovisionedPercent="not-a-number",
        ),
        fetched_at=FETCHED,
    )
    assert row["overprovisioned_cpu_pct"] == pytest.approx(12.5)
    assert pd.isna(row["overprovisioned_ram_pct"])


# --------------------------------------------------- v2-OPS provider coverage
def test_nodes_provider_managed_derivation(pin_now):
    """nodes_total=10 (2+8), na_managed=8 (1+6+1) -> provider-managed 2."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), summary_item=make_summary_item(),
        fetched_at=FETCHED,
    )
    assert row["nodes_total"] == pytest.approx(10.0)
    assert row["na_managed_nodes"] == pytest.approx(8.0)
    assert row["nodes_provider_managed"] == pytest.approx(2.0)


def test_nodes_provider_managed_measured_zero_stays_zero(pin_now):
    """nodes_total == na_managed -> provider-managed is a measured 0."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            nodeCountOnDemand="2", nodeCountSpot="0",
            nodeCountOnDemandCastai="2", nodeCountSpotCastai="0",
            nodeCountSpotFallbackCastai="0",
        ),
        fetched_at=FETCHED,
    )
    assert row["nodes_provider_managed"] == pytest.approx(0.0)


def test_nodes_provider_managed_negative_guard_is_na(pin_now):
    """total < managed (counter-family mismatch, e.g. fallback counted in
    managed but excluded from total) -> NA, NEVER negative-garbage."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            nodeCountOnDemand="1", nodeCountSpot="0",
            nodeCountOnDemandCastai="1", nodeCountSpotCastai="0",
            nodeCountSpotFallbackCastai="5",
        ),
        fetched_at=FETCHED,
    )
    assert row["nodes_total"] == pytest.approx(1.0)
    assert row["na_managed_nodes"] == pytest.approx(6.0)
    assert pd.isna(row["nodes_provider_managed"])


def test_nodes_provider_managed_na_when_either_side_na(pin_now):
    row_no_total = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(nodeCountOnDemand=None, nodeCountSpot=None),
        fetched_at=FETCHED,
    )
    assert pd.isna(row_no_total["nodes_total"])
    assert pd.isna(row_no_total["nodes_provider_managed"])
    row_no_managed = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        summary_item=make_summary_item(
            nodeCountOnDemandCastai=None, nodeCountSpotCastai=None,
            nodeCountSpotFallbackCastai=None,
        ),
        fetched_at=FETCHED,
    )
    assert pd.isna(row_no_managed["na_managed_nodes"])
    assert pd.isna(row_no_managed["nodes_provider_managed"])


# ------------------------------------------------------- v2-OPS rebalancing
def test_rebalance_trio_na_without_cluster_match(pin_now):
    """ADR R11: the fleet sweep cannot resolve schedule linkage (org-level
    payload only) — the trio stays NA/NaT, never invented."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(), fetched_at=FETCHED,
    )
    assert pd.isna(row["rebalance_schedule_name"])
    assert row["rebalance_last_trigger"] is pd.NaT
    assert row["rebalance_next_trigger"] is pd.NaT


def test_rebalance_trio_passthrough_when_cluster_resolved(pin_now):
    """A caller WITH a cluster-resolved match (drill-down): name passes
    through, RFC-3339 strings parse tz-aware; a missing lastTriggerAt -> NaT."""
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        rebalance_item={
            "name": "nightly-binpack",
            "nextTriggerAt": "2026-09-22T03:00:00Z",
            # lastTriggerAt absent (never triggered)
        },
        fetched_at=FETCHED,
    )
    assert row["rebalance_schedule_name"] == "nightly-binpack"
    assert row["rebalance_next_trigger"] == pd.Timestamp("2026-09-22T03:00:00Z")
    assert row["rebalance_next_trigger"].tzinfo is not None
    assert row["rebalance_last_trigger"] is pd.NaT


def test_rebalance_trio_garbage_timestamp_is_nat_never_raises(pin_now):
    row = build_fleet_row(
        **ORG, cluster_item=make_cluster_item(),
        rebalance_item={"name": "", "lastTriggerAt": "not-a-date", "nextTriggerAt": None},
        fetched_at=FETCHED,
    )
    assert pd.isna(row["rebalance_schedule_name"])   # blank name -> NA
    assert row["rebalance_last_trigger"] is pd.NaT   # garbage coerced
    assert row["rebalance_next_trigger"] is pd.NaT
