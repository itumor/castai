#!/bin/bash
# Find which Siemens org owns dema-platform-services[-test] / dev-cluster.
# Read-only probe of api.eu.cast.ai via curl (urllib triggers Cloudflare 1010).
set -euo pipefail

ENV_FILE="/Users/eramadan/castai/projects/castai-billing-export/.env"
KEY=$(awk -F= '/^CASTAI_API_KEY/ {v=$2; gsub(/^[\047\042]|[\047\042]$/,"",v); gsub(/^ +| +$/,"",v); print v}' "$ENV_FILE")
BASE="https://api.eu.cast.ai"

echo "key prefix: ${KEY:0:14}  len: ${#KEY}" >&2

# Get all orgs
ORG_JSON=$(curl -sS -H "X-API-Key: $KEY" "$BASE/v1/organizations")
ORG_COUNT=$(echo "$ORG_JSON" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("organizations",[])))')
echo "orgs total: $ORG_COUNT" >&2

# Write org IDs to file
echo "$ORG_JSON" | python3 -c '
import sys, json
for o in json.load(sys.stdin).get("organizations", []):
    print(o["id"] + "\t" + (o.get("name","")[:55]))
' > /tmp/castai_orgs.tsv
echo "wrote /tmp/castai_orgs.tsv ($(wc -l < /tmp/castai_orgs.tsv) orgs)" >&2

NAMES='dema-platform-services|dema-platform-services-test|dev-cluster|eks-dev|eks-tools|prod-cluster'
OUT=/tmp/castai_cluster_hits.tsv
> "$OUT"

while IFS=$'\t' read -r oid oname; do
  resp=$(curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $oid" "$BASE/v1/kubernetes/external-clusters" || true)
  echo "$resp" | python3 -c "
import sys, json, re
names = {'dema-platform-services','dema-platform-services-test','dev-cluster','eks-dev','eks-tools','prod-cluster'}
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
items = d.get('items', d) if isinstance(d, dict) else d
for c in items or []:
    n = c.get('name','')
    if n in names:
        region = c.get('region')
        rname = region.get('name') if isinstance(region, dict) else region
        print(' | '.join([sys.argv[1], sys.argv[2][:55], c.get('id',''), n, str(rname), str(c.get('agentStatus')), 'phase2' if c.get('isPhase2') else 'ro']))
" "$oid" "$oname" >> "$OUT" 2>/dev/null || true
done < /tmp/castai_orgs.tsv

echo ""
echo "ORG_ID | ORG_NAME | CLUSTER_ID | CLUSTER_NAME | REGION | AGENT | MODE"
echo "------|---------|-----------|--------------|--------|-------|-----"
sort -u "$OUT"