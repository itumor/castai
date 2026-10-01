#!/bin/bash
set -euo pipefail
ENV_FILE="/Users/eramadan/castai/projects/castai-billing-export/.env"
KEY=$(awk -F= '/^CASTAI_API_KEY/ {v=$2; gsub(/^[\047\042]|[\047\042]$/,"",v); gsub(/^ +| +$/,"",v); print v}' "$ENV_FILE")
BASE="https://api.eu.cast.ai"
THIRTY_AGO=$(date -u -v-30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z)
NOW=$(date -u +%Y-%m-%dT00:00:00Z)
FIRST_OF_MONTH=$(date -u +%Y-%m-01)
TODAY=$(date -u +%Y-%m-%d)

ORG1=5e413e89-eb67-48fb-b81c-6172baa988ed
CL1=00ee8944-67f6-43d5-8517-c270951ec02c
ORG2=d7534e71-612b-4963-89c8-22304c7a9d3d
CL2=7e04bd70-0513-4c6b-8b38-42b6c46905d9

py_nodes() {
  python3 - <<'PY'
import sys, json
d = json.load(sys.stdin)
nodes = d.get("items", d) if isinstance(d, dict) else d
print("node count:", len(nodes))
v = 0
for n in nodes:
    inst = n.get("instanceType") or n.get("instance_type") or ""
    cap = n.get("capacity") or {}
    cpu = float(cap.get("cpu", 0) or 0)
    v += cpu
    print(f"  {n.get('name','')[:45]} {inst} vCPU={cpu} life={n.get('lifecycle','?')}")
print(f"total vCPU on cluster right now: {v}")
PY
}

py_usage() {
  python3 - <<'PY'
import sys, json
d = json.load(sys.stdin)
for e in d.get("entities", []):
    name = e.get("clusterName") or e.get("cluster_name") or ""
    cid = e.get("clusterId") or e.get("cluster_id") or ""
    total = sum(float(x.get("value", 0)) for x in e.get("dailyUsages", []))
    days = len(e.get("dailyUsages", []))
    avg = round(total / 30, 1) if total else 0
    print(f"  cluster={name[:40]} id={cid[:8]} total_usage={round(total,3)} CPU-days over {days} days, avg_vCPU={avg}")
PY
}

py_est() {
  python3 - <<'PY'
import sys, json
d = json.load(sys.stdin)
for k, v in (d.get("recommendations") or {}).items():
    m = v.get("monthly") or {}
    pct = v.get("savingsPercentage", "?")
    print(f"rec={k} priceBefore=${m.get('priceBefore')} priceAfter=${m.get('priceAfter')} pct={pct}%")
    s = v.get("details", {}).get("configurationAfter", {}).get("summary", {})
    print(f"  config after: nodes={s.get('nodes')} vCPU={s.get('cpuCores')} RAM={s.get('ramBytes')}")
PY
}

echo "=== nodes dema-platform-services-test (CPS) ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG1" "$BASE/v1/kubernetes/external-clusters/$CL1/nodes" | py_nodes

echo ""
echo "=== nodes dev-cluster (DI PA MI) ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/kubernetes/external-clusters/$CL2/nodes" | py_nodes

echo ""
echo "=== estimated-savings dema-platform-services-test ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG1" "$BASE/v1/cost-reports/clusters/$CL1/estimated-savings" | py_est

echo ""
echo "=== estimated-savings dev-cluster ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/cost-reports/clusters/$CL2/estimated-savings" | py_est

echo ""
echo "=== platform-usage MTD CPS ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG1" "$BASE/v1/billing/platform-usage-detail?period.from=$FIRST_OF_MONTH&period.to=$TODAY&feature=phase2" | py_usage

echo ""
echo "=== platform-usage MTD DI PA MI ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/billing/platform-usage-detail?period.from=$FIRST_OF_MONTH&period.to=$TODAY&feature=phase2" | py_usage
