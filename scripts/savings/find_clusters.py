#!/usr/bin/env python3
"""Find which Siemens org owns dema-platform-services[-test] / dev-cluster.

Read-only probe of api.eu.cast.ai. Uses enterprise key from
projects/castai-billing-export/.env (CASTAI_API_KEY).
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path("/Users/eramadan/castai")
env_file = ROOT / "projects/castai-billing-export/.env"
for line in env_file.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if "=" in line:
        k, v = line.split("=", 1)
        v = v.strip()
        # Strip surrounding quotes (single or double) if present
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
            v = v[1:-1]
        os.environ.setdefault(k.strip(), v)

BASE = "https://api.eu.cast.ai"
KEY = os.environ["CASTAI_API_KEY"]
print("using key prefix:", KEY[:14], "length:", len(KEY), file=sys.stderr)

NAMES = {
    "dema-platform-services",
    "dema-platform-services-test",
    "dev-cluster",
    "eks-dev",
    "eks-tools",
    "prod-cluster",
}

req = urllib.request.Request(
    f"{BASE}/v1/organizations", headers={"X-API-Key": KEY}
)
orgs = json.loads(urllib.request.urlopen(req, timeout=20).read()).get(
    "organizations", []
)
print(f"orgs total: {len(orgs)}", file=sys.stderr)

hits, skipped = [], 0
errs = {}
for o in orgs:
    oid = o.get("id")
    oname = o.get("name", "")
    try:
        r = urllib.request.Request(
            f"{BASE}/v1/kubernetes/external-clusters",
            headers={
                "X-API-Key": KEY,
                "X-CastAI-Organization-Id": oid,
            },
        )
        d = json.loads(urllib.request.urlopen(r, timeout=10).read())
        items = d.get("items", d) if isinstance(d, dict) else d
        for c in items or []:
            n = c.get("name", "")
            if n in NAMES:
                region = c.get("region")
                rname = (
                    region.get("name")
                    if isinstance(region, dict)
                    else region
                )
                hits.append(
                    (
                        oid,
                        oname[:55],
                        c.get("id"),
                        n,
                        rname,
                        c.get("agentStatus"),
                        "phase2" if c.get("isPhase2") else "ro",
                    )
                )
    except urllib.error.HTTPError as e:
        skipped += 1
        errs[e.code] = errs.get(e.code, 0) + 1

print(f"skipped orgs: {skipped}, errs: {errs}", file=sys.stderr)
print("ORG_ID | ORG_NAME | CLUSTER_ID | CLUSTER_NAME | REGION | AGENT | MODE")
for h in hits:
    print(" | ".join(map(str, h)))
