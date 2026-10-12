#!/bin/bash
# Read-only per-org worker: 1 GET (inventory) + 1 POST (VR read-semantics report)
# Usage: _worker_slice3.sh <org_id>
set -u
ORG_ID="$1"
BASE="https://api.eu.cast.ai"
DIR="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise"
TMP_INV="$DIR/.tmp_inv_$ORG_ID.json"
TMP_VR="$DIR/.tmp_vr_$ORG_ID.json"

# 1) Inventory GET
code=$(curl -sS -o "$TMP_INV" -w '%{http_code}' -X GET \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: $ORG_ID" \
  "$BASE/v1/kubernetes/external-clusters" 2>/dev/null)
if [ "$code" = "200" ]; then
  n=$(jq '.items | length' "$TMP_INV" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 0 ]; then
    mv "$TMP_INV" "$DIR/inv_$ORG_ID.json"
    echo "$ORG_ID INV OK items=$n"
  else
    rm -f "$TMP_INV"
    echo "$ORG_ID INV EMPTY"
  fi
else
  rm -f "$TMP_INV"
  echo "$ORG_ID INV ERR $code" | tee -a "$DIR/.errs_slice3.log"
fi

# 2) VR report POST (read-semantics report query, authorized for this investigation)
code=$(curl -sS -o "$TMP_VR" -w '%{http_code}' -X POST \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE/reporting/v1beta/organizations/$ORG_ID/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe%2FBerlin" 2>/dev/null)
if [ "$code" = "200" ]; then
  n=$(jq '.items | length' "$TMP_VR" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 0 ]; then
    mv "$TMP_VR" "$DIR/vr_$ORG_ID.json"
    echo "$ORG_ID VR OK items=$n"
  else
    rm -f "$TMP_VR"
    echo "$ORG_ID VR EMPTY"
  fi
else
  rm -f "$TMP_VR"
  echo "$ORG_ID VR ERR $code" | tee -a "$DIR/.errs_slice3.log"
fi
