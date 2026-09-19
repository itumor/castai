#!/usr/bin/env bash
# Siemens CPS — T3a node template availability diagnostic
#
# Purpose: discover why the Siemens T3a node template shows ZERO available
# instance types while the Turbo template shows 13 (console.eu.cast.ai).
#
# Org:     5e413e89-eb67-48fb-b81c-6172baa988ed
# Cluster: 5dc3bf31-a263-4c6b-88bb-e95b6403aa51 (EKS, EU console => api.eu.cast.ai)
#
# Usage:
#   export CASTAI_API_KEY="..."   # EU-region key with cluster read scope
#   ./scripts/siemens-t3a-diag.sh
#
# Safety: read-only GET/POST probe calls. The token is never printed.
set -euo pipefail

BASE="${CASTAI_BASE_URL:-https://api.eu.cast.ai}"
CLUSTER_ID="5dc3bf31-a263-4c6b-88bb-e95b6403aa51"
OUT_DIR="${OUT_DIR:-/tmp/siemens-t3a-diag}"
mkdir -p "$OUT_DIR"

if [[ -z "${CASTAI_API_KEY:-}" ]]; then
  echo "ERROR: CASTAI_API_KEY not set (use an EU-region key; console.eu.cast.ai)." >&2
  exit 1
fi

command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 1; }

req() { # req METHOD PATH [BODY] -> body on stdout, HTTP code in $CODE
  local method="$1" path="$2" body="${3:-}"
  CODE=$(curl -sS -o "$OUT_DIR/last.json" -w "%{http_code}" -X "$method" \
    -H "X-API-Key: ${CASTAI_API_KEY}" -H "Content-Type: application/json" \
    ${body:+-d "$body"} "${BASE}${path}")
  cat "$OUT_DIR/last.json"
}

say() { printf '\n=== %s ===\n' "$*"; }

say "0. Token sanity check (GET /v1/auth/tokens)"
req GET /v1/auth/tokens >/dev/null && echo "http=$CODE"

say "1. Lookup probes for node templates (stops at first 200)"
TEMPLATES_PATH=""
for p in \
  "/v1/kubernetes/clusters/${CLUSTER_ID}/node-templates" \
  "/v1/kubernetes/external-clusters/${CLUSTER_ID}/node-templates" \
  ; do
  req GET "$p" >/dev/null || true
  if [[ "$CODE" == "200" ]]; then TEMPLATES_PATH="$p"; echo "OK: $p"; break; fi
  echo "  $p -> http=$CODE"
done

if [[ -z "$TEMPLATES_PATH" ]]; then
  echo "No node-template list endpoint reachable. Response body (maybe permissions):"
  head -c 600 "$OUT_DIR/last.json"; echo; exit 2
fi

say "2. Templates and their constraints (burstable/arch/task-relevant fields shown)"
cp "$OUT_DIR/last.json" "$OUT_DIR/node-templates.json"
jq -r '
  (.items // .templates // .)[] | {name, isDefault,
    constraints, customLabel: .customLabel, statistics} ' "$OUT_DIR/node-templates.json" || \
  cat "$OUT_DIR/node-templates.json"

echo
echo "-- T3a template raw block --"
jq -r '(.items // .templates // .)[] | select((.name|ascii_downcase|contains("t3a")) or (.customLabel|tolower? // ""|contains("t3a")))' \
  "$OUT_DIR/node-templates.json"

say "3. Available instance types per template (preview API)"
jq -c '(.items // .templates // .)[] | {name, configurationId, nodeConfigurationDetailID, constraints, configurationOverride, customLabel, stateDurationID} ' \
  "$OUT_DIR/node-templates.json" > "$OUT_DIR/templates-slim.jsonl"
while read -r tmpl; do
  name=$(echo "$tmpl" | jq -r .name)
  req POST "/v1/kubernetes/clusters/${CLUSTER_ID}/node-templates/available-instance-types" "$tmpl" >/dev/null || true
  echo "$OUT_DIR/last.json" > /dev/null
  count=$(jq -r '(.items // .) | length' "$OUT_DIR/last.json" 2>/dev/null || echo "?")
  echo "template=$name availableInstanceTypes=$count (http=$CODE)"
  cp "$OUT_DIR/last.json" "$OUT_DIR/avail-$name.json"
done < "$OUT_DIR/templates-slim.jsonl"

say "4. Cluster-level instance inventory health (region '${REGION_CHECK:-auto}')"
# Snapshot of what the cluster itself currently runs:
req GET "/v1/kubernetes/clusters/${CLUSTER_ID}/nodes" >/dev/null || true
echo "cluster nodes probe -> http=$CODE"
[[ "$CODE" == 200 ]] && jq -r '.items[]? | {name, labels: (.labels // {})} | .name' "$OUT_DIR/last.json" | head -20

say "Done. Raw payloads in $OUT_DIR (inspect constraints.burstableInstances, .taskType/spotOnly, maxCpu/minCpu, exclusions)."
echo "Hypothesis checklist (see support/siemens-cps/01-t3a-investigation.md):"
echo "  H1 'Burstable instances' constraint disabled while family=t3a (burstable-only family) -> 0 types"
echo "  H2 Min CPU/MEM constraints exceed t3a.xlarge/t3a.2xlarge ceiling (8 vCPU / 32 GiB)"
echo "  H3 GPU/storage-optimized/compute-optimized flags exclude the whole t3a line"
echo "  H4 Org/cluster blocklist entry for t3*"
echo "  H5 Spot-only template with zero t3a spot inventory in the EKS region"
