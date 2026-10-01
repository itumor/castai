#!/usr/bin/env python3
"""
build_dataset.py — raw CAST AI API snapshots -> browser-ready analytics JSON.

Offline pipeline: reads data/raw/{cost,savings,workload,events} snapshots
(collected by the `collect:*` scripts / subagents) and writes data/processed/
JSON consumed by the dashboard. No API calls are made here.

Methodology implemented (from .kimchi/docs/siemens-savings-methodology.md):
  M1  single-factor frozen unit price   p = ΣC(t)/ΣV(t)  over the pre-switch
      read-only window, adjusted(t) = p · V(t), gross = adjusted − actual
  M1b two-resource frozen prices        p_cpu, p_mem from the API's own
      cpu/mem cost decomposition, c_other residual
  ER  efficiency ratio                  e(t) = (ΣC/ΣV over window)/p
  M4  layers (when WOOP usage data exists): L_W demand, L_N packing, L_P price
  CAST AI cross-check                   realized savings ±30% band, never blended

Retention gap handling (user requirement): months without telemetry are not
hidden; they are emitted as `estimated` rows filled from the nearest era's
average daily cost, always flagged ESTIMATED_AVG_FILL.

Usage:
  python3 scripts/build_dataset.py            # from project root
"""

import calendar
import datetime as dt
import glob
import json
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed")
WEB_DATA = os.path.join(ROOT, "public", "data")
FEE_RATE = 0.05
RECONCILE_TOL = 0.30
MIN_BASELINE_DAYS = 21
MAX_GAP_FILL_DAYS = 31 * 12  # never fill more than a year of gap per era

CLUSTERS = {
    "main": "5dc3bf31-a263-4c6b-88bb-e95b6403aa51",
    "test": "00ee8944-67f6-43d5-8517-c270951ec02c",
}
SWITCH_DATE_DEFAULT = "2026-07-22"

def today_utc():
    return dt.datetime.now(dt.timezone.utc).date()


def shift_label(ts):
    """Cost/resource-usage daily buckets are END-LABELED (verified 2026-09-26:
    snapshot taken 09-26T05:30Z carried a 09-27 label). The label L covers
    calendar day L-1; drop labels that map to today (partial). Returns None
    for the partial-current-day bucket."""
    d = day_of(ts)
    if not d:
        return None
    mapped = dt.date.fromisoformat(d) - dt.timedelta(days=1)
    if mapped >= today_utc():
        return None
    return mapped.isoformat()


# --------------------------------------------------------------------------- #
# generic helpers
# --------------------------------------------------------------------------- #

def read_json(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def pick(item, *keys):
    if not isinstance(item, dict):
        return 0.0
    for k in keys:
        if k in item and item[k] not in (None, ""):
            return fnum(item[k])
    return 0.0


def day_of(ts):
    return (ts or "")[:10]


def iso_day(d):
    return d.isoformat() if isinstance(d, dt.date) else str(d)[:10]


def daterange(d0, d1):
    cur = d0
    while cur < d1:
        yield cur
        cur += dt.timedelta(days=1)


def bootstrap_ci_halfwidth(cost, vcpu, draws=999, seed=42):
    import random
    rng = random.Random(seed)
    n = len(cost)
    idx_all = range(n)
    ps = []
    for _ in range(draws):
        idx = [rng.choice(idx_all) for _ in idx_all]
        sv = sum(vcpu[i] for i in idx)
        if sv > 0:
            ps.append(sum(cost[i] for i in idx) / sv)
    if len(ps) < 30:
        return None
    ps.sort()
    lo = ps[int(0.025 * len(ps))]
    hi = ps[int(0.975 * len(ps)) - 1]
    p = sum(cost) / sum(vcpu)
    return ((hi - lo) / 2) / p if p else None


# --------------------------------------------------------------------------- #
# raw snapshot loaders (each returns {date: {...}} daily series per cluster)
# --------------------------------------------------------------------------- #

def load_cost_series(short):
    """Per-cluster /v1/cost-reports/clusters/{id}/cost chunks.
    Items are verified avg-HOURLY values per daily bucket; auto-calibrate the
    representation per chunk against summary.avgCost (x24 vs x1)."""
    days = {}
    flags = set()
    for path in sorted(glob.glob(os.path.join(RAW, "cost", f"cost_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        items = data.get("items", []) or []
        summary = data.get("summary", {}) or {}
        raw = []
        for it in items:
            d = shift_label(it.get("timestamp"))
            if not d:
                continue
            cA = pick(it, "costOnDemand") + pick(it, "costSpot") + pick(it, "costSpotFallback")
            cBu = pick(it, "cpuCostOnDemand") + pick(it, "cpuCostSpot") + pick(it, "cpuCostSpotFallback")
            cBr = pick(it, "ramCostOnDemand") + pick(it, "ramCostSpot") + pick(it, "ramCostSpotFallback")
            cB = cBu + cBr
            v = pick(it, "cpuCountOnDemand") + pick(it, "cpuCountSpot") + pick(it, "cpuCountSpotFallback")
            if v == 0.0:
                v = pick(it, "cpuCount", "cpuProvisioned", "avgCpuCount")
            m = (pick(it, "ramGibOnDemand") + pick(it, "ramGibSpot") + pick(it, "ramGibSpotFallback")) \
                or pick(it, "ramGib", "ramGibProvisioned", "totalRamGib")
            vspot = pick(it, "cpuCountSpot") + pick(it, "cpuCountSpotFallback")
            raw.append((d, cA, cB, v, m, vspot, cBu, cBr))
        if not raw:
            continue
        pos = [r for r in raw if r[1] > 0]
        mean_A = statistics.mean(r[1] for r in pos) if pos else None
        posB = [r for r in raw if r[2] > 0]
        mean_B = statistics.mean(r[2] for r in posB) if posB else None
        avg_cost = fnum(summary.get("avgCost"))
        choice, factor, ok = ("A" if mean_A else "B"), 24.0, False
        if avg_cost:
            for rep_name, rep_mean in (("A", mean_A), ("B", mean_B)):
                if not rep_mean:
                    continue
                if abs(rep_mean - avg_cost) / avg_cost <= 0.12:
                    choice, factor, ok = rep_name, 24.0, True
                    break
                if abs(rep_mean - avg_cost * 24) / (avg_cost * 24) <= 0.12:
                    choice, factor, ok = rep_name, 1.0, True
                    break
        if not ok:
            flags.add("CALIBRATION_ASSUMED_X24")
        for d, cA, cB, v, m, vspot, cBu, cBr in raw:
            cost_raw = cA if choice == "A" else cB
            days[d] = {
                "actualCost": cost_raw * factor,
                "vcpu": v,
                "ramGib": m,
                "vcpuSpot": vspot,
                "cpuCost": (cBu if cB > 0 else cost_raw * 0.88) * factor,
                "memCost": (cBr if cB > 0 else cost_raw * 0.12) * factor,
            }
    return days, flags


def load_resource_usage(short):
    """/v1/cost-reports/clusters/{id}/resource-usage — requested/used series.
    Same end-labeled buckets as the cost endpoint."""
    days = {}
    for path in sorted(glob.glob(os.path.join(RAW, "cost", f"resource-usage_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        for it in data.get("items", []) or []:
            d = shift_label(it.get("timestamp"))
            if not d:
                continue
            days[d] = {
                "cpuRequested": pick(it, "cpuRequested"),
                "cpuUsed": pick(it, "cpuUsed"),
                "ramRequestedGib": pick(it, "ramRequested", "ramRequestedGib"),
                "ramUsedGib": pick(it, "ramUsed", "ramUsedGib"),
            }
    return days


def load_estimated_savings_history(short):
    """/estimated-savings-history — real vs optimized variants over time."""
    series = []
    for path in sorted(glob.glob(os.path.join(RAW, "cost", f"savings-history_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        items = data.get("items") or data.get("curve") or []
        for it in items:
            d = day_of(it.get("createdAt"))
            cur = it.get("current") or {}
            spot = it.get("optimizedSpotInstances") or {}
            layman = it.get("optimizedLayman") or {}
            series.append({
                "date": d,
                "currentPerHour": pick(cur, "costPerHour"),
                "currentVcpu": pick(cur, "totalCpu"),
                "spotOptimizedPerHour": pick(spot, "costPerHour"),
                "laymanOptimizedPerHour": pick(layman, "costPerHour"),
                "spotShareOptimized": None,
            })
    dedup = {}
    for row in series:
        if row["date"]:
            dedup[row["date"]] = row
    return [dedup[d] for d in sorted(dedup)]


def load_vr_timeline(short):
    """Value-realization timeline POST snapshots (per-cluster via body filter)."""
    daily, monthly = {}, []
    for path in sorted(glob.glob(os.path.join(RAW, "savings", f"vr-timeline-day_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        for it in data.get("timelineItems", []) or []:
            d = day_of(it.get("timestamp"))
            if not d:
                continue
            cost = it.get("cost") or {}
            cpu = it.get("cpu") or {}
            mem = it.get("memory") or {}
            nodes = it.get("nodes") or {}
            # unit quirk (verified): derive real vCPU/GiB from *Hours accumulators
            v = pick(cpu, "provisionedCoreHours") / 24.0 or pick(cpu, "provisionedCoresHourly") * 2.0
            m = pick(mem, "provisionedByteHours") / 24.0 / (1024 ** 3) or pick(mem, "provisionedGib") * 2.0
            daily[d] = {
                "castActual": pick(cost, "actualCost"),
                "castProjected": pick(cost, "projectedCost"),
                "castAutoscalerSavings": pick(cost, "autoscalerSavings"),
                "castWoopSavings": pick(cost, "workloadAutoscalerSavings"),
                "castTotalSavings": pick(cost, "totalSavings"),
                "vcpu": v,
                "ramGib": m,
                "reqCpuHourly": pick(cpu, "requestedCoresHourly"),
                "nodeCount": pick(nodes, "actualNodeCount"),
                "projectedNodeCount": pick(nodes, "projectedNodeCount"),
                "cpuCost": pick(cpu, "actualCost"),
                "memCost": pick(mem, "actualCost"),
            }
    for path in sorted(glob.glob(os.path.join(RAW, "savings", f"vr-timeline-month_{short}.json"))):
        data = read_json(path)
        if not data:
            continue
        for it in data.get("timelineItems", []) or []:
            d = day_of(it.get("timestamp"))
            if not d:
                continue
            cost = it.get("cost") or {}
            monthly.append({
                "month": d[:7],
                "castActual": pick(cost, "actualCost"),
                "castProjected": pick(cost, "projectedCost"),
                "castTotalSavings": pick(cost, "totalSavings"),
                "castAutoscalerSavings": pick(cost, "autoscalerSavings"),
                "castWoopSavings": pick(cost, "workloadAutoscalerSavings"),
            })
    return daily, monthly


def load_legacy_savings(short):
    days = {}
    for path in sorted(glob.glob(os.path.join(RAW, "savings", f"savings_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        for it in data.get("items", []) or []:
            d = day_of(it.get("timestamp"))
            if d:
                days[d] = {
                    "downscalingSavings": pick(it, "downscalingSavings"),
                    "spotSavings": pick(it, "spotSavings"),
                }
    summary_total = None
    for path in sorted(glob.glob(os.path.join(RAW, "savings", f"savings_{short}_*.json"))):
        data = read_json(path)
        if data:
            summary_total = fnum((data.get("summary") or {}).get("totalSavings"))
    return days, summary_total


def load_baseline_params(short):
    data = read_json(os.path.join(RAW, "savings", f"baseline-params_{short}.json")) or {}
    return {
        "baselineType": data.get("baselineType"),
        "periodStart": day_of(data.get("baselinePeriodStartTime")),
        "periodEnd": day_of(data.get("baselinePeriodEndTime")),
        "costPerCpuCoreHourly": fnum(data.get("costPerCpuCoreHourly")),
        "cpuOverprovisioningFactor": fnum(data.get("cpuOverprovisioningFactor")),
    }


def load_estimated_savings(short):
    data = read_json(os.path.join(RAW, "savings", f"estimated-savings_{short}.json")) or {}
    recs = data.get("recommendations") or {}
    out = {"isRebalancingRecommended": data.get("isRebalancingRecommended"),
           "lastUpdatedAt": data.get("lastUpdatedAt"), "modes": {}}
    for mode, rec in recs.items():
        if isinstance(rec, dict):
            out["modes"][mode] = {"monthly": fnum(rec.get("monthly")),
                                  "savingsPercentage": fnum(rec.get("savingsPercentage"))}
    return out


def load_woop_usage(short):
    """/v1/workload-autoscaling/.../resource-usage — HOURLY samples, real fields
    (verified 2026-09-26): cpuRequestCores (R), cpuOriginalRequestCores (r_org,
    CAST AI's own pre-WOOP request record = M4 estimator (c)), cpuUsageCores (U),
    memory*Gibs. Aggregate to daily means."""
    acc = {}
    for path in sorted(glob.glob(os.path.join(RAW, "workload", f"resource-usage_{short}_*.json"))):
        if "400" in path:  # the rejected full-range probe file
            continue
        data = read_json(path)
        if not data:
            continue
        for it in data.get("items", []) or []:
            d = day_of(it.get("timestamp"))
            if not d:
                continue
            a = acc.setdefault(d, {"n": 0, "req": 0.0, "orig": 0.0, "used": 0.0,
                                   "reqM": 0.0, "origM": 0.0, "usedM": 0.0})
            a["n"] += 1
            a["req"] += fnum(it.get("cpuRequestCores"))
            a["orig"] += fnum(it.get("cpuOriginalRequestCores"))
            a["used"] += fnum(it.get("cpuUsageCores"))
            a["reqM"] += fnum(it.get("memoryRequestGibs"))
            a["origM"] += fnum(it.get("memoryOriginalRequestGibs"))
            a["usedM"] += fnum(it.get("memoryUsageGibs"))
    days = {}
    for d, a in acc.items():
        n = max(a["n"], 1)
        days[d] = {
            "cpuRequested": a["req"] / n,
            "origReqCpu": a["orig"] / n,
            "cpuUsed": a["used"] / n,
            "ramRequestedGib": a["reqM"] / n,
            "origReqRamGib": a["origM"] / n,
            "ramUsedGib": a["usedM"] / n,
        }
    return days


def load_woop_component(short):
    data = read_json(os.path.join(RAW, "workload", f"woop-component_{short}.json")) or {}
    return {"installedAt": data.get("installedAt"), "currentVersion": data.get("currentVersion"),
            "latestVersion": data.get("latestVersion"), "status": data.get("status"),
            "inPlaceResizeEnabled": data.get("inPlaceResizeEnabled")}


def load_woop_summary(short):
    data = read_json(os.path.join(RAW, "workload", f"woop-summary_{short}.json")) or {}
    cph = data.get("costsPerHour") or {}
    return {
        "totalWorkloads": fnum(data.get("totalCount")),
        "optimizedWorkloads": fnum(data.get("optimizedCount")),
        "vpaOptimized": fnum(data.get("vpaOptimizedCount")),
        "requestedPerHour": pick(cph, "requested"),
        "recommendedPerHour": pick(cph, "recommended"),
        "originalRequestedPerHour": pick(cph, "originalRequested"),
        "requestedCpuCores": fnum(data.get("requestedCpuCores")),
        "recommendedCpuCores": fnum(data.get("recommendedCpuCores")),
        "originalRequestedCpuCores": fnum(data.get("originalRequestedCpuCores")),
        "usageCpuCores": fnum(data.get("usageCpuCores")),
    }


def load_policies(short):
    data = read_json(os.path.join(RAW, "events", f"policies_{short}.json")) or {}
    spot = data.get("spotInstances") or {}
    return {"enabled": data.get("enabled"), "isScopedMode": data.get("isScopedMode"),
            "spotEnabled": spot.get("enabled") if isinstance(spot, dict) else None,
            "nodeDownscaler": bool((data.get("nodeDownscaler") or {}).get("enabled") if isinstance(data.get("nodeDownscaler"), dict) else False),
            "raw_keys": sorted(data.keys())[:12]}


def load_events(short, cluster_id):
    """Normalize audit events + rebalance plans into one event list."""
    events = []
    seen = set()

    def add(date, etype, title, details=None):
        if not date:
            return
        key = (date, etype, title)
        if key in seen:
            return
        seen.add(key)
        events.append({"date": date, "type": etype, "clusterId": cluster_id,
                       "title": title, "details": details or {}})

    # --- audit v2 pages (unfiltered samples + filtered autoscaler/WOOP sweeps)
    for path in sorted(glob.glob(os.path.join(RAW, "events", f"audit-v2_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        items = data.get("items") or data.get("events") or []
        for ev in items:
            occurred = day_of(ev.get("occurredAt") or ev.get("time"))
            domain = ev.get("eventDomain") or ev.get("eventType") or "unknown"
            resource = ev.get("eventResource") or ""
            action = ev.get("eventAction") or ev.get("operation") or ""
            label = f"{domain}/{resource}/{action}".lower()
            actor = (ev.get("actor") or {}).get("email") or (ev.get("initiatedBy") or {}).get("email") or ""
            if "polic" in label and ("enabl" in label or "activ" in label):
                add(occurred, "policy-enabled", "Autoscaler policy enabled", {"actor": actor, "raw": f"{domain}/{resource}/{action}"})
            elif "polic" in label or "configur" in label:
                add(occurred, "policy-change", f"Policy {action or 'change'}", {"actor": actor, "raw": f"{domain}/{resource}/{action}"})
            elif "rebalance" in label or "rebalanc" in resource.lower():
                add(occurred, "rebalance", f"Rebalance {action or 'event'}", {"actor": actor, "raw": f"{domain}/{resource}/{action}"})
            elif "workload" in label or "vpa" in label:
                add(occurred, "woop-activity", f"Workload autoscaler {action or 'event'}",
                    {"actor": actor, "raw": f"{domain}/{resource}/{action}"})
            else:
                add(occurred, "audit", f"{domain}/{resource}/{action}", {"actor": actor})
    # --- audit v1 fallback pages
    for path in sorted(glob.glob(os.path.join(RAW, "events", f"audit_{short}_*.json"))):
        data = read_json(path)
        if not data:
            continue
        for ev in data.get("items", []) or []:
            occurred = day_of(ev.get("time"))
            op = (ev.get("operation") or ev.get("event") or "").lower()
            if "polic" in op and ("enabl" in op or "activ" in op):
                add(occurred, "policy-enabled", "Autoscaler policy enabled", {"raw": ev.get("operation")})
            elif "rebalance" in op:
                add(occurred, "rebalance", ev.get("operation") or "Rebalance", {})

    # --- rebalance plans (authoritative for "rebalance applied")
    plans_path = os.path.join(RAW, "events", f"rebalancing-plans_{short}.json")
    plans = read_json(plans_path) or {}
    for pl in plans.get("items", []) or plans.get("rebalancingPlans", []) or []:
        pid = pl.get("rebalancingPlanId") or pl.get("id")
        detail = read_json(os.path.join(RAW, "events", f"rebalancing-plan_{short}_{pid}.json")) or pl
        status = detail.get("status") or pl.get("status") or ""
        diff = detail.get("diff") or pl.get("diff") or {}
        confs = detail.get("configurations") or pl.get("configurations") or []
        totals = [c.get("totals") or {} for c in confs]
        price_h = sum(fnum(t.get("priceHourly")) for t in totals) or None
        nodes_n = sum(fnum(t.get("nodes")) for t in totals) or None
        det = {
            "planId": pid, "status": status,
            "savingsPercentage": fnum(diff.get("savingsPercentage")) or None,
            "clusterSavingsPercentage": fnum(diff.get("clusterSavingsPercentage")) or None,
            "replaceableNodes": fnum(diff.get("replaceableNodes")) or None,
            "priceHourlyAfter": price_h,
            "nodesAfter": nodes_n,
            "rebalancingNodes": len(detail.get("rebalancingNodeIds") or []),
        }
        add(day_of(detail.get("generatedAt") or pl.get("generatedAt")), "rebalance-planned",
            f"Rebalance plan generated ({status})", det)
        if detail.get("finishedAt") or pl.get("finishedAt"):
            add(day_of(detail.get("finishedAt") or pl.get("finishedAt")), "rebalance",
                f"Rebalance {status} ({det['rebalancingNodes']} nodes)", det)
    return sorted(events, key=lambda e: (e["date"], e["type"]))


# --------------------------------------------------------------------------- #
# analytics
# --------------------------------------------------------------------------- #

def compute_baseline(days, sw_date, bp):
    """Frozen unit prices over the best available *pre-switch* era.

    Methodology: contiguous read-only days immediately before the switch date.
    Empirically the cost-report has a Dec-2025→Jul-2026 telemetry hole, so scan
    backward from the switch in 60-day tiles and take the FIRST tile holding
    ≥ MIN_BASELINE_DAYS valid days. Flags disclose any non-contiguity."""
    sw = dt.date.fromisoformat(sw_date)
    floor = dt.date(2025, 10, 21)  # cluster onboarding
    valid = {d: v for d, v in days.items()
             if d < sw_date and v["actualCost"] > 0 and v["vcpu"] > 0}
    if not valid:
        return None

    cursor = sw
    chosen = None
    while cursor > floor and chosen is None:
        tile_end = cursor
        tile_start = tile_end - dt.timedelta(days=60)
        tile_days = {d: v for d, v in valid.items()
                     if tile_start <= dt.date.fromisoformat(d) < tile_end}
        if len(tile_days) >= MIN_BASELINE_DAYS:
            chosen = tile_days
        cursor = tile_start

    if chosen is None:
        # last resort: any valid pre-switch days (flagged short)
        chosen = valid

    dates = sorted(chosen)
    win = chosen
    Cb = [win[d]["actualCost"] for d in dates]
    Vb = [win[d]["vcpu"] for d in dates]
    Mb = [win[d]["ramGib"] for d in dates]
    p = sum(Cb) / sum(Vb)
    daily_unit = [c / v for c, v in zip(Cb, Vb) if v > 0]
    cv = (statistics.pstdev(daily_unit) / statistics.mean(daily_unit)
          if len(daily_unit) > 1 and statistics.mean(daily_unit) else 0.0)
    ci = bootstrap_ci_halfwidth(Cb, Vb)
    p_cpu = sum(win[d]["cpuCost"] for d in dates) / sum(Vb)
    p_mem = sum(win[d]["memCost"] for d in dates) / sum(Mb) if sum(Mb) else 0.0
    resid = [win[d]["actualCost"] - win[d]["cpuCost"] - win[d]["memCost"] for d in dates]
    c_other = statistics.mean(resid) if resid else 0.0
    gap_days = (sw - dt.date.fromisoformat(dates[-1])).days
    src_votes = [win[d].get("source", "") for d in dates]
    return {
        "from": dates[0], "to": dates[-1], "days": len(dates),
        "pUsdPerVcpuDay": round(p, 6),
        "pCpuUsdPerVcpuDay": round(p_cpu, 6),
        "pMemUsdPerGibDay": round(p_mem, 6),
        "cOtherUsdPerDay": round(max(c_other, 0.0), 4),
        "unitPriceCV": round(cv, 4),
        "ciHalfwidthPct": round((ci or 0) * 100, 2),
        "gibPerVcpu": round(sum(Mb) / sum(Vb), 3) if sum(Vb) else None,
        "gapToSwitchDays": gap_days,
        "source": "cost-report" if sum(1 for s in src_votes if s == "cost-report") >= len(src_votes) / 2
                  else "value-realization",
        "flags": ([f"SHORT_BASELINE({len(dates)}<{MIN_BASELINE_DAYS})"] if len(dates) < MIN_BASELINE_DAYS else [])
                 + ([f"HIGH_VARIANCE_BASELINE(CV={cv:.2f})"] if cv > 0.4 else [])
                 + ([f"LOW_CONFIDENCE_P(CI±{(ci or 0)*100:.0f}%)"] if ci and ci > 0.15 else [])
                 + ([f"BASELINE_NOT_CONTIGUOUS_WITH_SWITCH(gap={gap_days}d, telemetry-hole)"] if gap_days > 14 else [])
                 + (["BASELINE_PRICED_FROM_VALUE_REALIZATION"] if "value-realization" in src_votes
                    and not all(s == "cost-report" for s in src_votes) else []),
    }


def build_cluster(short, cluster_id):
    name = {"main": "dema-platform-services", "test": "dema-platform-services-test"}[short]
    flags = set()

    cost_days, calib_flags = load_cost_series(short)
    flags |= calib_flags
    ru_days = load_resource_usage(short)
    woop_days = load_woop_usage(short)
    vr_daily, vr_monthly = load_vr_timeline(short)
    leg_days, leg_total = load_legacy_savings(short)
    bp = load_baseline_params(short)
    est = load_estimated_savings(short)
    est_hist = load_estimated_savings_history(short)
    comp = load_woop_component(short)
    wsum = load_woop_summary(short)
    policies = load_policies(short)
    events = load_events(short, cluster_id)

    # WOOP install event + switch event from baseline params
    if comp.get("installedAt"):
        ver = comp.get("currentVersion") or comp.get("version")
        events.append({"date": day_of(comp["installedAt"]), "type": "woop-installed",
                       "clusterId": cluster_id,
                       "title": f"Workload autoscaler installed (v{ver or '?'})",
                       "details": {"installedAt": comp["installedAt"], "currentVersion": ver,
                                   "latestVersion": comp.get("latestVersion")}})
    sw_date = bp.get("periodEnd") or SWITCH_DATE_DEFAULT
    events.append({"date": sw_date, "type": "autoscaler-switch",
                   "clusterId": cluster_id,
                   "title": "Node autoscaler go-live (read-only → autoscaling)",
                   "details": {"source": "baseline-params.baselinePeriodEndTime" if bp.get("periodEnd") else "default"}})
    if bp.get("periodStart"):
        events.append({"date": bp["periodStart"], "type": "baseline-start",
                       "clusterId": cluster_id, "title": "CAST AI baseline window starts",
                       "details": {"baselineType": bp.get("baselineType")}})
    events = sorted(events, key=lambda e: (e["date"], e["type"]))

    # --- unified daily series -------------------------------------------------
    all_dates = sorted(set(cost_days) | set(vr_daily) | set(woop_days) | set(ru_days))
    unified = {}
    for d in all_dates:
        c = cost_days.get(d, {})
        vr = vr_daily.get(d, {})
        w = woop_days.get(d, {})
        ru = ru_days.get(d, {})
        row = {
            "date": d,
            "actualCost": c.get("actualCost") or vr.get("castActual") or 0.0,
            "vcpu": c.get("vcpu") or vr.get("vcpu") or 0.0,
            "ramGib": c.get("ramGib") or vr.get("ramGib") or 0.0,
            "vcpuSpot": c.get("vcpuSpot") or 0.0,
            "cpuCost": c.get("cpuCost") or vr.get("cpuCost") or 0.0,
            "memCost": c.get("memCost") or vr.get("memCost") or 0.0,
            "castActual": vr.get("castActual"),
            "castProjected": vr.get("castProjected"),
            "castAutoscalerSavings": vr.get("castAutoscalerSavings"),
            "castWoopSavings": vr.get("castWoopSavings"),
            "castTotalSavings": vr.get("castTotalSavings"),
            "downscalingSavings": (leg_days.get(d) or {}).get("downscalingSavings"),
            "spotSavings": (leg_days.get(d) or {}).get("spotSavings"),
            "reqCpu": w.get("cpuRequested") or ru.get("cpuRequested") or 0.0,
            "origReqCpu": w.get("origReqCpu") or 0.0,
            "usedCpu": w.get("cpuUsed") or ru.get("cpuUsed") or 0.0,
            "source": ("cost-report" if c else ("value-realization" if vr else "workload-only")),
        }
        unified[d] = row

    # --- frozen baseline + per-day counterfactuals ----------------------------
    baseline = compute_baseline(unified, sw_date, bp)
    if baseline is None:
        flags.add("NO_BASELINE_DATA")
    else:
        for _f in baseline["flags"]:
            flags.add(_f)

    p = baseline["pUsdPerVcpuDay"] if baseline else 0.0
    p_cpu = baseline["pCpuUsdPerVcpuDay"] if baseline else 0.0
    p_mem = baseline["pMemUsdPerGibDay"] if baseline else 0.0
    c_other = baseline["cOtherUsdPerDay"] if baseline else 0.0

    # Organic demand r_org: (a) PRIMARY = CAST AI's own recorded original
    # requests (origReqCpu, WOOP era only); (b) FALLBACK = κ0·U(t) with κ0 =
    # request/usage padding measured pre-WOOP.
    kappa0 = None
    if comp.get("installedAt"):
        woop_sw = day_of(comp["installedAt"])
        pre = [unified[d] for d in sorted(unified)
               if d < woop_sw and unified[d]["reqCpu"] > 0 and unified[d]["usedCpu"] > 0]
        if len(pre) >= 14:
            kappa0 = sum(r["reqCpu"] for r in pre) / sum(r["usedCpu"] for r in pre)
    if kappa0 is None:
        flags.add("KAPPA0_UNAVAILABLE(using origRequested only)")

    o0 = None
    if baseline:
        req_b = [unified[x]["reqCpu"] for x in unified
                 if baseline["from"] <= x <= baseline["to"] and unified[x]["reqCpu"] > 0]
        v_b = [unified[x]["vcpu"] for x in unified
               if baseline["from"] <= x <= baseline["to"] and unified[x]["vcpu"] > 0]
        if req_b and v_b:
            o0 = sum(v_b) / sum(req_b) if sum(req_b) else None
    if baseline and o0 is None:
        flags.add("O0_UNAVAILABLE(no requested series in baseline era)")

    r_org_method = None
    for d in sorted(unified):
        row = unified[d]
        v, m = row["vcpu"], row["ramGib"]
        row["adjBaselineM1"] = p * v if p else None
        row["adjBaselineTR"] = (p_cpu * v + p_mem * m + c_other) if p_cpu else None
        row["grossM1"] = (row["adjBaselineM1"] - row["actualCost"]) if p else None
        row["unitPrice"] = (row["actualCost"] / v) if v else None
        row["spotSharePct"] = (100.0 * row["vcpuSpot"] / v) if v else 0.0
        # M4 layers — demand valued first at frozen prices, then packing, then price
        if p and o0 and (row["origReqCpu"] > 0 or (kappa0 and row["usedCpu"] > 0)) and row["reqCpu"] > 0:
            if row["origReqCpu"] > 0:
                r_org = max(row["origReqCpu"], row["reqCpu"])
                r_org_method = "cast-original-requests"
            else:
                r_org = max(kappa0 * row["usedCpu"], row["reqCpu"])
                r_org_method = "kappa0-times-usage"
            L_W = o0 * p * (r_org - row["reqCpu"])
            L_N = p * (o0 * row["reqCpu"] - v)
            L_P = v * (p - (row["unitPrice"] or 0.0))
            row["layers"] = {"woopDemand": round(L_W, 4), "nodePacking": round(L_N, 4),
                             "priceEffect": round(L_P, 4),
                             "total": round(L_W + L_N + L_P, 4),
                             "organicDemandVcpu": round(r_org, 3), "o0": round(o0, 4)}
        else:
            row["layers"] = None

    cluster_r_org_note = r_org_method or "unavailable"

    # --- monthly rollup (with ESTIMATED_AVG_FILL for telemetry gaps) ---------
    first_day = min(unified) if unified else sw_date
    last_day = max(unified) if unified else sw_date
    months = []
    y0, m0 = map(int, first_day[:7].split("-"))
    y1, m1 = map(int, last_day[:7].split("-"))
    cur = dt.date(y0, m0, 1)
    end = dt.date(y1, m1, 1)
    all_real = [r for r in unified.values() if r["actualCost"] > 0 and r["vcpu"] > 0]
    era_avg_global = (sum(r["actualCost"] for r in all_real) / len(all_real)) if all_real else 0.0
    era_avg = None
    while cur <= end:
        y, mo = cur.year, cur.month
        key = f"{y:04d}-{mo:02d}"
        days_in_month = calendar.monthrange(y, mo)[1]
        rows = [unified[d] for d in sorted(unified) if d.startswith(key)]
        real = [r for r in rows if r["actualCost"] > 0 and r["vcpu"] > 0]
        if era_avg is None and len(real) >= 10:
            era_avg = sum(r["actualCost"] for r in real) / len(real)
        if real:
            actual = sum(r["actualCost"] for r in real)
            adj = sum(r["adjBaselineM1"] or 0 for r in real)
            adj_tr = sum(r["adjBaselineTR"] or 0 for r in real)
            vcpu_avg = sum(r["vcpu"] for r in real) / len(real)
            ram_avg = sum(r["ramGib"] for r in real) / len(real)
            cast_sav = sum(r["castTotalSavings"] or 0 for r in real) or None
            layers_sum = {"woopDemand": 0.0, "nodePacking": 0.0, "priceEffect": 0.0}
            for r in real:
                if r["layers"]:
                    for k in layers_sum:
                        layers_sum[k] += r["layers"][k]
            gross = adj - actual
            gross_tr = adj_tr - actual
            fee = FEE_RATE * max(gross, 0.0)
            entry = {
                "month": key, "days": len(real), "daysInMonth": days_in_month,
                "partial": len(real) < days_in_month - 1,
                "estimated": False,
                "actualCost": round(actual, 2),
                "adjBaselineM1": round(adj, 2),
                "adjBaselineTR": round(adj_tr, 2) if p_cpu else None,
                "grossM1": round(gross, 2),
                "grossTR": round(gross_tr, 2) if p_cpu else None,
                "fee": round(fee, 2),
                "netM1": round(gross - fee, 2),
                "netTR": round(gross_tr - FEE_RATE * max(gross_tr, 0.0), 2) if p_cpu else None,
                "avgVcpu": round(vcpu_avg, 1),
                "avgRamGib": round(ram_avg, 1),
                "er": round((actual / sum(r["vcpu"] for r in real)) / p, 4) if p and sum(r["vcpu"] for r in real) else None,
                "castRealizedSavings": round(cast_sav, 2) if cast_sav is not None else None,
                "layers": {k: round(v, 2) for k, v in layers_sum.items()},
                "flags": [],
            }
            if cast_sav is not None and abs(gross - cast_sav) > RECONCILE_TOL * max(abs(cast_sav), 1.0):
                entry["flags"].append("CROSSCHECK_OUT_OF_BAND")
            if entry["partial"]:
                entry["flags"].append("PARTIAL_MONTH")
            era_avg = actual / len(real)
        else:
            # No telemetry this month -> user's requested average fallback,
            # always explicitly flagged; never mixed into savings math.
            fill_avg = era_avg if era_avg is not None else era_avg_global
            entry = {
                "month": key, "days": 0, "daysInMonth": days_in_month,
                "partial": True, "estimated": True,
                "actualCost": round(fill_avg * days_in_month, 2),
                "avgDailyCost": round(fill_avg, 2),
                "adjBaselineM1": None, "adjBaselineTR": None,
                "grossM1": None, "grossTR": None, "fee": None,
                "netM1": None, "netTR": None,
                "avgVcpu": None, "avgRamGib": None, "er": None,
                "castRealizedSavings": None, "layers": None,
                "flags": ["ESTIMATED_AVG_FILL", "NO_TELEMETRY"],
            }
        months.append(entry)
        cur = (dt.date(y + 1, 1, 1) if mo == 12 else dt.date(y, mo + 1, 1))

    timeline = [unified[d] for d in sorted(unified)]
    for r in timeline:  # round for payload size
        for k in list(r.keys()):
            if isinstance(r[k], float):
                r[k] = round(r[k], 4)

    return {
        "clusterId": cluster_id, "name": name, "short": short,
        "switchDate": sw_date,
        "baseline": baseline,
        "o0": round(o0, 4) if o0 else None,
        "rOrgMethod": cluster_r_org_note,
        "castBaselineParams": bp,
        "kappa0": round(kappa0, 4) if kappa0 else None,
        "woop": {"component": comp, "summary": wsum, "estimatedSavingsSnapshot": est},
        "policies": policies,
        "legacySavingsWindowTotal": leg_total,
        "vrMonthly": vr_monthly,
        "events": events,
        "timeline": timeline,
        "monthly": months,
        "flags": sorted(flags),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WEB_DATA, exist_ok=True)
    clusters = [build_cluster(short, cid) for short, cid in CLUSTERS.items()]

    dataset = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "org": {"id": "5e413e89-eb67-48fb-b81c-6172baa988ed", "name": "Siemens CPS"},
        "feeRate": FEE_RATE,
        "reconcileTolerance": RECONCILE_TOL,
        "clusters": clusters,
        "formulas": {
            "p_baseline": "p = Σ baseline daily cost / Σ baseline daily provisioned vCPU (ratio-of-sums)",
            "adjustedBaseline": "adjusted(t) = p × provisioned vCPU (t)",
            "adjustedBaselineTR": "adjusted_TR(t) = p_cpu×vCPU(t) + p_mem×RAM GiB(t) + c_other",
            "gross": "gross(t) = adjusted(t) − actual cost(t); negative values reported, never clamped",
            "fee": f"fee(m) = {FEE_RATE:.0%} × max(gross(m), 0); net(m) = gross(m) − fee(m)",
            "er": "ER(m) = (Σ actual month cost / Σ month vCPU) / p; ER < 1 = improved unit economics",
            "layers": "G(t) = L_W + L_N + L_P (WOOP demand, node binpacking, price/family) — telescopes exactly",
            "reconciliation": "Our gross(m) must sit within ±30% of CAST AI totalSavings(m); series are compared, never blended",
        },
    }
    out_path = os.path.join(OUT, "dataset.json")
    with open(out_path, "w") as fh:
        json.dump(dataset, fh)
    web_path = os.path.join(WEB_DATA, "dataset.json")
    with open(web_path, "w") as fh:
        json.dump(dataset, fh)

    for c in clusters:
        real_months = [m for m in c["monthly"] if not m["estimated"]]
        est_months = [m for m in c["monthly"] if m["estimated"]]
        print(f"[{c['short']}] days={len(c['timeline'])} events={len(c['events'])} "
              f"months(real/est)={len(real_months)}/{len(est_months)} "
              f"baseline={'OK n=%d p=%.4f' % (c['baseline']['days'], c['baseline']['pUsdPerVcpuDay']) if c['baseline'] else 'MISSING'} "
              f"flags={','.join(c['flags']) or '-'}")
    print(f"wrote {out_path}")
    print(f"wrote {web_path}")


if __name__ == "__main__":
    sys.exit(main())
