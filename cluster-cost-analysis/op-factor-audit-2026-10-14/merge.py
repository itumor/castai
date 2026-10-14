#!/usr/bin/env python3
"""Merge baseline-params results with VR flags → anomaly table."""
import csv, sys, datetime as dt
from pathlib import Path

BASE = Path(__file__).parent
bp_rows = {}
with open(BASE / "bp-results.tsv") as f:
    for r in csv.reader(f, delimiter="\t"):
        if len(r) >= 12:
            bp_rows[r[2]] = r  # key: clusterId

vr_rows = []
with open(BASE / "vr-flags.tsv") as f:
    rd = csv.reader(f, delimiter="\t")
    hdr = next(rd)
    for r in rd:
        vr_rows.append(dict(zip(hdr, r)))

def num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

def days(a, b):
    try:
        d1 = dt.datetime.fromisoformat(a.replace("Z", "+00:00"))
        d2 = dt.datetime.fromisoformat(b.replace("Z", "+00:00"))
        return (d2 - d1).total_seconds() / 86400
    except Exception: return None

out = []
for v in vr_rows:
    cid = v["clusterId"]
    bp = bp_rows.get(cid)
    cpu_applied, ram_applied = num(v["cpuAppliedOP"]), num(v["ramAppliedOP"])
    cpu_live, ram_live = num(v["cpuLiveOP"]), num(v["ramLiveOP"])
    sav_act = num(v["sav/act"])
    cpu_bp = ram_bp = win_days = upd = bp_type = None
    if bp and bp[3] == "200":
        bp_type = bp[4]
        cpu_bp, ram_bp = num(bp[7]), num(bp[8])
        win_days = days(bp[5], bp[6])
        upd = bp[11]
    flags = []
    if (cpu_applied or 0) > 5 or (ram_applied or 0) > 5: flags.append("OP>5")
    if (sav_act or 0) > 1: flags.append("savings>actual")
    if v["baseline"] in ("PEER_CLUSTERS", "INDUSTRY_AVERAGE"): flags.append(v["baseline"])
    if cpu_applied and cpu_live and cpu_applied > 2 * cpu_live: flags.append("cpu applied≥2×live")
    if ram_applied and ram_live and ram_applied > 2 * ram_live: flags.append("ram applied≥2×live")
    if win_days is not None and win_days < 7: flags.append(f"window<{win_days:.1f}d")
    if flags:
        out.append((v["org"], v["cluster"], cid, v["baseline"], bp_type or "-",
                    cpu_bp, ram_bp, cpu_applied, ram_applied, cpu_live, ram_live,
                    num(v["actual$"]), num(v["savings$"]), sav_act, win_days, upd, ",".join(flags)))

out.sort(key=lambda r: -(max(r[5] or 0, r[6] or 0, r[7] or 0, r[8] or 0)))
cols = ["org","cluster","clusterId","vrBaseline","bpBaseline","cpuBP","ramBP",
        "cpuApplied","ramApplied","cpuLive","ramLive","actual$","savings$","sav/act","windowDays","bpUpdated","flags"]
w = csv.writer(sys.stdout, delimiter="\t")
w.writerow(cols)
for r in out:
    w.writerow(["" if x is None else (f"{x:.2f}" if isinstance(x, float) else x) for x in r])
print(f"# {len(out)} flagged of {len(vr_rows)} VR-active clusters", file=sys.stderr)
covered = {v["clusterId"] for v in vr_rows}
have_bp = sum(1 for r in bp_rows.values() if r[3] == "200")
no_bp = sum(1 for r in bp_rows.values() if r[3] != "200")
print(f"# baseline-params: {have_bp} with baseline, {no_bp} without (404+), of {len(bp_rows)} swept", file=sys.stderr)
miss = [bp_rows[c][1] for c in bp_rows if c not in covered and bp_rows[c][3] == "200"]
print(f"# clusters WITH baseline but NOT in Sept VR: {len(miss)}", file=sys.stderr)
