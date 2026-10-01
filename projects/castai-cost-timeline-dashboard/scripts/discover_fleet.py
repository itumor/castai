#!/usr/bin/env python3
"""discover_fleet.py — enumerate every org + cluster visible to the API key.

Writes data/raw/inventory/{organizations.json, clusters_<orgId>.json, inventory.json}.
Read-only GETs. Cloudflare note (verified 2026-09-26): python urllib gets 1010;
send a curl-like User-Agent.
"""
import json
import os
import sys
import time

import requests

BASE = os.environ.get("CASTAI_API_BASE", "https://api.eu.cast.ai")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "inventory")


def main():
    key = os.environ.get("CASTAI_API_KEY")
    if not key:
        sys.exit("CASTAI_API_KEY not set — source .env first")
    s = requests.Session()
    s.headers.update({
        "X-API-Key": key, "Accept": "application/json",
        "User-Agent": "curl/8.7.1",
    })
    os.makedirs(OUT, exist_ok=True)

    orgs = s.get(f"{BASE}/v1/organizations", timeout=30).json().get("organizations", [])
    with open(os.path.join(OUT, "organizations.json"), "w") as fh:
        json.dump({"organizations": orgs}, fh)

    inventory = []
    failures = []
    for o in orgs:
        oid, name = o["id"], o["name"]
        try:
            r = s.get(f"{BASE}/v1/kubernetes/external-clusters",
                      headers={"X-CastAI-Organization-Id": oid}, timeout=30)
            items = r.json().get("items", [])
        except Exception as e:  # noqa: BLE001
            items, failures = [], failures + [(oid, str(e))]
        with open(os.path.join(OUT, f"clusters_{oid}.json"), "w") as fh:
            json.dump({"items": items}, fh)
        for c in items:
            inventory.append({
                "clusterId": c.get("id"),
                "name": c.get("name"),
                "orgId": oid,
                "orgName": name,
                "parentOrgId": o.get("parentId"),
                "status": c.get("status"),
                "agentStatus": c.get("agentStatus"),
                "isPhase2": c.get("isPhase2"),
                "createdAt": c.get("createdAt"),
                "firstOperationAt": c.get("firstOperationAt"),
                "region": c.get("region"),
                "cloudProvider": (c.get("eks") and "eks") or (c.get("aks") and "aks") or (c.get("gke") and "gke") or (c.get("kops") and "kops") or "other",
            })
        time.sleep(0.08)

    inventory.sort(key=lambda x: (x["orgName"], x["name"] or ""))
    with open(os.path.join(OUT, "inventory.json"), "w") as fh:
        json.dump({"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "orgs": [{"id": o["id"], "name": o["name"], "parentId": o.get("parentId"),
                             "childCount": sum(1 for o2 in orgs if o2.get("parentId") == o["id"])}
                            for o in orgs],
                   "clusters": inventory,
                   "failures": failures}, fh)
    p2 = sum(1 for c in inventory if c["isPhase2"])
    print(f"orgs={len(orgs)} clusters={len(inventory)} phase2={p2} failures={len(failures)}")
    for f in failures[:5]:
        print("  FAIL", f[0][:8], f[1][:80])


if __name__ == "__main__":
    main()
