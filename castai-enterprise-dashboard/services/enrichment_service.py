"""Opt-in bounded enrichment batch runner (performance-v2 §2).

Generic ThreadPoolExecutor runner over the CURRENT FILTERED fleet slice —
never "all clusters". Per-cluster failure isolation mirrors the Tier-1 sweep:
an exception inside one cluster's task becomes a sanitized FetchError (with
``.kind`` = exception class, GAP-B) and NEVER escapes its future; the batch as
a whole NEVER raises once running. Over-cap scopes are REFUSED pre-flight with
a ValueError (before any client call — perf-v2 §2.3: no silent chunking).

Kinds (hard caps: total estimated calls ≤ 800/run):
  * ``realized``      — 1 call/cluster (clusters/{id}/savings, long-read
                        windowed): cluster cap 100 (or 400 with allow_large).
                        Rows whose status/agent/reporting_state says
                        disconnected are PRE-SKIPPED (would 4xx/empty).
  * ``na_policies``   — 1 call/cluster (policies): cap 400.
  * ``health``        — 3 calls/cluster, serial within the cluster
                        (nodes phase classify + problematic-nodes +
                        problematic-workloads): cap 400.
  * ``wa_coverage``   — 1 call/cluster (workloads-summary incl. costs),
                        attempted only on rows whose WA agent status is
                        RUNNING: cap 400.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from services.organization_service import FetchError
from utils.errors import error_kind, sanitize_message

_TOTAL_CALL_CAP = 800  # perf-v2 §2.3: refuse >800 estimated calls per run
_KIND_CLUSTER_CAPS = {"realized": 100, "na_policies": 400, "health": 400, "wa_coverage": 400}
_KIND_CALLS_PER_CLUSTER = {"realized": 1, "na_policies": 1, "health": 3, "wa_coverage": 1}
_REALIZED_LARGE_CAP = 400  # explicit allow_large escape for realized (finops §6)
_MAX_WORKER_CAP = 32  # docs/architecture.md §4

# Pre-skip predicates (finops-model §6.6 / reliability-model §1.3): a
# disconnected or never-connected cluster cannot serve a windowed report.
_DISCONNECTED_STATES = {"disconnected", "disconnecting"}
_WA_RUNNING = {"AGENT_STATUS_RUNNING", "RUNNING"}

NODE_PHASES = (
    "unknown", "pending", "creating", "ready", "not_ready",
    "draining", "deleting", "deleted", "interrupted", "cordoned",
)

__all__ = ["EnrichmentResult", "run_enrichment", "NODE_PHASES"]


@dataclass
class EnrichmentResult:
    values: dict[tuple[str, str], dict] = field(default_factory=dict)
    errors: list[FetchError] = field(default_factory=list)
    attempted: int = 0
    succeeded: int = 0
    caps: dict = field(default_factory=dict)  # cluster_cap/call_cap/estimated/skipped


def _get(row: Any, key: str, default: Any = None) -> Any:
    """Row accessor tolerant of dicts and attribute objects (fleet rows)."""

    if isinstance(row, dict):
        return row.get(key, default)
    return getattr(row, key, default)


def _is_disconnected(row: Any) -> bool:
    for key in ("status", "agent_status"):
        if str(_get(row, key, "") or "").strip().lower() in _DISCONNECTED_STATES:
            return True
    reporting = str(_get(row, "reporting_state", "") or "").strip().upper()
    return reporting.endswith("DISCONNECTED")


def _wa_running(row: Any) -> bool:
    for key in ("workload_autoscaler_status", "wa_status"):
        value = str(_get(row, key, "") or "").strip().upper()
        if value in _WA_RUNNING:
            return True
    return False


def _default_window_30d() -> tuple[str, str]:
    """Trailing-30-day RFC-3339 Z window (realized default; finops §3)."""

    from datetime import datetime, timedelta, timezone

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return start.strftime(fmt), end.strftime(fmt)


# ------------------------------------------------------------- kind handlers
def _realized(client: Any, org_id: str, cluster_id: str, row: Any) -> dict:
    """1 call: realized savings over the row/window (finops-model §3).

    pct denominator = ``totalCost + totalSavings`` (pre-optimization baseline
    framing) — NA when the denominator is not positive, never clamped to 0.
    """
    start = _get(row, "start") or _get(row, "window_start")
    end = _get(row, "end") or _get(row, "window_end")
    if not start or not end:
        start, end = _default_window_30d()
    payload = client.get_cluster_realized_savings(
        org_id, cluster_id, start, end,
        **({"step_seconds": _get(row, "step_seconds")} if _get(row, "step_seconds") else {}),
    )
    from data.normalizers import parse_number  # deferred: heavy pandas import

    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    total_cost = parse_number(summary.get("totalCost"))
    total_savings = parse_number(summary.get("totalSavings"))
    down = spot = 0.0
    seen_bucket = False
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        seen_bucket = True
        down += parse_number(item.get("downscalingSavings")) or 0.0
        spot += parse_number(item.get("spotSavings")) or 0.0
    # summary.totalSavings is authoritative (spec); item sums are the fallback.
    savings = total_savings if total_savings is not None else (down + spot if seen_bucket else None)
    baseline = (total_cost + savings) if (total_cost is not None and savings is not None) else None
    pct = (savings / baseline) if (baseline is not None and baseline > 0) else None
    return {
        "realized_savings": savings,
        "realized_savings_pct": pct,
        "realized_downscaling": down,
        "realized_spot": spot,
        "realized_window_cost": total_cost,
    }


def _na_policies(client: Any, org_id: str, cluster_id: str, row: Any) -> dict:
    """1 call: node-autoscaler policy flags (tolerant of both wire layouts)."""

    payload = client.get_cluster_policies(org_id, cluster_id)
    payload = payload if isinstance(payload, dict) else {}
    downscaler = payload.get("nodeDownscaler") if isinstance(payload.get("nodeDownscaler"), dict) else {}
    spot = payload.get("spotInstances") if isinstance(payload.get("spotInstances"), dict) else {}
    evictor = payload.get("evictor")
    if not isinstance(evictor, dict):  # evictor may nest under nodeDownscaler
        nested = downscaler.get("evictor")
        evictor = nested if isinstance(nested, dict) else {}
    ev_active = evictor.get("enabled")
    return {
        "na_enabled": payload.get("enabled"),
        "na_spot_enabled": spot.get("enabled"),
        "evictor_enabled": ev_active,
        "evictor_status": None if ev_active is None else ("enabled" if ev_active else "disabled"),
        "node_downscaler_enabled": downscaler.get("enabled"),
    }


def _health(client: Any, org_id: str, cluster_id: str, row: Any) -> dict:
    """3 serial calls: nodes phase classify + problematic nodes/workloads.

    Partial results are kept when a subset of the calls fails; per-call
    failures surface through the batch's FetchError list (handled by the
    runner's per-cluster wrapper below — this function only raises).

    Cordoned = ``state.phase == "cordoned"`` OR ``unschedulable`` (union —
    reliability-model §1.2); unknown/absent phases count as ``nodes_unknown``.
    """
    out: dict[str, Any] = {}
    nodes_payload = client.get_cluster_nodes(org_id, cluster_id)
    counts = {f"nodes_{phase}": 0 for phase in NODE_PHASES}
    counts["nodes_other"] = 0
    for node in (nodes_payload or {}).get("items") or []:
        if not isinstance(node, dict):
            continue
        state = node.get("state") if isinstance(node.get("state"), dict) else {}
        phase = str(state.get("phase") or "unknown")
        if phase == "cordoned" or node.get("unschedulable") is True:
            counts["nodes_cordoned"] += 1
            continue
        counts[f"nodes_{phase}" if phase in NODE_PHASES else "nodes_other"] += 1
    out.update(counts)

    problems = client.get_problematic_nodes(org_id, cluster_id)
    workload_problems = client.get_problematic_workloads(org_id, cluster_id)
    nodes_list = (problems or {}).get("nodes") or []
    controllers = (workload_problems or {}).get("controllers") or []
    pods = (workload_problems or {}).get("standalonePods") or []
    reasons: list[str] = []
    for entry in [*nodes_list, *controllers, *pods]:
        if not isinstance(entry, dict):
            continue
        for problem in entry.get("problems") or []:
            if isinstance(problem, str) and problem:
                reasons.append(problem)
    out["nodes_total_classified"] = sum(counts.values())
    out["problematic_nodes_count"] = len(nodes_list)
    out["problematic_workloads_count"] = len(controllers) + len(pods)
    out["problematic_reasons"] = reasons[:20]  # bounded — never a flood
    return out


def _wa_coverage(client: Any, org_id: str, cluster_id: str, row: Any) -> dict:
    """1 call: WA workloads-summary (includeCosts=true) coverage extraction.

    v2-OPS extension: the full ``GetWorkloadsSummaryResponse`` surface joins
    as 11 extra keys (VPA/HPA optimized split, API/annotation managed split,
    core/memory deltas, original-requested + actual-usage baselines) — every
    one NA-safe (absent -> None, NEVER 0-fabricated); the generic
    ``merge_enrichment`` renames them ``enr_wa_coverage_<key>`` — no clashes
    with the pre-existing 4 keys by construction.
    """

    payload = client.get_wa_workloads_summary(org_id, cluster_id)
    payload = payload if isinstance(payload, dict) else {}
    total = payload.get("totalCount")
    optimized = payload.get("optimizedCount")
    costs = payload.get("costsPerHour") if isinstance(payload.get("costsPerHour"), dict) else {}
    from data.normalizers import parse_number  # deferred: heavy pandas import

    requested = parse_number(costs.get("requested"))
    recommended = parse_number(costs.get("recommended"))
    savings = (requested - recommended) if (requested is not None and recommended is not None) else None
    coverage = (
        (float(optimized) / float(total))
        if (total is not None and optimized is not None and float(total) > 0)
        else None
    )
    return {
        "wa_total_workloads": total,
        "wa_optimized_workloads": optimized,
        "wa_coverage_pct": coverage,
        "wa_estimated_savings_hourly": savings,
        # --- v2-OPS: full summary enrichment (all NA-safe via parse_number) --
        "wa_optimized_vpa_count": parse_number(payload.get("vpaOptimizedCount")),
        "wa_optimized_hpa_count": parse_number(payload.get("hpaOptimizedCount")),
        "wa_optimized_both_count": parse_number(payload.get("hpaVpaOptimizedCount")),
        "wa_api_managed_count": parse_number(payload.get("apiManagedCount")),
        "wa_annotation_managed_count": parse_number(payload.get("annotationManagedCount")),
        "wa_cpu_cores_difference": parse_number(payload.get("cpuCoresDifference")),
        "wa_memory_difference": parse_number(payload.get("memoryDifference")),
        "wa_original_requested_cpu": parse_number(payload.get("originalRequestedCpuCores")),
        "wa_original_requested_ram_gib": parse_number(payload.get("originalRequestedMemoryGibs")),
        "wa_usage_cpu_cores": parse_number(payload.get("usageCpuCores")),
        "wa_usage_memory_gib": parse_number(payload.get("usageMemoryGibs")),
    }


_KIND_RUNNERS = {
    "realized": _realized,
    "na_policies": _na_policies,
    "health": _health,
    "wa_coverage": _wa_coverage,
}


# ------------------------------------------------------------------- runner
def run_enrichment(
    kind: str,
    client: Any,
    clusters_iter: Iterable[Any],
    *,
    max_workers: int = 8,
    progress_cb: Callable[[int, int, float, float], None] | None = None,
    allow_large: bool = False,
) -> EnrichmentResult:
    """Run one bounded enrichment batch; returns a result NEVER raised into.

    Raises ValueError PRE-FLIGHT (before any client call) when the estimated
    call volume exceeds the kind/run caps — perf-v2 §2.3 forbids silent
    chunking; the message tells the caller to narrow the filter.
    """
    if kind not in _KIND_RUNNERS:
        raise ValueError(f"unknown enrichment kind {kind!r}.")

    rows_in = [r for r in (clusters_iter or []) if r is not None]
    runner = _KIND_RUNNERS[kind]
    skipped = 0
    work: list[tuple[str, str, Any]] = []
    for row in rows_in:
        org_id = str(_get(row, "organization_id", "") or "")
        cluster_id = str(_get(row, "cluster_id", "") or "")
        if not cluster_id:
            skipped += 1
            continue
        if kind == "realized" and _is_disconnected(row):
            skipped += 1  # finops §6.6: pre-skip disconnected rows
            continue
        if kind == "wa_coverage" and not _wa_running(row):
            skipped += 1  # coverage only meaningful where WA is RUNNING
            continue
        work.append((org_id, cluster_id, row))

    cluster_cap = _KIND_CLUSTER_CAPS[kind]
    if kind == "realized" and allow_large:
        cluster_cap = _REALIZED_LARGE_CAP
    estimated_calls = len(work) * _KIND_CALLS_PER_CLUSTER[kind]
    caps = {
        "cluster_cap": cluster_cap,
        "call_cap": _TOTAL_CALL_CAP,
        "estimated_calls": estimated_calls,
        "skipped": skipped,
    }
    if len(work) > cluster_cap:
        raise ValueError(
            f"enrichment {kind!r} refused: {len(work)} clusters exceeds the "
            f"{cluster_cap}-cluster cap — narrow the filter (org/provider/status) "
            f"to <= {cluster_cap} clusters."
        )
    if estimated_calls > _TOTAL_CALL_CAP:
        raise ValueError(
            f"enrichment {kind!r} refused: {estimated_calls} estimated calls exceeds "
            f"the {_TOTAL_CALL_CAP}-call cap per run — narrow the filter."
        )

    result = EnrichmentResult(caps=caps)
    total = len(work)
    if not total:
        return result

    workers = max(1, min(int(max_workers), _MAX_WORKER_CAP))
    started = time.monotonic()

    def _task(org_id: str, cluster_id: str, row: Any) -> tuple[tuple[str, str], dict, list[FetchError]]:
        op_errors: list[FetchError] = []
        try:
            values = runner(client, org_id, cluster_id, row)
        except Exception as exc:  # per-cluster isolation; NEVER escapes
            op_errors.append(
                FetchError(
                    organization_id=org_id,
                    organization_name=str(_get(row, "organization_name", "") or ""),
                    operation=f"enrichment:{kind}",
                    message=sanitize_message(str(exc)),
                    kind=error_kind(exc),
                )
            )
            values = {}
        return (org_id, cluster_id), (values if isinstance(values, dict) else {}), op_errors

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_task, org_id, cluster_id, row) for org_id, cluster_id, row in work]
        for future in as_completed(futures):
            try:
                key, values, op_errors = future.result()
            except Exception as exc:  # belt-and-braces identical to the sweep
                key, values, op_errors = ("", ""), {}, [
                    FetchError(
                        organization_id="",
                        organization_name="",
                        operation=f"enrichment:{kind}",
                        message=sanitize_message(str(exc)),
                        kind=error_kind(exc),
                    )
                ]
            result.attempted += 1
            result.errors.extend(op_errors)
            if not op_errors:
                result.succeeded += 1
            if values and key != ("", ""):
                result.values[key] = values
            if progress_cb is not None:
                elapsed = time.monotonic() - started
                rate = elapsed / result.attempted if result.attempted else 0.0
                try:
                    progress_cb(result.attempted, total, elapsed, rate * (total - result.attempted))
                except Exception:
                    pass  # UI telemetry must never break the batch
    return result
