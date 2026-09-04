#!/usr/bin/env bash
# castai-billing-export.sh
#
# Export CAST AI Enterprise billing usage to CSV.
#
# Flow:
#   1. GET /v1/billing/enterprise/platform-usage-detail  (X-API-Key)
#   2. For each child org in .detail.entities[]:
#        a. GET /v1/billing/platform-usage-detail        (X-CastAI-Organization-Id)
#        b. GET /v1/kubernetes/external-clusters         (X-CastAI-Organization-Id)
#   3. Join billing cluster IDs to external-cluster metadata and emit CSV.

set -euo pipefail

# ---------- prerequisite checks ----------
if [[ -z "${CASTAI_API_KEY:-}" ]]; then
  echo "ERROR: CASTAI_API_KEY environment variable is required." >&2
  echo "Hint: export CASTAI_API_KEY=... before running this script." >&2
  exit 2
fi

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command '$cmd' is not installed or not on PATH." >&2
    echo "Install it and retry." >&2
    exit 3
  fi
done

# ---------- configuration ----------
BASE_URL="${BASE_URL:-https://api.eu.cast.ai}"
FROM="${FROM:-2026-08-01}"
TO="${TO:-2026-08-31}"
FEATURE="${FEATURE:-phase2}"

# ---------- helpers ----------
log() {
  echo "[castai-billing-export] $*" >&2
}

# Emit one CSV row for a single (cluster, usage, unit) tuple.
emit_row() {
  local org_id="$1"
  local org_name="$2"
  local cluster_id="$3"
  local cluster_name="$4"
  local provider="$5"
  local cloud_account="$6"
  local usage="$7"
  local unit="$8"

  # CSV-escape any value that contains a comma, quote, or newline.
  csv_field() {
    local v="$1"
    if [[ "$v" == *","* || "$v" == *'"'* || "$v" == *$'\n'* ]]; then
      v="${v//\"/\"\"}"
      printf '"%s"' "$v"
    else
      printf '%s' "$v"
    fi
  }

  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$(csv_field "$org_id")" \
    "$(csv_field "$org_name")" \
    "$(csv_field "$cluster_id")" \
    "$(csv_field "$cluster_name")" \
    "$(csv_field "$provider")" \
    "$(csv_field "$cloud_account")" \
    "$(csv_field "$usage")" \
    "$(csv_field "$unit")"
}

# ---------- main ----------
log "BASE_URL=$BASE_URL FROM=$FROM TO=$TO FEATURE=$FEATURE"

log "Fetching enterprise child organizations"
ENTERPRISE_BODY="$(curl -fsS -G \
  -H "X-API-Key: $CASTAI_API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "period.from=$FROM" \
  --data-urlencode "period.to=$TO" \
  --data-urlencode "feature=$FEATURE" \
  "$BASE_URL/v1/billing/enterprise/platform-usage-detail")"

CHILD_ORGS="$(printf '%s' "$ENTERPRISE_BODY" | jq -c '
  (.detail.entities // .entities // [])
  | map({
      organizationId:  (.entityId  // .organizationId  // .id // ""),
      organizationName: (.entityName // .organizationName // .name // "")
    })
  | map(select(.organizationId != ""))
')"

CHILD_COUNT="$(printf '%s' "$CHILD_ORGS" | jq 'length')"
log "Found $CHILD_COUNT child organization(s)"

# CSV header to stdout.
echo "organization_id,organization_name,cluster_id,cluster_name,provider,cloud_account,usage,unit"

if [[ "$CHILD_COUNT" -eq 0 ]]; then
  log "No child organizations to process; CSV contains only the header."
  exit 0
fi

# Iterate child orgs.
while IFS=$'\t' read -r ORG_ID ORG_NAME; do
  [[ -z "$ORG_ID" ]] && continue
  log "Processing child org: $ORG_NAME ($ORG_ID)"

  log "  Fetching per-cluster usage"
  USAGE_BODY="$(curl -fsS -G \
    -H "X-API-Key: $CASTAI_API_KEY" \
    -H "Accept: application/json" \
    -H "X-CastAI-Organization-Id: $ORG_ID" \
    --data-urlencode "period.from=$FROM" \
    --data-urlencode "period.to=$TO" \
    --data-urlencode "feature=$FEATURE" \
    "$BASE_URL/v1/billing/platform-usage-detail" || true)"

  if [[ -z "$USAGE_BODY" ]]; then
    log "  No usage response for org $ORG_ID; skipping"
    continue
  fi

  USAGE_ROWS="$(printf '%s' "$USAGE_BODY" | jq -c '
    (.detail.entities // .entities // [])
    | map({
        clusterId:   (.entityId   // .clusterId   // .id // ""),
        clusterName: (.entityName // .clusterName // .name // ""),
        usage:       (.usage       // .quantity // .value // 0),
        unit:        (.unit        // .uom      // "")
      })
    | map(select(.clusterId != ""))
  ')"

  log "  Fetching external clusters"
  CLUSTERS_BODY="$(curl -fsS -G \
    -H "X-API-Key: $CASTAI_API_KEY" \
    -H "Accept: application/json" \
    -H "X-CastAI-Organization-Id: $ORG_ID" \
    "$BASE_URL/v1/kubernetes/external-clusters" || true)"

  if [[ -z "$CLUSTERS_BODY" ]]; then
    log "  No external-clusters response for org $ORG_ID; skipping"
    continue
  fi

  # Build a lookup map: clusterId -> {name, provider, cloud_account}
  CLUSTER_MAP="$(printf '%s' "$CLUSTERS_BODY" | jq -c '
    (.items // .detail.entities // .entities // [])
    | map(. + { _cloudAccount: (
        .providerNamespaceId
        // .eks.accountId
        // .gke.projectId
        // .aks.subscriptionId
        // "UNKNOWN"
      )})
    | map(select(.id != "" or .clusterId != ""))
    | map({
        key: (.id // .clusterId),
        value: {
          name: (.name // .clusterName // ""),
          provider: (.provider // ""),
          cloudAccount: ._cloudAccount
        }
      })
    | from_entries
  ')"

  # Emit joined rows.
  while read -r ROW; do
    [[ -z "$ROW" ]] && continue
    CLUSTER_ID="$(printf '%s' "$ROW"  | jq -r '.clusterId')"
    CLUSTER_NAME="$(printf '%s' "$ROW" | jq -r '.clusterName')"
    USAGE_VAL="$(printf '%s' "$ROW"     | jq -r '.usage')"
    UNIT_VAL="$(printf '%s' "$ROW"      | jq -r '.unit')"

    META="$(printf '%s' "$CLUSTER_MAP" | jq -c --arg id "$CLUSTER_ID" '.[$id] // null')"
    if [[ "$META" == "null" || -z "$META" ]]; then
      PROVIDER="UNKNOWN"
      CLOUD_ACCOUNT="UNKNOWN"
    else
      PROVIDER="$(printf '%s' "$META" | jq -r '.provider // "UNKNOWN"')"
      CLOUD_ACCOUNT="$(printf '%s' "$META" | jq -r '.cloudAccount // "UNKNOWN"')"
    fi

    emit_row "$ORG_ID" "$ORG_NAME" "$CLUSTER_ID" "$CLUSTER_NAME" \
             "$PROVIDER" "$CLOUD_ACCOUNT" "$USAGE_VAL" "$UNIT_VAL"
  done < <(printf '%s' "$USAGE_ROWS" | jq -c '.[]')
done < <(printf '%s' "$CHILD_ORGS" | jq -r '.[] | [.organizationId, .organizationName] | @tsv')

log "Done"
