#!/usr/bin/env python3
"""Build result_slice6.tsv from inv_/vr_ JSONs for orgs on lines 86-102 of orgs_130.tsv."""
import json, os, sys

BASE = "/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12"
DIR = os.path.join(BASE, "enterprise")

orgs = []
with open(os.path.join(BASE, "orgs_130.tsv")) as f:
    lines = f.read().splitlines()
for ln in lines[85:102]:
    oid, oname = ln.split("\t", 1)
    orgs.append((oid, oname))

def money(v):
    if v is None: return "-"
    try: return f"{float(v):.2f}"
    except (TypeError, ValueError): return "-"

def text(v):
    return str(v) if v is not None else "-"

def to_float(v):
    try: return float(v)
    except (TypeError, ValueError): return None

rows = []
for oid, oname in orgs:
    inv_path = os.path.join(DIR, f"inv_{oid}.json")
    vr_path = os.path.join(DIR, f"vr_{oid}.json")
    inv, vr = [], []
    if os.path.exists(inv_path):
        inv = (json.load(open(inv_path)).get("items") or [])
    if os.path.exists(vr_path):
        vr = (json.load(open(vr_path)).get("items") or [])
    vr_by_cid = {}
    for it in vr:
        cid = it.get("clusterId")
        if cid: vr_by_cid[cid] = it
    matched = set()
    for c in inv:
        cid = c.get("id")
        acct = "-"
        if c.get("eks") and c["eks"].get("accountId"): acct = c["eks"]["accountId"]
        elif c.get("aks") and c["aks"].get("accountId"): acct = c["aks"]["accountId"]
        elif c.get("gke") and c["gke"].get("projectId"): acct = c["gke"]["projectId"]
        region = (c.get("region") or {}).get("name") or "-"
        it = vr_by_cid.get(cid)
        if it is not None:
            matched.add(cid)
            cost = it.get("cost") or {}
            rows.append([oname, oid, text(it.get("clusterName") or c.get("name")), text(cid),
                         text(acct), text(region), "yes",
                         money(cost.get("actualCost")), money(cost.get("projectedCost")),
                         money(cost.get("totalSavings"))])
        else:
            rows.append([oname, oid, text(c.get("name")), text(cid),
                         text(acct), text(region), "no", "-", "-", "-"])
    for it in vr:
        cid = it.get("clusterId")
        if cid and cid not in matched:
            cost = it.get("cost") or {}
            rows.append([oname, oid, text(it.get("clusterName")), text(cid),
                         "-", "-", "yes",
                         money(cost.get("actualCost")), money(cost.get("projectedCost")),
                         money(cost.get("totalSavings"))])

def sort_key(r):
    sav = to_float(r[9])
    return (r[0], 0 if sav is not None else 1, -(sav or 0.0), r[4])

rows.sort(key=sort_key)
out = os.path.join(DIR, "result_slice6.tsv")
with open(out, "w") as f:
    for r in rows:
        f.write("\t".join(r) + "\n")
print(f"wrote {len(rows)} rows to {out}")
