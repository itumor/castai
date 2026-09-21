"""Tests for data/aggregators.py — hand-computed golden cases, no network.

The golden case proves the aggregation law (docs/data-model.md §3):
ratio KPIs = SUM(num)/SUM(den) on pairwise-complete rows, never mean of %.
"""

from __future__ import annotations

import pandas as pd
import pytest

from data.aggregators import (
    cost_by_organization,
    enterprise_kpis,
    sum_or_na,
    trend_from_org_report,
    weighted_ratio,
)
from data.normalizers import build_fleet_row


def fleet_df(rows) -> pd.DataFrame:
    """Dict rows -> object-dtype frame, exactly how B3 assembles the fleet."""
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- sum_or_na

def test_sum_or_na_sums_present_values():
    assert sum_or_na(pd.Series([1, "2", None, pd.NA])) == pytest.approx(3.0)
    assert sum_or_na([0.5, 0.25]) == pytest.approx(0.75)
    assert sum_or_na(pd.Series([0, "0"])) == 0.0  # measured zeros count


def test_sum_or_na_all_missing_is_none():
    assert sum_or_na(pd.Series([None, pd.NA, "garbage"])) is None
    assert sum_or_na(pd.Series([], dtype="float64")) is None
    assert sum_or_na([]) is None
    assert sum_or_na(None) is None


# ---------------------------------------------------------------- weighted_ratio

def test_weighted_ratio_pairwise_complete_rows():
    df = pd.DataFrame({"used": [1.0, None, 3.0], "allocatable": [2.0, 2.0, None]})
    assert weighted_ratio(df, "used", "allocatable") == pytest.approx(0.5)


def test_weighted_ratio_respects_mask():
    df = pd.DataFrame({"used": [1.0, 10.0], "allocatable": [2.0, 100.0]})
    mask = pd.Series([True, False])
    assert weighted_ratio(df, "used", "allocatable", mask=mask) == pytest.approx(0.5)
    assert weighted_ratio(df, "used", "allocatable") == pytest.approx(11 / 102)


def test_weighted_ratio_none_paths():
    df = pd.DataFrame({"used": [1.0, 2.0], "allocatable": [0.0, 0.0]})
    assert weighted_ratio(df, "used", "allocatable") is None  # Σden == 0
    all_na = pd.DataFrame({"used": [None], "allocatable": [pd.NA]})
    assert weighted_ratio(all_na, "used", "allocatable") is None
    assert weighted_ratio(pd.DataFrame(), "used", "allocatable") is None
    assert weighted_ratio(pd.DataFrame({"a": [1]}), "used", "allocatable") is None
    assert weighted_ratio(None, "used", "allocatable") is None


def test_weighted_ratio_excludes_nonpositive_denominator_rows():
    # v2 fix (resource-metrics §4): den<=0 rows leave the PAIR-mask entirely —
    # their numerators must not stack into the numerator sum either.
    df = pd.DataFrame({"used": [1.0, 99.0, 3.0], "allocatable": [2.0, 0.0, 6.0]})
    assert weighted_ratio(df, "used", "allocatable") == pytest.approx(4.0 / 8.0)
    # den==0 AND num==0 row is excluded too, not kept as a silent 0/0 pair
    df2 = pd.DataFrame({"used": [1.0, 0.0], "allocatable": [2.0, 0.0]})
    assert weighted_ratio(df2, "used", "allocatable") == pytest.approx(0.5)
    # negative denominators are excluded by the same law
    df3 = pd.DataFrame({"used": [1.0, 5.0], "allocatable": [2.0, -8.0]})
    assert weighted_ratio(df3, "used", "allocatable") == pytest.approx(0.5)


def test_weighted_ratio_none_when_every_row_masked():
    df = pd.DataFrame({"used": [1.0, 0.0], "allocatable": [0.0, 0.0]})
    assert weighted_ratio(df, "used", "allocatable") is None  # all rows masked
    df_neg = pd.DataFrame({"used": [1.0], "allocatable": [-2.0]})
    assert weighted_ratio(df_neg, "used", "allocatable") is None


# ---------------------------------------------------------------- enterprise_kpis

def test_enterprise_kpis_ratio_of_sums_not_mean_of_percents():
    # golden: cluster A = 1 cpu @ 100% used, cluster B = 100 cpu @ 10% used
    row_a = build_fleet_row(
        organization_id="org-1", organization_name="Org One",
        cluster_item={"id": "a", "name": "tiny"},
        summary_item={
            "clusterId": "a",
            "cpuAllocatableOnDemand": "1", "cpuUsed": "1",
            "ramAllocatableOnDemand": "4", "ramUsed": "2",
            "nodeCountOnDemand": "1", "nodeCountSpot": "0",
            "costHourlyOnDemand": "10", "unschedulablePodCount": "0", "podCount": "5",
        },
        overview_item={"clusterId": "a", "costHourly": "10", "optimalCostHourly": "8",
                       "state": "CLUSTER_STATE_OPTIMIZED"},
        wa_status="AGENT_STATUS_RUNNING",
        fetched_at="2026-09-21T12:00:00Z",
    )
    row_b = build_fleet_row(
        organization_id="org-1", organization_name="Org One",
        cluster_item={"id": "b", "name": "huge"},
        summary_item={
            "clusterId": "b",
            "cpuAllocatableOnDemand": "100", "cpuUsed": "10",
            "ramAllocatableOnDemand": "100", "ramUsed": "10",
            "nodeCountOnDemand": "100", "nodeCountSpot": "25",
            "costHourlyOnDemand": "100", "unschedulablePodCount": "5", "podCount": "50",
        },
        overview_item={"clusterId": "b", "costHourly": "100", "optimalCostHourly": "50",
                       "state": "CLUSTER_STATE_DISCOVERED"},
        wa_status=None,  # Not installed
        fetched_at="2026-09-21T12:00:00Z",
    )
    # partial org: overview only (no summary) -> cost/savings cols only
    row_c = build_fleet_row(
        organization_id="org-2", organization_name="Org Two",
        cluster_item={"id": "c", "name": "no-summary"},
        overview_item={"clusterId": "c", "costHourly": "4", "optimalCostHourly": "3",
                       "state": "CLUSTER_STATE_DISCOVERED"},
        fetched_at="2026-09-21T12:00:00Z",
    )
    # failed org: inventory only
    row_d = build_fleet_row(
        organization_id="org-3", organization_name="Org Three",
        cluster_item={"id": "d", "name": "dead"},
        fetched_at="2026-09-21T12:00:00Z",
    )
    df = fleet_df([row_a, row_b, row_c, row_d])
    kpi = enterprise_kpis(df)

    assert kpi["organizations"] == 3
    assert kpi["clusters"] == 4
    assert kpi["nodes_total"] == pytest.approx(1 + 0 + 100 + 25)
    assert kpi["monthly_cost"] == pytest.approx((10 + 100) * 730)

    # THE law: Σused/Σallocatable = 11/101, NOT mean(100%, 10%) = 55%
    # (ADR v2 R8 rename: same golden as the v1 cpu_efficiency assertion)
    assert kpi["cpu_utilization_pct"] == pytest.approx(11 / 101)
    assert abs(kpi["cpu_utilization_pct"] - (1.0 + 0.10) / 2) > 0.1
    assert kpi["memory_utilization_pct"] == pytest.approx(12 / 104)

    # savings: Σ hours over present rows x730; pct = Σps/Σ(overview cost),
    # same-source pairwise (final-review MAJOR-1): (2+50+1)/(10+100+4)
    assert kpi["potential_savings_monthly"] == pytest.approx((2 + 50 + 1) * 730)
    assert kpi["potential_savings_pct"] == pytest.approx(53 / 114)
    # v2 savings trio: all three positives here -> gross == net, no headroom
    assert kpi["gross_savings_opportunity"] == pytest.approx(53 * 730)
    assert kpi["headroom_savings"] is None
    assert kpi["headroom_clusters"] == 0
    assert kpi["clusters_with_positive_savings"] == 3

    assert kpi["spot_coverage"] == pytest.approx(25 / 126)
    assert kpi["wa_coverage"] == pytest.approx(1 / 4)
    assert kpi["clusters_with_unscheduled_pods"] == 1  # row A has a true 0
    assert kpi["orgs_unavailable"] == 1


def test_enterprise_kpis_all_na_columns_yield_none():
    row = build_fleet_row(
        organization_id="org-1", organization_name="Org One",
        cluster_item={"id": "a", "name": "bare"},
        fetched_at="2026-09-21T12:00:00Z",
    )
    kpi = enterprise_kpis(fleet_df([row]))
    assert kpi["cpu_utilization_pct"] is None
    assert kpi["memory_utilization_pct"] is None
    assert kpi["cpu_request_efficiency_pct"] is None
    assert kpi["memory_request_efficiency_pct"] is None
    assert kpi["na_coverage_pct"] is None
    assert kpi["potential_savings_monthly"] is None
    assert kpi["potential_savings_pct"] is None
    assert kpi["gross_savings_opportunity"] is None
    assert kpi["headroom_savings"] is None
    assert kpi["headroom_clusters"] == 0
    assert kpi["clusters_with_positive_savings"] == 0
    assert kpi["spot_coverage"] is None
    assert kpi["monthly_cost"] is None
    assert kpi["nodes_total"] is None
    for col in ("waste_cpu_usd", "waste_ram_usd", "waste_storage_usd", "waste_total_usd"):
        assert kpi[col] is None, col
    assert kpi["wa_coverage"] == pytest.approx(0.0)  # 1 cluster, 0 running
    assert kpi["clusters"] == 1
    assert kpi["organizations"] == 1
    assert kpi["orgs_unavailable"] == 1
    assert kpi["clusters_with_unscheduled_pods"] == 0


def test_enterprise_kpis_zero_denominator_is_none_never_zero():
    df = pd.DataFrame(
        {
            "organization_id": ["o1", "o1"],
            "cpu_used": [1.0, 2.0],
            "cpu_allocatable": [0.0, 0.0],
        }
    )
    assert enterprise_kpis(df)["cpu_utilization_pct"] is None


def test_enterprise_kpis_empty_frame_is_none_safe():
    kpi = enterprise_kpis(pd.DataFrame())
    assert kpi == {
        "organizations": 0,
        "clusters": 0,
        "nodes_total": None,
        "monthly_cost": None,
        "cpu_utilization_pct": None,
        "memory_utilization_pct": None,
        "cpu_request_efficiency_pct": None,
        "memory_request_efficiency_pct": None,
        "na_coverage_pct": None,
        "potential_savings_monthly": None,
        "potential_savings_pct": None,
        "gross_savings_opportunity": None,
        "headroom_savings": None,
        "headroom_clusters": 0,
        "clusters_with_positive_savings": 0,
        "waste_cpu_usd": None,
        "waste_ram_usd": None,
        "waste_storage_usd": None,
        "waste_total_usd": None,
        "spot_coverage": None,
        "wa_coverage": None,
        "clusters_with_unscheduled_pods": 0,
        "unschedulable_pods_total": None,
        "orgs_unavailable": 0,
    }


# ---------------------------------------------------------------- cost_by_organization

def _org_row(org_id, name, cluster_id, cost_hourly, ps_hourly):
    return build_fleet_row(
        organization_id=org_id, organization_name=name,
        cluster_item={"id": cluster_id, "name": cluster_id},
        summary_item=(
            None if cost_hourly is None else {"clusterId": cluster_id,
                                              "costHourlyOnDemand": str(cost_hourly)}
        ),
        overview_item=(
            None if ps_hourly is None
            else {"clusterId": cluster_id,
                  "costHourly": str(ps_hourly + 1.0), "optimalCostHourly": "1.0"}
            # => potential_savings_hourly == ps_hourly, pairwise with overview cost
        ),
        fetched_at="2026-09-21T12:00:00Z",
    )


def test_cost_by_organization_weighted_pct_sort_and_na_org():
    rows = [
        _org_row("org-small", "Small Org", "s1", 10.0, 1.0),
        _org_row("org-big", "Big Org", "b1", 100.0, 40.0),
        _org_row("org-big", "Big Org", "b2", 50.0, 10.0),
        _org_row("org-na", "NA Org", "n1", None, None),   # still listed
    ]
    out = cost_by_organization(fleet_df(rows))

    assert list(out.columns) == [
        "organization_name", "organization_id", "clusters",
        "monthly_cost", "potential_savings_monthly", "potential_savings_pct",
    ]
    # sorted desc by cost, NA org last
    assert list(out["organization_id"]) == ["org-big", "org-small", "org-na"]

    big = out.loc[out["organization_id"] == "org-big"].iloc[0]
    assert big["clusters"] == 2
    assert big["monthly_cost"] == pytest.approx(150 * 730)
    assert big["potential_savings_monthly"] == pytest.approx(50 * 730)
    # same-source pairwise (final-review MAJOR-1): (40+10)/(41+11) = 50/52,
    # where ov cost = ps+1 per _org_row (41, 11); NEVER mean(40%, 20%) = 30%
    assert big["potential_savings_pct"] == pytest.approx(50 / 52)
    assert abs(big["potential_savings_pct"] - (0.40 + 0.20) / 2) > 0.01

    na_org = out.loc[out["organization_id"] == "org-na"].iloc[0]
    assert na_org["clusters"] == 1                      # listed
    assert pd.isna(na_org["monthly_cost"])
    assert pd.isna(na_org["potential_savings_monthly"])
    assert pd.isna(na_org["potential_savings_pct"])     # excluded from ratio


def test_cost_by_organization_partial_cost_missing_cost_denominator_is_na():
    # MAJOR-1 semantics: savings carry their OWN overview cost basis, so a missing
    # SUMMARY cost no longer blocks the ratio: pct = ps/ov = 5/(5+1) = 5/6.
    # (monthly_cost stays NA -- it is summary-derived.) pct is NA only when the
    # overview cost itself is missing/zero.
    out = cost_by_organization(fleet_df([_org_row("org-x", "X Org", "x1", None, 5.0)]))
    row = out.iloc[0]
    assert pd.isna(row["monthly_cost"])
    assert row["potential_savings_monthly"] == pytest.approx(5 * 730)
    assert row["potential_savings_pct"] == pytest.approx(5 / 6)


def test_cost_by_organization_empty():
    out = cost_by_organization(pd.DataFrame())
    assert list(out.columns) == [
        "organization_name", "organization_id", "clusters",
        "monthly_cost", "potential_savings_monthly", "potential_savings_pct",
    ]
    assert len(out) == 0
    assert len(cost_by_organization(None)) == 0


# ---------------------------------------------------------------- trend_from_org_report

def test_trend_from_org_report_parses_and_sorts():
    report = {
        "totalDailyCost": [
            {"timestamp": "2026-09-20T00:00:00Z", "value": "12.5"},
            {"timestamp": "2026-09-19T00:00:00Z", "value": 10},
        ],
        "summary": {"totalCost": "22.5"},
    }
    out = trend_from_org_report(report)
    assert list(out.columns) == ["timestamp", "value"]
    assert str(out["timestamp"].dtype) == "datetime64[ns, UTC]"
    assert out["timestamp"].tolist() == [
        pd.Timestamp("2026-09-19T00:00:00Z"),
        pd.Timestamp("2026-09-20T00:00:00Z"),
    ]
    assert out["value"].tolist() == [10.0, 12.5]


def test_trend_from_org_report_empty_inputs():
    for bad in (None, {}, {"totalDailyCost": []}, {"totalDailyCost": "nope"},
                {"totalDailyCost": [None, "x"]}, "not-a-dict"):
        out = trend_from_org_report(bad)
        assert len(out) == 0
        assert str(out["timestamp"].dtype) == "datetime64[ns, UTC]"


# ================================================================ v2 KPIs

def _v2_row(cid, *, ghost=False, **summary_over):
    """build_fleet_row wrapper for ratio/waste/ghost KPI cases."""
    summary = {
        "clusterId": cid,
        "nodeCountOnDemand": "4", "nodeCountSpot": "0",
        "nodeCountOnDemandCastai": "3", "nodeCountSpotCastai": "0",
        "nodeCountSpotFallbackCastai": "0",
        "cpuAllocatableOnDemand": "10", "cpuRequestedOnDemand": "4", "cpuUsed": "2",
        "ramAllocatableOnDemand": "20", "ramRequestedOnDemand": "10", "ramUsed": "5",
        "costHourlyOnDemand": "1", "podCount": "5", "unschedulablePodCount": "0",
    }
    summary.update(summary_over)
    return build_fleet_row(
        organization_id="org-1", organization_name="Org One",
        cluster_item={"id": cid, "name": cid, "agentStatus": "online"},
        summary_item=summary,
        overview_item={
            "clusterId": cid, "costHourly": "1", "optimalCostHourly": "0.5",
            "state": "CLUSTER_STATE_UNSPECIFIED" if ghost else "CLUSTER_STATE_OPTIMIZED",
        },
        efficiency_item={"clusterId": cid, "wasted": {"cpu": 2.0, "ram": 1.0, "storage": 0.5}},
        fetched_at="2026-09-21T12:00:00Z",
    )


def test_request_efficiency_kpis_ratio_of_sums():
    # row2 carries HALF-weighted numbers so Σ-weighting differs from the mean
    row1 = _v2_row("r1", cpuRequestedOnDemand="4", cpuUsed="2")      # 0.5
    row2 = _v2_row("r2", cpuRequestedOnDemand="100", cpuUsed="10")   # 0.1
    kpi = enterprise_kpis(fleet_df([row1, row2]))
    assert kpi["cpu_request_efficiency_pct"] == pytest.approx(12 / 104)
    assert abs(kpi["cpu_request_efficiency_pct"] - (0.5 + 0.1) / 2) > 0.1
    assert kpi["memory_request_efficiency_pct"] == pytest.approx(10 / 20)


def test_request_efficiency_kpi_excludes_zero_requested_rows():
    row1 = _v2_row("r1", cpuRequestedOnDemand="4", cpuUsed="2")
    row2 = _v2_row("r2", cpuRequestedOnDemand="0", cpuUsed="10")  # excluded pair
    kpi = enterprise_kpis(fleet_df([row1, row2]))
    assert kpi["cpu_request_efficiency_pct"] == pytest.approx(0.5)


def test_na_coverage_kpi_ratio_of_sums_over_masked_pairs():
    row1 = _v2_row("r1")  # 3/4
    row2 = _v2_row("r2", nodeCountOnDemand="96", nodeCountSpot="4",
                   nodeCountOnDemandCastai="7")  # 7/100
    kpi = enterprise_kpis(fleet_df([row1, row2]))
    assert kpi["na_coverage_pct"] == pytest.approx((3 + 7) / (4 + 100))


def test_waste_kpi_sums_min_count_1():
    row1 = _v2_row("w1")
    row2 = _v2_row("w2")
    kpi = enterprise_kpis(fleet_df([row1, row2]))
    assert kpi["waste_cpu_usd"] == pytest.approx(4.0)
    assert kpi["waste_ram_usd"] == pytest.approx(2.0)
    assert kpi["waste_storage_usd"] == pytest.approx(1.0)
    assert kpi["waste_total_usd"] == pytest.approx(7.0)


def test_savings_trio_with_negatives_never_clamped():
    def _savings_row(cid, cost, optimal):
        return build_fleet_row(
            organization_id="org-1", organization_name="Org One",
            cluster_item={"id": cid, "name": cid},
            overview_item={"clusterId": cid, "costHourly": str(cost),
                           "optimalCostHourly": str(optimal),
                           "state": "CLUSTER_STATE_READ_ONLY"},
            fetched_at="2026-09-21T12:00:00Z",
        )

    df = fleet_df([
        _savings_row("p1", 10.0, 8.0),   # +2.0/h
        _savings_row("p2", 5.0, 4.0),    # +1.0/h
        _savings_row("n1", 1.0, 4.0),    # -3.0/h (net headline still includes it)
    ])
    kpi = enterprise_kpis(df)
    assert kpi["potential_savings_monthly"] == pytest.approx(0.0)  # NET incl. negatives
    assert kpi["gross_savings_opportunity"] == pytest.approx(3.0 * 730)
    assert kpi["headroom_savings"] == pytest.approx(-3.0 * 730)    # signed, never floored
    assert kpi["headroom_clusters"] == 1
    assert kpi["clusters_with_positive_savings"] == 2


def test_ghost_rows_masked_from_all_kpis_but_kept_in_table():
    real = _v2_row("g1")
    ghost = _v2_row("g2", ghost=True)
    df = fleet_df([real, ghost])
    # ghost rows REMAIN in the frame (visible in the table)
    assert len(df) == 2
    assert bool(df.set_index("cluster_id").loc["g2", "is_ghost"]) is True

    kpi = enterprise_kpis(df)
    assert kpi["clusters"] == 1                      # ghost masked, not counted
    assert kpi["nodes_total"] == pytest.approx(4.0)  # not 4+4
    assert kpi["monthly_cost"] == pytest.approx(1.0 * 730)
    assert kpi["cpu_utilization_pct"] == pytest.approx(0.2)
    assert kpi["na_coverage_pct"] == pytest.approx(0.75)
    assert kpi["waste_cpu_usd"] == pytest.approx(2.0)
    assert kpi["potential_savings_monthly"] == pytest.approx(0.5 * 730)
    assert kpi["gross_savings_opportunity"] == pytest.approx(0.5 * 730)
    assert kpi["clusters_with_positive_savings"] == 1

    rollup = cost_by_organization(df)
    assert len(rollup) == 1
    assert rollup.iloc[0]["clusters"] == 1
    assert rollup.iloc[0]["monthly_cost"] == pytest.approx(730.0)


def test_ghost_only_frame_yields_empty_kpis():
    kpi = enterprise_kpis(fleet_df([_v2_row("g9", ghost=True)]))
    assert kpi["clusters"] == 0
    assert kpi["nodes_total"] is None
    assert kpi["monthly_cost"] is None
    assert cost_by_organization(fleet_df([_v2_row("g9", ghost=True)])).empty


def test_no_is_ghost_column_frames_pass_through_unchanged():
    # older callers without the ghost column keep every row in scope
    df = pd.DataFrame(
        {
            "organization_id": ["o1", "o1"],
            "cpu_used": [1.0, 1.0],
            "cpu_allocatable": [4.0, 4.0],
        }
    )
    kpi = enterprise_kpis(df)
    assert kpi["clusters"] == 2
    assert kpi["cpu_utilization_pct"] == pytest.approx(0.25)
