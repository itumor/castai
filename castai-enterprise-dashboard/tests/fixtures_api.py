"""Wire-shape API fixtures for the service test-suite (Builder B3).

REAL RESPONSE SHAPES ONLY (docs/api-matrix.md §0.1, §2.1, §3.1, §3.2, §3.6,
§7.2; docs/data-model.md §0 rule 3): every proto3 numeric rides the wire as a
JSON STRING ("4.5"), timestamps are RFC 3339, ids are uuid-ish strings,
all list endpoints are unpaginated envelopes ({items[]/clusters[]/...}).

Scenario topology (one ENTERPRISE root, children, one stray DEFAULT org):

  ROOT         ENTERPRISE root ("Siemens AG")
  ORG_A        healthy child, 2 clusters:
                 C1 full payloads    -> data_status "ok"
                 C2 overview/report  -> data_status "partial" (no summary)
  ORG_B        healthy child, 2 clusters:
                 C3 full payloads, name DUPLICATES C1's across orgs
                 C4 inventory-only   -> data_status "unavailable"
  ORG_EMPTY    child with zero clusters/payloads
  ORG_PARTIAL  child whose cluster LIST endpoint fails while summary/overview/
               report/WA still arrive -> rows keyed by cluster_id must survive
  ORG_FAIL     child where ALL fleet endpoints fail -> zero rows + FetchErrors
  ORG_ORPHAN   CHILD of a DIFFERENT parent -> excluded from the scope
  ORG_DEFAULT  ORGANIZATION_TYPE_DEFAULT -> excluded from the scope

Usage: build a FakeClient (tests/test_enterprise_service.py) with
organizations_payload=organization_tree() and payloads=fleet_payload_map(),
plus fail_orgs={ORG_FAIL_ID: ServerError(...)} / fail_methods for ORG_PARTIAL.
"""

from __future__ import annotations

TYPE_ENTERPRISE = "ORGANIZATION_TYPE_ENTERPRISE"
TYPE_CHILD = "ORGANIZATION_TYPE_CHILD"
TYPE_DEFAULT = "ORGANIZATION_TYPE_DEFAULT"

ROOT_ID = "e0000000-0000-4000-8000-0e0000000001"
ROOT_NAME = "Siemens AG"
ROOT2_ID = "e0000000-0000-4000-8000-0e0000000002"
ROOT2_NAME = "Other Enterprise"

ORG_A_ID = "a0000000-0000-4000-a000-000000000a01"
ORG_A_NAME = "Acme Web Services"
ORG_B_ID = "b0000000-0000-4000-b000-000000000b02"
ORG_B_NAME = "Acme Analytics"
ORG_EMPTY_ID = "e0000000-0000-4000-e000-000000000e03"
ORG_EMPTY_NAME = "Acme Idle"
ORG_PARTIAL_ID = "d0000000-0000-4000-d000-000000000004"
ORG_PARTIAL_NAME = "Acme Legacy"
ORG_FAIL_ID = "f0000000-0000-4000-f000-00000000005"
ORG_FAIL_NAME = "Acme Broken"
ORG_ORPHAN_ID = "01000000-0000-4000-9000-00000000006"
ORG_ORPHAN_NAME = "Unrelated Child"
ORG_DEFAULT_ID = "d6000000-0000-4000-8600-00000000007"
ORG_DEFAULT_NAME = "Personal Sandbox"

C1_ID = "c0000000-0000-4000-c001-000000000001"
C2_ID = "c0000000-0000-4000-c002-000000000002"
C3_ID = "c0000000-0000-4000-c003-000000000003"
C4_ID = "c0000000-0000-4000-c004-000000000004"
P1_ID = "c0000000-0000-4000-c005-000000000005"

DUP_CLUSTER_NAME = "shared-web"  # C1 and C3 — names are NOT unique (data-model §0.1)

START = "2026-09-18T00:00:00Z"
END = "2026-09-21T00:00:00Z"

TREND_DAYS = ["2026-09-18T00:00:00Z", "2026-09-19T00:00:00Z", "2026-09-20T00:00:00Z"]


# ---------------------------------------------------------------- organizations
def _org_wire(org_id: str, name: str, org_type: str, parent_id: str | None = None) -> dict:
    out = {
        "id": org_id,
        "name": name,
        "createdAt": "2025-06-01T09:00:00Z",
        "type": org_type,
        "organizationMember": True,
        "internal": False,
        "blockEscalatedPrivilege": True,
    }
    if parent_id is not None:
        out["parentId"] = parent_id
    return out


def organization_tree() -> dict:
    """GET /v1/organizations: one ENTERPRISE root, CHILD orgs, one DEFAULT."""
    return {
        "organizations": [
            _org_wire(ROOT_ID, ROOT_NAME, TYPE_ENTERPRISE),
            _org_wire(ORG_A_ID, ORG_A_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_B_ID, ORG_B_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_EMPTY_ID, ORG_EMPTY_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_PARTIAL_ID, ORG_PARTIAL_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_FAIL_ID, ORG_FAIL_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_ORPHAN_ID, ORG_ORPHAN_NAME, TYPE_CHILD, "someone-elses-root"),
            _org_wire(ORG_DEFAULT_ID, ORG_DEFAULT_NAME, TYPE_DEFAULT),
        ]
    }


def organization_tree_dual_enterprise() -> dict:
    """Ambiguity scenario: TWO ENTERPRISE roots visible to the key."""
    return {
        "organizations": [
            _org_wire(ROOT_ID, ROOT_NAME, TYPE_ENTERPRISE),
            _org_wire(ROOT2_ID, ROOT2_NAME, TYPE_ENTERPRISE),
            _org_wire(ORG_A_ID, ORG_A_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_DEFAULT_ID, ORG_DEFAULT_NAME, TYPE_DEFAULT),
        ]
    }


def organization_tree_no_enterprise() -> dict:
    """No ENTERPRISE org visible -> root resolution must fail clearly."""
    return {
        "organizations": [
            _org_wire(ORG_A_ID, ORG_A_NAME, TYPE_CHILD, ROOT_ID),
            _org_wire(ORG_DEFAULT_ID, ORG_DEFAULT_NAME, TYPE_DEFAULT),
        ]
    }


# ------------------------------------------------------------------ clusters A
CLUSTERS_A: dict = {
    "items": [
        {
            "id": C1_ID,
            "name": DUP_CLUSTER_NAME,
            "organizationId": ORG_A_ID,
            "createdAt": "2025-11-02T10:15:30Z",
            "region": {"name": "eu-central-1", "displayName": "EU Central (Frankfurt)"},
            "status": "ready",
            "agentSnapshotReceivedAt": "2026-09-21T06:55:12Z",
            "agentStatus": "online",
            "providerType": "eks",
            "kubernetesVersion": "1.29.3",
            "isPhase2": True,
            "eks": {"clusterName": DUP_CLUSTER_NAME, "region": "eu-central-1", "accountId": "123456789012"},
            "managedBy": "terraform",
        },
        {
            "id": C2_ID,
            "name": "analytics-batch",
            "organizationId": ORG_A_ID,
            "createdAt": "2026-01-19T08:03:41Z",
            "region": {"name": "europe-west1", "displayName": "EU West 1 (Belgium)"},
            "status": "warning",
            "agentStatus": "non-responding",
            "providerType": "gke",
            "kubernetesVersion": "1.28.4",
            "gke": {"clusterName": "analytics-batch", "projectId": "acme-analytics", "location": "europe-west1"},
            "managedBy": "console",
        },
    ]
}

# ------------------------------------------------------------------ clusters B
CLUSTERS_B: dict = {
    "items": [
        {
            "id": C3_ID,
            "name": DUP_CLUSTER_NAME,  # duplicate NAME of C1, different id/org
            "organizationId": ORG_B_ID,
            "createdAt": "2026-03-03T14:45:00Z",
            "region": {"name": "eu-west-1", "displayName": "EU West 1 (Ireland)"},
            "status": "ready",
            "agentSnapshotReceivedAt": "2026-09-21T06:54:01Z",
            "agentStatus": "online",
            "providerType": "eks",
            "kubernetesVersion": "1.30.1",
            "isPhase2": False,
            "eks": {"clusterName": DUP_CLUSTER_NAME, "region": "eu-west-1", "accountId": "210987654321"},
            "managedBy": "terraform",
        },
        {
            "id": C4_ID,
            "name": "legacy-plane",
            "organizationId": ORG_B_ID,
            "createdAt": "2024-12-10T11:20:00Z",
            "region": {"name": "westeurope", "displayName": "West Europe"},
            "status": "connecting",
            "agentStatus": "waiting-connection",
            "providerType": "aks",
            "kubernetesVersion": None,
            "aks": {
                "region": "westeurope",
                "nodeResourceGroup": "mc_rg_legacy_westeurope",
                "subscriptionId": "00000000-1111-2222-3333-444444444444",
            },
            "managedBy": "console",
        },
    ]
}

CLUSTERS_EMPTY: dict = {"items": []}

# --------------------------------------------------------- summary (§3.1, strings)
SUMMARY_A: dict = {
    "items": [
        {
            "clusterId": C1_ID,
            "nodeCountOnDemand": "4",
            "nodeCountSpot": "6",
            "nodeCountOnDemandCastai": "4",
            "nodeCountSpotCastai": "6",
            "nodeCountSpotFallbackCastai": "1",
            "unknownNodeCount": "1",
            "cpuProvisionedOnDemand": "16",
            "cpuProvisionedSpot": "8",
            "cpuProvisionedSpotFallback": "1",
            "cpuAllocatableOnDemand": "15",
            "cpuAllocatableSpot": "7.5",
            "cpuAllocatableSpotFallback": "0.5",
            "cpuRequestedOnDemand": "10",
            "cpuRequestedSpot": "2",
            "cpuRequestedSpotFallback": "0",
            "cpuUsed": "6.9",
            "ramProvisionedOnDemand": "64",
            "ramProvisionedSpot": "32",
            "ramProvisionedSpotFallback": "2",
            "ramAllocatableOnDemand": "60",
            "ramAllocatableSpot": "30",
            "ramAllocatableSpotFallback": "2",
            "ramRequestedOnDemand": "40",
            "ramRequestedSpot": "8",
            "ramRequestedSpotFallback": "0",
            "ramUsed": "30",
            "costHourlyOnDemand": "2.0",
            "costHourlySpot": "1.0",
            "costHourlySpotFallback": "0.1",
            "podCount": "50",
            "unschedulablePodCount": "2",
            "clusterScore": "87.5",
            # v2 storage block (resource-metrics §3; string numerics).
            # TRAP: storageRequested = ACTIVE PVC claims -> storage_active_claimed_gib.
            "storageProvisioned": "500",
            "storageClaimed": "300",
            "storageRequested": "280",
            "storageCostHourly": "0.055",
        },
    ]
}
# NOTE: C2 is deliberately ABSENT from SUMMARY_A -> data_status "partial".

SUMMARY_B: dict = {
    "items": [
        {
            "clusterId": C3_ID,
            "nodeCountOnDemand": "2",
            "nodeCountSpot": "0",
            "nodeCountOnDemandCastai": "2",
            "nodeCountSpotCastai": "0",
            "nodeCountSpotFallbackCastai": "0",
            "unknownNodeCount": "0",
            "cpuProvisionedOnDemand": "4",
            "cpuProvisionedSpot": "0",
            "cpuProvisionedSpotFallback": "0",
            "cpuAllocatableOnDemand": "3",
            "cpuAllocatableSpot": "0",
            "cpuAllocatableSpotFallback": "0",
            "cpuRequestedOnDemand": "2",
            "cpuRequestedSpot": "0",
            "cpuRequestedSpotFallback": "0",
            "cpuUsed": "1.5",
            "ramProvisionedOnDemand": "16",
            "ramProvisionedSpot": "0",
            "ramProvisionedSpotFallback": "0",
            "ramAllocatableOnDemand": "15",
            "ramAllocatableSpot": "0",
            "ramAllocatableSpotFallback": "0",
            "ramRequestedOnDemand": "10",
            "ramRequestedSpot": "0",
            "ramRequestedSpotFallback": "0",
            "ramUsed": "7",
            "costHourlyOnDemand": "0.5",
            "costHourlySpot": "0",
            "costHourlySpotFallback": "0",
            "podCount": "10",
            "unschedulablePodCount": "0",
            "clusterScore": "95.0",
            "storageProvisioned": "50",
            "storageClaimed": "30",
            "storageRequested": "20",
            "storageCostHourly": "0.006",
        },
    ]
}
# NOTE: C4 is deliberately ABSENT from all ORG_B reporting payloads.

SUMMARY_PARTIAL: dict = {
    "items": [
        {
            "clusterId": P1_ID,
            "nodeCountOnDemand": "1",
            "nodeCountSpot": "0",
            "nodeCountSpotFallbackCastai": "0",
            "unknownNodeCount": "0",
            "cpuProvisionedOnDemand": "2",
            "cpuAllocatableOnDemand": "2",
            "cpuRequestedOnDemand": "1",
            "cpuUsed": "0.5",
            "ramProvisionedOnDemand": "8",
            "ramAllocatableOnDemand": "7",
            "ramRequestedOnDemand": "4",
            "ramUsed": "2",
            "costHourlyOnDemand": "0.25",
            "costHourlySpot": "0",
            "costHourlySpotFallback": "0",
            "podCount": "5",
            "unschedulablePodCount": "0",
        },
    ]
}

# --------------------------------------------------------- overview (§3.6, strings)
OVERVIEW_A: dict = {
    "clusters": [
        {
            "clusterId": C1_ID,
            "clusterName": DUP_CLUSTER_NAME,
            "provider": "eks",
            "region": "eu-central-1",
            "kubernetesVersion": "1.29.3",
            "status": "ready",
            "state": "CLUSTER_STATE_OPTIMIZED",
            "nodeCount": "10",
            "spotNodeCount": "6",
            "onDemandNodeCount": "4",
            "costHourly": "3.0",
            "optimalCostHourly": "2.0",
            "sources": [{"source": "agent", "lastCollectedAt": "2026-09-21T06:55:12Z"}],
            "primarySource": "agent",
        },
        {
            "clusterId": C2_ID,
            "clusterName": "analytics-batch",
            "provider": "gke",
            "region": "europe-west1",
            "kubernetesVersion": "1.28.4",
            "status": "warning",
            "state": "CLUSTER_STATE_DISCOVERED",
            "nodeCount": "0",
            "costHourly": "4.0",
            "optimalCostHourly": "3.0",
            "sources": [{"source": "cloud", "lastCollectedAt": "2026-09-21T06:55:12Z"}],
            "primarySource": "cloud",
        },
    ],
    "latestSyncTime": "2026-09-21T06:55:12Z",
}

OVERVIEW_B: dict = {
    "clusters": [
        {
            "clusterId": C3_ID,
            "clusterName": DUP_CLUSTER_NAME,
            "provider": "eks",
            "region": "eu-west-1",
            "kubernetesVersion": "1.30.1",
            "status": "ready",
            "state": "CLUSTER_STATE_OPTIMIZED",
            "nodeCount": "2",
            "spotNodeCount": "0",
            "onDemandNodeCount": "2",
            "costHourly": "0.5",
            "optimalCostHourly": "0.4",
            "sources": [{"source": "agent", "lastCollectedAt": "2026-09-21T06:54:01Z"}],
            "primarySource": "agent",
        },
    ],
    "latestSyncTime": "2026-09-21T06:54:01Z",
}

OVERVIEW_PARTIAL: dict = {
    "clusters": [
        {
            "clusterId": P1_ID,
            "clusterName": "orphan-costs",
            "provider": "eks",
            "region": "eu-central-1",
            "status": "ready",
            "state": "CLUSTER_STATE_OPTIMIZED",
            "costHourly": "0.25",
            "optimalCostHourly": "0.20",
            "sources": [{"source": "agent", "lastCollectedAt": "2026-09-21T06:50:00Z"}],
            "primarySource": "agent",
        },
    ],
    "latestSyncTime": "2026-09-21T06:50:00Z",
}

# --------------------------------------------------- clusters/report (§3.2, strings)
REPORT_A: dict = {
    "summary": {
        "totalCost": "550.5",
        "cpuCost": "330.0",
        "ramCost": "220.5",
        "totalCostPercentChange": "-8.0",
    },
    "clusters": [
        {
            "clusterId": C1_ID,
            "clusterName": DUP_CLUSTER_NAME,
            "summary": {"totalCost": "420.5", "totalCostPercentChange": "-12.3"},
        },
        {
            "clusterId": C2_ID,
            "clusterName": "analytics-batch",
            "summary": {"totalCost": "130.0", "totalCostPercentChange": "5.2"},
        },
    ],
    "topClustersCost": [
        {"clusterId": C1_ID, "clusterName": DUP_CLUSTER_NAME, "totalCost": "420.5"},
    ],
    "totalDailyCost": [
        {"timestamp": TREND_DAYS[0], "value": "10.0"},
        {"timestamp": TREND_DAYS[1], "value": "20.0"},
        {"timestamp": TREND_DAYS[2], "value": "30.0"},
    ],
    "previousPeriodStart": "2026-08-19T00:00:00Z",
    "previousPeriodEnd": "2026-09-17T00:00:00Z",
}

REPORT_B: dict = {
    "summary": {"totalCost": "40.0", "totalCostPercentChange": "1.5"},
    "clusters": [
        {
            "clusterId": C3_ID,
            "clusterName": DUP_CLUSTER_NAME,
            "summary": {"totalCost": "40.0", "totalCostPercentChange": "1.5"},
        },
    ],
    "totalDailyCost": [
        {"timestamp": TREND_DAYS[0], "value": "1.0"},
        {"timestamp": TREND_DAYS[1], "value": "2.0"},
        {"timestamp": TREND_DAYS[2], "value": "3.0"},
    ],
    "previousPeriodStart": "2026-08-19T00:00:00Z",
    "previousPeriodEnd": "2026-09-17T00:00:00Z",
}

REPORT_PARTIAL: dict = {
    "summary": {"totalCost": "18.0", "totalCostPercentChange": "0.0"},
    "clusters": [
        {
            "clusterId": P1_ID,
            "clusterName": "orphan-costs",
            "summary": {"totalCost": "18.0", "totalCostPercentChange": "0.0"},
        },
    ],
    "totalDailyCost": [],
}

REPORT_EMPTY: dict = {"summary": {"totalCost": "0"}, "clusters": [], "totalDailyCost": []}

# --------------------------------------------- WA agent statuses (§7.2, strings)
WA_A: dict = {
    "clusterAgentStatuses": [
        {
            "clusterId": C1_ID,
            "status": "AGENT_STATUS_RUNNING",
            "currentVersion": "v0.35.2",
            "latestVersion": "v0.35.3",
            "installedAt": "2026-01-05T10:00:00Z",
            "updatedAt": "2026-09-12T08:30:00Z",
            "inPlaceResizeEnabled": True,
        },
    ]
}
# NOTE: C2 absent -> normalizers render "Not installed".

WA_B: dict = {
    "clusterAgentStatuses": [
        {
            "clusterId": C3_ID,
            "status": "AGENT_STATUS_RUNNING",
            "currentVersion": "v0.35.3",
            "latestVersion": "v0.35.3",
            "installedAt": "2026-03-03T15:00:00Z",
            "updatedAt": "2026-09-10T09:00:00Z",
        },
    ]
}

WA_PARTIAL: dict = {
    "clusterAgentStatuses": [
        {"clusterId": P1_ID, "status": "AGENT_STATUS_RUNNING"},
    ]
}

WA_EMPTY: dict = {"clusterAgentStatuses": []}

OVERVIEW_EMPTY: dict = {"clusters": [], "latestSyncTime": "2026-09-21T06:00:00Z"}

# --------------------------------- org efficiency/summary (api-delta-v2 §2c, DOUBLES)
# ADR v2: this call joins the Tier-1 bundle by default (1 + 6×N budget).
# Wire note: totalWaste is a JSON double (NOT a proto3 string), matching the spec.
EFFICIENCY_SUMMARY_A: dict = {
    "cpuResources": {"provisioned": 25.0, "requested": 12.0, "used": 6.9, "overprovisionedPercent": 52.0},
    "cpuCost": {"cost": 330.0, "perUnitProvisioned": 13.2, "perUnitRequested": 27.5, "perUnitUsed": 47.8},
    "ramResources": {"provisioned": 98.0, "requested": 48.0, "used": 30.0, "overprovisionedPercent": 51.0},
    "ramCost": {"cost": 220.5, "perUnitProvisioned": 2.25, "perUnitRequested": 4.59, "perUnitUsed": 7.35},
    "storageResources": {"provisioned": 500.0, "claimed": 300.0, "requested": 280.0, "overprovisionedPercent": 40.0},
    "storageCost": {"cost": 40.0, "perGibProvisioned": 0.08, "perGibClaimed": 0.13, "perGibRequested": 0.14},
    "totalWaste": 96.4,  # DOUBLE USD/window — exists ONLY on this endpoint
}

EFFICIENCY_SUMMARY_B: dict = {
    "cpuResources": {"provisioned": 4.0, "requested": 2.0, "used": 1.5, "overprovisionedPercent": 50.0},
    "cpuCost": {"cost": 12.0, "perUnitProvisioned": 3.0, "perUnitRequested": 6.0, "perUnitUsed": 8.0},
    "ramResources": {"provisioned": 16.0, "requested": 10.0, "used": 7.0, "overprovisionedPercent": 37.5},
    "ramCost": {"cost": 10.0, "perUnitProvisioned": 0.625, "perUnitRequested": 1.0, "perUnitUsed": 1.428},
    "storageResources": {"provisioned": 50.0, "claimed": 30.0, "requested": 20.0, "overprovisionedPercent": 60.0},
    "storageCost": {"cost": 4.0, "perGibProvisioned": 0.08, "perGibClaimed": 0.13, "perGibRequested": 0.2},
    "totalWaste": 11.0,
}

EFFICIENCY_SUMMARY_PARTIAL: dict = {
    "cpuResources": {"provisioned": 2.0, "requested": 1.0, "used": 0.5, "overprovisionedPercent": 75.0},
    "cpuCost": {"cost": 6.0, "perUnitProvisioned": 3.0, "perUnitRequested": 6.0, "perUnitUsed": 12.0},
    "ramResources": {"provisioned": 8.0, "requested": 4.0, "used": 2.0, "overprovisionedPercent": 75.0},
    "ramCost": {"cost": 4.0, "perUnitProvisioned": 0.5, "perUnitRequested": 1.0, "perUnitUsed": 2.0},
    "storageResources": {"provisioned": 40.0, "claimed": 20.0, "requested": 16.0, "overprovisionedPercent": 60.0},
    "storageCost": {"cost": 3.2, "perGibProvisioned": 0.08, "perGibClaimed": 0.16, "perGibRequested": 0.2},
    "totalWaste": 8.0,
}

EFFICIENCY_SUMMARY_EMPTY: dict = {
    "cpuResources": {"provisioned": 0.0, "requested": 0.0, "used": 0.0, "overprovisionedPercent": 0.0},
    "cpuCost": {"cost": 0.0, "perUnitProvisioned": 0.0, "perUnitRequested": 0.0, "perUnitUsed": 0.0},
    "ramResources": {"provisioned": 0.0, "requested": 0.0, "used": 0.0, "overprovisionedPercent": 0.0},
    "ramCost": {"cost": 0.0, "perUnitProvisioned": 0.0, "perUnitRequested": 0.0, "perUnitUsed": 0.0},
    "storageResources": {"provisioned": 0.0, "claimed": 0.0, "requested": 0.0, "overprovisionedPercent": 0.0},
    "storageCost": {"cost": 0.0, "perGibProvisioned": 0.0, "perGibClaimed": 0.0, "perGibRequested": 0.0},
    "totalWaste": 0.0,
}

# ---------------------- org clusters/efficiency (api-delta-v2 §2c, DOUBLES) --
# ADR v2 R2: this PER-CLUSTER items[] call is the Tier-1 6th bundle call; the
# matched items feed the fleet waste_*_usd columns. Values are JSON doubles
# (NOT proto3 strings), USD/window. The org-level efficiency/summary payloads
# above remain the drill-down cross-check (cost_service.waste_by_organization).
EFFICIENCY_A: dict = {
    "items": [
        {"clusterId": C1_ID, "wasted": {"cpu": 40.0, "ram": 30.0, "storage": 10.0}},
        # C2 is DISCOVERED-only: absent from the efficiency payload -> waste NA.
    ]
}

EFFICIENCY_B: dict = {
    "items": [
        {"clusterId": C3_ID, "wasted": {"cpu": 2.5, "ram": 1.5, "storage": 0.0}},
    ]
}

EFFICIENCY_PARTIAL: dict = {
    "items": [
        {"clusterId": P1_ID, "wasted": {"cpu": 1.0, "ram": 0.5, "storage": 0.25}},
    ]
}

EFFICIENCY_EMPTY: dict = {"items": []}

# Client method-name -> (method, org_id) key used by tests' FakeClient.
GET_CLUSTERS = "get_clusters"
GET_SUMMARY = "get_org_clusters_summary"
GET_OVERVIEW = "get_org_overview"
GET_REPORT = "get_org_clusters_report"
GET_WA = "get_org_wa_agent_statuses"
GET_EFFICIENCY = "get_org_cluster_efficiency"  # ADR v2 R2 Tier-1 6th call (items[])
GET_EFFICIENCY_SUMMARY = "get_org_efficiency_summary"  # drill-down cross-check only


def fleet_payload_map() -> dict:
    """Full (method, org_id) -> wire-payload map for the healthy/partial orgs.

    ORG_PARTIAL's cluster-list payload is intentionally ABSENT — the test wires
    its failure via FakeClient fail_methods. ORG_FAIL is absent entirely — the
    test wires total failure via fail_orgs.
    """
    return {
        (GET_CLUSTERS, ORG_A_ID): CLUSTERS_A,
        (GET_SUMMARY, ORG_A_ID): SUMMARY_A,
        (GET_OVERVIEW, ORG_A_ID): OVERVIEW_A,
        (GET_REPORT, ORG_A_ID): REPORT_A,
        (GET_WA, ORG_A_ID): WA_A,
        (GET_EFFICIENCY, ORG_A_ID): EFFICIENCY_A,
        (GET_CLUSTERS, ORG_B_ID): CLUSTERS_B,
        (GET_SUMMARY, ORG_B_ID): SUMMARY_B,
        (GET_OVERVIEW, ORG_B_ID): OVERVIEW_B,
        (GET_REPORT, ORG_B_ID): REPORT_B,
        (GET_WA, ORG_B_ID): WA_B,
        (GET_EFFICIENCY, ORG_B_ID): EFFICIENCY_B,
        (GET_CLUSTERS, ORG_EMPTY_ID): CLUSTERS_EMPTY,
        (GET_SUMMARY, ORG_EMPTY_ID): {"items": []},
        (GET_OVERVIEW, ORG_EMPTY_ID): OVERVIEW_EMPTY,
        (GET_REPORT, ORG_EMPTY_ID): REPORT_EMPTY,
        (GET_WA, ORG_EMPTY_ID): WA_EMPTY,
        (GET_EFFICIENCY, ORG_EMPTY_ID): EFFICIENCY_EMPTY,
        (GET_SUMMARY, ORG_PARTIAL_ID): SUMMARY_PARTIAL,
        (GET_OVERVIEW, ORG_PARTIAL_ID): OVERVIEW_PARTIAL,
        (GET_REPORT, ORG_PARTIAL_ID): REPORT_PARTIAL,
        (GET_WA, ORG_PARTIAL_ID): WA_PARTIAL,
        (GET_EFFICIENCY, ORG_PARTIAL_ID): EFFICIENCY_PARTIAL,
    }
