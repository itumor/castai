#!/usr/bin/env python3
"""Aggregate daily CAST AI savings/cost pulls into monthly series per cluster."""
import json, glob
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).parent
CLUSTERS = {
    "helios": "ngm-helios-eks",
    "integ":  "ngm-integ-eks",
    "kronos": "ngm-kronos-eks",
}
EURUSD = 1.08  # analysis-consistent conversion for the €5/vCPU fee

def month_of(ts): return ts[:7]

out = {"period": "Oct 2025 – Sep 2026", "clusters": {}}
for key, name in CLUSTERS.items():
    sav_daily, cost_daily = defaultdict(lambda: [0.0, 0.0]), defaultdict(list)
    for f in sorted(glob.glob(str(BASE / f"savings-{key}-*.json"))):
        for it in json.load(open(f)).get("items", []):
            m = month_of(it["timestamp"])
            sav_daily[m][0] += float(it.get("downscalingSavings", 0))
            sav_daily[m][1] += float(it.get("spotSavings", 0))
    for f in sorted(glob.glob(str(BASE / f"cost-{key}-*.json"))):
        for it in json.load(open(f)).get("items", []):
            m = month_of(it["timestamp"])
            # costOnDemand/costSpot are hourly averages; total*Cost fields are
            # daily totals (totalCpuCostOnDemand == cpuCostOnDemand * 24).
            cost = ((float(it.get("costOnDemand", 0)) + float(it.get("costSpot", 0))
                     + float(it.get("costSpotFallback", 0))) * 24.0
                    + float(it.get("totalStorageCost", 0)))
            # cpuCount* fields are already daily-average provisioned vCPU.
            cpu = (float(it.get("cpuCountOnDemand", 0)) + float(it.get("cpuCountSpot", 0))
                   + float(it.get("cpuCountSpotFallback", 0)))
            cost_daily[m].append({
                "cost": cost,
                "cpu": cpu,
            })
    months = []
    for m in sorted(set(sav_daily) | set(cost_daily)):
        if m >= "2026-10":  # boundary artifact: partial month, keep window exactly Oct 2025 – Sep 2026
            continue
        s = sav_daily.get(m, [0.0, 0.0])
        days = cost_daily.get(m, [])
        total_cost = sum(d["cost"] for d in days)
        # avg provisioned vCPU: mean of daily avgCpuCount (days with data)
        cpu_vals = [d["cpu"] for d in days if d["cpu"] > 0]
        avg_cpu = sum(cpu_vals) / len(cpu_vals) if cpu_vals else 0.0
        savings = s[0] + s[1]
        baseline = total_cost + savings
        fee_eur = avg_cpu * 5.0
        months.append({
            "month": m, "days": len(days),
            "actual_cost": round(total_cost, 2),
            "downscale_savings": round(s[0], 2),
            "spot_savings": round(s[1], 2),
            "savings": round(savings, 2),
            "baseline": round(baseline, 2),
            "avg_provisioned_vcpu": round(avg_cpu, 1),
            "fee_eur": round(fee_eur, 0),
            "fee_usd": round(fee_eur * EURUSD, 0),
            "net_usd": round(savings - fee_eur * EURUSD, 2),
            "savings_pct": round(savings / baseline * 100, 1) if baseline else 0,
        })
    tot = {
        "actual_cost": round(sum(m["actual_cost"] for m in months), 2),
        "savings": round(sum(m["savings"] for m in months), 2),
        "downscale_savings": round(sum(m["downscale_savings"] for m in months), 2),
        "spot_savings": round(sum(m["spot_savings"] for m in months), 2),
        "baseline": round(sum(m["baseline"] for m in months), 2),
        "fee_eur": round(sum(m["fee_eur"] for m in months), 0),
        "fee_usd": round(sum(m["fee_usd"] for m in months), 0),
        "net_usd": round(sum(m["net_usd"] for m in months), 2),
        "avg_provisioned_vcpu": round(sum(m["avg_provisioned_vcpu"] for m in months) / max(len(months),1), 1),
    }
    tot["savings_pct"] = round(tot["savings"] / tot["baseline"] * 100, 1) if tot["baseline"] else 0
    out["clusters"][name] = {"id": {"helios": "419c39e4-66bf-4d61-b833-4562968a61c7",
                                    "integ":  "1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f",
                                    "kronos": "6d20eb8e-a1e5-4411-b4c8-5346ac3291b0"}[key],
                             "months": months, "total": tot}

# portfolio rollup
c = out["clusters"]
g = {k: round(sum(c[n]["total"][k] for n in c), 2)
     for k in ["actual_cost", "savings", "downscale_savings", "spot_savings", "baseline", "fee_eur", "fee_usd", "net_usd"]}
g["savings_pct"] = round(g["savings"] / g["baseline"] * 100, 1) if g["baseline"] else 0
out["portfolio"] = g

with open(BASE / "monthly_series.json", "w") as f:
    json.dump(out, f, indent=2)

print(json.dumps(out, indent=2))
