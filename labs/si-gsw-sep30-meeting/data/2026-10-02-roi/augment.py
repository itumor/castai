#!/usr/bin/env python3
"""Augment compute_roi.py output with per-cluster detail + honest caveats."""
import json
from pathlib import Path

BASE = Path(__file__).parent
data = json.load(open(BASE / "roi_data_07aa3c29.json"))
series = json.load(open(BASE / "monthly_series.json"))
P = series["portfolio"]
C = series["clusters"]

# Corrected period label (data window is Oct 2025 – Sep 2026, exactly 12 months)
data["period_label"] = "Oct 2025 – Sep 2026 (last 12 months, CAST API list prices)"

data["kpi_cards"] = [
    {"label": "Total Saved (12 months)", "value": "$526,923", "sub": "vs no-CAST baseline"},
    {"label": "Savings Rate",            "value": "33.5%",   "sub": "of baseline infra cost"},
    {"label": "Net After CAST Fee",      "value": "$357,284", "sub": "savings − platform fee"},
    {"label": "Return per $1 of Fee",    "value": "3.1×",    "sub": "savings-to-fee ratio"},
]

rows = [
    {"indicator": "Total Actual Savings (12 months)",          "value": "$526,923"},
    {"indicator": "Baseline Infrastructure Cost (no CAST AI)", "value": "$1,573,732"},
    {"indicator": "Optimized Cost After CAST AI",              "value": "$1,046,809"},
    {"indicator": "CAST AI Platform Fee (€5 × avg prov. vCPU)", "value": "€157,074 ≈ $169,638"},
    {"indicator": "Net Savings (Savings − Fee)",               "value": "$357,285"},
    {"indicator": "ROI on Platform Fee",                       "value": "211%"},
    {"indicator": "Savings-to-Fee Ratio",                      "value": "3.1×"},
    {"indicator": "Fee Payback · Net at Siemens' rates (48–58% of list)", "value": "~11 days/mo of savings · still $83k–$136k net"},
]
for name in ["ngm-helios-eks", "ngm-integ-eks", "ngm-kronos-eks"]:
    t = C[name]["total"]
    rows.append({
        "indicator": f"· {name}",
        "value": (f"saved ${t['savings']/1000:,.1f}k ({t['savings_pct']}%) · "
                  f"fee ${t['fee_usd']/1000:,.1f}k · net ${t['net_usd']/1000:,.1f}k"),
    })
data["roi_metrics"] = rows

data["savings_breakdown"] = {
    "node_savings": 526922.82,
    "node_savings_pct": 33.5,
    "woop_savings": 0,
    "woop_savings_pct": 0,
    "node_share_pct": 100,
    "woop_share_pct": 0,
}

data["executive_summary"] = (
    "Savings ROI for Siemens SI GSW CLO — ngm-helios-eks, ngm-integ-eks, ngm-kronos-eks. "
    "Over the last 12 months (Oct 2025 – Sep 2026) CAST AI downscaling removed $526,923 of node-hours at AWS "
    "list prices, a 33.5% reduction against the $1,573,732 infrastructure baseline these clusters would have "
    "cost without CAST AI. Measured against the platform fee (€5 × avg provisioned vCPU = €157,074 ≈ $169,638): "
    "net $357,285 after fee, 211% ROI, $3.1 returned per $1 of fee. Every cluster is net-positive every month — "
    "integ +$215.6k, helios +$128.9k, kronos +$12.8k — and net remains $83k–$136k even at Siemens' effective "
    "discounted rates (48–58% of list). Spot is not yet enabled ($0 spot savings today), which is the next "
    "upside beyond these numbers."
)

data["disclaimer"] = (
    "Source: CAST AI cost-reports API (api.eu.cast.ai), org SI GSW CLO, pulled 02 Oct 2026; 12 monthly buckets "
    "Oct 2025 – Sep 2026. Savings = measured downscaling (node-hours removed) vs CAST AI baseline at AWS list "
    "prices; spot savings $0 (spot not yet enabled on these clusters). Platform fee basis: €5 × average "
    "provisioned vCPU (EUR→USD 1.08). Costs include compute + storage. Clusters: ngm-helios-eks "
    "(419c39e4-66bf-4d61-b833-4562968a61c7), ngm-integ-eks (1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f), "
    "ngm-kronos-eks (6d20eb8e-a1e5-4411-b4c8-5346ac3291b0)."
)

json.dump(data, open(BASE / "roi_data_07aa3c29.json", "w"), indent=2)
print("✓ augmented roi_data_07aa3c29.json")
print(json.dumps(data["kpi_cards"], indent=2))
