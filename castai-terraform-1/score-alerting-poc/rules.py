"""Rule engine — maps observable score failure categories to remediation
templates (rule-based, no AI; Ebrahim's framing: steps come from existing
docs, mapped to the 6 Cluster Score sub-metrics).

Thresholds follow https://docs.cast.ai/docs/cluster-score :
  - overprovisioning Healthy:  CPU < 20%  and  memory < 35%
  - rebalancer        Healthy:  >= 1 rebalance / 2 weeks;  Poor: none in 30 days
  - bin packing       Healthy:  node deletion On + Evictor On + util > 65%
  - workload opt.     Healthy:  Workload Autoscaler enabled, most workloads covered
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from signals import ClusterSignals

DOCS = {
    "cluster-score": "https://docs.cast.ai/docs/cluster-score",
    "evictor": "https://docs.cast.ai/docs/evictor",
    "rebalancing": "https://docs.cast.ai/docs/rebalancing",
    "spot-rebalancing": "https://docs.cast.ai/docs/rebalancing#spot-rebalancing",
    "workload-autoscaling": "https://docs.cast.ai/docs/workload-autoscaling-overview",
    "constraints": "https://docs.cast.ai/docs/optimization-constraints",
    "available-savings": "https://docs.cast.ai/docs/available-savings",
    "autoscaler-policies": "https://docs.cast.ai/docs/policies",
    "scheduled-rebalancing": "https://docs.cast.ai/docs/scheduled-rebalancing",
}


@dataclass
class Thresholds:
    cpu_overprov_pct: float = 20.0
    ram_overprov_pct: float = 35.0
    rebalancing_warn_days: int = 14   # Healthy is "regular"; warn past 2 weeks
    rebalancing_poor_days: int = 30   # Docs: Poor = no rebalance in 30 days
    min_savings_pct: float = 10.0     # Only cry "savings on the table" above this

    @classmethod
    def from_dict(cls, raw: dict | None) -> "Thresholds":
        t = cls()
        for key, value in (raw or {}).items():
            if hasattr(t, key) and isinstance(value, (int, float)):
                setattr(t, key, type(getattr(t, key))(value))
        return t


@dataclass
class Finding:
    rule_id: str
    sub_metric: str
    severity: str          # "poor" | "concerning" | "info"
    title: str
    description: str
    steps: list[str]
    docs: list[str]
    evidence: dict = field(default_factory=dict)


def evaluate_rules(sig: ClusterSignals, th: Thresholds | None = None,
                   now: dt.datetime | None = None) -> list[Finding]:
    now = now or dt.datetime.now(dt.timezone.utc)
    th = th or Thresholds()
    findings: list[Finding] = []
    rules = (_rule_overprovisioning, _rule_evictor, _rule_rebalancer,
             _rule_woop, _rule_rebalance_recommended, _rule_restrictions)
    for rule in rules:
        finding = rule(sig, th, now)
        if finding:
            findings.append(finding)
    return findings


def health_percent(findings: list[Finding], sig: ClusterSignals) -> int:
    """POC proxy for posture: % of the API-observable sub-metrics that are
    not flagged. Explicitly NOT the console score — the public API does not
    expose it (ClusterScoreAPI only ships restrictions)."""
    observed = 0
    flagged_ids = {f.rule_id for f in findings}
    for rule_id, has_data in (
        ("overprovisioning", sig.cpu_overprov_pct is not None or sig.ram_overprov_pct is not None),
        ("evictor_off", sig.evictor_enabled is not None),
        ("rebalance_stale", sig.rebalance_plan_count is not None),
        ("woop_off", sig.woop_policy_count is not None),
    ):
        if has_data:
            observed += 1
            flagged = rule_id in flagged_ids
            if not flagged:
                observed += 0  # placeholder keeps counting explicit
    if observed == 0:
        return 0
    flagged_observable = sum(1 for rid in flagged_ids
                             if rid in {"overprovisioning", "evictor_off",
                                        "rebalance_stale", "woop_off"})
    return max(0, round((observed - min(flagged_observable, observed)) / observed * 100))


# --- SUB_METRIC 1: cluster overprovisioning ---------------------------------

def _rule_overprovisioning(sig, th, now):
    if sig.cpu_overprov_pct is None and sig.ram_overprov_pct is None:
        return None
    cpu = sig.cpu_overprov_pct or 0.0
    ram = sig.ram_overprov_pct or 0.0
    if cpu <= th.cpu_overprov_pct and ram <= th.ram_overprov_pct:
        return None
    severe = cpu >= 2 * th.cpu_overprov_pct or ram >= 2 * th.ram_overprov_pct
    description = (
        f"Overprovisioning {cpu:.1f}% CPU / {ram:.1f}% RAM — healthy is "
        f"CPU < {th.cpu_overprov_pct:.0f}% and memory < {th.ram_overprov_pct:.0f}% "
        "(docs.cast.ai/docs/cluster-score).")
    if sig.efficiency_no_data_reason:
        description += f" Note: efficiency report has gaps ({sig.efficiency_no_data_reason})."
    return Finding(
        "overprovisioning", "Cluster overprovisioning",
        "poor" if severe else "concerning",
        f"Cluster overprovisioned ({cpu:.0f}% CPU / {ram:.0f}% RAM unused)",
        description,
        steps=[
            "Enable Evictor to continuously bin-pack underutilized nodes "
            "(workload-eviction config; start with dryRun=false only after review).",
            "Run a rebalancing plan to consolidate workloads onto right-sized nodes.",
            "Review node templates: remove oversized/rarely-used instance types so the "
            "autoscaler can pick tighter shapes.",
            "Consider enabling Workload Autoscaler to right-size requests feeding the "
            "overprovisioning number.",
        ],
        docs=[DOCS["cluster-score"], DOCS["evictor"], DOCS["rebalancing"]],
        evidence={"cpu_overprov_pct": cpu, "ram_overprov_pct": ram,
                  "cpu_threshold": th.cpu_overprov_pct, "ram_threshold": th.ram_overprov_pct},
    )


# --- SUB_METRIC 2/3: bin packing machinery ----------------------------------

def _rule_evictor(sig, th, now):
    if sig.evictor_enabled is None:
        return None
    if sig.evictor_enabled and not sig.evictor_dry_run:
        return None
    if not sig.evictor_enabled:
        title = "Evictor disabled — no continuous bin packing"
        description = ("Evictor is off. The Bin Packing sub-metric needs the node "
                       "deletion policy and Evictor on, with median node utilization "
                       "> 65%.")
        first = ("Enable Evictor on the cluster policies "
                 "(nodeDownscaler.evictor.enabled=true) — dryRun first is fine.")
    else:
        title = "Evictor is in dry-run — nothing is actually evicted"
        description = ("Evictor is enabled but still in dry-run: it simulates without "
                       "removing nodes, so fragmentation stays.")
        first = ("Switch Evictor out of dry-run (dryRun=false) after reviewing the "
                 "exclusions (non-replicated pods, StatefulSets, PVCs in aggressive "
                 "mode, DaemonSets, PDBs).")
    return Finding(
        "evictor_off", "Bin packing", "poor" if not sig.evictor_enabled else "concerning",
        title, description,
        steps=[first,
               "Confirm PDBs on critical workloads before production eviction.",
               "Annotate dedicated on-demand pools with "
               "autoscaling.cast.ai/removal-disabled=true if they must stay."],
        docs=[DOCS["evictor"], DOCS["cluster-score"]],
        evidence={"evictor_enabled": sig.evictor_enabled, "dry_run": sig.evictor_dry_run},
    )


# --- SUB_METRIC 6: rebalancer ------------------------------------------------

def _rule_rebalancer(sig, th, now):
    if sig.rebalance_plan_count is None:
        return None
    last = sig.last_rebalance_at
    age_days = (now - last).days if last else None
    if last and age_days is not None and age_days < th.rebalancing_warn_days:
        return None
    never = last is None
    stale_days = th.rebalancing_poor_days if never else age_days or 0
    severity = "poor" if (never or stale_days >= th.rebalancing_poor_days) else "concerning"
    if never:
        title = "Rebalancer never run on this cluster"
        description = ("No rebalancing plan has ever been executed. Docs: Poor = no "
                       "rebalancing in the last 30 days; recommended at least once "
                       "every two weeks.")
    else:
        title = f"Last rebalance {stale_days} days ago ({sig.last_rebalance_status or 'unknown status'})"
        description = (f"Docs: run rebalancing at least every two weeks; Poor = none "
                       f"in 30 days.")
    steps = []
    if sig.unschedulable_pods_enabled is False:
        steps.append("FIRST: enable the Unscheduled Pods policy — rebalancing refuses "
                     "to run while it is off (\"Autoscaler is disabled\" error).")
    steps += [
        "Generate a rebalancing plan in the console or via "
        "AutoscalerAPI_GenerateRebalancingPlan, review savings, execute.",
        "Set up scheduled rebalancing (weekly/biweekly) so recency stays green.",
        "If the plan comes back Partial/Failed: check problematic workloads "
        "(custom node-affinity labels, disabled node templates, hostname topology "
        "spread) and strict PDBs.",
    ]
    return Finding(
        "rebalance_stale", "Rebalancer", severity, title, description, steps,
        docs=[DOCS["rebalancing"], DOCS["scheduled-rebalancing"], DOCS["cluster-score"]],
        evidence={"last_rebalance_at": last.isoformat() if last else None,
                  "last_status": sig.last_rebalance_status,
                  "plan_count": sig.rebalance_plan_count},
    )


# --- SUB_METRIC 5: workload optimization -------------------------------------

def _rule_woop(sig, th, now):
    if sig.woop_policy_count is None:
        return None
    if sig.woop_enabled:
        return None
    if sig.woop_policy_count == 0:
        title = "Workload Autoscaler not configured on any workload"
        description = ("No workload scaling policies exist. The Workload Optimization "
                       "sub-metric needs WOOP enabled and optimizing most workloads.")
        step = ("Create one scaling policy covering broad namespaces with 'recommend'"
                " defaults, then flip optimization on for the top waste offenders.")
    else:
        title = (f"{sig.woop_policy_count} workload scaling policies exist but none "
                 "is enabled")
        description = "Enable at least one policy to start right-sizing requests."
        step = "Enable an existing scaling policy (overrides.allowOptimization=true)."
    return Finding(
        "woop_off", "Workload optimization", "poor", title, description,
        steps=[step,
               "Exclude/cover deliberately: label workloads "
               "workload-autoscaler.cast.ai/enabled=true for allowlist mode, or "
               "workload-autoscaler.cast.ai/ignore=true to opt out.",
               "Watch for PDB-blocked applies and OOM-loop cooldown (20 OOMs/h → "
               "4h pause) in the WOOP event log."],
        docs=[DOCS["workload-autoscaling"], DOCS["cluster-score"]],
        evidence={"policy_count": sig.woop_policy_count},
    )


# --- Economic hook (not a sub-metric, but the sharpest motivation) -----------

def _rule_rebalance_recommended(sig, th, now):
    if not sig.is_rebalancing_recommended:
        return None
    if sig.savings_pct is not None and sig.savings_pct < th.min_savings_pct:
        return None
    pct = f"{sig.savings_pct:.0f}%" if sig.savings_pct is not None else "significant"
    return Finding(
        "rebalance_recommended", "Available savings", "poor",
        f"CAST AI flags rebalancing as recommended — modeled savings ≈ {pct}",
        ("The available-savings recommendation says the current node configuration "
         f"could cost ≈ {pct} less — run the plan, don't leave it on the table."),
        steps=[
            "Generate and review a rebalancing plan; execute during a maintenance "
            "window if drain risk worries you.",
            "Verify spot readiness (quotas, subnet IPs, instance-type allowlists) "
            "before executing.",
        ],
        docs=[DOCS["available-savings"], DOCS["rebalancing"]],
        evidence={"savings_pct": sig.savings_pct,
                  "is_rebalancing_recommended": sig.is_rebalancing_recommended},
    )


# --- Constraint inventory: explains blockers, zero-noise ----------------------

def _rule_restrictions(sig, th, now):
    if not sig.restrictions:
        return None
    top = sig.restrictions[:5]
    lines = ", ".join(
        f"{r.get('resource', {}).get('resourceKind', '?')}/"
        f"{r.get('resource', {}).get('resourceName', '?')} -> "
        f"{','.join(r.get('restrictionIds', [])) or '?'}"
        for r in top)
    more = f" (+{len(sig.restrictions) - 5} more)" if len(sig.restrictions) > 5 else ""
    return Finding(
        "restrictions_present", "Optimization constraints", "info",
        f"{len(sig.restrictions)} optimization constraints registered",
        ("Advisory checks that explain *why* optimization may stall: " + lines + more +
         ". Constraints do not change the score but block evictions/rebalancing."),
        steps=[
            "Fix strict PDBs (maxUnavailable: 0 or minAvailable >= replicas).",
            "Add liveness/readiness probes and sane topology spread constraints.",
            "Suppress intentional cases with the pod-template annotation "
            "reporting.cast.ai/ignore-optimization-constraints: \"true\".",
        ],
        docs=[DOCS["constraints"]],
        evidence={"count": len(sig.restrictions)},
    )
