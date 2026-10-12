#!/usr/bin/env bash
# Worker: collect inventory + VR report for ONE org. Read-only.
# Args: org_id  org_name
set -u
ORG_ID="$1"
ORG_NAME="$2"
BASE="https://api.eu.cast.ai"
DIR="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise"
TMP="$(mktemp)"

# 1) Inventory GET
code_inv=$(curl -sS -o "$TMP" -w "%{http_code}" \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Accept: application/json" \
  -H "X-CastAI-Organization-Id: $ORG_ID" \
  "$BASE/v1/kubernetes/external-clusters")
inv_saved=0
if [ "$code_inv" = "200" ]; then
  n=$(jq '.items | length' < "$TMP" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 0 ]; then
    jq '.' < "$TMP" > "$DIR/inv_${ORG_ID}.json"
    inv_saved=1
  fi
fi

# 2) VR report POST (read-semantics report query)
code_vr=$(curl -sS -o "$TMP" -w "%{http_code}" \
  -X POST \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE/reporting/v1beta/organizations/$ORG_ID/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe%2FBerlin" \
  -d '{}')
vr_saved=0
if [ "$code_vr" = "200" ]; then
  m=$(jq '.items | length' < "$TMP" 2>/dev/null || echo 0)
  if [ "${m:-0}" -gt 0 ]; then
    jq '.' < "$TMP" > "$DIR/vr_${ORG_ID}.json"
    vr_saved=1
  fi
fi

# Status line to results log (tab-separated): org_id, inv_code, inv_saved, vr_code, vr_saved
printf '%s\t%s\t%s\t%s\t%s\n' "$ORG_ID" "$code_inv" "$inv_saved" "$code_vr" "$vr_saved" >> "$DIR/status_slice4.tsv"
rm -f "$TMP"
