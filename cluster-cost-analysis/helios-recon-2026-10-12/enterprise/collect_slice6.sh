#!/bin/bash
# Read-only CAST AI collector for one org. Input: "org_id<TAB>org_name" on stdin line.
# Usage: echo -e "$line" | collect_one.sh
set -u
IFS=$'\t' read -r org_id org_name <<< "$1"
BASE="https://api.eu.cast.ai"
DIR="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise"
LOG="$DIR/slice6_status.log"

# 1. Inventory (GET external-clusters)
inv_tmp=$(mktemp)
inv_code=$(curl -sS -o "$inv_tmp" -w '%{http_code}' \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: $org_id" \
  "$BASE/v1/kubernetes/external-clusters" 2>/dev/null)
if [ "$inv_code" = "200" ]; then
  n=$(jq -r '.items | length' "$inv_tmp" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 0 ]; then
    cp "$inv_tmp" "$DIR/inv_${org_id}.json"
    echo -e "$org_id\t$org_name\tINV_OK n=$n" >> "$LOG"
  else
    echo -e "$org_id\t$org_name\tINV_EMPTY" >> "$LOG"
  fi
else
  echo -e "$org_id\t$org_name\tINV_ERR $inv_code" >> "$LOG"
fi
rm -f "$inv_tmp"

# 2. VR report (read-semantics POST report query, body {})
vr_tmp=$(mktemp)
vr_code=$(curl -sS -o "$vr_tmp" -w '%{http_code}' -X POST \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE/reporting/v1beta/organizations/${org_id}/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe%2FBerlin" 2>/dev/null)
if [ "$vr_code" = "200" ]; then
  n=$(jq -r '.items | length' "$vr_tmp" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 0 ]; then
    cp "$vr_tmp" "$DIR/vr_${org_id}.json"
    echo -e "$org_id\t$org_name\tVR_OK n=$n" >> "$LOG"
  else
    echo -e "$org_id\t$org_name\tVR_EMPTY" >> "$LOG"
  fi
else
  echo -e "$org_id\t$org_name\tVR_ERR $vr_code" >> "$LOG"
fi
rm -f "$vr_tmp"
