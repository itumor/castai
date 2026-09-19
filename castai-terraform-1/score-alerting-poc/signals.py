"""Signal collection: one ClusterSignals per cluster, from documented APIs.

Each source is fetched independently and failures are captured in
``ClusterSignals.errors`` so one flaky endpoint never blanks the whole
cluster — the rule engine works on whatever arrived.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from castai_client import ApiError, CastaiClient


def parse_ts(value: str | None) -> dt.datetime | None:
    """Parse an RFC-3339 timestamp, tolerating a trailing Z."""
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass
class ClusterSignals:
    """Everything the rule engine needs for one cluster. Sources:
    https://docs.cast.ai/reference/llms.txt (efficiency, savings, policies,
    evictor config, WOOP policies, rebalancing plans, restrictions)."""

    cluster_id: str
    cluster_name: str = ""
    organization_id: str = ""
    organization_name: str = ""
    region: str = ""
    provider: str = ""

    # Numeric console "Cluster Score" is not exposed by the public API.
    # The POC ships a data-driven proxy; a real score can be injected from
    # config (`console_scores`) and is carried here untouched for display.
    console_score: float | None = None

    # Sub-metric 1: Cluster Overprovisioning (efficiency report)
    cpu_overprov_pct: float | None = None
    ram_overprov_pct: float | None = None
    efficiency_no_data_reason: str | None = None

    # Sub-metric 2: Bin packing machinery (policies + evictor config)
    evictor_enabled: bool | None = None
    evictor_dry_run: bool | None = None
    unschedulable_pods_enabled: bool | None = None
    spot_enabled: bool | None = None

    # Sub-metric 5: Workload optimization (WOOP scaling policies)
    woop_policy_count: int | None = None
    woop_enabled: bool | None = None

    # Sub-metric 6: Rebalancer (rebalance plan history)
    rebalance_plan_count: int | None = None
    last_rebalance_at: dt.datetime | None = None
    last_rebalance_status: str | None = None

    # Economic context (estimated savings / available savings)
    savings_pct: float | None = None
    is_rebalancing_recommended: bool | None = None

    # Optimization constraints (ClusterScoreAPI restrictions)
    restrictions: list[dict] = field(default_factory=list)

    errors: dict = field(default_factory=dict)


def _safe(errors: dict, key: str, fn):
    """Run ``fn`` and stow any API error under ``key`` instead of raising."""
    try:
        return fn()
    except ApiError as exc:  # one bad endpoint should not kill the scan
        errors[key] = str(exc)
        return None


def collect_cluster_signals(client: CastaiClient, cluster: dict,
                            org_name: str = "",
                            lookback_days: int = 31,
                            now: dt.datetime | None = None,
                            console_score: float | None = None
                            ) -> ClusterSignals:
    """Fetch every signal source for ``cluster`` (an ExternalClusterAPI item)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    start = (now - dt.timedelta(hours=3)).isoformat()

    sig = ClusterSignals(
        cluster_id=cluster.get("id", ""),
        cluster_name=cluster.get("name", ""),
        organization_id=cluster.get("organizationId", ""),
        organization_name=org_name,
        region=(cluster.get("region") or {}).get("name", ""),
        provider=cluster.get("providerType", ""),
        console_score=console_score,
    )
    cid = sig.cluster_id
    err = sig.errors

    window_start = (now - dt.timedelta(days=lookback_days)).isoformat()
    eff = _safe(err, "efficiency", lambda: client.efficiency(cid, window_start, now.isoformat()))
    if eff:
        sig.cpu_overprov_pct = _num(eff.get("cpuOverprovisioningPercent"))
        sig.ram_overprov_pct = _num(eff.get("ramOverprovisioningPercent"))
        reason = eff.get("noDataReason")
        if reason and not reason.endswith("UNSPECIFIED"):
            sig.efficiency_no_data_reason = reason

    pol = _safe(err, "policies", lambda: client.autoscaler_policies(cid))
    if pol:
        downscaler = pol.get("nodeDownscaler") or {}
        ev = downscaler.get("evictor") or {}
        if "enabled" in ev:
            sig.evictor_enabled = bool(ev.get("enabled"))
        if "dryRun" in ev:
            sig.evictor_dry_run = bool(ev.get("dryRun"))
        up = pol.get("unschedulablePods") or {}
        if "enabled" in up:
            sig.unschedulable_pods_enabled = bool(up.get("enabled"))
        spot = pol.get("spotInstances") or {}
        if "enabled" in spot:
            sig.spot_enabled = bool(spot.get("enabled"))

    ev_cfg = _safe(err, "evictor", lambda: client.evictor_config(cid))
    if ev_cfg:
        ev = ev_cfg.get("evictor") or ev_cfg
        if "enabled" in ev:
            sig.evictor_enabled = bool(ev.get("enabled"))
        if "dryRun" in ev:
            sig.evictor_dry_run = bool(ev.get("dryRun"))

    woop = _safe(err, "woop", lambda: client.woop_policies(cid))
    if woop is not None:
        policies = woop.get("policies") or woop.get("items") or []
        sig.woop_policy_count = len(policies)
        sig.woop_enabled = any(p.get("enabled", True) for p in policies) if policies else False

    plans = _safe(err, "rebalance", lambda: client.rebalancing_plans(cid))
    if plans is not None:
        items = (plans.get("rebalancingPlans") or plans.get("items") or
                 plans.get("plans") or [])
        sig.rebalance_plan_count = len(items)
        times = sorted(filter(None, (parse_ts(p.get("createdAt") or
                                              p.get("createTime")) for p in items)))
        if times:
            sig.last_rebalance_at = times[-1]
            latest = next((p for p in items
                           if parse_ts(p.get("createdAt") or p.get("createTime")) == times[-1]),
                          items[-1])
            sig.last_rebalance_status = latest.get("status", "")

    sav = _safe(err, "savings", lambda: client.estimated_savings(cid))
    if sav:
        sig.is_rebalancing_recommended = sav.get("isRebalancingRecommended")
        recs = sav.get("recommendations") or {}
        pcts = []
        for rec in recs.values():
            if isinstance(rec, dict) and rec.get("savingsPercentage") is not None:
                try:
                    pcts.append(float(rec["savingsPercentage"]))
                except (TypeError, ValueError):
                    pass
        if pcts:
            sig.savings_pct = max(pcts)

    rest = _safe(err, "restrictions",
                 lambda: client.restrictions(sig.organization_id, cid))
    if rest is not None:
        sig.restrictions = rest.get("items", []) or []

    _ = start  # kept for future per-cluster time-series needs
    return sig


def _num(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
