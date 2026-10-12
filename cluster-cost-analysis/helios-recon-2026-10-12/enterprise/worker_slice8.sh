#!/bin/bash
# Read-only CAST AI collector for ONE org line: org_id<TAB>org_name
# Call 1: GET external-clusters (read-only inventory)
# Call 2: POST runValueRealizationReport (read-semantics report query, authorized for this investigation)
# No other POST/PUT/PATCH/DELETE is issued anywhere.
set -u
line="$1"
org_id="${line%%	*}"
org_name="${line#*	}"
BASE="https://api.eu.cast.ai"
OUT="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise"
ERRLOG="$OUT/errors_slice8.log"
mkdir -p "$OUT"

tmp_inv="$(mktemp -t inv_slice8)"
tmp_vr="$(mktemp -t vr_slice8)"

inv_code="$(curl -sS --max-time 90 -o "$tmp_inv" -w '%{http_code}' \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "X-CastAI-Organization-Id: ${org_id}" \
  -H "Accept: application/json" \
  "${BASE}/v1/kubernetes/external-clusters" 2>/dev/null)"

if [ "$inv_code" = "200" ]; then
  n="$(jq -r 'try (.items | length) catch 0' "$tmp_inv" 2>/dev/null)"
  if [ "${n:-0}" -gt 0 ]; then
    jq '.' "$tmp_inv" > "${OUT}/inv_${org_id}.json"
  fi
else
  printf '%s\tINV\tERR %s\n' "$org_id" "$inv_code" >> "$ERRLOG"
fi

vr_code="$(curl -sS --max-time 90 -o "$tmp_vr" -w '%{http_code}' \
  -X POST \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "${BASE}/reporting/v1beta/organizations/${org_id}/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe%2FBerlin" 2>/dev/null)"

if [ "$vr_code" = "200" ]; then
  n="$(jq -r 'try (.items | length) catch 0' "$tmp_vr" 2>/dev/null)"
  if [ "${n:-0}" -gt 0 ]; then
    jq '.' "$tmp_vr" > "${OUT}/vr_${org_id}.json"
  fi
else
  printf '%s\tVR\tERR %s\n' "$org_id" "$vr_code" >> "$ERRLOG"
fi

rm -f "$tmp_inv" "$tmp_vr"
