#!/usr/bin/env python3
"""
Cluster Readiness Lite Runner
=============================

Generates one branded PDF + one editable XLSX per cluster for all CAST AI clusters
listed in ``castai_cluster_inventory.xlsx``.

Why "Lite": the CAST AI public API does not expose full Kubernetes snapshots
(deployments, pods, PDBs, etc.), so we work with what is reachable via REST and
emit a JSON shape compatible with ``.kimchi/skills/cluster-readiness/scripts/generate_report.py``.

Inputs:
  - /Users/eramadan/castai/projects/castai-billing-export/.env (CASTAI_API_KEY)
  - /Users/eramadan/castai/cluster-readiness-outputs/castai_cluster_inventory.xlsx

Outputs (per cluster):
  reports/{org_id}/{cluster_id}/readiness_{cluster_id}.pdf
  reports/{org_id}/{cluster_id}/readiness_{cluster_id}.xlsx
  reports/{org_id}/{cluster_id}/data.json

State:
  reports/progress.json (resumable)
  reports/summary.json  (final counts)

Usage:
  python3 run_readiness_lite.py --one <cluster_id>     # test single cluster
  python3 run_readiness_lite.py                        # process all clusters
  python3 run_readiness_lite.py --no-resume            # regenerate everything
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

# ── Constants ────────────────────────────────────────────────────────────────
REPO_ROOT = Path("/Users/eramadan/castai")
INV_PATH = REPO_ROOT / "cluster-readiness-outputs" / "castai_cluster_inventory.xlsx"
ENV_PATH = REPO_ROOT / "projects" / "castai-billing-export" / ".env"
OUT_ROOT = REPO_ROOT / "cluster-readiness-outputs" / "reports"
PROGRESS_PATH = OUT_ROOT / "progress.json"
SUMMARY_PATH = OUT_ROOT / "summary.json"
GENERATOR = REPO_ROOT / ".kimchi" / "skills" / "cluster-readiness" / "scripts" / "generate_report.py"
API_BASE = "https://api.eu.cast.ai"

HTTP_TOO_MANY = 429
HTTP_SERVER_RANGE = range(500, 600)
MAX_ATTEMPTS = 4
RETRY_BACKOFF = 1.6  # exponential factor
INTER_CLUSTER_SLEEP = 0.5
REQUEST_TIMEOUT = 30


# ── Utility ──────────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_api_key() -> str:
    if not ENV_PATH.exists():
        raise SystemExit(f"Env file not found: {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r'^\s*CASTAI_API_KEY\s*=\s*"?([^"\s]+)"?\s*$', line)
        if m:
            return m.group(1)
    raise SystemExit("CASTAI_API_KEY not found in env file")


def safe_slug(name: str, fallback: str = "cluster") -> str:
    s = re.sub(r"[^\w\-.]+", "-", name or "").strip("-")
    return s or fallback


# ── API client with retry ────────────────────────────────────────────────────
class CastAIClient:
    def __init__(self, api_key: str):
        self.session = requests.Session()
        self.session.headers.update({
            "X-API-Key": api_key,
            "Accept": "application/json",
            "User-Agent": "castai-readiness-lite/1.0",
        })

    def get(self, org_id: str, path: str, params: dict | None = None) -> tuple[int, Any]:
        """GET with retry/backoff. Returns (http_status, parsed_json_or_text)."""
        headers = {"X-CastAI-Organization-Id": org_id}
        url = f"{API_BASE}{path}"
        last_status = 0
        last_body: Any = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                resp = self.session.get(
                    url, headers=headers, params=params, timeout=REQUEST_TIMEOUT,
                )
                last_status = resp.status_code
                if last_status < 400:
                    try:
                        last_body = resp.json()
                    except ValueError:
                        last_body = resp.text
                    return last_status, last_body
                # Retry on 429 / 5xx
                if last_status == HTTP_TOO_MANY or last_status in HTTP_SERVER_RANGE:
                    delay = (RETRY_BACKOFF ** attempt) * 1.0
                    log(f"  retry {attempt}/{MAX_ATTEMPTS} after HTTP {last_status} ({path}); sleeping {delay:.1f}s")
                    time.sleep(delay)
                    continue
                # Client error — return body, do not retry
                try:
                    last_body = resp.json()
                except ValueError:
                    last_body = resp.text
                return last_status, last_body
            except requests.RequestException as e:
                delay = (RETRY_BACKOFF ** attempt) * 1.0
                log(f"  network error {attempt}/{MAX_ATTEMPTS} ({e}); sleeping {delay:.1f}s")
                time.sleep(delay)
        return last_status, last_body


# ── Schema builders ──────────────────────────────────────────────────────────
def build_snapshot(meta: dict, nodes_payload: dict, cost: dict, workloads_payload: dict) -> dict:
    """Aggregate minimal counters from reachable API data."""
    nodes = (nodes_payload or {}).get("items") or []
    spot_nodes = sum(1 for n in nodes if (n.get("spotConfig") or {}).get("isSpot"))
    on_demand_nodes = len(nodes) - spot_nodes

    workloads = ((workloads_payload or {}).get("workloads") or []) if workloads_payload else []
    kind_counts = Counter((w.get("kind") or "Other") for w in workloads)

    snap = {
        "nodes": len(nodes),
        "spot_nodes": spot_nodes,
        "on_demand_nodes": on_demand_nodes,
        "deployments": kind_counts.get("Deployment", 0),
        "statefulsets": kind_counts.get("StatefulSet", 0),
        "daemonsets": kind_counts.get("DaemonSet", 0),
        "workloads_total": len(workloads),
        "pdbs": 0,         # not available via API
        "hpas": 0,         # not available via API
        "namespaces": 0,   # not available via API
    }
    if cost:
        snap["cost_hourly"] = cost.get("costHourly")
        snap["optimal_cost_hourly"] = cost.get("optimalCostHourly")
        snap["cpu_provisioned"] = cost.get("cpuProvisioned")
        snap["ram_provisioned"] = cost.get("ramProvisioned")
        snap["cpu_requested"] = cost.get("cpuRequested")
        snap["ram_requested"] = cost.get("ramRequested")
        snap["avg_cpu_utilization"] = cost.get("avgCpuUtilization")
        snap["avg_ram_utilization"] = cost.get("avgRamUtilization")
    return snap


def build_checks(meta: dict, nodes_payload: dict, cost: dict, savings: dict, policies: dict,
                 workloads_payload: dict | None) -> list[dict]:
    """Return the 10 Lite checks defined in the plan."""
    nodes = (nodes_payload or {}).get("items") or []
    spot = sum(1 for n in nodes if (n.get("spotConfig") or {}).get("isSpot"))
    on_demand = len(nodes) - spot
    families = sorted({(n.get("instanceType") or "").split(".")[0] for n in nodes if n.get("instanceType")})

    agent_status = (meta or {}).get("agentStatus") or "unknown"
    cluster_status = (meta or {}).get("status") or "unknown"
    is_phase2 = bool((meta or {}).get("isPhase2"))
    region = ((meta or {}).get("region") or {}).get("name") or ""
    provider = (meta or {}).get("providerType") or ""

    cost_have = bool(cost and cost.get("costHourly") is not None)
    cost_status = cost_have

    sav_items = ((savings or {}).get("items") or [])
    total_spot_sav = 0.0
    total_downscaling_sav = 0.0
    for it in sav_items:
        try:
            total_spot_sav += float(it.get("spotSavings") or 0)
            total_downscaling_sav += float(it.get("downscalingSavings") or 0)
        except (TypeError, ValueError):
            continue
    savings_total = total_spot_sav + total_downscaling_sav

    autoscaler = (policies or {}).get("enabled")
    node_constraints = ((policies or {}).get("unschedulablePods") or {}).get("nodeConstraints") or {}
    spot_cfg = (policies or {}).get("spotInstances") or {}
    downscaler = (policies or {}).get("nodeDownscaler") or {}
    pod_pinner = (((policies or {}).get("unschedulablePods") or {}).get("podPinner") or {})

    if agent_status == "online":
        agent_check = ("PASS", f"Agent reporting online (cluster status: {cluster_status}).")
    elif agent_status in ("waiting-connection", "waiting"):
        agent_check = ("REVIEW", f"Agent in waiting-connection state — verify network/credentials.")
    elif agent_status in ("disconnected", "non-responding"):
        agent_check = ("CRITICAL", f"Agent is {agent_status} — reconnect required before enablement.")
    else:
        agent_check = ("REVIEW", f"Agent status unknown ({agent_status}).")

    if is_phase2:
        scope_status = "MONITOR"
        scope_detail = (f"Phase 2 cluster — Node Autoscaler and Workload Autoscaler (WOOP) in scope. "
                        f"Region: {region}.")
    else:
        scope_status = "MONITOR"
        scope_detail = ("Read-only cluster — Node Autoscaler and Workload Autoscaler not in scope; "
                        "this Lite report covers metadata, nodes, policies, and cost signals only.")

    if len(nodes) == 0:
        spot_status = "REVIEW"
        spot_detail = "No node inventory available — cannot determine spot mix."
        spot_pct = None
    else:
        spot_pct = round(100.0 * spot / len(nodes), 1)
        if spot_pct >= 70:
            spot_status = "PASS"
        elif spot_pct >= 40:
            spot_status = "MONITOR"
        else:
            spot_status = "REVIEW"
        spot_detail = (f"{spot} of {len(nodes)} nodes are Spot ({spot_pct}%); "
                       f"{on_demand} on-demand.")

    if not families:
        families_status = "REVIEW"
        families_detail = "No instance families observed — node inventory empty or unavailable."
    elif len(families) <= 4:
        families_status = "PASS"
        families_detail = f"Observed instance families: {', '.join(families)} ({len(families)})."
    else:
        families_status = "MONITOR"
        families_detail = f"{len(families)} instance families observed: {', '.join(families)} — review for consolidation."

    cost_check = ("PASS", "Cost overview returned hourly cost and utilisation data.") if cost_have \
        else ("REVIEW", "Cost overview unavailable — verify the agent is reporting data.")

    if savings_total > 0:
        savings_status = "MONITOR"
        savings_detail = (f"Reported savings in window: spot ${total_spot_sav:.2f}, "
                          f"downscaling ${total_downscaling_sav:.2f}, total ${savings_total:.2f}.")
    elif sav_items:
        savings_status = "MONITOR"
        savings_detail = "Savings endpoint returned data but totals are zero in this window."
    else:
        savings_status = "REVIEW"
        savings_detail = "No savings data available in the queried window."

    pol_lines = []
    pol_lines.append(f"Autoscaler enabled: {'yes' if autoscaler else 'no'}")
    pol_lines.append(f"Spot instances enabled: {'yes' if spot_cfg.get('enabled') else 'no'}")
    if spot_cfg.get("spotBackups", {}).get("enabled"):
        pol_lines.append("Spot backups: enabled")
    pol_lines.append(f"Node downscaler enabled: {'yes' if downscaler.get('enabled') else 'no'}")
    pol_lines.append(f"PodPinner enabled: {'yes' if pod_pinner.get('enabled') else 'no'}")
    if node_constraints.get("enabled"):
        pol_lines.append(
            f"Node constraints: CPU {node_constraints.get('minCpuCores')}-"
            f"{node_constraints.get('maxCpuCores')}c, "
            f"RAM {node_constraints.get('minRamMib')}-"
            f"{node_constraints.get('maxRamMib')} MiB"
        )
    policy_check = ("MONITOR", " | ".join(pol_lines))

    node_template_check = (
        "REVIEW",
        "Prescriptive default: balanced spot (m5/m6i family, fallback to on-demand). "
        "Critical workload template: on-demand (m5/m6i, no spot fallback) for stateful or "
        "single-replica workloads. See Section 4 of the report for full template guidance.",
    )

    if is_phase2:
        wl_count = len(((workloads_payload or {}).get("workloads") or []))
        woop_check = (
            "REVIEW",
            f"Workload Autoscaler (WOOP) eligible — {wl_count} workloads discovered. "
            "Confirm pilot namespace and policy assignment before activation.",
        )
    else:
        woop_check = (
            "MONITOR",
            "Read-only cluster — WOOP not installed. Upgrade to Phase 2 to enable workload right-sizing.",
        )

    snap_check = (
        "MONITOR",
        "Deployment, pod, PDB, HPA, and VPA checks require a full cluster snapshot — not "
        "available via the CAST AI public API. Deferred to a follow-up in-cluster scan.",
    )

    return [
        {
            "status": agent_check[0],
            "name": "Agent Status",
            "category": "Connectivity",
            "detail": agent_check[1],
            "why": "The CAST AI agent must be reachable before any automation can be enabled.",
            "action": "If disconnected, verify IAM/network credentials and reconnect via the CAST AI console.",
            "verify": "Agent status returns 'online' in the cluster list.",
        },
        {
            "status": scope_status,
            "name": "Automation Scope",
            "category": "Onboarding",
            "detail": scope_detail,
            "why": "Defines whether Node Autoscaler and Workload Autoscaler are in scope for this engagement.",
            "action": "Confirm scope with the TAM before requesting activation.",
            "verify": "Scope matches the customer expectation for this engagement.",
        },
        {
            "status": spot_status,
            "name": "Spot Mix",
            "category": "Cost",
            "detail": spot_detail,
            "why": "A healthy spot mix (>70%) maximises CAST AI savings without sacrificing reliability for tolerant workloads.",
            "action": "If spot mix is low, identify fault-tolerant workloads that can be moved to spot via node templates.",
            "verify": "Spot node percentage trends upward after autoscaler activation.",
        },
        {
            "status": families_status,
            "name": "Node Diversity",
            "category": "Cost",
            "detail": families_detail,
            "why": "Diverse instance families help spot diversity and pricing optimisation; too many families increases management overhead.",
            "action": "Consolidate to 3-4 preferred families per region with spot diversity enabled.",
            "verify": "Spot diversity increase limit reflects the recommended consolidation.",
        },
        {
            "status": cost_check[0],
            "name": "Cost Visibility",
            "category": "Cost",
            "detail": cost_check[1],
            "why": "Hourly cost and utilisation data are the foundation for savings recommendations and right-sizing.",
            "action": "If cost data is missing, wait one snapshot cycle (5-15 min) and re-check; investigate agent connectivity if persistent.",
            "verify": "Cost overview endpoint returns costHourly, cpuProvisioned, and ramProvisioned.",
        },
        {
            "status": savings_status,
            "name": "Savings Opportunity",
            "category": "Cost",
            "detail": savings_detail,
            "why": "Tracks realised savings from spot usage and downscaling in the observed window.",
            "action": "Compare against the cluster's spend baseline to validate CAST AI value realisation.",
            "verify": "Savings values are positive and trending up over time.",
        },
        {
            "status": policy_check[0],
            "name": "Policy Configuration",
            "category": "Autoscaler",
            "detail": policy_check[1],
            "why": "Autoscaler, spot, downscaler, and PodPinner policies determine how aggressively CAST AI optimises the cluster.",
            "action": "Confirm policy settings match the customer's risk tolerance; tighten constraints for production-critical workloads.",
            "verify": "Policies match the TAM-approved configuration recorded in the engagement notes.",
        },
        {
            "status": node_template_check[0],
            "name": "Node Template Guidance",
            "category": "Autoscaler",
            "detail": node_template_check[1],
            "why": "Well-designed node templates balance cost (spot) with reliability (on-demand fallback) per workload class.",
            "action": "Create at least one default spot template and one on-demand critical template per region.",
            "verify": "Templates visible in the CAST AI console and referenced by the autoscaler.",
        },
        {
            "status": woop_check[0],
            "name": "WOOP Readiness",
            "category": "Workload Autoscaler",
            "detail": woop_check[1],
            "why": "WOOP performs right-sizing based on observed utilisation; pilot scope must be validated before rollout.",
            "action": "Choose a low-risk pilot namespace and a conservative policy; review recommendations weekly.",
            "verify": "Pilot workloads receive recommendations and applied changes are visible in the console.",
        },
        {
            "status": snap_check[0],
            "name": "Workload Snapshot Access",
            "category": "Coverage",
            "detail": snap_check[1],
            "why": "Deployment/pod/PDB/HPA/VPA checks require an in-cluster snapshot; deferred for this Lite report.",
            "action": "Run an in-cluster readiness scan (kubectl + CAST AI snapshot) for a full check set.",
            "verify": "Follow-up Lite+ or Full report includes deployment-level findings.",
        },
    ]


def build_report_payload(
    row: pd.Series, meta: dict, nodes_payload: dict, policies: dict,
    cost: dict, savings: dict, workloads_payload: dict | None,
) -> dict:
    snapshot = build_snapshot(meta, nodes_payload, cost, workloads_payload)
    checks = build_checks(meta, nodes_payload, cost, savings, policies, workloads_payload)
    region = ((meta or {}).get("region") or {}).get("name") or row.get("region") or ""
    provider = (meta or {}).get("providerType") or row.get("provider") or ""

    payload = {
        "cluster_name": row.get("cluster_name") or meta.get("name") or row["cluster_id"],
        "cluster_id": row["cluster_id"],
        "customer": row.get("org_name") or "Unknown Customer",
        "cloud": f"{provider.upper()} · {region}" if region else (provider.upper() or "Unknown"),
        "today": date.today().strftime("%-d %B %Y"),

        "onboarding_scope": {
            "node_autoscaler": bool(row.get("is_autoscaler") or False),
            "workload_autoscaler": bool(row.get("is_phase2") or False),
            "tam_name": "CAST AI Customer Success",
            "customer_contact": row.get("org_name") or "To be confirmed",
            "evictor_mode": "non-aggressive",
            "lite_report": True,
            "scope_note": ("Lite report — generated from CAST AI public API only. "
                           "Full deployment/pod/PDB checks require an in-cluster snapshot."),
        },

        "snapshot": snapshot,
        "checks": checks,
        "findings": [],

        "node_autoscaler_config": {
            "node_templates": [],
            "rebalancing": {"schedule": "non-scheduled", "recommended_frequency_days": 60,
                             "notes": "Lite report — templates not yet authored."},
            "evictor": {"mode": "non-aggressive", "cycle_minutes": 30,
                         "grace_minutes": 120, "max_nodes_per_run": 5,
                         "notes": "Defaults applied; tune per engagement."},
        },

        "workload_autoscaler_config": {
            "policies": [],
            "policy_assignment": [],
            "pilot_namespace": "",
            "pilot_duration_days": 7,
            "startup_metrics": {"enabled": False, "notes": "Lite report — assign in follow-up."},
        },

        "actions": [],
        "checklist": [],
        "rollout": {},
    }
    return payload


# ── Pipeline ─────────────────────────────────────────────────────────────────
def fetch_all(client: CastAIClient, org_id: str, cluster_id: str, is_phase2: bool):
    """Fetch all reachable endpoints; return a dict with each payload (or None on failure)."""
    out: dict[str, Any] = {}

    status, body = client.get(org_id, f"/v1/kubernetes/external-clusters/{cluster_id}")
    if status == 200 and isinstance(body, dict):
        out["meta"] = body
    else:
        out["meta"] = None
        log(f"  metadata: HTTP {status}")

    status, body = client.get(org_id, f"/v1/kubernetes/external-clusters/{cluster_id}/nodes")
    out["nodes"] = body if status == 200 and isinstance(body, dict) else None
    if status != 200:
        log(f"  nodes: HTTP {status}")

    status, body = client.get(org_id, f"/v1/kubernetes/clusters/{cluster_id}/policies")
    out["policies"] = body if status == 200 and isinstance(body, dict) else None
    if status != 200:
        log(f"  policies: HTTP {status}")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30)
    params = {
        "startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    status, body = client.get(org_id, f"/v1/cost-reports/clusters/{cluster_id}/overview", params)
    out["cost"] = body if status == 200 and isinstance(body, dict) else None
    if status != 200:
        log(f"  cost overview: HTTP {status}")

    status, body = client.get(org_id, f"/v1/cost-reports/clusters/{cluster_id}/savings", params)
    out["savings"] = body if status == 200 and isinstance(body, dict) else None
    if status != 200:
        log(f"  savings: HTTP {status}")

    out["workloads"] = None
    if is_phase2:
        status, body = client.get(org_id, f"/v1/workload-autoscaling/clusters/{cluster_id}/workloads")
        if status == 200 and isinstance(body, dict):
            out["workloads"] = body
        elif status in (400, 404):
            log(f"  workloads: HTTP {status} (expected for some Phase2 clusters) — ignored")
        else:
            log(f"  workloads: HTTP {status}")

    return out


def generate_outputs(payload: dict, out_dir: Path, cluster_id: str) -> tuple[Path, Path]:
    """Write JSON, run generator, rename outputs to readiness_{cluster_id}.{pdf,xlsx}.

    The generator derives its own filename from cluster_name when given a path
    ending in .pdf/.xlsx, so we pass the *directory* (which triggers the
    directory branch of derive_output_paths) and then rename.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    data_path = out_dir / "data.json"
    data_path.write_text(json.dumps(payload, indent=2, default=str))

    # Use a tmp subdir so the generator's auto-name doesn't collide between
    # clusters with the same name. We then rename to the canonical names.
    tmp_dir = out_dir / "_tmp"
    tmp_dir.mkdir(exist_ok=True)

    cmd = [
        sys.executable, str(GENERATOR),
        "--data", str(data_path),
        "--output", str(tmp_dir),     # directory path -> generator picks filename
        "--also-xlsx", str(tmp_dir),  # same directory; --also-xlsx expects a path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"generate_report.py failed (exit {result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )

    # The generator always writes these two filenames when given a directory.
    safe = re.sub(r"[^\w\-]", "-", payload.get("cluster_name") or cluster_id).strip("-") or "cluster"
    auto_pdf = tmp_dir / f"Cluster Onboarding Readiness Report – {safe}.pdf"
    auto_xlsx = tmp_dir / f"Cluster Onboarding Readiness Report – {safe}.xlsx"
    final_pdf = out_dir / f"readiness_{cluster_id}.pdf"
    final_xlsx = out_dir / f"readiness_{cluster_id}.xlsx"

    # If generator wrote them with a slightly different safe name, glob.
    if not auto_pdf.exists():
        candidates = list(tmp_dir.glob("*.pdf"))
        if candidates:
            auto_pdf = candidates[0]
    if not auto_xlsx.exists():
        candidates = list(tmp_dir.glob("*.xlsx"))
        if candidates:
            auto_xlsx = candidates[0]

    if not auto_pdf.exists() or auto_pdf.stat().st_size == 0:
        raise RuntimeError("generator did not produce a non-empty PDF")
    if not auto_xlsx.exists() or auto_xlsx.stat().st_size == 0:
        raise RuntimeError("generator did not produce a non-empty XLSX")

    # Replace existing outputs if present.
    for src, dst in [(auto_pdf, final_pdf), (auto_xlsx, final_xlsx)]:
        if dst.exists():
            dst.unlink()
        src.rename(dst)

    # Cleanup tmp dir
    try:
        for f in tmp_dir.iterdir():
            f.unlink()
        tmp_dir.rmdir()
    except OSError:
        pass

    return final_pdf, final_xlsx


# ── Progress tracking ────────────────────────────────────────────────────────
def load_progress() -> dict:
    if PROGRESS_PATH.exists():
        try:
            return json.loads(PROGRESS_PATH.read_text())
        except json.JSONDecodeError:
            log("progress.json corrupted — starting fresh")
    return {"version": 1, "started_at": datetime.now(timezone.utc).isoformat(),
            "clusters": {}}


def save_progress(progress: dict) -> None:
    PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PROGRESS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(progress, indent=2))
    tmp.replace(PROGRESS_PATH)


def already_done(progress: dict, cluster_id: str, out_dir: Path) -> bool:
    """Both PDF and XLSX must exist and be non-empty."""
    state = progress.get("clusters", {}).get(cluster_id)
    pdf = out_dir / f"readiness_{cluster_id}.pdf"
    xlsx = out_dir / f"readiness_{cluster_id}.xlsx"
    return (state and state.get("status") == "done"
            and pdf.exists() and pdf.stat().st_size > 0
            and xlsx.exists() and xlsx.stat().st_size > 0)


# ── Main loop ────────────────────────────────────────────────────────────────
def process_one(client: CastAIClient, row: pd.Series, progress: dict, resume: bool) -> str:
    cluster_id = row["cluster_id"]
    org_id = row["org_id"]
    cluster_dir = OUT_ROOT / org_id / cluster_id

    if resume and already_done(progress, cluster_id, cluster_dir):
        return "skipped"

    log(f"{cluster_id} ({row.get('cluster_name') or '?'}, {row.get('org_name') or '?'})")

    fetched = fetch_all(client, org_id, cluster_id, bool(row.get("is_phase2")))
    meta = fetched.get("meta") or {}
    # Even when the metadata call failed, fall back to inventory columns so the
    # report still has identity fields.
    if not meta:
        meta = {
            "name": row.get("cluster_name"),
            "id": cluster_id,
            "region": {"name": row.get("region")},
            "providerType": row.get("provider"),
            "agentStatus": row.get("agent_status") or "unknown",
            "status": row.get("status") or "unknown",
            "isPhase2": bool(row.get("is_phase2")),
        }

    payload = build_report_payload(
        row, meta,
        fetched.get("nodes") or {},
        fetched.get("policies") or {},
        fetched.get("cost") or {},
        fetched.get("savings") or {},
        fetched.get("workloads"),
    )

    pdf, xlsx = generate_outputs(payload, cluster_dir, cluster_id)
    log(f"  wrote {pdf.name} ({pdf.stat().st_size} bytes)")
    log(f"  wrote {xlsx.name} ({xlsx.stat().st_size} bytes)")

    progress.setdefault("clusters", {})[cluster_id] = {
        "status": "done",
        "pdf": str(pdf),
        "xlsx": str(xlsx),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "org_id": org_id,
        "cluster_name": row.get("cluster_name"),
    }
    save_progress(progress)
    return "done"


def main():
    ap = argparse.ArgumentParser(description="Generate CAST AI Cluster Readiness Lite reports.")
    ap.add_argument("--one", metavar="CLUSTER_ID", help="Process a single cluster by ID")
    ap.add_argument("--no-resume", action="store_true", help="Regenerate even if output exists")
    args = ap.parse_args()

    if not INV_PATH.exists():
        raise SystemExit(f"Inventory not found: {INV_PATH}")
    if not GENERATOR.exists():
        raise SystemExit(f"Generator not found: {GENERATOR}")

    api_key = load_api_key()
    log(f"Loaded API key from {ENV_PATH}")
    log(f"EU API base: {API_BASE}")

    df = pd.read_excel(INV_PATH, sheet_name="Clusters")
    log(f"Loaded {len(df)} clusters from inventory")

    if args.one:
        mask = df["cluster_id"].astype(str) == args.one
        if not mask.any():
            raise SystemExit(f"Cluster {args.one} not found in inventory")
        df = df[mask].reset_index(drop=True)

    client = CastAIClient(api_key)
    progress = load_progress()
    resume = not args.no_resume

    counts = {"done": 0, "skipped": 0, "failed": 0}
    failures: list[dict] = []

    for idx, row in df.iterrows():
        cluster_id = row["cluster_id"]
        org_id = row["org_id"]
        cluster_dir = OUT_ROOT / org_id / cluster_id
        try:
            outcome = process_one(client, row, progress, resume)
            counts[outcome] += 1
        except Exception as e:  # noqa: BLE001
            counts["failed"] += 1
            log(f"FAILED {cluster_id}: {e}")
            failures.append({"cluster_id": cluster_id, "error": str(e),
                             "org_id": org_id,
                             "cluster_name": row.get("cluster_name")})
            progress.setdefault("clusters", {})[cluster_id] = {
                "status": "failed",
                "error": str(e),
                "org_id": org_id,
                "cluster_name": row.get("cluster_name"),
                "failed_at": datetime.now(timezone.utc).isoformat(),
            }
            save_progress(progress)

        if idx + 1 < len(df):
            time.sleep(INTER_CLUSTER_SLEEP)

    total = len(df)
    summary = {
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "total": total,
        "done": counts["done"],
        "skipped": counts["skipped"],
        "failed": counts["failed"],
        "failures": failures,
    }
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2))
    log(f"DONE — total={total} done={counts['done']} skipped={counts['skipped']} failed={counts['failed']}")
    log(f"Progress: {PROGRESS_PATH}")
    log(f"Summary : {SUMMARY_PATH}")


if __name__ == "__main__":
    main()
