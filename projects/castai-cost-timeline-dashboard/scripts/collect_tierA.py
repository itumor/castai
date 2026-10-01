#!/usr/bin/env python3
"""collect_tierA.py — fleet-wide (org-level + per-cluster monthly) collection.

For every org in the slice that has ≥1 cluster:
  1. org daily-cost (per-cluster-per-day $  series) in 90d chunks
  2. per-calendar-month org clusters/report (per-cluster monthly cost + avg vCPU/RAM)
  3. org value-realization timeline, MONTHLY (actual vs projected vs savings)
  4. per-cluster value-realization timeline, MONTHLY (one call per cluster)

Usage: python3 scripts/collect_tierA.py --slice 1 4
"""
import argparse
import datetime as dt
import json
import os
import sys

from _collect import (Client, chunks, cluster_dir, day, iso, load_inventory,
                      months_between, org_dir, save, today)

FLOOR = dt.date(2025, 10, 1)   # never probe before this (pre-fleet era)


def collect_org(cli, org, inv_clusters):
    oid, oname = org["id"], org["name"]
    odir = org_dir(oid)
    t_end = today()
    out = {"orgId": oid, "orgName": oname, "calls": 0, "days": 0, "months": 0,
           "clusters": len(inv_clusters), "errors": []}

    # 1) org daily-cost chunks
    d0 = min((day(c["createdAt"]) for c in inv_clusters if c.get("createdAt")), default=FLOOR)
    d0 = max(d0, FLOOR)
    for cs, ce in chunks(d0, t_end, 90):
        data = cli.get("/v1/cost-reports/organization/daily-cost",
                       org=oid, startTime=iso(cs), endTime=iso(ce))
        out["calls"] += 1
        if data is None:
            out["errors"].append(f"daily-cost {cs}..{ce} -> no response")
            continue
        items = data.get("items", []) or []
        out["days"] += sum(len(i.get("intervals", []) or []) for i in items)
        save(odir, f"daily-cost_{cs}_{ce}.json", data)

    # 2) per-month clusters/report (per-cluster monthly cost + avg vCPU/RAM)
    for ms, me in months_between(max(d0, dt.date(2025, 10, 1)), t_end):
        data = cli.get("/v1/cost-reports/organization/clusters/report",
                       org=oid, startTime=iso(ms), endTime=iso(me))
        out["calls"] += 1
        if data is None:
            out["errors"].append(f"report {ms} -> no response")
            continue
        if data.get("clusters"):
            out["months"] += 1
        save(odir, f"clusters-report_{ms:%Y-%m}.json", data)

    # 3) org value-realization, monthly step, full window
    vr = cli.post_report(":runValueRealizationTimelineReport", {},
                         org=oid, start_time=iso(max(d0, FLOOR)), end_time=iso(t_end),
                         step="ONE_MONTH")
    out["calls"] += 1
    if vr is not None:
        save(odir, "vr-timeline-month.json", vr)

    # 4) per-cluster value-realization, monthly
    for c in inv_clusters:
        cid = c["clusterId"]
        cvr = cli.post_report(":runValueRealizationTimelineReport",
                              {"clusterIds": [cid]}, org=oid,
                              start_time=iso(max(day(c["createdAt"]) if c.get("createdAt") else FLOOR, FLOOR)),
                              end_time=iso(t_end), step="ONE_MONTH")
        out["calls"] += 1
        if cvr is not None:
            save(cluster_dir(cid, "savings"), "vr-timeline-month_cluster.json", cvr)

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", type=int, nargs=2, required=True, metavar=("K", "N"))
    args = ap.parse_args()
    k, n = args.slice
    inv = load_inventory()
    orgs_with = sorted({c["orgId"] for c in inv["clusters"]})
    org_map = {o["id"]: o for o in inv["orgs"]}
    selected = [oid for i, oid in enumerate(orgs_with) if i % n == (k - 1)]
    key = os.environ.get("CASTAI_API_KEY")
    if not key:
        sys.exit("CASTAI_API_KEY missing")
    cli = Client(key)
    results = []
    for oid in selected:
        org = org_map[oid]
        clusters = [c for c in inv["clusters"] if c["orgId"] == oid]
        try:
            results.append(collect_org(cli, org, clusters))
        except Exception as e:  # noqa: BLE001
            results.append({"orgId": oid, "orgName": org["name"], "calls": -1, "errors": [str(e)]})
        print(f"[{k}/{n}] {org['name'][:28]:<28} clusters={results[-1]['clusters']:>3} "
              f"calls={results[-1]['calls']:>3} days={results[-1].get('days', 0):>5} "
              f"errors={len(results[-1].get('errors', []))}", flush=True)
    log_path = os.path.join(os.path.dirname(__file__), f"_tierA_slice{k}of{n}.json")
    with open(log_path, "w") as fh:
        json.dump(results, fh)
    print(json.dumps({"slice": k, "orgs": len(results),
                      "calls": sum(r["calls"] for r in results),
                      "errors": sum(len(r.get("errors", [])) for r in results)}))


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
