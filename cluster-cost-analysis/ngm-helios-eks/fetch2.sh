#!/usr/bin/env bash
# Detail fetches: node-config by id, 3 most recent rebalancing plans, audit retry with RFC3339 dates.
set -u
cd /Users/eramadan/castai
source .env
BASE=https://api.eu.cast.ai
ORG=07aa3c29-3e1f-44bc-ad60-ceedb878d99a
CLUSTER=419c39e4-66bf-4d61-b833-4562968a61c7
OUT=/Users/eramadan/castai/cluster-cost-analysis/ngm-helios-eks
mkdir -p "$OUT"

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

CFG=$(jq -r '.items[0].id' "$OUT/node-configurations.json")
fetch "node-config-$CFG.json" "$BASE/v1/kubernetes/clusters/$CLUSTER/node-configurations/$CFG"

for PID in $(jq -r '.items | sort_by(.createdAt) | reverse | .[0:3][].rebalancingPlanId' "$OUT/rebalancing-plans.json"); do
  fetch "rebalancing-$PID.json" "$BASE/v1/kubernetes/clusters/$CLUSTER/rebalancing-plans/$PID"
done

fetch audit-events.json "$BASE/v1/audit?clusterId=$CLUSTER&fromDate=2026-07-01T00:00:00Z&toDate=2026-10-02T00:00:00Z"
echo "DETAIL FETCHES DONE"
