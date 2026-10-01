#!/bin/bash
# Pull dev-cluster + platform-usage data only.
set -euo pipefail
ENV_FILE="/Users/eramadan/castai/projects/castai-billing-export/.env"
KEY=$(awk -F= '/^CASTAI_API_KEY/ {v=$2; gsub(/^[\047\042]|[\047\042]$/,"",v); gsub(/^ +| +$/,"",v); print v}' "$ENV_FILE")
BASE="https://api.eu.cast.ai"
THIRTY_AGO=$(date -u -v-30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z)
NOW=$(date -u +%Y-%m-%dT00:00:00Z)
FIRST_OF_MONTH=$(date -u +%Y-%m-01)
TODAY=$(date -u +%Y-%m-%d)

ORG1=5e413e89-eb67-48fb-b81c-6172baa988ed  # CPS
CL1=00ee8944-67f6-43d5-8517-c270951ec02c
ORG2=d7534e71-612b-4963-89c8-22304c7a9d3d  # DI PA MI
CL2=7e04bd70-0513-4c6b-8b38-42b6c46905d9

echo "=== dev-cluster overview ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/kubernetes/external-clusters/$CL2" | python3 -m json.tool | head -40

echo ""
echo "=== dev-cluster savings (30d) ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/cost-reports/clusters/$CL2/savings?startTime=$THIRTY_AGO&endTime=$NOW" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d.get('items',[])
total_cost=0; total_savings=0
downscaling=0; spot=0
for it in items:
    if it.get('totalCost'): total_cost += float(it['totalCost'])
    downscaling += float(it.get('downscalingSavings') or 0)
    spot += float(it.get('spotSavings') or 0)
s=d.get('summary',{})
print('days:', len(items))
print('summary:', s)
print('computed downscaling:', round(downscaling,2), 'spot:', round(spot,2), 'total:', round(downscaling+spot,2))
"

echo ""
echo "=== dev-cluster estimated-savings (head) ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/cost-reports/clusters/$CL2/estimated-savings" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for k,v in (d.get('recommendations') or {}).items():
    m=v.get('monthly') or {}
    print(f\"rec={k} priceBefore=\\${m.get('priceBefore')} priceAfter=\\${m.get('priceAfter')} pct={v.get('savingsPercentage')}%\")
    s=v.get('details',{}).get('configurationAfter',{}).get('summary',{})
    print(f\"  config after: nodes={s.get('nodes')} vCPU={s.get('cpuCores')} RAM={s.get('ramBytes')}\")
"

echo ""
echo "=== platform-usage-detail MTD — CPS (test cluster) ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG1" "$BASE/v1/billing/platform-usage-detail?period.from=$FIRST_OF_MONTH&period.to=$TODAY&feature=phase2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for e in d.get('entities',[]):
    cid = e.get('clusterId') or e.get('cluster_id') or ''
    name = e.get('clusterName') or e.get('cluster_name') or ''
    total = sum(float(x.get('value',0)) for x in e.get('dailyUsages',[]))
    days = len(e.get('dailyUsages',[]))
    print(f\"  cluster={name[:40]} id={cid[:8]} total_usage={round(total,3)} CPU-days over {days} days, avg_vCPU={round(total/30,1) if total else 0}\")
"

echo ""
echo "=== platform-usage-detail MTD — DI PA MI (dev-cluster) ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/billing/platform-usage-detail?period.from=$FIRST_OF_MONTH&period.to=$TODAY&feature=phase2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for e in d.get('entities',[]):
    cid = e.get('clusterId') or e.get('cluster_id') or ''
    name = e.get('clusterName') or e.get('cluster_name') or ''
    total = sum(float(x.get('value',0)) for x in e.get('dailyUsages',[]))
    days = len(e.get('dailyUsages',[]))
    print(f\"  cluster={name[:40]} id={cid[:8]} total_usage={round(total,3)} CPU-days over {days} days, avg_vCPU={round(total/30,1) if total else 0}\")
"

echo ""
echo "=== nodes — dema-platform-services-test ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG1" "$BASE/v1/kubernetes/external-clusters/$CL1/nodes" | python3 -c "
import sys,json
d=json.load(sys.stdin)
nodes = d.get('items',d) if isinstance(d,dict) else d
print('node count:', len(nodes))
v=0
for n in nodes:
    inst = n.get('instanceType') or n.get('instance_type') or ''
    cap = n.get('capacity') or {}
    cpu = float(cap.get('cpu',0) or 0)
    v += cpu
    print(f\"  {n.get('name','')[:45]} {inst} vCPU={cpu} life={n.get('lifecycle','?')}\")
print(f'total vCPU on cluster right now: {v}')
"

echo ""
echo "=== nodes — dev-cluster ==="
curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG2" "$BASE/v1/kubernetes/external-clusters/$CL2/nodes" | python3 -c "
import sys,json
d=json.load(sys.stdin)
nodes = d.get('items',d) if isinstance(d,dict) else d
print('node count:', len(nodes))
v=0
for n in nodes:
    inst = n.get('instanceType') or n.get('instance_type') or ''
    cap = n.get('capacity') or {}
    cpu = float(cap.get('cpu',0) or 0)
    v += cpu
    print(f\"  {n.get('name','')[:45]} {inst} vCPU={cpu} life={n.get('lifecycle','?')}\")
print(f'total vCPU on cluster right now: {v}')
"