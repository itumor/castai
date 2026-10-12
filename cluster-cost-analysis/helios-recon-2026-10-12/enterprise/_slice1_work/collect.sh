#!/bin/bash
set -u
W="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise/_slice1_work"
LINE="$1"; OID="${LINE%%	*}"
API="https://api.eu.cast.ai"
note() { printf '%s\t%s\t%s\n' "$OID" "$1" "$2" >> "$W/status.tsv"; }
C=$(curl -sS -o "$W/ti_$OID.json" -w '%{http_code}' -H "X-API-Key: $CASTAI_API_KEY" -H "X-CastAI-Organization-Id: $OID" "$API/v1/kubernetes/external-clusters")
if [ "$C" = "200" ]; then
  N=$(jq -r '(.items // [])|length' "$W/ti_$OID.json")
  if [ "$N" -gt 0 ]; then mv "$W/ti_$OID.json" "$W/inv_$OID.json"; note INV "OK $N"; else rm -f "$W/ti_$OID.json"; note INV EMPTY; fi
else rm -f "$W/ti_$OID.json"; note INV "ERR $C"; fi
C=$(curl -sS -o "$W/tv_$OID.json" -w '%{http_code}' -X POST -H "X-API-Key: $CASTAI_API_KEY" -H "Content-Type: application/json" -d '{}' "$API/reporting/v1beta/organizations/$OID/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe%2FBerlin")
if [ "$C" = "200" ]; then
  N=$(jq -r '(.items // [])|length' "$W/tv_$OID.json")
  if [ "$N" -gt 0 ]; then mv "$W/tv_$OID.json" "$W/vr_$OID.json"; note VR "OK $N"; else rm -f "$W/tv_$OID.json"; note VR EMPTY; fi
else rm -f "$W/tv_$OID.json"; note VR "ERR $C"; fi
