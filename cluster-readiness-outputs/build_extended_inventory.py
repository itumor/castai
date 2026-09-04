#!/usr/bin/env python3
"""
Build the extended CAST AI cluster inventory workbook.

Reads:
  - cluster-readiness-outputs/castai_cluster_inventory.xlsx        (Clusters sheet)
  - cluster-readiness-outputs/Cluster_DB_MASTER_Upcomming Sessions.xlsx
        (sheet: 'Full view (Do not edit) test' - has cluster_id join key)
  - cluster-readiness-outputs/reports/progress.json                (readiness run state)

Writes:
  - cluster-readiness-outputs/castai_cluster_inventory_extended.xlsx
        with 4 sheets: Clusters, Orgs, Change Windows, Optimization Scope.

The original castai_cluster_inventory.xlsx is NOT modified.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = "/Users/eramadan/castai/cluster-readiness-outputs"
INVENTORY_XLSX = os.path.join(BASE_DIR, "castai_cluster_inventory.xlsx")
MASTER_XLSX = os.path.join(BASE_DIR, "Cluster_DB_MASTER_Upcomming Sessions.xlsx")
PROGRESS_JSON = os.path.join(BASE_DIR, "reports", "progress.json")
OUT_XLSX = os.path.join(BASE_DIR, "castai_cluster_inventory_extended.xlsx")

FULL_VIEW_SHEET = "Full view (Do not edit) test"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NONPROD_PATTERNS = (
    "nonprod", "non-prod", "non_prod", "non prod",
    "dev", "test", "accp", "staging", "stage", "qa",
    "lab", "sandbox", "demo", "poc", "preview", "pre-prod", "preprod",
)


def _norm(value: Any) -> str:
    """Normalize a value to a stripped lowercase string; '' for None/NaN."""
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).strip()


def is_yes(value: Any) -> bool:
    """Return True for Yes / true / 1 / enabled values."""
    s = _norm(value).lower()
    if not s:
        return False
    if s in {"yes", "y", "true", "1", "enabled", "active", "running"}:
        return True
    # 'Enabled (date unknown)' counts as enabled
    if s.startswith("enabled"):
        return True
    return False


def is_truthy_or_enabled(value: Any) -> bool:
    """Like is_yes but also accepts numeric > 0 and dates / known enablement tokens."""
    if is_yes(value):
        return True
    s = _norm(value).lower()
    if s in {"installed", "ok", "success", "successful", "completed"}:
        return True
    # numeric
    try:
        return float(s) > 0
    except (TypeError, ValueError):
        return False


def derive_environment(row: pd.Series) -> str:
    """Resolve PROD / NON-PROD / UNKNOWN with the documented preference order."""
    v1 = _norm(row.get("Prod / Non-Prod Environment")).lower()
    v2 = _norm(row.get("PROD vs NON-PROD")).lower()
    name = _norm(row.get("cluster_name")).lower()

    if v1 in {"prod", "production"}:
        return "PROD"
    if v1 in {"non-prod", "non_prod", "nonprod"}:
        return "NON-PROD"
    if v2 in {"prod", "production"}:
        return "PROD"
    if v2 in {"non-prod", "non_prod", "nonprod"}:
        return "NON-PROD"
    if v1 or v2:
        # Anything else explicit but unrecognized -> keep 'UNKNOWN' so we
        # don't silently override the source.
        if v1 or v2:
            return "UNKNOWN"
    # Fall back to name inference.
    if name:
        if "prod" in name:
            # Guard against 'non-prod' / 'nonprod' being matched by the substring 'prod'.
            if "non" in name and "prod" in name:
                return "NON-PROD"
            return "PROD"
        for pat in NONPROD_PATTERNS:
            if pat in name:
                return "NON-PROD"
    return "UNKNOWN"


def derive_optimization_scope(node_autoscaler_yes: bool, woop_yes: bool) -> str:
    if node_autoscaler_yes and woop_yes:
        return "Node Autoscaler + WOOP"
    if node_autoscaler_yes:
        return "Node Autoscaler only"
    if woop_yes:
        return "WOOP only"
    return "None / Unknown"


def derive_optimisation_target(node_autoscaler_yes: bool, woop_yes: bool) -> str:
    if woop_yes:
        return "All workloads"
    if node_autoscaler_yes:
        return "Node-level only"
    return "N/A"


def derive_agent_type(value: Any) -> str:
    s = _norm(value)
    if not s or s.lower() == "none":
        return "Unknown"
    return s


def best_source_row(group: pd.DataFrame) -> pd.Series:
    """Pick the best row when a cluster_id appears multiple times.

    Preference: latest Year + Month (most recent cost snapshot); ties broken
    by the row with the most populated fields.
    """
    if len(group) == 1:
        return group.iloc[0]

    g = group.copy()
    # Build a numeric sort key from Year / Month (handle NaN safely).
    year = pd.to_numeric(g["Year"], errors="coerce").fillna(0)
    month = pd.to_numeric(g["Month"], errors="coerce").fillna(0)
    g["_ym"] = year * 100 + month
    g["_populated"] = g.notna().sum(axis=1)
    g = g.sort_values(by=["_ym", "_populated"], ascending=[False, False])
    return g.iloc[0]


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_inventory() -> pd.DataFrame:
    inv = pd.read_excel(INVENTORY_XLSX, sheet_name="Clusters")
    inv.columns = [str(c).strip() for c in inv.columns]
    # Normalize join keys.
    inv["cluster_id"] = inv["cluster_id"].astype(str).str.strip()
    inv["org_id"] = inv["org_id"].astype(str).str.strip()
    return inv


def load_source_rows() -> pd.DataFrame:
    src = pd.read_excel(MASTER_XLSX, sheet_name=FULL_VIEW_SHEET)
    src.columns = [str(c).strip() for c in src.columns]
    # Strip whitespace on join key.
    src["05_Cast script export.cluster_id"] = (
        src["05_Cast script export.cluster_id"].astype(str).str.strip()
    )
    # Drop rows with no join key.
    src = src[src["05_Cast script export.cluster_id"].notna() &
              (src["05_Cast script export.cluster_id"].str.lower() != "nan")].copy()

    # If a cluster_id appears multiple times, pick the row with the latest
    # Year + Month, breaking ties by row with the most populated fields.
    # Sort so the 'best' row comes first, then drop_duplicates keeps it.
    year = pd.to_numeric(src["Year"], errors="coerce").fillna(0)
    month = pd.to_numeric(src["Month"], errors="coerce").fillna(0)
    populated = src.notna().sum(axis=1)
    src = src.assign(_ym=year * 100 + month, _populated=populated)
    src = src.sort_values(by=["_ym", "_populated"], ascending=[False, False])
    src = src.drop_duplicates(subset="05_Cast script export.cluster_id", keep="first")
    src = src.drop(columns=["_ym", "_populated"]).reset_index(drop=True)
    return src


def load_progress() -> Dict[str, Dict[str, Any]]:
    with open(PROGRESS_JSON, "r") as f:
        p = json.load(f)
    return p.get("clusters", {}) or {}


# ---------------------------------------------------------------------------
# Build per-cluster rows
# ---------------------------------------------------------------------------

SOURCE_COLS = {
    "organization_name": "05_Cast script export.organization",
    "organization_id_src": "05_Cast script export.organization_id",
    "provider_src": "05_Cast script export.provider",
    "agent_status_src": "05_Cast script export.agent_status",
    "optimised_src": "05_Cast script export.optimised",
    "total_vcpu": "05_Cast script export.total_vcpu",
    "managed_vcpu": "05_Cast script export.managed_vcpu",
    "unmanaged_vcpu": "05_Cast script export.unmanaged_vcpu",
    "woop_total": "05_Cast script export.woop_total",
    "woop_optimized": "05_Cast script export.woop_optimized",
    "woop_pct": "05_Cast script export.woop_pct",
    "woop_enabled_date": "05_Cast script export.woop_enabled_date",
    "spot_handler": "05_Cast script export.spot_handler",
    "node_autoscaler": "05_Cast script export.node_autoscaler",
    "created_at": "05_Cast script export.created_at",
    "agent_type": "Agent_type",
    "prod_vs_nonprod": "PROD vs NON-PROD",
    "prod_nonprod_env": "Prod / Non-Prod Environment",
    "use_case": "Use Case",
    "department_1": "Department.1.1",
    "department_2": "Department.1.2",
    "department_3": "Department.2",
    "account_owner": "Account owner",
    "technical_responsible": "Technical responsible",
    "account_id": "AccountId",
    "cost": "Cost (USD)",
    "potential_savings": "Potential Savings (USD)",
    "month": "Month",
    "year": "Year",
    "cluster_name_src": "05_Cast script export.cluster_name",
    # Change-window fields
    "onboarding_session": "Onboarding Session",
    "follow_up_1": "Follow-up #1 Read-Only",
    "follow_up_2": "Follow-up #2 Autoscale",
    "follow_up_3": "Follow-up #3 Autoscale finetune",
    "wave_planning": "Wave planning",
    "comment_owner": "Comment from Cluster Owner",
    "internal_comment": "Internal Comment",
}


def _safe_get(row: pd.Series, key: str) -> Any:
    if key not in row.index:
        return None
    val = row[key]
    if pd.isna(val):
        return None
    return val


def build_clusters_sheet(
    inventory: pd.DataFrame,
    source: pd.DataFrame,
    progress: Dict[str, Dict[str, Any]],
) -> pd.DataFrame:
    src_by_id = source.set_index("05_Cast script export.cluster_id", drop=False)

    rows = []
    missing_ids = []
    for _, inv in inventory.iterrows():
        cid = inv["cluster_id"]
        src = src_by_id.loc[cid] if cid in src_by_id.index else None
        if src is None:
            missing_ids.append(cid)
        else:
            if isinstance(src, pd.DataFrame):
                # Should not happen because source is deduped, but guard anyway.
                src = src.iloc[0]

        prog = progress.get(cid, {})

        # --- source-backed fields -------------------------------------------------
        if src is not None:
            org_name_src = _safe_get(src, SOURCE_COLS["organization_name"])
            org_id_src = _safe_get(src, SOURCE_COLS["organization_id_src"])
            provider_src = _safe_get(src, SOURCE_COLS["provider_src"])
            agent_status_src = _safe_get(src, SOURCE_COLS["agent_status_src"])
            optimised_src = _safe_get(src, SOURCE_COLS["optimised_src"])
            woop_total = _safe_get(src, SOURCE_COLS["woop_total"])
            woop_enabled_date = _safe_get(src, SOURCE_COLS["woop_enabled_date"])
            node_autoscaler_src = _safe_get(src, SOURCE_COLS["node_autoscaler"])
            agent_type_src = _safe_get(src, SOURCE_COLS["agent_type"])
            cost = _safe_get(src, SOURCE_COLS["cost"])
            potential_savings = _safe_get(src, SOURCE_COLS["potential_savings"])
            use_case = _safe_get(src, SOURCE_COLS["use_case"])
            account_owner = _safe_get(src, SOURCE_COLS["account_owner"])
            technical_responsible = _safe_get(src, SOURCE_COLS["technical_responsible"])
            account_id_src = _safe_get(src, SOURCE_COLS["account_id"])
            region_src = _safe_get(src, "Region")

            # Department: prefer the most-specific non-null of the three dept columns
            department = next(
                (v for k in (SOURCE_COLS["department_1"], SOURCE_COLS["department_2"], SOURCE_COLS["department_3"])
                 if (v := _safe_get(src, k)) is not None and _norm(v) != ""),
                None,
            )

            # booleans
            node_autoscaler_yes = is_yes(node_autoscaler_src)
            # WOOP enabled if value says so, or date set, or woop_total > 0
            woop_yes = is_yes(woop_enabled_date) or is_yes(optimised_src) or is_truthy_or_enabled(woop_total)

            env_row = {
                "Prod / Non-Prod Environment": _safe_get(src, SOURCE_COLS["prod_nonprod_env"]),
                "PROD vs NON-PROD": _safe_get(src, SOURCE_COLS["prod_vs_nonprod"]),
                "cluster_name": inv.get("cluster_name"),
            }
            environment = derive_environment(env_row)
        else:
            org_name_src = org_id_src = provider_src = agent_status_src = None
            optimised_src = woop_total = woop_enabled_date = None
            node_autoscaler_src = agent_type_src = cost = potential_savings = None
            use_case = account_owner = technical_responsible = account_id_src = None
            region_src = department = None
            node_autoscaler_yes = False
            woop_yes = False
            environment = derive_environment({
                "Prod / Non-Prod Environment": None,
                "PROD vs NON-PROD": None,
                "cluster_name": inv.get("cluster_name"),
            })

        # --- inventory-backed fields --------------------------------------------
        readiness_status = (prog.get("status") or "").lower()
        readiness_run = "YES" if readiness_status == "done" else "NO"

        rows.append({
            "cluster_id": cid,
            "cluster_name": inv.get("cluster_name"),
            "organization_id": inv.get("org_id"),
            "organization_name": org_name_src if org_name_src else inv.get("org_name"),
            "account_id": account_id_src or inv.get("cloud_account_id"),
            "provider": inv.get("provider") or provider_src,
            "region": inv.get("region") or region_src,
            "agent_status": inv.get("agent_status") or agent_status_src,
            "readiness_run": readiness_run,
            "readiness_pdf_path": prog.get("pdf"),
            "readiness_xlsx_path": prog.get("xlsx"),
            "environment": environment,
            "agent_type": derive_agent_type(agent_type_src) if agent_type_src is not None else "Unknown",
            "node_autoscaler_enabled": "YES" if node_autoscaler_yes else "NO",
            "woop_enabled": "YES" if woop_yes else "NO",
            "optimization_scope": derive_optimization_scope(node_autoscaler_yes, woop_yes),
            "optimisation_target": derive_optimisation_target(node_autoscaler_yes, woop_yes),
            "cost_usd": cost,
            "potential_savings_usd": potential_savings,
            "use_case": use_case,
            "department": department,
            "account_owner": account_owner,
            "technical_responsible": technical_responsible,
        })

    out = pd.DataFrame(rows, columns=[
        "cluster_id", "cluster_name", "organization_id", "organization_name",
        "account_id", "provider", "region", "agent_status",
        "readiness_run", "readiness_pdf_path", "readiness_xlsx_path",
        "environment", "agent_type", "node_autoscaler_enabled", "woop_enabled",
        "optimization_scope", "optimisation_target",
        "cost_usd", "potential_savings_usd",
        "use_case", "department", "account_owner", "technical_responsible",
    ])
    out.attrs["missing_ids"] = missing_ids
    return out


def build_orgs_sheet(clusters: pd.DataFrame) -> pd.DataFrame:
    grp = clusters.groupby("organization_id", dropna=False)

    def _count(series: pd.Series, target: str) -> int:
        return int((series.astype(str).str.upper() == target).sum())

    rows = []
    for org_id, g in grp:
        rows.append({
            "organization_id": org_id,
            "organization_name": g["organization_name"].dropna().iloc[0] if g["organization_name"].notna().any() else None,
            "cluster_count": len(g),
            "readiness_run_count": _count(g["readiness_run"], "YES"),
            "prod_count": _count(g["environment"], "PROD"),
            "non_prod_count": _count(g["environment"], "NON-PROD"),
            "unknown_env_count": _count(g["environment"], "UNKNOWN"),
            "node_autoscaler_count": _count(g["node_autoscaler_enabled"], "YES"),
            "woop_count": _count(g["woop_enabled"], "YES"),
            "both_count": int(((g["node_autoscaler_enabled"].str.upper() == "YES") &
                              (g["woop_enabled"].str.upper() == "YES")).sum()),
            "total_cost_usd": pd.to_numeric(g["cost_usd"], errors="coerce").sum(),
            "total_potential_savings_usd": pd.to_numeric(g["potential_savings_usd"], errors="coerce").sum(),
        })
    out = pd.DataFrame(rows, columns=[
        "organization_id", "organization_name", "cluster_count",
        "readiness_run_count", "prod_count", "non_prod_count", "unknown_env_count",
        "node_autoscaler_count", "woop_count", "both_count",
        "total_cost_usd", "total_potential_savings_usd",
    ])
    out = out.sort_values("organization_id").reset_index(drop=True)
    return out


def build_change_windows_sheet(
    clusters: pd.DataFrame,
    source: pd.DataFrame,
) -> pd.DataFrame:
    src_by_id = source.set_index("05_Cast script export.cluster_id", drop=False)
    cluster_meta = clusters.set_index("cluster_id")

    cw_cols = [
        "onboarding_session", "follow_up_1_read_only",
        "follow_up_2_autoscale", "follow_up_3_autoscale_finetune",
        "wave_planning", "comment_from_cluster_owner", "internal_comment",
    ]
    src_col_map = {
        "onboarding_session": SOURCE_COLS["onboarding_session"],
        "follow_up_1_read_only": SOURCE_COLS["follow_up_1"],
        "follow_up_2_autoscale": SOURCE_COLS["follow_up_2"],
        "follow_up_3_autoscale_finetune": SOURCE_COLS["follow_up_3"],
        "wave_planning": SOURCE_COLS["wave_planning"],
        "comment_from_cluster_owner": SOURCE_COLS["comment_owner"],
        "internal_comment": SOURCE_COLS["internal_comment"],
    }

    rows = []
    for _, c in clusters.iterrows():
        cid = c["cluster_id"]
        if cid not in src_by_id.index:
            continue
        src = src_by_id.loc[cid]
        if isinstance(src, pd.DataFrame):
            src = src.iloc[0]

        row = {
            "organization_id": c["organization_id"],
            "cluster_id": cid,
            "cluster_name": c["cluster_name"],
            "environment": c["environment"],
        }
        any_value = False
        for col in cw_cols:
            val = _safe_get(src, src_col_map[col])
            if val is None or (isinstance(val, str) and val.strip() == ""):
                val = None
            else:
                any_value = True
            row[col] = val
        if any_value:
            rows.append(row)

    out = pd.DataFrame(rows, columns=[
        "organization_id", "cluster_id", "cluster_name", "environment",
        "onboarding_session", "follow_up_1_read_only",
        "follow_up_2_autoscale", "follow_up_3_autoscale_finetune",
        "wave_planning", "comment_from_cluster_owner", "internal_comment",
    ])
    return out


def build_optimization_scope_sheet(
    clusters: pd.DataFrame,
    source: pd.DataFrame,
) -> pd.DataFrame:
    src_by_id = source.set_index("05_Cast script export.cluster_id", drop=False)

    rows = []
    for _, c in clusters.iterrows():
        cid = c["cluster_id"]
        src = src_by_id.loc[cid] if cid in src_by_id.index else None
        if src is not None and isinstance(src, pd.DataFrame):
            src = src.iloc[0]

        if src is not None:
            woop_total = _safe_get(src, SOURCE_COLS["woop_total"])
            woop_optimized = _safe_get(src, SOURCE_COLS["woop_optimized"])
            woop_pct = _safe_get(src, SOURCE_COLS["woop_pct"])
            proposed_action = _safe_get(src, "Proposed Action")
        else:
            woop_total = woop_optimized = woop_pct = proposed_action = None

        rows.append({
            "organization_id": c["organization_id"],
            "cluster_id": cid,
            "cluster_name": c["cluster_name"],
            "environment": c["environment"],
            "agent_type": c["agent_type"],
            "node_autoscaler_enabled": c["node_autoscaler_enabled"],
            "woop_enabled": c["woop_enabled"],
            "woop_total_workloads": woop_total,
            "woop_optimized_workloads": woop_optimized,
            "woop_pct": woop_pct,
            "optimization_scope": c["optimization_scope"],
            "optimisation_target": c["optimisation_target"],
            "proposed_action": proposed_action,
        })

    out = pd.DataFrame(rows, columns=[
        "organization_id", "cluster_id", "cluster_name", "environment",
        "agent_type", "node_autoscaler_enabled", "woop_enabled",
        "woop_total_workloads", "woop_optimized_workloads", "woop_pct",
        "optimization_scope", "optimisation_target", "proposed_action",
    ])
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print(f"[build] reading {INVENTORY_XLSX}")
    inventory = load_inventory()
    print(f"[build] inventory rows: {len(inventory)}")

    print(f"[build] reading {MASTER_XLSX} sheet={FULL_VIEW_SHEET!r}")
    source = load_source_rows()
    print(f"[build] source rows (deduped): {len(source)}")

    print(f"[build] reading {PROGRESS_JSON}")
    progress = load_progress()
    print(f"[build] progress entries: {len(progress)}")

    clusters = build_clusters_sheet(inventory, source, progress)
    missing_ids: list = clusters.attrs.get("missing_ids", [])
    print(f"[build] clusters rows: {len(clusters)}  unmatched: {len(missing_ids)}")

    orgs = build_orgs_sheet(clusters)
    print(f"[build] orgs rows: {len(orgs)}")

    change_windows = build_change_windows_sheet(clusters, source)
    print(f"[build] change_windows rows: {len(change_windows)}")

    opt_scope = build_optimization_scope_sheet(clusters, source)
    print(f"[build] optimization_scope rows: {len(opt_scope)}")

    print(f"[build] writing {OUT_XLSX}")
    with pd.ExcelWriter(OUT_XLSX, engine="openpyxl") as writer:
        clusters.to_excel(writer, sheet_name="Clusters", index=False)
        orgs.to_excel(writer, sheet_name="Orgs", index=False)
        change_windows.to_excel(writer, sheet_name="Change Windows", index=False)
        opt_scope.to_excel(writer, sheet_name="Optimization Scope", index=False)

    # ---------- verification ----------
    print()
    print("=" * 72)
    print("VERIFICATION")
    print("=" * 72)
    wb = pd.ExcelFile(OUT_XLSX)
    print(f"sheets: {wb.sheet_names}")

    df_clusters = pd.read_excel(OUT_XLSX, sheet_name="Clusters")
    df_orgs = pd.read_excel(OUT_XLSX, sheet_name="Orgs")
    df_cw = pd.read_excel(OUT_XLSX, sheet_name="Change Windows")
    df_os = pd.read_excel(OUT_XLSX, sheet_name="Optimization Scope")

    expected_orgs = inventory["org_id"].astype(str).str.strip().nunique()
    print(f"Clusters rows         : {len(df_clusters)} (expected 221)")
    print(f"Orgs rows             : {len(df_orgs)} (unique orgs in inventory: {expected_orgs})")
    print(f"Change Windows rows   : {len(df_cw)}")
    print(f"Optimization Scope rows: {len(df_os)}")

    rr_yes = int((df_clusters["readiness_run"].astype(str).str.upper() == "YES").sum())
    rr_no = int((df_clusters["readiness_run"].astype(str).str.upper() == "NO").sum())
    print(f"readiness_run YES     : {rr_yes}")
    print(f"readiness_run NO      : {rr_no}")

    print()
    print("--- 5-row sample: Clusters ---")
    sample_cols = [
        "cluster_id", "cluster_name", "organization_name", "environment",
        "agent_type", "node_autoscaler_enabled", "woop_enabled",
        "optimization_scope", "optimisation_target", "readiness_run",
    ]
    print(df_clusters[sample_cols].head(5).to_string(index=False))

    print()
    print("--- 5-row sample: Orgs ---")
    org_cols = [
        "organization_id", "organization_name", "cluster_count",
        "readiness_run_count", "prod_count", "non_prod_count",
        "node_autoscaler_count", "woop_count", "both_count",
    ]
    print(df_orgs[org_cols].head(5).to_string(index=False))

    if missing_ids:
        print()
        print(f"Unmatched clusters ({len(missing_ids)}):")
        for cid in missing_ids:
            row = inventory[inventory["cluster_id"] == cid].iloc[0]
            print(f"  - {cid}  name={row.get('cluster_name')!r}  org={row.get('org_name')!r}")

    anomalies = []
    if len(df_clusters) != 221:
        anomalies.append(f"Clusters row count != 221 ({len(df_clusters)})")
    if len(df_orgs) != expected_orgs:
        anomalies.append(f"Orgs row count != unique org ids ({len(df_orgs)} vs {expected_orgs})")
    if rr_no != 0:
        anomalies.append(f"{rr_no} clusters have readiness_run=NO")
    if missing_ids:
        anomalies.append(f"{len(missing_ids)} clusters could not be matched to source data")

    print()
    if anomalies:
        print("ANOMALIES:")
        for a in anomalies:
            print(f"  - {a}")
        return 1
    print("No anomalies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
