#!/usr/bin/env bash
# GET-only CAST AI fetcher with single retry (5s; 10s on 429). Never prints the API key.
set -u
cd /Users/eramadan/castai
source .env
BASE=https://api.eu.cast.ai
ORG=07aa3c29-3e1f-44bc-ad60-ceedb878d99a
CLUSTER=419c39e4-66bf-4d61-b833-4562968a61c7
OUT=/Users/eramadan/castai/cluster-cost-analysis/ngm-helios-eks
mkdir -p "$OUT"

if [ -z "${CASTAI_API_KEY:-}" ]; then echo "MISSING CASTAI_API_KEY"; exit 1; fi

fetch() {
  local name="$1"; shift
  local url="$1"; shift
  local code="" attempt
  for attempt in 1 2; do
    code=$(curl -sS --max-time 120 -o "$OUT/$name" -w '%{http_code}' \
      -H "X-API-Key: $CASTAI_API_KEY" \
      -H "X-CastAI-Organization-Id: $ORG" \
      -H "Accept: application/json" \
      "$url" 2>>"$OUT/fetch-errors.log")
    if [ "$code" = "200" ]; then
      echo "OK   $name ($code)"
      return 0
    fi
    echo "attempt $attempt for $name -> HTTP $code" >> "$OUT/fetch-errors.log"
    if [ "$attempt" = "1" ]; then
      if [ "$code" = "429" ]; then sleep 10; else sleep 5; fi
    fi
  done
  echo "FAIL $name (last HTTP $code)"
  echo "$code" > "$OUT/$name.httpcode"
  return 1
}

fetch nodes "$BASE/v1/kubernetes/external-clusters/$CLUSTER/nodes"
fetch nodes-pricing "$BASE/v1/pricing/clusters/$CLUSTER/nodes"
fetch cost-30d "$BASE/v1/cost-reports/clusters/$CLUSTER/cost?startTime=2026-09-02T00:00:00Z&endTime=2026-10-02T00:00:00Z&stepSeconds=86400"
fetch resource-usage-30d "$BASE/v1/cost-reports/clusters/$CLUSTER/resource-usage?startTime=2026-09-02T00:00:00Z&endTime=2026-10-02T00:00:00Z&stepSeconds=86400"
fetch savings-90d "$BASE/v1/cost-reports/clusters/$CLUSTER/savings?startTime=2026-07-04T00:00:00Z&endTime=2026-10-02T00:00:00Z&stepSeconds=86400"
fetch estimated-savings "$BASE/v1/cost-reports/clusters/$CLUSTER/estimated-savings"
fetch policies "$BASE/v1/kubernetes/clusters/$CLUSTER/policies"
fetch node-configurations "$BASE/v1/kubernetes/clusters/$CLUSTER/node-configurations"
fetch node-templates "$BASE/v1/kubernetes/clusters/$CLUSTER/node-templates"
fetch rebalancing-plans "$BASE/v1/kubernetes/clusters/$CLUSTER/rebalancing-plans"
fetch problematic-nodes "$BASE/v1/kubernetes/clusters/$CLUSTER/problematic-nodes"
fetch node-count-history-30d "$BASE/v1/cost-reports/clusters/$CLUSTER/node-count-history?startTime=2026-09-02T00:00:00Z&endTime=2026-10-02T00:00:00Z&stepSeconds=86400"
fetch nodes-storage "$BASE/v1/cost-reports/clusters/$CLUSTER/nodes/storage"
fetch audit-events "$BASE/v1/audit?clusterId=$CLUSTER&fromDate=2026-07-01&toDate=2026-10-02"
fetch woop-component "$BASE/v1/workload-autoscaling/clusters/$CLUSTER/components/workload-autoscaler"
echo "BASE FETCHES DONE"
