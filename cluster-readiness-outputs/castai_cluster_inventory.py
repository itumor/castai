#!/usr/bin/env python3
"""
Enumerate all CAST AI organizations and clusters accessible with the given API key,
extract cluster name, id, org id, status (read-only vs connected/autoscaler), etc.,
and write the results to an Excel file.
"""

import os
import sys
import json
import re
import time
from typing import Optional, List
from datetime import datetime, timezone

import requests
import pandas as pd

API_BASE = "https://api.eu.cast.ai"
ENV_FILE = "/Users/eramadan/castai/projects/castai-billing-export/.env"
OUTPUT_XLSX = "/Users/eramadan/castai/cluster-readiness-outputs/castai_cluster_inventory.xlsx"


def load_api_key(path: str) -> str:
    with open(path) as f:
        for line in f:
            m = re.search(r'castai_v1_[a-f0-9_]+', line)
            if m:
                return m.group(0)
    raise RuntimeError(f"No CASTAI_API_KEY found in {path}")


def api_get(session: requests.Session, path: str, org_id: Optional[str] = None) -> dict:
    url = f"{API_BASE}{path}"
    headers = {"X-API-Key": session.headers['X-Token']}
    if org_id:
        headers["X-CastAI-Organization-Id"] = org_id
    resp = session.get(url, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


def list_organizations(session: requests.Session) -> List[dict]:
    data = api_get(session, "/v1/organizations")
    return data.get("organizations", [])


def list_clusters(session: requests.Session, org_id: str) -> List[dict]:
    """List clusters for a specific org using the external-clusters endpoint."""
    data = api_get(session, "/v1/kubernetes/external-clusters", org_id=org_id)
    return data.get("items", [])


def get_cluster_details(session: requests.Session, cluster_id: str, org_id: str) -> dict:
    """Fetch detailed cluster info to extract agent status / onboarding flags."""
    try:
        return api_get(session, f"/v1/kubernetes/external-clusters/{cluster_id}", org_id=org_id)
    except Exception as e:
        return {"_fetch_error": str(e)}


def normalize_cluster(c: dict, org: dict) -> dict:
    """Flatten key cluster fields."""
    region = c.get("region") or {}
    if isinstance(region, dict):
        region_name = region.get("name")
        region_display = region.get("displayName")
    else:
        region_name = region
        region_display = None

    # Provider type is in providerType (e.g. eks, gke, aks)
    provider = c.get("providerType") or c.get("provider")

    # Cloud account / subscription / project id
    cloud_account = (
        c.get("providerNamespaceId")
        or c.get("cloudAccountId")
        or c.get("accountId")
        or c.get("account_id")
    )

    # isPhase2 == true means Phase 2 automation (autoscaler) is enabled;
    # false means read-only / monitoring only.
    is_phase2 = c.get("isPhase2")
    is_autoscaler = is_phase2 if isinstance(is_phase2, bool) else None

    return {
        "org_id": org.get("id"),
        "org_name": org.get("name"),
        "org_type": org.get("type"),
        "cluster_id": c.get("id"),
        "cluster_name": c.get("name"),
        "provider": provider,
        "region": region_name,
        "region_display": region_display,
        "status": c.get("status"),
        "agent_status": c.get("agentStatus") or c.get("agent_status"),
        "connection_status": c.get("connectionStatus") or c.get("connection_status"),
        "is_readonly": not is_autoscaler if isinstance(is_autoscaler, bool) else None,
        "is_autoscaler": is_autoscaler,
        "is_phase2": is_phase2,
        "onboarded_at": c.get("createdAt") or c.get("created_at") or c.get("onboardedAt"),
        "cloud_account_id": cloud_account,
        "raw_json": json.dumps(c),
    }


def main():
    api_key = load_api_key(ENV_FILE)
    session = requests.Session()
    session.headers["X-Token"] = api_key  # stored temporarily for api_get helper

    print(f"Using API base: {API_BASE}")
    print("Listing organizations...")
    orgs = list_organizations(session)
    print(f"Found {len(orgs)} organizations")

    rows = []
    errors = []

    for i, org in enumerate(orgs, 1):
        org_id = org.get("id")
        org_name = org.get("name", "")
        print(f"[{i}/{len(orgs)}] {org_name} ({org_id}) ... ", end="", flush=True)
        try:
            clusters = list_clusters(session, org_id)
            print(f"{len(clusters)} clusters")
            for c in clusters:
                # optionally enrich with details if needed; skip for speed unless status is missing
                row = normalize_cluster(c, org)
                if not row["agent_status"] and not row["connection_status"]:
                    details = get_cluster_details(session, c.get("id"), org_id)
                    row["agent_status"] = details.get("agentStatus") or details.get("agent_status")
                    row["connection_status"] = details.get("connectionStatus") or details.get("connection_status")
                    row["is_readonly"] = (
                        row["is_readonly"]
                        or details.get("isReadOnly")
                        or details.get("is_read_only")
                        or details.get("readOnly")
                    )
                    row["is_autoscaler"] = (
                        row["is_autoscaler"]
                        or details.get("isAutoscaler")
                        or details.get("autoscalerEnabled")
                        or details.get("autoscaler")
                    )
                rows.append(row)
        except Exception as e:
            msg = f"{org_name} ({org_id}): {e}"
            print(f"ERROR: {e}")
            errors.append({"org_id": org_id, "org_name": org_name, "error": str(e)})
        # polite rate limiting
        time.sleep(0.2)

    df_clusters = pd.DataFrame(rows)
    df_orgs = pd.DataFrame([{"id": o.get("id"), "name": o.get("name"), "type": o.get("type")} for o in orgs])
    df_errors = pd.DataFrame(errors)

    # Add a friendly status summary column
    def derive_status(row):
        if row.get("is_autoscaler"):
            return "connected-autoscaler"
        if row.get("is_readonly"):
            return "connected-readonly"
        if row.get("connection_status"):
            return str(row["connection_status"]).lower()
        if row.get("agent_status"):
            return str(row["agent_status"]).lower()
        return "unknown"

    if not df_clusters.empty:
        df_clusters["derived_status"] = df_clusters.apply(derive_status, axis=1)

    with pd.ExcelWriter(OUTPUT_XLSX, engine="openpyxl") as writer:
        df_clusters.to_excel(writer, sheet_name="Clusters", index=False)
        df_orgs.to_excel(writer, sheet_name="Organizations", index=False)
        df_errors.to_excel(writer, sheet_name="Errors", index=False)

    print(f"\nWrote {len(df_clusters)} cluster(s) to {OUTPUT_XLSX}")
    print(f"Organizations sheet: {len(df_orgs)} org(s)")
    print(f"Errors sheet: {len(df_errors)} error(s)")

    if df_clusters.empty:
        print("\nNo clusters were found across any accessible organization.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
