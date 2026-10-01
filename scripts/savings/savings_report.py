#!/usr/bin/env python3
"""
savings_report.py — workload-adjusted CAST AI savings per cluster per month.

Implements the M1 (single-factor unit-price) methodology from
.kimchi/docs/siemens-savings-methodology.md, with optional M2 (two-factor
OLS over vCPU + RAM) when numpy is available:

  p_baseline = sum(cost(t)) / sum(vcpu(t))      over frozen read-only window B
  adjustedBaseline(t) = p_baseline * vcpu(t)    for t >= switch date
  gross(m) = Σ adjusted − Σ actual ; fee = f*max(gross,0) ; net = gross − fee

All calls are READ-ONLY (GET, plus the one CAST AI "report" POST which is a
read-style report endpoint). Docs: .kimchi/docs/castai-api-savings-endpoints.md.

Usage (from repo root):
  source .env
  python3 scripts/savings/savings_report.py \
      --org-id 5e413e89-eb67-48fb-b81c-6172baa988ed --baseline-days 60 --m2
"""

import argparse
import calendar
import datetime as dt
import json
import os
import random
import statistics
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("pip install requests   (or run inside the repo's prepared env)")

try:
    import numpy as np  # only needed for --m2
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

CPS_ORG = "5e413e89-eb67-48fb-b81c-6172baa988ed"   # Siemens CPS (verified 2026-09-25)
CHUNK_DAYS = 90          # API cap: daily step accepts max 2232h (~93d)/request
MIN_BASELINE_DAYS = 21
MIN_M2_DAYS = 28
TODAY_DROP_HINT = "partial current day dropped (use --include-today to keep)"


# ---------------------------------------------------------------- API helpers

class CastClient:
    def __init__(self, base, key, org_id):
        self.s = requests.Session()
        self.s.headers.update({
            "X-API-Key": key,
            "X-CastAI-Organization-Id": org_id,   # mandatory for org-scoped reads
            "Accept": "application/json",
            "User-Agent": "savings-report/1.0",
        })
        self.base = base.rstrip("/")

    def get(self, path, params=None, attempts=4):
        url = self.base + path
        for i in range(attempts):
            try:
                r = self.s.get(url, params=params, timeout=60)
            except requests.RequestException as e:
                if i == attempts - 1:
                    raise
                time.sleep(1.5 * (i + 1))
                continue
            if r.status_code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(1.5 * (i + 1))
                continue
            if r.status_code != 200:
                raise RuntimeError(f"GET {path} -> {r.status_code}: {r.text[:200]}")
            return r.json()
        raise RuntimeError(f"GET {path}: retries exhausted")

    def post(self, path, params=None, attempts=3):
        """Only for read-style *report* endpoints (value-realization timeline)."""
        url = self.base + path
        for i in range(attempts):
            r = self.s.post(url, params=params, json={}, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(1.5 * (i + 1))
                continue
            if r.status_code != 200:
                raise RuntimeError(f"POST {path} -> {r.status_code}: {r.text[:200]}")
            return r.json()
        raise RuntimeError(f"POST {path}: retries exhausted")


def log(*a):
    print(*a, file=sys.stderr)


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def pick(item, *keys):
    for k in keys:
        if k in item and item[k] not in (None, ""):
            return fnum(item[k])
    return 0.0


def iso(d):
    return dt.datetime.combine(d, dt.time(0, 0), tzinfo=dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date(s):
    return dt.datetime.strptime(s[:10], "%Y-%m-%d").date()


# ------------------------------------------------------------- data fetching

def list_clusters(cli):
    data = cli.get("/v1/kubernetes/external-clusters")
    items = data.get("items", []) or []
    out = []
    for c in items:
        out.append({
            "id": c.get("id"),
            "name": c.get("name", "?"),
            "createdAt": c.get("createdAt"),
            "firstOperationAt": c.get("firstOperationAt"),
            "isPhase2": c.get("isPhase2"),
        })
    return out


def baseline_params(cli, org_id, cid):
    path = f"/reporting/v1beta/organizations/{org_id}/clusters/{cid}/baseline-params"
    try:
        return cli.get(path)
    except RuntimeError as e:
        log(f"  [warn] baseline-params unavailable for {cid[:8]}: {e}")
        return None


def resolve_switch_date(cli, org_id, cluster, override):
    """Priority: CLI override > baseline-params.baselinePeriodEndTime > firstOperationAt."""
    if override:
        return parse_date(override), "cli-override"
    bp = baseline_params(cli, org_id, cluster["id"])
    if bp and bp.get("baselinePeriodEndTime"):
        return parse_date(bp["baselinePeriodEndTime"]), "baseline-params.baselinePeriodEndTime"
    foa = cluster.get("firstOperationAt")
    if foa:
        return parse_date(foa), "firstOperationAt"
    return None, "unresolved — pass --switch-date"


def daily_series(cli, cid, start, end, use_listing):
    """Per-cluster daily (date -> dict) cost/vCPU/RAM series from the cost-report
    endpoint, chunked to <= CHUNK_DAYS windows (API cap: 93d daily / request).

    Verified live (2026-09-25): items are avg-HOURLY values per daily bucket
    (summary.avgCost is avg hourly; mean(items) ~= avgCost). Calibration below
    still auto-detects representation in case semantics drift.
    Retention: empirically ~60 days back only.
    """
    days = {}
    calib_flags = []
    cur = start
    while cur < end:
        chunk_end = min(end, cur + dt.timedelta(days=CHUNK_DAYS))
        params = {"startTime": iso(cur), "endTime": iso(chunk_end), "stepSeconds": 86400}
        if use_listing:
            params["useListingPrices"] = "true"
        data = cli.get(f"/v1/cost-reports/clusters/{cid}/cost", params=params)
        items = data.get("items", []) or []
        summary = data.get("summary", {}) or {}

        raw = []
        for it in items:
            d = it.get("timestamp", "")[:10]
            if not d:
                continue
            cA = pick(it, "costOnDemand") + pick(it, "costSpot") + pick(it, "costSpotFallback")
            cBu = pick(it, "totalCpuCost")
            cBr = pick(it, "totalRamCost")
            cB = cBu + cBr
            v = pick(it, "cpuCountOnDemand") + pick(it, "cpuCountSpot") + pick(it, "cpuCountSpotFallback")
            if v == 0.0:
                v = pick(it, "cpuCount", "cpuProvisioned", "avgCpuCount")
            m = (pick(it, "ramGibOnDemand") + pick(it, "ramGibSpot") + pick(it, "ramGibSpotFallback")) \
                or pick(it, "ramGib", "ramGibProvisioned", "totalRamGib")
            raw.append((d, cA, cB, v, m,
                        pick(it, "cpuCountSpot") + pick(it, "cpuCountSpotFallback"), cBu, cBr))

        if raw:
            mean_A = statistics.mean(r[1] for r in raw if r[1] > 0) if any(r[1] > 0 for r in raw) else None
            mean_B = statistics.mean(r[2] for r in raw if r[2] > 0) if any(r[2] > 0 for r in raw) else None
            avg_cost = fnum(summary.get("avgCost"))
            choice, factor = ("A" if mean_A else "B"), 24.0
            ok = False
            if avg_cost:
                for rep_name, rep_mean in (("A", mean_A), ("B", mean_B)):
                    if not rep_mean:
                        continue
                    # summary.avgCost is the average HOURLY cost of the window.
                    if abs(rep_mean - avg_cost) / avg_cost <= 0.12:
                        choice, factor, ok = rep_name, 24.0, True
                    elif abs(rep_mean - avg_cost * 24) / (avg_cost * 24) <= 0.12:
                        choice, factor, ok = rep_name, 1.0, True
                    if ok:
                        break
            if not ok and calib_flags is not None:
                calib_flags.append("CALIBRATION_FAIL(assumed avg-hourly items x24)")
            for d, cA, cB, v, m, vspot, cBu, cBr in raw:
                cost_raw = cA if choice == "A" else cB
                days[d] = {
                    "cost": cost_raw * factor,
                    "vcpu": v,
                    "ram": m,
                    "vcpu_spot": vspot,
                    "cpu_cost": (cBu if cB > 0 else cA * 0.88) * factor,
                    "mem_cost": (cBr if cB > 0 else cA * 0.12) * factor,
                }
        cur = chunk_end
    return days, calib_flags


TIMELINE_CHUNK_DAYS = 24   # endpoint returns at most ~25 items per call (no paging surface)


def org_timeline_series(cli, org_id, start, end):
    """ORG-LEVEL daily series from the value-realization timeline report.

    Verified live (2026-09-25): params MUST be URL query (start_time/end_time/
    step); the JSON body AND the cluster_ids query param are ignored -> the
    series is org-aggregated. Fields: cost.actualCost, cpu.provisionedCoresHourly,
    memory.provisionedGib. Coverage is non-contiguous historically: for CPS only
    2025-10-21..2025-11-25 (read-only era) and ~2026-07-20..today returned data.
    """
    days = {}
    cur = start
    while cur < end:
        chunk_end = min(end, cur + dt.timedelta(days=TIMELINE_CHUNK_DAYS))
        data = cli.post(
            f"/reporting/v1beta/organizations/{org_id}:runValueRealizationTimelineReport",
            params={"start_time": iso(cur), "end_time": iso(chunk_end), "step": "ONE_DAY"},
        )
        for it in data.get("timelineItems", []) or []:
            d = (it.get("timestamp") or "")[:10]
            if not d:
                continue
            cpu = it.get("cpu") or {}
            mem = it.get("memory") or {}
            cost = pick(it.get("cost") or {}, "actualCost")
            # VERIFIED 2026-09-25: provisionedCoresHourly / provisionedGib read
            # ~HALF of real vCPU/GiB; the *Hours accumulators are consistent with
            # the /cost endpoint -> derive real vCPU & GiB from them.
            v = pick(cpu, "provisionedCoreHours") / 24.0
            if v == 0.0:
                v = pick(cpu, "provisionedCoresHourly") * 2.0  # fallback, flagged
            m = pick(mem, "provisionedByteHours") / 24.0 / (1024 ** 3)
            if m == 0.0:
                m = pick(mem, "provisionedGib") * 2.0          # fallback, flagged
            days[d] = {
                "cost": cost, "vcpu": v, "ram": m, "vcpu_spot": 0.0,
                "cpu_cost": pick(cpu, "actualCost"),
                "mem_cost": pick(mem, "actualCost"),
            }
        cur = chunk_end
    return days


def probe_baseline_era(cli, org_id, sw_date, max_probe_days=380):
    """Probe backwards from the switch date in 30-day tiles; return the OLDEST
    contiguous run of tiles with org-timeline data (tiles are adjacent 30-day
    chunks by construction, so contiguity == consecutive non-empty tiles)."""
    tiles = []
    probed = 0
    while probed < max_probe_days:
        pe = sw_date - dt.timedelta(days=probed)
        ps = pe - dt.timedelta(days=30)
        sdays = {d: v for d, v in org_timeline_series(cli, org_id, ps, pe).items()
                 if v["cost"] > 0 and v["vcpu"] > 0}
        tiles.append(sdays)
        probed += 30
    best, run = {}, {}
    for sdays in reversed(tiles):          # oldest tile first
        if sdays:
            run.update(sdays)
            if len(run) > len(best):
                best = dict(run)
        else:
            run = {}
    return best


def realized_savings(cli, cid, start, end):
    """CAST AI's own realized savings over the window (cross-check only)."""
    try:
        data = cli.get(f"/v1/cost-reports/clusters/{cid}/savings",
                       params={"startTime": iso(start), "endTime": iso(end)})
        return fnum((data.get("summary") or {}).get("totalSavings"))
    except RuntimeError:
        return None


# ----------------------------------------------------------------- statistics

def bootstrap_ci_halfwidth(cost, vcpu, draws=999, seed=42):
    """Ratio-of-sums p = sum(C)/sum(V); resample days, return 95% CI half-width / p."""
    rng = random.Random(seed)
    n = len(cost)
    idx_all = range(n)
    ps = []
    for _ in range(draws):
        idx = [rng.choice(idx_all) for _ in idx_all]
        sc = sum(cost[i] for i in idx)
        sv = sum(vcpu[i] for i in idx)
        if sv > 0:
            ps.append(sc / sv)
    if len(ps) < 30:
        return None
    lo = np.percentile(ps, 2.5) if HAVE_NUMPY else sorted(ps)[int(0.025 * len(ps))]
    hi = np.percentile(ps, 97.5) if HAVE_NUMPY else sorted(ps)[int(0.975 * len(ps)) - 1]
    p_full = sum(cost) / sum(vcpu)
    return ((hi - lo) / 2) / p_full if p_full else None


def m2_fit(cost, vcpu, ram):
    """OLS C = a*V + b*M + c with gates from the methodology. Returns dict or None."""
    if not HAVE_NUMPY:
        return None
    n = len(cost)
    if n < MIN_M2_DAYS:
        return None
    X = np.column_stack([vcpu, ram, np.ones(n)])
    y = np.array(cost, dtype=float)
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    a, b, c = float(beta[0]), float(beta[1]), float(beta[2])
    resid = y - X @ beta
    r2 = 1.0 - float(resid @ resid) / float(((y - y.mean()) ** 2).sum() or 1.0)
    corr = float(np.corrcoef(vcpu, ram)[0, 1]) if n > 2 else 1.0
    if corr >= 0.9:                       # collinearity gate -> unidentified
        return None
    if not (0 < a <= 26.4 and 0 <= b <= 3.4 and (c >= 0 or abs(c) < 0.05 * (y.mean() or 1))):
        return None                       # physical bounds: $1.10/vCPU-h, $0.14/GiB-h
    if r2 < 0.7:
        return None
    rng = np.random.default_rng(42)
    a_s = []
    for _ in range(400):
        idx = rng.integers(0, n, n)
        bb, *_ = np.linalg.lstsq(X[idx], y[idx], rcond=None)
        if bb[0] > 0:
            a_s.append(float(bb[0]))
    if len(a_s) < 100:
        return None
    hw = float((np.percentile(a_s, 97.5) - np.percentile(a_s, 2.5)) / 2)
    if a and hw / a > 0.25:
        return None
    return {"a": a, "b": b, "c": c, "r2": r2, "corr": corr}


# ------------------------------------------------------------------- pipeline

def weekday_share(dates):
    if not dates:
        return 0.0
    return sum(1 for d in dates if dt.date.fromisoformat(d).weekday() < 5) / len(dates)


def process_cluster(cli, org_id, cluster, args, switch_override):
    cid, name = cluster["id"], cluster["name"]
    out = {"cluster_id": cid, "cluster_name": name, "flags": [], "rows": []}
    log(f"== {name} ({cid[:8]}) ==")

    sw_date, sw_src = resolve_switch_date(cli, org_id, cluster, switch_override)
    if sw_date is None:
        out["flags"].append("NO_SWITCH_DATE")
        log("  cannot resolve switch date; skipped")
        return out
    log(f"  switch date: {sw_date} ({sw_src})")

    # windows
    if args.baseline_from and args.baseline_to:
        b_start, b_end = parse_date(args.baseline_from), parse_date(args.baseline_to)
    else:
        b_end = sw_date
        b_start = sw_date - dt.timedelta(days=args.baseline_days)
    if not args.include_today:
        # cost items include today (partial); drop it unless asked otherwise
        today = dt.datetime.now(dt.timezone.utc).date()
    else:
        today = None

    # --- baseline data: try per-cluster cost report first (preferred: truly
    # per-cluster), fall back to the ORG-level timeline (only deep-history
    # source; covers CPS's read-only era 2025-10-21..2025-11-25). If both are
    # too short for the requested window, auto-probe older eras.
    base_source = "PER_CLUSTER_COST"
    base_days, calib1 = daily_series(cli, cid, b_start, b_end, args.use_listing_prices)
    keep = {d: v for d, v in base_days.items() if v["cost"] > 0 and v["vcpu"] > 0 and d != (today.isoformat() if today else "")}
    dropped_today = len(base_days) - len(keep) == 1 and today
    base_days = keep
    for f in calib1 + (["dropped-today"] if dropped_today else []):
        out["flags"].append(f)

    if len(base_days) < MIN_BASELINE_DAYS:
        # org-level timeline at the requested window
        tl = {d: v for d, v in org_timeline_series(cli, org_id, b_start, b_end).items()
              if v["cost"] > 0 and v["vcpu"] > 0 and d != (today.isoformat() if today else "")}
        if len(tl) > len(base_days):
            base_days, base_source = tl, "ORG_TIMELINE"
        if len(base_days) < MIN_BASELINE_DAYS:
            probed = probe_baseline_era(cli, args.org_id, b_end)
            if len(probed) >= max(MIN_BASELINE_DAYS, len(base_days)):
                base_days, base_source = probed, "ORG_TIMELINE_PROBE"
                out["flags"].append("BASELINE_NOT_CONTIGUOUS_WITH_SWITCH")
    if base_source.startswith("ORG_TIMELINE"):
        out["flags"].append("ORG_LEVEL_BASELINE_PRICE")

    dates_b = sorted(base_days)
    n_b = len(dates_b)
    out["baseline_source"] = base_source
    log(f"  baseline: {dates_b[0] if dates_b else '—'} .. {dates_b[-1] if dates_b else '—'}  ({n_b} days, {base_source})")
    if n_b < MIN_BASELINE_DAYS:
        out["flags"].append(f"SHORT_BASELINE({n_b}<{MIN_BASELINE_DAYS})")

    Cb = [base_days[d]["cost"] for d in dates_b]
    Vb = [base_days[d]["vcpu"] for d in dates_b]
    Mb = [base_days[d]["ram"] for d in dates_b]
    if not Cb or sum(Vb) == 0:
        out["flags"].append("NO_BASELINE_DATA (cost-report retention? escalate to CAST AI support)")
        return out

    p = sum(Cb) / sum(Vb)
    daily_unit = [c / v for c, v in zip(Cb, Vb) if v > 0]
    cv = statistics.pstdev(daily_unit) / statistics.mean(daily_unit) if len(daily_unit) > 1 and statistics.mean(daily_unit) else 0.0
    ci = bootstrap_ci_halfwidth(Cb, Vb)
    if cv > 0.4:
        out["flags"].append(f"HIGH_VARIANCE_BASELINE(CV={cv:.2f})")
    if ci is not None and ci > 0.15:
        out["flags"].append(f"LOW_CONFIDENCE_P(CI±{ci*100:.0f}%)")

    # ---- two-resource frozen prices (TR): p_cpu, p_mem from the API's own
    # cpu.actualCost / memory.actualCost decomposition + c_other residual.
    # Robust where the OLS M2 is unidentified (collinear V & M).
    UB = [base_days[d]["cost"] - base_days[d].get("cpu_cost", 0.0) - base_days[d].get("mem_cost", 0.0) for d in dates_b]
    p_cpu = sum(base_days[d].get("cpu_cost", 0.0) for d in dates_b) / sum(Vb) if sum(Vb) else 0.0
    p_mem = sum(base_days[d].get("mem_cost", 0.0) for d in dates_b) / sum(Mb) if sum(Mb) else 0.0
    c_other = statistics.mean(UB) if UB else 0.0
    if p_mem == 0.0 or p_cpu == 0.0:
        out["flags"].append("TR_UNAVAILABLE(no cpu/mem split in baseline source)")
        tr_ok = False
    else:
        tr_ok = True
        if c_other < 0:
            out["flags"].append(f"TR_RESIDUAL_NEGATIVE({c_other:.2f})")
            c_other = 0.0
        gap_rel = abs(c_other) / (statistics.mean(Cb) or 1.0)
        if gap_rel > 0.10:
            out["flags"].append(f"TR_RESIDUAL_GAP({gap_rel*100:.0f}% of cost)")
    gib_per_vcpu_b = (sum(Mb) / sum(Vb)) if sum(Vb) else 0.0
    log(f"  p_baseline = ${p:.4f}/vCPU-day  (CV={cv:.2f}, CI±{(ci or 0)*100:.0f}%, n={n_b}, {gib_per_vcpu_b:.2f} GiB/vCPU)")
    if tr_ok:
        log(f"  TR prices: p_cpu=${p_cpu:.4f}/vCPU-day  p_mem=${p_mem:.5f}/GiB-day  c_other=${c_other:.2f}/day")

    m2 = m2_fit(Cb, Vb, Mb) if (args.m2 and HAVE_NUMPY) else None
    if args.m2 and not HAVE_NUMPY:
        out["flags"].append("M2_SKIPPED(no numpy)")
    elif args.m2 and m2 is None:
        out["flags"].append("M2_GATES_FAILED(using M1)")
    elif m2:
        log(f"  M2: a=${m2['a']:.4f}/vCPU-d b=${m2['b']:.4f}/GiB-d c=${m2['c']:.2f}/d  R²={m2['r2']:.2f} corr={m2['corr']:.2f}")

    # evaluation window
    if args.month:
        y, mo = map(int, args.month.split("-"))
        e_start = dt.date(y, mo, 1)
        e_end = dt.date(y + (mo == 12), (mo % 12) + 1, 1) if mo == 12 else dt.date(y, mo + 1, 1)
    elif args.eval_from and args.eval_to:
        e_start, e_end = parse_date(args.eval_from), parse_date(args.eval_to)
    else:
        e_end = dt.datetime.now(dt.timezone.utc).date()
        e_start = e_end - dt.timedelta(days=30)

    eval_days, calib2 = daily_series(cli, cid, e_start, e_end, args.use_listing_prices)
    drop2 = {d: v for d, v in eval_days.items() if v["cost"] > 0 and v["vcpu"] > 0 and d != (today.isoformat() if today else "")}
    if len(eval_days) - len(drop2) == 1 and today:
        out["flags"].append(TODAY_DROP_HINT)
    eval_days = drop2
    for f in calib2:
        out["flags"].append(f"eval:{f}")

    ref = realized_savings(cli, cid, e_start, e_end)
    log(f"  eval: {e_start} .. {e_end}  ({len(eval_days)} days) | CAST AI realized savings = {None if ref is None else f'${ref:,.2f}'}")

    # RAM-drift check: if GiB-per-vCPU grew a lot since the baseline, the
    # single-factor vCPU price under-adjusts the counterfactual -> insist on M2.
    sum_ev = sum(eval_days[d]["vcpu"] for d in eval_days)
    sum_em = sum(eval_days[d]["ram"] for d in eval_days)
    gib_per_vcpu_e = (sum_em / sum_ev) if sum_ev else 0.0
    if gib_per_vcpu_b and gib_per_vcpu_e and gib_per_vcpu_e / gib_per_vcpu_b > 1.5:
        out["flags"].append(f"M1_UNRELIABLE_RAM_DRIFT({gib_per_vcpu_b:.2f}->{gib_per_vcpu_e:.2f} GiB/vCPU)")

    # roll up per calendar month
    months = {}
    for d in sorted(eval_days):
        row = eval_days[d]
        adj_m1 = p * row["vcpu"]
        adj = m2["a"] * row["vcpu"] + m2["b"] * row["ram"] + m2["c"] if m2 else adj_m1
        adj_tr = p_cpu * row["vcpu"] + p_mem * row["ram"] + c_other if tr_ok else None
        mth = d[:7]
        mo = months.setdefault(mth, {
            "days": 0, "actual": 0.0, "adj": 0.0, "adj_m1": 0.0, "adj_tr": 0.0,
            "vcpu": 0.0, "ram": 0.0, "spot_vcpu": 0.0,
            "dates": [],
        })
        mo["days"] += 1
        mo["actual"] += row["cost"]
        mo["adj"] += adj
        mo["adj_m1"] += adj_m1
        if adj_tr is not None:
            mo["adj_tr"] += adj_tr
        mo["vcpu"] += row["vcpu"]
        mo["ram"] += row["ram"]
        mo["spot_vcpu"] += row["vcpu_spot"]
        mo["dates"].append(d)

    wk_b = weekday_share(dates_b)
    wk_w = weekday_share(sorted(eval_days))
    if abs(wk_b - wk_w) > 0.20:
        out["flags"].append(f"WEEKDAY_MIX(B={wk_b:.2f},W={wk_w:.2f})")

    for mth in sorted(months):
        mo = months[mth]
        gross = mo["adj"] - mo["actual"]
        gross_m1 = mo["adj_m1"] - mo["actual"]
        gross_tr = (mo["adj_tr"] - mo["actual"]) if tr_ok else None
        fee = args.fee_rate * max(gross, 0.0)
        net = gross - fee
        net_tr = (gross_tr - args.fee_rate * max(gross_tr, 0.0)) if gross_tr is not None else None
        avg_v = mo["vcpu"] / mo["days"] if mo["days"] else 0
        er = (mo["actual"] / mo["vcpu"]) / p if mo["vcpu"] > 0 else None
        spot_share = 100.0 * mo["spot_vcpu"] / mo["vcpu"] if mo["vcpu"] else 0.0

        flags = list(out["flags"])
        y, mm = map(int, mth.split("-"))
        days_in_month = calendar.monthrange(y, mm)[1]
        if mo["days"] < days_in_month - 1:
            flags.append(f"PARTIAL(month {mo['days']}/{days_in_month} days)")
        if ref is not None and abs(gross_m1 - ref) > args.reconcile_tol * max(abs(ref), 1.0):
            flags.append("CROSSCHECK_OUT_OF_BAND")

        out["rows"].append({
            "cluster_id": cid,
            "cluster_name": name,
            "month": mth,
            "days": mo["days"],
            "baseline_from": str(dates_b[0]),
            "baseline_to": str(dates_b[-1]),
            "baseline_days": n_b,
            "baseline_source": base_source,
            "switch_date": str(sw_date),
            "switch_source": sw_src,
            "p_usd_per_vcpu_day": round(p, 4),
            "p_ci_halfwidth_pct": round((ci or 0) * 100, 1),
            "unit_price_cv": round(cv, 3),
            "avg_vcpu": round(avg_v, 1),
            "avg_ram_gib": round(mo["ram"] / mo["days"], 1) if mo["days"] else 0,
            "spot_share_pct": round(spot_share, 1),
            "actual_cost_usd": round(mo["actual"], 2),
            "adjusted_baseline_usd": round(mo["adj"], 2),
            "gross_saving_usd": round(gross, 2),
            "er_unit_price_ratio": round(er, 3) if er else None,
            "fee_usd": round(fee, 2),
            "net_saving_usd": round(net, 2),
            "castai_realized_savings_usd": round(ref, 2) if ref is not None else None,
            "m1_gross_usd": round(gross_m1, 2),
            "p_cpu_usd_per_vcpu_day": round(p_cpu, 4) if tr_ok else None,
            "p_mem_usd_per_gib_day": round(p_mem, 5) if tr_ok else None,
            "c_other_usd_per_day": round(c_other, 2) if tr_ok else None,
            "tr_adjusted_baseline_usd": round(mo["adj_tr"], 2) if tr_ok else None,
            "tr_gross_usd": round(gross_tr, 2) if gross_tr is not None else None,
            "tr_net_usd": round(net_tr, 2) if net_tr is not None else None,
            "model": "M2" if m2 else "M1",
            "flags": ";".join(sorted(set(flags))) if flags else "",
        })
    return out


# ----------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=os.environ.get("CASTAI_API_BASE", "https://api.eu.cast.ai"))
    ap.add_argument("--org-id", default=os.environ.get("CASTAI_ORG_ID", CPS_ORG))
    ap.add_argument("--cluster", action="append", help="cluster id (prefix match ok); repeatable; default: all")
    ap.add_argument("--switch-date", help="YYYY-MM-DD read-only→autoscaling for ALL clusters (default: auto)")
    ap.add_argument("--baseline-days", type=int, default=60, help="baseline window length ending at switch date (default 60)")
    ap.add_argument("--baseline-from"), ap.add_argument("--baseline-to")
    ap.add_argument("--eval-from"), ap.add_argument("--eval-to")
    ap.add_argument("--month", help="evaluate a calendar month: YYYY-MM")
    ap.add_argument("--fee-rate", type=float, default=0.05)
    ap.add_argument("--use-listing-prices", action="store_true")
    ap.add_argument("--m2", dest="m2", action="store_true", default=True,
                    help="fit two-factor OLS a*V+b*M+c as well (default on; needs numpy)")
    ap.add_argument("--no-m2", dest="m2", action="store_false", help="skip the M2 model")
    ap.add_argument("--reconcile-tol", type=float, default=0.30)
    ap.add_argument("--include-today", action="store_true")
    ap.add_argument("--out", help="write cluster x month table to this CSV path")
    ap.add_argument("--dry-run", action="store_true", help="resolve windows + switch dates only")
    args = ap.parse_args()

    key = os.environ.get("CASTAI_API_KEY")
    if not key:
        sys.exit("CASTAI_API_KEY not set — run `source .env` at the repo root first")

    cli = CastClient(args.base, key, args.org_id)
    log(f"org={args.org_id} base={args.base}")

    clusters = list_clusters(cli)
    if args.cluster:
        wanted = set(args.cluster)
        clusters = [c for c in clusters if any(c["id"].startswith(w) for w in wanted)]
    if not clusters:
        sys.exit("no clusters found (check org id / headers)")

    if args.dry_run:
        for c in clusters:
            sw, src = resolve_switch_date(cli, args.org_id, c, args.__dict__.get("switch_date"))
            log(f"  {c['name']} ({c['id'][:8]}): switch={sw} via {src}")
        log("dry-run complete")
        return

    results = [process_cluster(cli, args.org_id, c, args, args.__dict__.get("switch_date")) for c in clusters]

    rows = [r for res in results for r in res["rows"]]
    if not rows:
        sys.exit("no rows produced — see flags on stderr")

    cols = ["cluster_name", "cluster_id", "month", "days", "baseline_from", "baseline_to",
            "baseline_days", "baseline_source", "switch_date", "p_usd_per_vcpu_day", "p_ci_halfwidth_pct",
            "unit_price_cv", "avg_vcpu", "avg_ram_gib", "spot_share_pct",
            "actual_cost_usd", "adjusted_baseline_usd", "gross_saving_usd",
            "er_unit_price_ratio", "fee_usd", "net_saving_usd",
            "castai_realized_savings_usd", "m1_gross_usd",
            "p_cpu_usd_per_vcpu_day", "p_mem_usd_per_gib_day", "c_other_usd_per_day",
            "tr_adjusted_baseline_usd", "tr_gross_usd", "tr_net_usd",
            "model", "flags"]

    print(f"\n{'cluster':<22} {'month':<7} {'p $/vCPU-d':>10} {'avg vCPU':>8} {'actual $':>10} "
          f"{'adj base $':>10} {'gross $':>9} {'fee $':>8} {'net $':>9} {'TR net $':>10}  flags")
    tot_net = 0.0
    tot_net_tr = 0.0
    for r in rows:
        tr_net_s = f"{r['tr_net_usd']:>10,.0f}" if r.get("tr_net_usd") is not None else f"{'—':>10}"
        print(f"{r['cluster_name'][:22]:<22} {r['month']:<7} {r['p_usd_per_vcpu_day']:>10.4f} "
              f"{r['avg_vcpu']:>8.0f} {r['actual_cost_usd']:>10,.0f} {r['adjusted_baseline_usd']:>10,.0f} "
              f"{r['gross_saving_usd']:>9,.0f} {r['fee_usd']:>8,.0f} {r['net_saving_usd']:>9,.0f} {tr_net_s}  {r['flags'][:50]}")
        tot_net += r["net_saving_usd"]
        if r.get("tr_net_usd") is not None:
            tot_net_tr += r["tr_net_usd"]
    print(f"\nTOTAL NET (M1): ${tot_net:,.2f}   TOTAL NET (TR): ${tot_net_tr:,.2f}")

    if args.out:
        with open(args.out, "w") as fh:
            fh.write(",".join(cols) + "\n")
            for r in rows:
                fh.write(",".join(json.dumps(r[c]) if isinstance(r[c], str) else str(r[c]) for c in cols) + "\n")
        log(f"CSV written: {args.out}")


if __name__ == "__main__":
    main()
