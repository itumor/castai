#!/usr/bin/env python3
"""
build_dataset_v2.py — inventory-driven, multi-method analytics dataset.

Reads data/raw/{inventory,orgs,clusters} snapshots and writes:
  data/processed/dataset2.json          fleet index + monthly ledgers + params
  public/data/dataset2.json             (copy served to the web app)
  public/data/ts/<clusterId>.json       per-cluster daily timelines (lazy fetch)

Methods (all per cluster; applicability marked when inputs are missing):
  M0   naive flat-demand     gross = first-full-month daily-avg × days − actual
  M1   frozen vCPU price     p = ΣC/ΣV over pre-switch era; adj = p×V(t)
  TR   two-resource frozen   adj = p_cpu×V + p_mem×RAM + c_other
  M2   OLS C = a·V + b·RAM + c over pre-switch days (gates: corr<0.9, R²≥0.7, bounds)
  M4   WOOP-aware layers     G = L_W + L_N + L_P (original requests for r_org)
  CAST CAST AI realized      cross-check only (±30% band, never blended)

Cost-day truth: org daily-cost is authoritative CONTINUOUS coverage → a day
inside that window with no interval for the cluster is an IDLE $0 day, not a
telemetry hole. Per-cluster /cost buckets are end-labeled (shift −1 day);
org daily-cost + value-realization are start-of-day labeled.
"""
import calendar
import datetime as dt
import glob
import json
import os
import statistics
import sys

try:
    import numpy as np
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed")
WEB = os.path.join(ROOT, "public", "data")
FEE_EUR_PER_VCPU_MONTH = 5.0     # CAST AI subscription: €5 per provisioned vCPU-month
FEE_FX_USD_PER_EUR = 1.10        # frozen FX assumption (USD series) — documented in-app + export
RECONCILE_TOL = 0.30
MIN_BASELINE_DAYS = 21
MIN_BASELINE_MONTHS = 2
FLOOR = dt.date(2025, 10, 1)


# ----------------------------------------------------------------------------- helpers

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


def dstr(d):
    return d.isoformat() if isinstance(d, dt.date) else str(d)[:10]


def day_of(ts):
    return (ts or "")[:10]


def today_utc():
    return dt.datetime.now(dt.timezone.utc).date()


def bootstrap_ci(cost, vcpu, draws=999, seed=42):
    import random
    rng = random.Random(seed)
    n = len(cost)
    if n < 10 or sum(vcpu) == 0:
        return None
    ps = []
    for _ in range(draws):
        idx = [rng.randrange(n) for _ in range(n)]
        sv = sum(vcpu[i] for i in idx)
        if sv > 0:
            ps.append(sum(cost[i] for i in idx) / sv)
    if len(ps) < 30:
        return None
    ps.sort()
    p = sum(cost) / sum(vcpu)
    return (((ps[int(0.975 * len(ps)) - 1] - ps[int(0.025 * len(ps))]) / 2) / p) if p else None


def m2_fit(cost, vcpu, ram):
    if not HAVE_NUMPY or len(cost) < 28:
        return None
    X = np.column_stack([vcpu, ram, np.ones(len(cost))])
    y = np.array(cost, dtype=float)
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    a, b, c = map(float, beta)
    resid = y - X @ beta
    r2 = 1.0 - float(resid @ resid) / float(((y - y.mean()) ** 2).sum() or 1.0)
    corr = float(np.corrcoef(vcpu, ram)[0, 1]) if len(cost) > 2 else 1.0
    if corr >= 0.9 or not (0 < a <= 26.4 and 0 <= b <= 3.4) or r2 < 0.7:
        return None
    rng = np.random.default_rng(42)
    a_s = []
    for _ in range(400):
        idx = rng.integers(0, len(cost), len(cost))
        bb, *_ = np.linalg.lstsq(X[idx], y[idx], rcond=None)
        if bb[0] > 0:
            a_s.append(float(bb[0]))
    if len(a_s) < 100 or (a and float((np.percentile(a_s, 97.5) - np.percentile(a_s, 2.5)) / 2) / a > 0.25):
        return None
    return {"a": a, "b": b, "c": c, "r2": round(r2, 3), "corr": round(corr, 3)}


# ----------------------------------------------------------------------------- raw loaders

def load_cost_daily(cdir):
    """Per-cluster /cost chunks (end-labeled → shift −1 day, drop partial today)."""
    days, flags = {}, set()
    for path in sorted(glob.glob(os.path.join(cdir, "cost", "cost_2*.json"))):
        data = read_json(path) or {}
        items, summary = data.get("items", []) or [], data.get("summary", {}) or {}
        raw = []
        for it in items:
            lbl = day_of(it.get("timestamp"))
            if not lbl:
                continue
            d = (dt.date.fromisoformat(lbl) - dt.timedelta(days=1)).isoformat()
            if d >= today_utc().isoformat():
                continue
            cA = pick(it, "costOnDemand") + pick(it, "costSpot") + pick(it, "costSpotFallback")
            cBu = pick(it, "cpuCostOnDemand") + pick(it, "cpuCostSpot") + pick(it, "cpuCostSpotFallback")
            cBr = pick(it, "ramCostOnDemand") + pick(it, "ramCostSpot") + pick(it, "ramCostSpotFallback")
            v = pick(it, "cpuCountOnDemand") + pick(it, "cpuCountSpot") + pick(it, "cpuCountSpotFallback") \
                or pick(it, "cpuCount", "cpuProvisioned", "avgCpuCount")
            m = (pick(it, "ramGibOnDemand") + pick(it, "ramGibSpot") + pick(it, "ramGibSpotFallback")) \
                or pick(it, "ramGib", "ramGibProvisioned", "totalRamGib")
            raw.append((d, cA, cBu, cBr, v, m,
                        pick(it, "cpuCountSpot") + pick(it, "cpuCountSpotFallback")))
        if not raw:
            continue
        meanA = statistics.mean(r[1] for r in raw if r[1] > 0) if any(r[1] > 0 for r in raw) else None
        avg = fnum(summary.get("avgCost"))
        factor = 1.0 if (avg and meanA and abs(meanA - avg * 24) / (avg * 24) < abs(meanA - avg) / avg) else 24.0
        if not avg:
            flags.add("CALIBRATION_ASSUMED_X24")
        for d, cA, cBu, cBr, v, m, vspot in raw:
            days[d] = {"actualCost": cA * factor, "vcpu": v, "ramGib": m,
                       "cpuCost": (cBu or cA * 0.88) * factor, "memCost": (cBr or cA * 0.12) * factor,
                       "vcpuSpot": vspot}
    return days, flags


def load_ru_daily(cdir):
    """Cost-family resource-usage chunks (same end-labeled buckets as /cost):
    request/usage series incl. the pre-WOOP era that workloads-summary-metrics
    can't reach — feeds κ0 and o0."""
    days = {}
    for path in sorted(glob.glob(os.path.join(cdir, "cost", "resource-usage_2*.json"))):
        data = read_json(path) or {}
        for it in data.get("items", []) or []:
            lbl = day_of(it.get("timestamp"))
            if not lbl:
                continue
            d = (dt.date.fromisoformat(lbl) - dt.timedelta(days=1)).isoformat()
            if d >= today_utc().isoformat():
                continue
            days[d] = {"reqCpu": pick(it, "cpuRequested"), "usedCpu": pick(it, "cpuUsed"),
                       "provCpu": pick(it, "cpuProvisioned"), "origReqCpu": 0.0,
                       "reqRam": pick(it, "ramRequested"), "provRam": pick(it, "ramProvisioned")}
    return days


def load_vr_daily(sdir):
    days = {}
    for path in sorted(glob.glob(os.path.join(sdir, "vr-timeline-day_2*.json"))):
        data = read_json(path) or {}
        for it in data.get("timelineItems", []) or []:
            d = day_of(it.get("timestamp"))
            if not d or d >= today_utc().isoformat():
                continue
            cpu, mem, cost, nodes = it.get("cpu") or {}, it.get("memory") or {}, it.get("cost") or {}, it.get("nodes") or {}
            days[d] = {
                "castActual": pick(cost, "actualCost"),
                "castProjected": pick(cost, "projectedCost"),
                "castAutoscalerSavings": pick(cost, "autoscalerSavings"),
                "castWoopSavings": pick(cost, "workloadAutoscalerSavings"),
                "castTotalSavings": pick(cost, "totalSavings"),
                "vcpu": pick(cpu, "provisionedCoreHours") / 24.0 or pick(cpu, "provisionedCoresHourly") * 2.0,
                "ramGib": pick(mem, "provisionedByteHours") / 24.0 / 1073741824.0 or pick(mem, "provisionedGib") * 2.0,
                "cpuCost": pick(cpu, "actualCost"), "memCost": pick(mem, "actualCost"),
                "nodeCount": pick(nodes, "actualNodeCount"),
            }
    return days


def load_org_daily_cost(odir, cluster_id):
    """Org-level daily-cost: {date: $/day} for THIS cluster (SoD labels)."""
    out = {}
    for path in sorted(glob.glob(os.path.join(odir, "daily-cost_2*.json"))):
        data = read_json(path) or {}
        for item in data.get("items", []) or []:
            if item.get("clusterId") != cluster_id:
                continue
            for iv in item.get("intervals", []) or []:
                d = day_of(iv.get("timestamp"))
                if not d or d >= today_utc().isoformat():
                    continue
                rate = pick(iv, "costOnDemandPerHour") + pick(iv, "costSpotPerHour") + pick(iv, "costSpotFallbackPerHour")
                out[d] = rate * 24.0
    return out


def load_woop(wdir):
    usage = {}
    for path in sorted(glob.glob(os.path.join(wdir, "resource-usage_*.json"))):
        if "400" in path:
            continue
        data = read_json(path) or {}
        acc = {}
        for it in data.get("items", []) or []:
            d = day_of(it.get("timestamp"))
            if not d:
                continue
            a = acc.setdefault(d, [0, 0, 0, 0, 0, 0, 0, 0])
            rc, ro = fnum(it.get("cpuRequestCores")), fnum(it.get("cpuOriginalRequestCores"))
            mc, mo = fnum(it.get("memoryRequestGibs")), fnum(it.get("memoryOriginalRequestGibs"))
            a[0] += 1                     # hours (Δt = 1h items)
            a[1] += rc                    # current CPU requests
            a[2] += ro                    # original (pre-WA) CPU requests
            a[3] += fnum(it.get("cpuUsageCores"))
            a[4] += max(rc, ro)           # Σ_t max(R_orig, R_cur) — the WMAX reference demand
            a[5] += max(mc, mo)
            a[6] += mc
            a[7] += mo
        for d, a in acc.items():
            n = max(a[0], 1)
            usage[d] = {"reqCpu": a[1] / n, "origReqCpu": a[2] / n, "usedCpu": a[3] / n,
                        "reqMem": a[6] / n, "origReqMem": a[7] / n,
                        "refCpuHours": a[4], "refMemHours": a[5], "hoursWoop": a[0]}
    comp = read_json(os.path.join(wdir, "woop-component.json")) or {}
    summ = read_json(os.path.join(wdir, "woop-summary.json")) or {}
    return usage, comp, summ


def load_cluster_vr_month(sdir):
    months = {}
    for name in ("vr-timeline-month_cluster.json", "vr-timeline-month.json"):
        data = read_json(os.path.join(sdir, name))
        if not data:
            continue
        for it in data.get("timelineItems", []) or []:
            m = day_of(it.get("timestamp"))[:7]
            if len(m) == 7:
                cost = it.get("cost") or {}
                months[m] = {"castActual": pick(cost, "actualCost"),
                             "castProjected": pick(cost, "projectedCost"),
                             "castTotalSavings": pick(cost, "totalSavings"),
                             "castAutoscalerSavings": pick(cost, "autoscalerSavings"),
                             "castWoopSavings": pick(cost, "workloadAutoscalerSavings")}
        if months:
            break
    return months


def load_org_report_months(odir, cluster_id):
    """Per-cluster monthly rows from org clusters/report: cost, avg vCPU, splits."""
    months = {}
    for path in sorted(glob.glob(os.path.join(odir, "clusters-report_2*.json"))):
        data = read_json(path) or {}
        for c in data.get("clusters", []) or []:
            if c.get("clusterId") != cluster_id:
                continue
            m = os.path.basename(path)[16:23]
            s = c.get("summary") or {}
            months[m] = {
                "actualCost": fnum(s.get("totalCost")),
                "avgVcpu": fnum(s.get("cpuProvisioned")),
                "avgRamGib": fnum(s.get("ramProvisionedGib") or s.get("ramProvisioned")),
                "cpuCost": fnum(s.get("cpuCost")),
                "ramCost": fnum(s.get("ramCost")),
                "deletedAt": c.get("clusterDeletedAt"),
            }
    return months


def load_baseline_params(sdir):
    data = read_json(os.path.join(sdir, "baseline-params.json")) or {}
    return {"periodStart": day_of(data.get("baselinePeriodStartTime")) or None,
            "periodEnd": day_of(data.get("baselinePeriodEndTime")) or None,
            "baselineType": data.get("baselineType"),
            "costPerCpuCoreHourly": fnum(data.get("costPerCpuCoreHourly")),
            "cpuOverprovisioningFactor": fnum(data.get("cpuOverprovisioningFactor")),
            "memoryOverprovisioningFactor": fnum(data.get("memoryOverprovisioningFactor"))}


def load_events_block(cdir, cluster_id):
    """Normalized events from policies/rebalancing/audit (tier B only)."""
    events, seen = [], set()

    def add(date, etype, title, details=None):
        if date and (date, etype, title) not in seen:
            seen.add((date, etype, title))
            events.append({"date": date, "type": etype, "clusterId": cluster_id,
                           "title": title, "details": details or {}})

    plans = read_json(os.path.join(cdir, "events", "rebalancing-plans.json")) or {}
    for pl in plans.get("items", []) or plans.get("rebalancingPlans", []) or []:
        pid = pl.get("rebalancingPlanId") or pl.get("id")
        det = read_json(os.path.join(cdir, "events", f"rebalancing-plan_{pid}.json")) or pl
        status = det.get("status") or ""
        nodes = len(det.get("rebalancingNodeIds") or [])
        add(day_of(det.get("generatedAt")), "rebalance-planned", f"Rebalance plan generated ({status})",
            {"planId": pid, "status": status})
        if det.get("finishedAt"):
            add(day_of(det.get("finishedAt")), "rebalance", f"Rebalance {status} ({nodes} nodes)",
                {"planId": pid, "status": status, "rebalancingNodes": nodes})

    for path in sorted(glob.glob(os.path.join(cdir, "events", "audit-v2_*.json"))):
        data = read_json(path) or {}
        for ev in data.get("items", []) or data.get("events", []) or []:
            occurred = day_of(ev.get("occurredAt") or ev.get("time"))
            domain = str(ev.get("eventDomain") or "")
            resource = str(ev.get("eventResource") or "")
            action = str(ev.get("eventAction") or "")
            label = f"{domain}/{resource}/{action}".lower()
            if "polic" in label and ("enabl" in label or "activ" in label):
                add(occurred, "policy-enabled", "Autoscaler policy enabled", {"raw": label})
            elif "polic" in label or ("configur" in label and "workload" not in label):
                add(occurred, "policy-change", f"Policy {action or 'change'}", {"raw": label})
            elif "rebalancing" in label:
                add(occurred, "rebalance", f"Rebalance {action or 'event'}", {"raw": label})
            elif "scaling_policy" in label:
                add(occurred, "woop-activity", f"WOOP scaling policy {action or 'event'}", {"raw": label})

    comp = read_json(os.path.join(cdir, "workload", "woop-component.json")) or {}
    if comp.get("installedAt"):
        add(day_of(comp["installedAt"]), "woop-installed",
            f"Workload autoscaler installed ({comp.get('currentVersion') or '?'})",
            {"installedAt": comp["installedAt"], "currentVersion": comp.get("currentVersion"),
             "latestVersion": comp.get("latestVersion")})
    return sorted(events, key=lambda e: (e["date"], e["type"]))


# ----------------------------------------------------------------------------- methods

def freeze_baseline(days_map, sw_date):
    """days_map: {date: {actualCost, vcpu, ramGib, cpuCost, memCost}} → frozen prices."""
    valid = {d: v for d, v in days_map.items()
             if d < sw_date and v.get("actualCost", 0) > 0 and v.get("vcpu", 0) > 0}
    if not valid:
        return None
    chosen, cursor = None, dt.date.fromisoformat(sw_date)
    while cursor > FLOOR and chosen is None:
        t0 = cursor - dt.timedelta(days=60)
        tile = {d: v for d, v in valid.items() if t0 <= dt.date.fromisoformat(d) < cursor}
        if len(tile) >= 7:  # CAST's own minimum observation (docs 02/03); <21 stays SHORT-flagged
            chosen = tile
        cursor = t0
    if chosen is None:
        chosen = valid
    dates = sorted(chosen)
    C = [chosen[d]["actualCost"] for d in dates]
    V = [chosen[d]["vcpu"] for d in dates]
    M = [chosen[d]["ramGib"] for d in dates]
    p = sum(C) / sum(V)
    p_cpu = sum(chosen[d]["cpuCost"] for d in dates) / sum(V)
    p_mem = sum(chosen[d]["memCost"] for d in dates) / sum(M) if sum(M) else 0.0
    c_other = statistics.mean([chosen[d]["actualCost"] - chosen[d]["cpuCost"] - chosen[d]["memCost"] for d in dates])
    unit = [c / v for c, v in zip(C, V)]
    cv = statistics.pstdev(unit) / statistics.mean(unit) if len(unit) > 1 and statistics.mean(unit) else 0.0
    m2 = m2_fit(C, V, M)
    return {
        "from": dates[0], "to": dates[-1], "days": len(dates),
        "pUsdPerVcpuDay": round(p, 6), "pCpuUsdPerVcpuDay": round(p_cpu, 6),
        "pMemUsdPerGibDay": round(p_mem, 6), "cOtherUsdPerDay": round(max(c_other, 0.0), 4),
        "unitPriceCV": round(cv, 4), "ciHalfwidthPct": round((bootstrap_ci(C, V) or 0) * 100, 2),
        "m2": m2,
        "gapToSwitchDays": (dt.date.fromisoformat(sw_date) - dt.date.fromisoformat(dates[-1])).days,
        "_w": {"cost": round(sum(C), 2), "vcpuQ": round(sum(V), 1),
               "cpuCost": round(sum(chosen[d]["cpuCost"] for d in dates), 2),
               "memCost": round(sum(chosen[d]["memCost"] for d in dates), 2), "ram": round(sum(M), 1)},
        "flags": ([f"SHORT_BASELINE({len(dates)}<{MIN_BASELINE_DAYS})"] if len(dates) < MIN_BASELINE_DAYS else [])
                 + (["M2_GATES_FAILED"] if HAVE_NUMPY and m2 is None else []),
    }


def freeze_baseline_monthly(months, sw_month):
    """Tier A: months = {YYYY-MM: {actualCost, avgVcpu, avgRamGib, cpuCost, ramCost}}."""
    pre = {m: r for m, r in sorted(months.items()) if m < sw_month and r["actualCost"] > 0 and r["avgVcpu"] > 0}
    if len(pre) < 1:
        return None
    vd = sum(r["avgVcpu"] * calendar.monthrange(int(m[:4]), int(m[5:]))[1] for m, r in pre.items())
    md = sum(r["avgRamGib"] * calendar.monthrange(int(m[:4]), int(m[5:]))[1] for m, r in pre.items())
    tc = sum(r["actualCost"] for m, r in pre.items())
    if vd <= 0:
        return None
    return {
        "from": min(pre), "to": max(pre), "days": len(pre) * 30,
        "pUsdPerVcpuDay": round(tc / vd, 6),
        "pCpuUsdPerVcpuDay": round(sum(r["cpuCost"] for r in pre.values()) / vd, 6),
        "pMemUsdPerGibDay": round(sum(r["ramCost"] for r in pre.values()) / md, 6) if md else 0.0,
        "cOtherUsdPerDay": 0.0,
        "unitPriceCV": None, "ciHalfwidthPct": None, "m2": None,
        "gapToSwitchDays": None,
        "_w": {"cost": round(tc, 2), "vcpuQ": round(vd, 1),
               "cpuCost": round(sum(r["cpuCost"] for r in pre.values()), 2),
               "memCost": round(sum(r["ramCost"] for r in pre.values()), 2), "ram": round(md, 1)},
        "flags": [f"MONTHLY_GRANULARITY_BASELINE({len(pre)}months)"]
                 + ([f"SHORT_BASELINE({len(pre)}<{MIN_BASELINE_MONTHS}months)"] if len(pre) < MIN_BASELINE_MONTHS else []),
    }


# ----------------------------------------------------------------------------- per-cluster build

def build_cluster(c, org_holes, fallback=None):
    cid = c["clusterId"]
    tier = "B" if os.path.isdir(os.path.join(RAW, "clusters", cid, "cost")) else "A"

    odir = os.path.join(RAW, "orgs", c["orgId"])
    org_daily = load_org_daily_cost(odir, cid)
    vr_months = load_cluster_vr_month(os.path.join(RAW, "clusters", cid, "savings"))
    report_months = load_org_report_months(odir, cid)
    bp = load_baseline_params(os.path.join(RAW, "clusters", cid, "savings"))

    # --- switch date: baseline-params > vr first savings month > firstOperationAt
    sw = None
    sw_src = None
    if bp.get("periodEnd"):
        sw, sw_src = bp["periodEnd"], "baseline-params"
    else:
        for m in sorted(vr_months):
            if vr_months[m]["castTotalSavings"] > 0:
                sw, sw_src = m + "-01", "vr-first-savings-month"
                break
    if sw is None and c.get("firstOperationAt"):
        sw, sw_src = day_of(c["firstOperationAt"]), "firstOperationAt"

    # --- unified daily series
    cost_days, calib = ({}, set())
    vr_days = {}
    ru_days = {}
    woop_usage, woop_comp, woop_summ = {}, {}, {}
    events = []
    policies = None
    if tier == "B":
        cost_days, calib = load_cost_daily(os.path.join(RAW, "clusters", cid))
        vr_days = load_vr_daily(os.path.join(RAW, "clusters", cid, "savings"))
        ru_days = load_ru_daily(os.path.join(RAW, "clusters", cid))
        woop_usage, woop_comp, woop_summ = load_woop(os.path.join(RAW, "clusters", cid, "workload"))
        events = load_events_block(os.path.join(RAW, "clusters", cid), cid)
        pol = read_json(os.path.join(RAW, "clusters", cid, "events", "policies.json")) or {}
        spot = pol.get("spotInstances") or {}
        policies = {"enabled": pol.get("enabled"), "spotEnabled": spot.get("enabled") if isinstance(spot, dict) else None,
                    "isScopedMode": pol.get("isScopedMode")}
        if woop_comp.get("installedAt") and not bp.get("periodEnd"):
            pass  # switch already resolved above

    all_dates = sorted(set(cost_days) | set(vr_days) | set(org_daily) | set(woop_usage) | set(ru_days))
    timeline = []
    for d in all_dates:
        cd, vd, od = cost_days.get(d), vr_days.get(d), org_daily.get(d)
        wu = woop_usage.get(d) or {}
        ru = ru_days.get(d) or {}
        actual = (cd or {}).get("actualCost") or (vd or {}).get("castActual") or od or 0.0
        v = (cd or {}).get("vcpu") or (vd or {}).get("vcpu") or ru.get("provCpu") or 0.0
        ram = (cd or {}).get("ramGib") or (vd or {}).get("ramGib") or 0.0
        row = {
            "date": d, "actualCost": actual, "vcpu": v, "ramGib": ram,
            "cpuCost": (cd or vd or {}).get("cpuCost") or 0.0,
            "memCost": (cd or vd or {}).get("memCost") or 0.0,
            "castActual": (vd or {}).get("castActual"),
            "castProjected": (vd or {}).get("castProjected"),
            "castTotalSavings": (vd or {}).get("castTotalSavings"),
            "castAutoscalerSavings": (vd or {}).get("castAutoscalerSavings"),
            "castWoopSavings": (vd or {}).get("castWoopSavings"),
            "reqCpu": wu.get("reqCpu") or ru.get("reqCpu") or 0.0,
            "origReqCpu": wu.get("origReqCpu") or ru.get("origReqCpu") or 0.0,
            "usedCpu": wu.get("usedCpu") or ru.get("usedCpu") or 0.0,
            "reqRam": wu.get("reqMem") or ru.get("reqRam") or 0.0,
            "origReqMem": wu.get("origReqMem") or 0.0,
            "refCpuHours": wu.get("refCpuHours"), "refMemHours": wu.get("refMemHours"),
            "hoursWoop": wu.get("hoursWoop", 0),
            "source": ("cost-report" if cd else ("value-realization" if vd else ("org-daily-cost" if od is not None else "workload-only"))),
            "idle": actual == 0 and od is None and cd is None and vd is None,
        }
        timeline.append(row)

    # day map for baseline pricing
    day_map = {r["date"]: {"actualCost": r["actualCost"], "vcpu": r["vcpu"], "ramGib": r["ramGib"],
                           "cpuCost": r["cpuCost"], "memCost": r["memCost"]} for r in timeline}

    baseline = freeze_baseline(day_map, sw) if sw else None
    if baseline is None and fallback:
        baseline = fallback  # PEER_FROZEN / FLEET_PRICEBOOK pooled price list (doc-01 ladder rungs 2/3)
    if baseline is None and sw:
        baseline = freeze_baseline_monthly(report_months, sw[:7])
    if baseline is None and fallback and tier == "A":
        baseline = fallback
    elif baseline is None and not sw:
        baseline = freeze_baseline_monthly(report_months, "9999")  # whole-history (read-only clusters)
        if baseline:
            baseline["flags"].append("READONLY_WHOLE_HISTORY_BASELINE")

    # --- WOOP κ0 & o0 & M4 layers (tier B)
    kappa0 = o0 = None
    if woop_comp.get("installedAt"):
        pre = [r for r in timeline if r["date"] < day_of(woop_comp["installedAt"]) and r["reqCpu"] > 0 and r["usedCpu"] > 0]
        if len(pre) >= 14:
            kappa0 = sum(r["reqCpu"] for r in pre) / sum(r["usedCpu"] for r in pre)
    o_mem = None
    u_cpu = u_mem = None
    if baseline and baseline.get("from") and baseline.get("days") >= MIN_BASELINE_DAYS:
        bdays = [r for r in timeline if baseline["from"] <= r["date"] <= baseline["to"] and r["reqCpu"] > 0 and r["vcpu"] > 0]
        if bdays:
            o0 = sum(r["vcpu"] for r in bdays) / sum(r["reqCpu"] for r in bdays)
        bram = [r for r in timeline if baseline["from"] <= r["date"] <= baseline["to"] and r.get("reqRam", 0) > 0]
        if bram:
            # RAM provisioned = ramGib (cost report); reqRam = K8s requested GiB (era-1 ru feed or WOOP originals-era)
            o_mem = sum(r["ramGib"] for r in bram) / sum(r["reqRam"] for r in bram)
        # REQ: demand-unit costs — baseline compute $ per REQUESTED unit (O absorbed implicitly), ratio-of-sums
        if bdays:
            u_cpu = sum(r["cpuCost"] for r in bdays) / sum(r["reqCpu"] for r in bdays)
        if bram:
            u_mem = sum(r["memCost"] for r in bram) / sum(r["reqRam"] for r in bram)

    p = baseline["pUsdPerVcpuDay"] if baseline else 0.0
    p_cpu = baseline["pCpuUsdPerVcpuDay"] if baseline else 0.0
    p_mem = baseline["pMemUsdPerGibDay"] if baseline else 0.0
    c_other = baseline["cOtherUsdPerDay"] if baseline else 0.0
    m2 = baseline.get("m2") if baseline else None

    # --- M0 naive: first full telemetry month becomes the flat counterfactual
    month_day_count = {}
    for r in timeline:
        month_day_count[r["date"][:7]] = month_day_count.get(r["date"][:7], 0) + 1
    first_full = next((m for m in sorted(month_day_count) if month_day_count[m] >= 28), None)
    m0_avg = None
    if first_full:
        rows = [r for r in timeline if r["date"][:7] == first_full]
        m0_avg = sum(r["actualCost"] for r in rows) / max(len(rows), 1)

    # --- per-day adjusted + layers
    from collections import deque
    roll = deque()          # trailing telemetried-day actual costs (TR30D window)
    rollcpu, rollmem, rolloth = deque(), deque(), deque()
    for r in timeline:
        wcpu, wmem, woth = list(rollcpu)[-30:], list(rollmem)[-30:], list(rolloth)[-30:]
        win = list(roll)[-30:]
        if len(win) >= 7:
            n = len(win)
            r["adjTR30D"] = sum(win) / n
            r["tr30dSplit"] = {"cpu": round(sum(wcpu) / n, 2), "mem": round(sum(wmem) / n, 2),
                               "other": round(sum(woth) / n, 2), "windowDays": n}
        else:
            r["adjTR30D"] = None
            r["tr30dSplit"] = None
        roll.append(r["actualCost"])
        rollcpu.append(r["cpuCost"])
        rollmem.append(r["memCost"])
        rolloth.append(max(r["actualCost"] - r["cpuCost"] - r["memCost"], 0.0))
        v, ram = r["vcpu"], r["ramGib"]
        r["adjM1"] = p * v if p else None
        r["adjTR"] = p_cpu * v + p_mem * ram + c_other if p_cpu or p_mem else None
        r["adjM2"] = m2["a"] * v + m2["b"] * ram + m2["c"] if m2 else None
        r["grossM0"] = (m0_avg - r["actualCost"]) if m0_avg is not None else None
        r["unitPrice"] = (r["actualCost"] / v) if v else None
        if p and o0 and (r["origReqCpu"] > 0 or (kappa0 and r["usedCpu"] > 0)) and r["reqCpu"] > 0:
            r_org = max(r["origReqCpu"], r["reqCpu"]) if r["origReqCpu"] > 0 else max(kappa0 * r["usedCpu"], r["reqCpu"])
            L_W = o0 * p * (r_org - r["reqCpu"])
            L_N = p * (o0 * r["reqCpu"] - v)
            L_P = v * (p - (r["unitPrice"] or 0.0))
            r["layers"] = {"woopDemand": round(L_W, 4), "nodePacking": round(L_N, 4),
                           "priceEffect": round(L_P, 4), "organicDemandVcpu": round(r_org, 3)}
        else:
            r["layers"] = None
        # ---- WMAX: Σ_t max(R_orig,R_cur) × O × max(P_base, P_cur) — per-hour WOOP hours
        if (r.get("refCpuHours") is not None and r["hoursWoop"] > 0 and o0 and p_cpu):
            o_use_mem = o_mem or o0
            ref_cpu_day = r["refCpuHours"] / 24.0
            ref_mem_day = (r.get("refMemHours") or 0.0) / 24.0
            pcpu_cur = (r["cpuCost"] / r["vcpu"]) if r["vcpu"] > 0 else None
            pmem_cur = (r["memCost"] / r["ramGib"]) if r["ramGib"] > 0 else None
            pcpu_used = max(p_cpu, pcpu_cur or 0.0)
            pmem_used = max(p_mem, pmem_cur or 0.0)
            base_w = o0 * ref_cpu_day * pcpu_used + o_use_mem * ref_mem_day * pmem_used
            r["wmaxBaseline"] = round(base_w, 4)
            r["wmax"] = {"refCpu": round(ref_cpu_day, 3), "refMem": round(ref_mem_day, 3),
                         "oCpu": round(o0, 4), "oMem": round(o_use_mem, 4),
                         "pCpuUsed": round(pcpu_used, 6), "pMemUsed": round(pmem_used, 6),
                         "hours": r["hoursWoop"]}
        else:
            r["wmaxBaseline"] = None
            r["wmax"] = None
        # ---- TRW: TR with WA demand floor — V_ref = max(V, O×max(R_orig,R_cur))
        o_use_mem = o_mem or o0
        if r["hoursWoop"] > 0 and r.get("refCpuHours") is not None:
            ref_c = r["refCpuHours"] / r["hoursWoop"] if r["origReqCpu"] > 1.02 * r["reqCpu"] else 0.0
            ref_m = ((r.get("refMemHours") or 0.0) / r["hoursWoop"]) if r["origReqMem"] > 1.02 * r["reqRam"] else 0.0
        else:
            # floor engages ONLY where Workload Autoscaler demonstrably cut demand (orig > cur)
            ref_c = r["origReqCpu"] if r["origReqCpu"] > 1.02 * r["reqCpu"] else 0.0
            ref_m = r["origReqMem"] if r["origReqMem"] > 1.02 * r["reqRam"] else 0.0
        if o0:
            v_ref = max(r["vcpu"], o0 * ref_c)
            m_ref = max(r["ramGib"], o_use_mem * ref_m)
            _trw = p_cpu * v_ref + p_mem * m_ref + c_other
            r["adjTRW"] = round(_trw, 4) if (_trw > 0 or r["actualCost"] == 0) else None
            if r["adjTRW"] is None:
                r["trw"] = None
            else:
                r["trw"] = {"vRef": round(v_ref, 2), "mRef": round(m_ref, 1),
                            "refCpu": round(ref_c, 2), "refMem": round(ref_m, 1),
                            "floorCpu": bool(o0 * ref_c > r["vcpu"]), "floorMem": bool(o_use_mem * ref_m > r["ramGib"])}
        else:
            r["adjTRW"] = r["adjTR"]   # smooth degradation: equals TR where no O exists
            r["trw"] = None
        # ---- REQ (docs 05/06): demand-unit counterfactual — max(orig,cur) request-hours × frozen $/req-unit
        d_cpu = max(r["origReqCpu"], r["reqCpu"])
        d_mem = max(r["origReqMem"], r["reqRam"])
        if (u_cpu or u_mem) and d_cpu + d_mem > 0 and sw and r["date"] >= sw:
            adj_req = (u_cpu or 0) * d_cpu + (u_mem or 0) * d_mem
            act_compute = (r["cpuCost"] or 0) + (r["memCost"] or 0)
            r["adjREQ"] = round(adj_req, 4) if adj_req > 0 else None
            r["reqActualCompute"] = round(act_compute, 4)
            r["reqD"] = {"cpu": round(d_cpu, 2), "mem": round(d_mem, 1),
                         "uCpu": round(u_cpu or 0, 6), "uMem": round(u_mem or 0, 6)}
        else:
            r["adjREQ"] = None
            r["reqActualCompute"] = None
            r["reqD"] = None

    # --- TR30D monthly baseline preparations: 30× trailing-avg-day before each month
    tl_dates = [r["date"] for r in timeline]
    import bisect as _bisect

    def tr30d_month(key):
        """30 × mean actual/day of the trailing ≤30 telemetried days before month `key`."""
        i = _bisect.bisect_left(tl_dates, key + "-00")
        win_a, win_c, win_m = [], [], []
        for r in timeline[max(0, i - 30):i]:
            win_a.append(r["actualCost"])
        if len(win_a) < 7:
            return None
        return round(30.0 * sum(win_a) / len(win_a), 2), len(win_a)

    # --- monthly ledger
    created = dt.date.fromisoformat(day_of(c.get("createdAt") or "2025-10-01"))
    first_day = max(dt.date.fromisoformat(min(all_dates)) if all_dates else created, FLOOR, created)
    last_day = max(dt.date.fromisoformat(max(all_dates)) if all_dates else created, created)
    # ---- last-30-days demand-side pulses: WMAX30 / REQ30 over the trailing <=30 days each method covers
    def last30_pair(cols_base, col_act):
        rows = [r for r in timeline if r.get(cols_base) is not None]
        if not rows:
            return None
        rows = rows[-30:]
        base = sum(r[cols_base] for r in rows)
        act = sum(r[col_act] or 0 for r in rows)
        avgv = sum(r["vcpu"] for r in rows) / len(rows)
        fee30 = FEE_EUR_PER_VCPU_MONTH * FEE_FX_USD_PER_EUR * avgv
        g = base - act
        return {"from": rows[0]["date"], "to": rows[-1]["date"], "days": len(rows),
                "baseline": round(base, 2), "actual": round(act, 2), "gross": round(g, 2),
                "fee": round(fee30, 2), "net": round(g - fee30, 2)}
    last30 = {"WMAX": last30_pair("wmaxBaseline", "actualCost"),
              "REQ": last30_pair("adjREQ", "reqActualCompute")}
    monthly = []
    cur = dt.date(first_day.year, first_day.month, 1)
    endm = dt.date(last_day.year, last_day.month, 1)
    while cur <= endm:
        key = f"{cur.year:04d}-{cur.month:02d}"
        dim = calendar.monthrange(cur.year, cur.month)[1]
        days = [r for r in timeline if r["date"].startswith(key)]
        rep = report_months.get(key)
        wmax_arg = None
        trw_arg = None
        req_arg = None
        vrm = vr_months.get(key) or {}
        if days:
            real = [r for r in days if not r["idle"]]
            actual = sum(r["actualCost"] for r in days)  # idle $0 days included in month total
            n_days = len(days)
            n_real = len(real)
            avgV = (sum(r["vcpu"] for r in real) / n_real) if n_real else (rep or {}).get("avgVcpu") or 0.0
            avgR = (sum(r["ramGib"] for r in real) / n_real) if n_real else (rep or {}).get("avgRamGib") or 0.0
            adjM1 = sum((r["adjM1"] or 0) for r in days) or None
            adjTR = sum((r["adjTR"] or 0) for r in days) or None
            adjM2 = sum((r["adjM2"] or 0) for r in days) or None
            # tier-A spending months: org-daily-cost rows carry cost but no vCPU/RAM —
            # fall back to monthly-report quantities so M1/TR/TRW evaluate at report grain.
            fb_days = 0
            if actual > 0 and rep and (sum(r["vcpu"] for r in days) + sum(r["ramGib"] for r in days)) <= 0:
                fb_days = len(days)
                if adjM1 is None and (p or 0) > 0:
                    adjM1 = p * rep["avgVcpu"] * fb_days
                if adjTR is None and ((p_cpu or 0) > 0 or (p_mem or 0) > 0):
                    adjTR = p_cpu * rep["avgVcpu"] * fb_days + p_mem * rep["avgRamGib"] * fb_days + c_other * fb_days
                avgV = rep["avgVcpu"]
                avgR = rep["avgRamGib"]
            grossM0 = sum((r["grossM0"] or 0) for r in days) if m0_avg is not None and key > (first_full or "") else None
            lw = sum((r["layers"] or {}).get("woopDemand", 0) for r in days) or None
            qdays = [r for r in days if r.get("adjREQ") is not None]
            req_arg = (sum(r["adjREQ"] for r in qdays),
                       sum(r["reqActualCompute"] or 0 for r in qdays), len(qdays)) if qdays else None
            wdays = [r for r in days if r.get("wmaxBaseline") is not None]
            wmax_arg = (sum(r["wmaxBaseline"] for r in wdays),
                        sum(r["actualCost"] for r in wdays), len(wdays)) if wdays else None
            trw_sum = sum((r["adjTRW"] or 0) for r in days)
            trw_arg = ((trw_sum, sum(r["actualCost"] for r in days))
                       if (trw_sum > 0 and any(r.get("adjTRW") is not None for r in days)) else None)
            if trw_arg is None and fb_days > 0 and adjTR is not None:
                trw_arg = (adjTR, actual)  # TRW ≡ TR at report grain (no O available on tier A)
            ln = sum((r["layers"] or {}).get("nodePacking", 0) for r in days)
            lp = sum((r["layers"] or {}).get("priceEffect", 0) for r in days)
            cast = vrm.get("castTotalSavings")
            cast = cast if cast and cast != 0 else (sum((r["castTotalSavings"] or 0) for r in days) or None)
            entry = mk_month(key, dim, n_days, n_real, actual, avgV, avgR,
                             adjM1, adjTR, adjM2, grossM0, lw, ln, lp, cast, false=False)
        elif rep is not None:
            trw_arg = ((p_cpu * rep["avgVcpu"] * dim + p_mem * rep["avgRamGib"] * dim + c_other * dim),
                       rep["actualCost"]) if (p_cpu or p_mem) else None
            (# month exists in org report but not in daily series (tier A only)
            entry) = mk_month(key, dim, 0, 0, rep["actualCost"], rep["avgVcpu"], rep["avgRamGib"],
                              (p * rep["avgVcpu"] * dim) if p else None,
                              (p_cpu * rep["avgVcpu"] * dim + p_mem * rep["avgRamGib"] * dim + c_other * dim) if (p_cpu or p_mem) else None,
                              None,
                              (m0_avg * dim - rep["actualCost"]) if (m0_avg is not None and key > (first_full or "")) else None,
                              None, None, None, (vr_month_month(vr_months, key)), false=False,
                              org_report=True)
        else:
            entry = mk_month(key, dim, 0, 0, None, None, None, None, None, None, None,
                             None, None, None, None, false=True)
        if trw_arg:
            base_t, act_t = trw_arg
            g_t = base_t - act_t
            fee_t = entry["feesUsd"]
            entry["TRW"] = {"adjusted": round(base_t, 2), "gross": round(g_t, 2),
                            "fee": fee_t, "net": round(g_t - fee_t, 2)}
        else:
            entry["TRW"] = None
        if req_arg:
            base_q, act_q, nq = req_arg
            g_q = base_q - act_q
            fee_q = entry["feesUsd"] * (nq / max(len(days) or 1, 1))
            entry["REQ"] = {"adjusted": round(base_q, 2), "gross": round(g_q, 2),
                            "fee": round(fee_q, 2), "net": round(g_q - fee_q, 2)}
            if nq < len(days):
                entry["flags"] = entry.get("flags", []) + [f"REQ_PARTIAL({nq}/{len(days)}days w/requests)"]
        else:
            entry["REQ"] = None
        if wmax_arg:
            base_w, act_w, nw = wmax_arg
            g_w = base_w - act_w
            fee_w = entry["feesUsd"] * (nw / max(len(days) or 1, 1))
            entry["WMAX"] = {"adjusted": round(base_w, 2), "gross": round(g_w, 2),
                             "fee": round(fee_w, 2), "net": round(g_w - fee_w, 2)}
            if nw < len(days):
                entry["flags"] = entry.get("flags", []) + [f"WMAX_PARTIAL({nw}/{len(days)}days w/WOOP-orig)"]
        else:
            entry["WMAX"] = None
        tr30 = tr30d_month(key)
        if tr30 is not None:
            base30, nwin = tr30
            gross30 = (base30 - entry["actualCost"]) if not entry["estimated"] else None
            if gross30 is not None:
                fee30 = entry["feesUsd"]
                entry["TR30D"] = {"adjusted": base30, "gross": round(gross30, 2),
                                  "fee": fee30, "net": round(gross30 - fee30, 2)}
                if nwin < 30:
                    entry["flags"].append(f"TR30D_SHORT_WINDOW({nwin})")
        else:
            entry["TR30D"] = None
        entry["flags"] += month_flags(entry, sw)
        monthly.append(entry)
        cur = dt.date(cur.year + (cur.month == 12), (cur.month % 12) + 1, 1)

    return c, tier, timeline, monthly, baseline, sw, sw_src, policies, events, kappa0, o0, bp, calib, woop_comp, woop_summ, o_mem, u_cpu, u_mem, last30


def vr_month_month(vr_months, key):
    r = vr_months.get(key) or {}
    v = r.get("castTotalSavings")
    return v if v != 0 else (v if v else None)


def mk_month(key, dim, n_days, n_real, actual, avgV, avgR, adjM1, adjTR, adjM2,
             grossM0, lw, ln, lp, cast, false, org_report=False):
    adjustable = adjM1 is not None and actual is not None
    gross1 = (adjM1 - actual) if adjustable else None
    grossTR = (adjTR - actual) if (adjTR is not None and actual is not None) else None
    grossM2 = (adjM2 - actual) if (adjM2 is not None and actual is not None) else None
    idle = n_days > 0 and n_real == 0
    # subscription fee: €5 per provisioned vCPU-month (frozen FX), prorated by
    # telemetried days — org-report months are full-month windows by definition
    eff_days = n_real if n_real else (dim if org_report else 0)
    fee = month_fee(avgV, eff_days, dim)
    m4_gross = (round((lw or 0) + (ln or 0) + (lp or 0), 2)) if (lw is not None or lp) else None
    return {
        "month": key, "days": n_real if not idle else 0, "daysInMonth": dim,
        "partial": n_real < dim - 1 and not idle, "idle": idle,
        "estimated": false and actual is None,
        "fromOrgReport": org_report,
        "actualCost": round(actual, 2) if actual is not None else 0.0,
        "avgVcpu": round(avgV, 1) if avgV else 0.0,
        "avgRamGib": round(avgR, 1) if avgR else 0.0,
        "feesUsd": round(fee, 2),
        "M0": met(grossM0, None, fee), "M1": met(gross1, adjM1, fee), "TR": met(grossTR, adjTR, fee),
        "M2": met(grossM2, adjM2, fee),
        "M4": ({"woopDemand": round(lw or 0, 2), "nodePacking": round(ln or 0, 2),
                "priceEffect": round(lp or 0, 2), "gross": m4_gross,
                "net": round(m4_gross - fee, 2)}
               if m4_gross is not None else None),
        "castRealizedSavings": round(cast, 2) if cast is not None else None,
        "flags": [],
    }


def met(gross, adjusted=None, fee=0.0):
    if gross is None:
        return None
    return {"adjusted": round(adjusted, 2) if adjusted is not None else None,
            "gross": round(gross, 2), "fee": round(fee, 2), "net": round(gross - fee, 2)}


def month_fee(avg_vcpu, covered_days, days_in_month):
    """€5 per provisioned vCPU-month (frozen FX), prorated by covered days."""
    if avg_vcpu is None:
        return 0.0
    frac = covered_days / days_in_month if days_in_month else 0.0
    return FEE_EUR_PER_VCPU_MONTH * FEE_FX_USD_PER_EUR * avg_vcpu * frac


def month_flags(entry, sw):
    f = []
    m = entry["month"]
    if entry["estimated"]:
        f += ["ESTIMATED_NO_DATA"]
    if entry["idle"]:
        f += ["IDLE_MONTH($0)"]
    if entry["partial"]:
        f += ["PARTIAL_MONTH"]
    g1 = (entry.get("M1") or {}).get("gross")
    cast = entry.get("castRealizedSavings")
    if g1 is not None and cast is not None and abs(g1 - cast) > RECONCILE_TOL * max(abs(cast), 1.0):
        f += ["CROSSCHECK_OUT_OF_BAND"]
    if sw and m == sw[:7]:
        f += ["SWITCH_MONTH"]
    return f


# ----------------------------------------------------------------------------- main

def main():
    inv = read_json(os.path.join(RAW, "inventory", "inventory.json")) or {}
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(WEB, "ts"), exist_ok=True)

    orgs = {o["id"]: o for o in inv.get("orgs", [])}
    out_clusters = []
    for c in inv.get("clusters", []):
        cid = c["clusterId"]
        try:
            (c, tier, timeline, monthly, baseline, sw, sw_src, policies,
             events, kappa0, o0, bp, calib, woop_comp, woop_summ, o_mem, u_cpu, u_mem, last30) = build_cluster(c, None)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(f"[ERROR] {c.get('name')} {cid[:8]}: {e}", file=sys.stderr)
            continue

        # timeline file (rounded)
        ts_path = f"ts/{cid}.json"
        if timeline:
            for r in timeline:
                for k in list(r.keys()):
                    if isinstance(r[k], float):
                        r[k] = round(r[k], 4)
            with open(os.path.join(WEB, ts_path), "w") as fh:
                json.dump({"clusterId": cid, "timeline": timeline}, fh)

        methods_meta = {}
        if baseline:
            methods_meta["M1"] = {"p": baseline["pUsdPerVcpuDay"], "window": [baseline["from"], baseline["to"]],
                                  "days": baseline["days"]}
            methods_meta["TR"] = {"pCpu": baseline["pCpuUsdPerVcpuDay"], "pMem": baseline["pMemUsdPerGibDay"],
                                  "cOther": baseline["cOtherUsdPerDay"]}
            if baseline.get("m2"):
                methods_meta["M2"] = baseline["m2"]
        if kappa0 or o0:
            methods_meta["M4"] = {"kappa0": round(kappa0, 6) if kappa0 else None,
                                  "o0": round(o0, 6) if o0 else None}
        if u_cpu or u_mem:
            methods_meta["REQ"] = {"uCpu": round(u_cpu or 0, 6), "uMem": round(u_mem or 0, 6),
                                   "note": "$/req-core·day and $/req-GiB·day frozen from baseline era; demand = max(orig,cur); compute-only actual"}
        if o0:
            methods_meta["WMAX"] = {"oCpu": round(o0, 4), "oMem": round((o_mem or o0), 4),
                                    "castOCpu": fnum((bp or {}).get("cpuOverprovisioningFactor")),
                                    "castOMem": fnum((bp or {}).get("memoryOverprovisioningFactor")),
                                    "note": "max(R_orig,R_cur) × O × max(P_base,P_cur) per WOOP hour; CAST own O shown for reference (their basis differs: workload-level vs cluster-total)"}

        out_clusters.append({
            "clusterId": cid, "name": c.get("name"), "orgId": c["orgId"], "orgName": c.get("orgName"),
            "parentOrgId": c.get("parentOrgId"),
            "tier": tier, "isPhase2": c.get("isPhase2"), "status": c.get("status"),
            "agentStatus": c.get("agentStatus"), "createdAt": c.get("createdAt"),
            "switchDate": sw, "switchSource": sw_src,
            "baseline": baseline, "methodsMeta": methods_meta,
            "policies": policies,
            "woop": ({"installedAt": woop_comp.get("installedAt"), "currentVersion": woop_comp.get("currentVersion"),
                      "optimizedWorkloads": fnum(woop_summ.get("optimizedCount")),
                      "totalWorkloads": fnum(woop_summ.get("totalCount")),
                      "requestedPerHour": fnum((woop_summ.get("costsPerHour") or {}).get("requested")),
                      "recommendedPerHour": fnum((woop_summ.get("costsPerHour") or {}).get("recommended"))}
                     if woop_comp else None),
            "castBaselineParams": bp,
            "last30": last30,
            "timelineFile": f"data/ts/{cid}.json" if timeline else None,
            "monthly": monthly,
            "events": events,
            "flags": sorted(calib),
        })
    # ---- second pass: CAST-doc-01 baseline ladder rungs 2/3 for baseline-less clusters
    def pool_weights(sel):
        ws = [r["baseline"]["_w"] for r in sel if r.get("baseline") and r["baseline"].get("_w")]
        if not ws:
            return None
        return {"cpuCost": sum(w["cpuCost"] for w in ws), "vcpu": sum(w["vcpuQ"] for w in ws),
                "memCost": sum(w["memCost"] for w in ws), "ram": sum(w["ram"] for w in ws),
                "cost": sum(w["cost"] for w in ws), "n": len(ws)}

    def make_book(pool, kind_flag, sw):
        if not pool or pool["vcpu"] <= 0:
            return None
        return {"from": (sw[:7] + "-01") if sw else "2025-10-01", "to": sw or "2025-10-01", "days": 30,
                "pUsdPerVcpuDay": round(pool["cost"] / pool["vcpu"], 6),
                "pCpuUsdPerVcpuDay": round(pool["cpuCost"] / pool["vcpu"], 6),
                "pMemUsdPerGibDay": round(pool["memCost"] / pool["ram"], 6) if pool["ram"] else 0.0,
                "cOtherUsdPerDay": 0.0, "unitPriceCV": None, "ciHalfwidthPct": None, "m2": None,
                "gapToSwitchDays": 0, "switchDate": sw, "source": "pooled-frozen-prices",
                "_w": None, "flags": [kind_flag]}

    fleet_pool = pool_weights(out_clusters)
    rebuilt = 0
    for i, rec in enumerate(out_clusters):
        if rec.get("baseline") is not None:
            continue
        c0 = next((x for x in inv.get("clusters", []) if x["clusterId"] == rec["clusterId"]), None)
        if c0 is None:
            continue
        # rerun the complete build for this cluster with a pooled price book
        try:
            (c0, tier_t, timeline, monthly, baseline, sw, sw_src, policies,
             events, kappa0, o0, bp, calib, woop_comp, woop_summ, o_mem, u_cpu, u_mem, last30) = build_cluster(c0, None, fallback=None)
        except Exception:
            continue
        org_pool = pool_weights([r for r in out_clusters if r["orgId"] == rec["orgId"]])
        book = (make_book(org_pool, f"PEER_FROZEN(n={org_pool['n']};same-org pooled prices)", rec.get("switchDate")) if org_pool
                else make_book(fleet_pool, f"FLEET_PRICEBOOK_POOL(n={fleet_pool['n']};fleet pooled prices)", rec.get("switchDate")))
        if book is None:
            continue
        try:
            full = build_cluster(c0, None, fallback=book)
        except Exception:
            continue
        (c0, tier_t, timeline, monthly, baseline, sw, sw_src, policies,
         events, kappa0, o0, bp, calib, woop_comp, woop_summ, o_mem, u_cpu, u_mem, last30) = full
        if baseline is None or not (baseline.get("flags") or []):
            continue
        if baseline.get("_w"):  # own-history miraculously appeared — keep as own but re-run already fine
            pass
        rec["baseline"] = baseline
        rec["monthly"] = monthly
        rec["last30"] = last30
        if baseline:
            rec["methodsMeta"]["M1"] = {"p": baseline["pUsdPerVcpuDay"], "window": [baseline["from"], baseline["to"]], "days": baseline["days"]}
            rec["methodsMeta"]["TR"] = {"pCpu": baseline["pCpuUsdPerVcpuDay"], "pMem": baseline["pMemUsdPerGibDay"],
                                        "cOther": baseline["cOtherUsdPerDay"]}
        rebuilt += 1
    print(f"[ladder] peer/fleet pricebooks rebuilt for {rebuilt} baseline-less clusters")

    out_clusters.sort(key=lambda x: (x["orgName"] or "", x["name"] or ""))

    dataset = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fee": {"model": "per-provisioned-vcpu-month", "eurPerVcpuMonth": FEE_EUR_PER_VCPU_MONTH,
                "fxUsdPerEur": FEE_FX_USD_PER_EUR,
                "usdPerVcpuMonth": round(FEE_EUR_PER_VCPU_MONTH * FEE_FX_USD_PER_EUR, 2),
                "note": "CAST AI subscription fee — prorated by telemetried days; net = gross − fee (fee also on negative-gross months). CAST reference series left untouched (never blended)."},
        "reconcileTolerance": RECONCILE_TOL,
        "methodsCatalog": METHODS_CATALOG,
        "orgs": [{"id": o["id"], "name": o["name"], "parentId": o.get("parentId")} for o in inv.get("orgs", [])],
        "clusters": out_clusters,
    }
    with open(os.path.join(OUT, "dataset2.json"), "w") as fh:
        json.dump(dataset, fh)
    with open(os.path.join(WEB, "dataset2.json"), "w") as fh:
        json.dump(dataset, fh)

    tiers = {}
    for c in out_clusters:
        tiers[c["tier"]] = tiers.get(c["tier"], 0) + 1
    base_ok = sum(1 for c in out_clusters if c["baseline"])
    print(f"clusters={len(out_clusters)} tiers={tiers} with-baseline={base_ok}")
    print("methods coverage:",
          {"M1": sum(1 for c in out_clusters if c["methodsMeta"].get("M1")),
           "TR": sum(1 for c in out_clusters if c["methodsMeta"].get("TR")),
           "M2": sum(1 for c in out_clusters if c["methodsMeta"].get("M2")),
           "M4": sum(1 for c in out_clusters if c["methodsMeta"].get("M4")),
           "WMAX": sum(1 for c in out_clusters if any(m.get("WMAX") for m in c["monthly"])),
           "TRW": sum(1 for c in out_clusters if any(m.get("TRW") for m in c["monthly"])),
           "REQ": sum(1 for c in out_clusters if any(m.get("REQ") for m in c["monthly"])),
           "CAST": sum(1 for c in out_clusters if any(m["castRealizedSavings"] for m in c["monthly"]))})
    ts_n = len(glob.glob(os.path.join(WEB, "ts", "*.json")))
    du = sum(os.path.getsize(p) for p in glob.glob(os.path.join(WEB, "*.json")) + glob.glob(os.path.join(WEB, "ts", "*.json")))
    print(f"ts files={ts_n} web payload={du/1e6:.1f}MB")


METHODS_CATALOG = [
    {"id": "M0", "tier": 1, "name": "Naive flat-demand",
     "formula": "gross(m) = avgDaily(first full month) × days(m) − actual(m)",
     "note": "What 'month-over-month' really computes — no workload adjustment. Anchor for the fallacy; not a savings measure."},
    {"id": "M1", "tier": 2, "name": "Frozen vCPU price",
     "formula": "p = Σ baseline cost / Σ baseline vCPU (pre-switch era, frozen) · gross(t) = p×vCPU(t) − actual(t)",
     "note": "Workload-adjusted single price; understates savings when RAM grows faster than CPU (conservative floor)."},
    {"id": "TR", "tier": 3, "default": True, "name": "Frozen CPU+RAM prices (M1b) — operational standard",
     "formula": "gross(t) = p_cpu×vCPU(t) + p_mem×RAM(t) + c_other − actual(t)",
     "note": "DEFAULT for routine FinOps & reporting: dual-resource sensitivity (no distortion when RAM:CPU shifts), "
             "robust & deterministic (no regression, no collinearity or data-availability gates), "
             "defensible & auditable (vendor-independent, consistent, dispute-free counterfactual)."},
    {"id": "M2", "tier": 4, "name": "Two-factor OLS regression",
     "formula": "fit C = a·vCPU + b·RAM + c on pre-switch days → gross(t) = â·V(t) + b̂·RAM(t) + ĉ − actual(t)",
     "note": "Learns price split statistically; only published when gates pass (corr<0.9, R²≥0.7, CI≤25%, physical bounds)."},
    {"id": "M4", "tier": 5, "name": "Three-layer WOOP attribution",
     "formula": "G(t) = L_W + L_N + L_P — demand (original requests), packing, price/family; telescopes exactly",
     "note": "The management story: shows WHERE savings come from, incl. negative WOOP demand layers (stability value)."},
    {"id": "TR30D", "tier": 3, "name": "Rolling 30-day TR baseline",
     "formula": "baseline(m) = 30 × avg daily cost of the trailing ≤30 telemetried days before m (resource-split available per day); gross(m) = baseline(m) − actual(m)",
     "note": "Short-horizon pulse, not a savings measure: prices & workload self-absorb into the window, so steady state ≈ 0 by design — it spots RECENT shocks (price moves, migrations, spikes) that frozen TR keeps smoothed. ×30 is calendar-neutral (a 31-day month reads ~3% lean, February ~6% fat). Runs fleet-wide (needs only the daily cost feed)."},
    {"id": "WMAX", "tier": 5, "name": "WA-aware counterfactual (max demand · frozen O · max price)",
     "formula": "C_base(T) = Σ_t Δt [ max(Rᵒʳⁱᵍ_cpu, R^{cur}_cpu) × O_cpu × max(p_base_cpu, p^{cur}_cpu,t) + same for RAM ];  savings = C_base − C_actual   (Δt = 1h, WOOP hourly telemetry)",
     "note": "Workload-Autoscaler-aware: WA-reduced workloads still count their ORIGINAL demand, growing workloads count current demand (CAST AI documents this higher-of-original-or-current approach). Frozen overprovisioning factors O from pre-WA era; max-price leg keeps the counterfactual honest under price drift. Needs WOOP window (~60 days); partial months flagged."},
    {"id": "TRW", "tier": 5, "name": "TR with WA demand floor — best of TR ✚ WMAX",
     "formula": "V_ref(t) = max(V(t), O_cpu×max(Rᵒʳⁱᵍ_cpu, Rᵖᵘʳ_cpu)); M_ref analogous for RAM → baseline = p_cpu×V_ref + p_mem×M_ref + c_other − frozen TR prices",
     "note": "TR's frozen prices & additivity ✚ WMAX's anti-self-absorption demand floor: provisioning compressed by node+workload autoscaling never drags the counterfactual below O×original demand. Floor activates ONLY on days where WA demonstrably cut demand (orig > cur by >2%) — everywhere else it is pure TR. Degrades to plain TR where no originals exist (fleet tier, pre-WA era)."},
    {"id": "REQ", "tier": 5, "name": "Demand-unit counterfactual (Siemens C/D — docs 05/06)",
     "formula": "u_cpu = Σ baseline cpuCost ÷ Σ baseline req-core·day; u_mem = Σ ramCost ÷ Σ req-GiB·day \n adjREQ(t) = u_cpu×max(Rᵒʳⁱᵍ_cpu, Rᵖᵘʳ_cpu) + u_mem×max(Rᵒʳⁱᵍ_mem, Rᵖᵘʳ_mem) \n gross = adjREQ − (cpuCost + memCost)   [compute-only; storage/network excluded]",
     "note": "Implementation of the Siemens Workload-Adjusted Baseline proposal (doc 06, options C+D) grounded in CAST AI's own TAM cost-per-requested-CPU framework (doc 05). No separate overprovisioning factor needs estimating — O is absorbed in the unit cost, so the method is self-contained and provisioner-agnostic. Demand uses greatest(original, current) requests exactly as CAST AI's projected model does (doc 03), so rightsizing never masks value. Evaluation restricted to post-switch days with request telemetry (WOOP ~60d + era-1 windows)."},
    {"id": "CAST", "tier": 0, "name": "CAST AI realized (reference)",
     "formula": "totalSavings = projected − actual, CAST AI baseline at current prices",
     "note": "Their counterfactual, their price vintage. Side-by-side ±30% reconciliation band — never blended."},
]


if __name__ == "__main__":
    sys.exit(main())
