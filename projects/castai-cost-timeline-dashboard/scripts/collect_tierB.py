#!/usr/bin/env python3
"""collect_tierB.py — deep per-cluster collection (all methods + events).

Mirrors the original CPS collector fan-out, generalized by cluster id from the
inventory. Per cluster:
  cost/      /cost (90d chunks) · /resource-usage (90d chunks)
  savings/   vr-timeline daily (21d chunks) · vr monthly · legacy savings chunks
             · baseline-params · estimated-savings
  workload/  WOOP component · workloads-summary · workloads-summary-metrics (2×30d)
  events/    policies · rebalancing-plans (+details) · audit v2 autoscaler+workload
             filtered sweeps (paged, capped)

Usage: python3 scripts/collect_tierB.py --clusters id1,id2,...
"""
import argparse
import datetime as dt
import json
import os
import sys

from _collect import (Client, chunks, cluster_dir, day, iso, load_inventory,
                      save, today)

FLOOR = dt.date(2025, 10, 1)


def collect_cluster(cli, c):
    cid, oid = c["clusterId"], c["orgId"]
    t_end = today()
    calls, errors = 0, []

    created = day(c["createdAt"]) if c.get("createdAt") else FLOOR
    d0 = max(created, FLOOR)

    # ---- cost + resource usage
    for series, path in (("cost", "/v1/cost-reports/clusters/{cid}/cost"),
                         ("resource-usage", "/v1/cost-reports/clusters/{cid}/resource-usage")):
        for cs, ce in chunks(d0, t_end, 90):
            data = cli.get(path.format(cid=cid), org=oid,
                           startTime=iso(cs), endTime=iso(ce), stepSeconds=86400)
            calls += 1
            if data is None:
                errors.append(f"{series} {cs}.. chunk no-response")
                continue
            save(cluster_dir(cid, "cost"), f"{series}_{cs}_{ce}.json", data)

    # ---- value-realization daily (21d chunks, retry-once on empty)
    for cs, ce in chunks(d0, t_end, 21):
        data = cli.post_report(":runValueRealizationTimelineReport",
                               {"clusterIds": [cid]}, org=oid,
                               start_time=iso(cs), end_time=iso(ce), step="ONE_DAY")
        calls += 1
        if data is None:
            errors.append(f"vr-daily {cs}.. no-response")
            continue
        if not (data.get("timelineItems") or []):
            data = cli.post_report(":runValueRealizationTimelineReport",
                                   {"clusterIds": [cid]}, org=oid,
                                   start_time=iso(cs), end_time=iso(ce), step="ONE_DAY")
            calls += 1
            if data is None:
                errors.append(f"vr-daily {cs}.. retry no-response")
                continue
        save(cluster_dir(cid, "savings"), f"vr-timeline-day_{cs}_{ce}.json", data)

    # ---- vr monthly + legacy savings + baseline params + estimated savings
    vr_m = cli.post_report(":runValueRealizationTimelineReport",
                           {"clusterIds": [cid]}, org=oid,
                           start_time=iso(d0), end_time=iso(t_end), step="ONE_MONTH")
    calls += 1
    if vr_m is not None:
        save(cluster_dir(cid, "savings"), "vr-timeline-month_cluster.json", vr_m)

    for cs, ce in chunks(d0, t_end, 90):
        data = cli.get("/v1/cost-reports/clusters/{cid}/savings".format(cid=cid), org=oid,
                       startTime=iso(cs), endTime=iso(ce), stepSeconds=86400)
        calls += 1
        if data is not None:
            save(cluster_dir(cid, "savings"), f"savings_{cs}_{ce}.json", data)

    bp = cli.get(f"/reporting/v1beta/organizations/{oid}/clusters/{cid}/baseline-params", org=oid)
    calls += 1
    if bp is not None:
        save(cluster_dir(cid, "savings"), "baseline-params.json", bp)

    est = cli.get(f"/v1/cost-reports/clusters/{cid}/estimated-savings", org=oid)
    calls += 1
    if est is not None:
        save(cluster_dir(cid, "savings"), "estimated-savings.json", est)

    # ---- WOOP
    comp = cli.get(f"/v1/workload-autoscaling/clusters/{cid}/components/workload-autoscaler", org=oid)
    calls += 1
    if comp is not None:
        save(cluster_dir(cid, "workload"), "woop-component.json", comp)
        summ = cli.get(f"/v1/workload-autoscaling/clusters/{cid}/workloads-summary",
                       org=oid, includeCosts="true")
        calls += 1
        if summ is not None:
            save(cluster_dir(cid, "workload"), "woop-summary.json", summ)
        m0 = max(t_end - dt.timedelta(days=60), d0)
        for i, (cs, ce) in enumerate(chunks(m0, t_end, 30)):
            mts = cli.get(f"/v1/workload-autoscaling/clusters/{cid}/workloads-summary-metrics",
                          org=oid, fromTime=iso(cs), toTime=iso(ce))
            calls += 1
            if mts is not None:
                save(cluster_dir(cid, "workload"), f"resource-usage_chunk{i}_{cs}_{ce}.json", mts)

    # ---- events: policies + rebalancing + filtered audit sweeps
    pol = cli.get(f"/v1/kubernetes/clusters/{cid}/policies", org=oid)
    calls += 1
    if pol is not None:
        save(cluster_dir(cid, "events"), "policies.json", pol)

    pl = cli.get(f"/v1/kubernetes/clusters/{cid}/rebalancing-plans", org=oid)
    calls += 1
    if pl is not None:
        save(cluster_dir(cid, "events"), "rebalancing-plans.json", pl)
        for p in (pl.get("items") or pl.get("rebalancingPlans") or []):
            pid = p.get("rebalancingPlanId") or p.get("id")
            if not pid:
                continue
            det = cli.get(f"/v1/kubernetes/clusters/{cid}/rebalancing-plans/{pid}", org=oid)
            calls += 1
            if det is not None:
                save(cluster_dir(cid, "events"), f"rebalancing-plan_{pid}.json", det)

    audit_start = max(t_end - dt.timedelta(days=85), d0)
    for domains, tag in (("autoscaler", "autoscaler"),
                         ("workload", "workload-scaling")):
        cursor = None
        for page in range(1, 21):
            params = {"filter.clusters": cid, "filter.domains": domains,
                      "fromDate": iso(audit_start), "toDate": iso(t_end)}
            if cursor:
                params["page.cursor"] = cursor
            ev = cli.get("/v2/audit/events", org=oid, **params)
            calls += 1
            if ev is None:
                break
            save(cluster_dir(cid, "events"), f"audit-v2_{tag}_page{page}.json", ev)
            cursor = ev.get("nextCursor")
            batch = ev.get("items") or ev.get("events") or []
            if not cursor or not batch:
                break

    return cid, c["name"], calls, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clusters", required=True, help="comma-separated cluster ids")
    args = ap.parse_args()
    wanted = set(args.clusters.split(","))
    inv = load_inventory()
    targets = [c for c in inv["clusters"] if c["clusterId"] in wanted]
    key = os.environ.get("CASTAI_API_KEY")
    if not key:
        sys.exit("CASTAI_API_KEY missing")
    cli = Client(key)
    out = []
    for c in targets:
        try:
            cid, name, calls, errors = collect_cluster(cli, c)
        except Exception as e:  # noqa: BLE001
            cid, name, calls, errors = c["clusterId"], c.get("name"), -1, [str(e)]
        out.append({"clusterId": cid, "name": name, "calls": calls, "errors": errors})
        print(f"  {name[:30]:<30} {cid[:8]} calls={calls} errors={len(errors)}", flush=True)
    print(json.dumps({"clusters": len(out), "calls": sum(o["calls"] for o in out),
                      "errors": sum(len(o["errors"]) for o in out),
                      "detail": [{"clusterId": o["clusterId"], "errors": o["errors"][:4]} for o in out if o["errors"]]}))


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
