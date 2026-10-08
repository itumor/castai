#!/bin/bash
# Read-only CAST AI fetches for cluster ngm-helios-eks (FY26: Oct2025-Sep2026)
set -u
source /Users/eramadan/castai/.env

BASE="https://api.eu.cast.ai"
ORG="07aa3c29-3e1f-44bc-ad60-ceedb878d99a"
CID="419c39e4-66bf-4d61-b833-4562968a61c7"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/fetch_log.txt"
: > "$LOG"

get() { # label url
  local label="$1" url="$2"
  local http
  http=$(curl -sS -o "$DIR/${label}.json" -w "%{http_code}" \
    -H "X-API-Key: $Castai_mcp" \
    -H "X-CastAI-Organization-Id: $ORG" \
    -H "Accept: application/json" \
    "$url")
  echo "$label http=$http bytes=$(wc -c < "$DIR/${label}.json" | tr -d ' ')" >> "$LOG"
}

months=(
  "oct25 2025-10-01 2025-11-01"
  "nov25 2025-11-01 2025-12-01"
  "dec25 2025-12-01 2026-01-01"
  "jan26 2026-01-01 2026-02-01"
  "feb26 2026-02-01 2026-03-01"
  "mar26 2026-03-01 2026-04-01"
  "apr26 2026-04-01 2026-05-01"
  "may26 2026-05-01 2026-06-01"
  "jun26 2026-06-01 2026-07-01"
  "jul26 2026-07-01 2026-08-01"
  "aug26 2026-08-01 2026-09-01"
  "sep26 2026-09-01 2026-10-01"
)

for m in "${months[@]}"; do
  read -r label start end <<< "$m"
  S="${start}T00:00:00Z"; E="${end}T00:00:00Z"
  get "cost_${label}_listfalse" "$BASE/v1/cost-reports/clusters/$CID/cost?startTime=$S&endTime=$E&stepSeconds=86400&useListingPrices=false" &
  get "cost_${label}_listtrue"  "$BASE/v1/cost-reports/clusters/$CID/cost?startTime=$S&endTime=$E&stepSeconds=86400&useListingPrices=true" &
  get "savings_${label}"        "$BASE/v1/cost-reports/clusters/$CID/savings?startTime=$S&endTime=$E&stepSeconds=86400" &
  wait
done

# Verification window matching CAST PDF claim (2026-09-02 -> 2026-10-02)
get "cost_verify_default"  "$BASE/v1/cost-reports/clusters/$CID/cost?startTime=2026-09-02T00:00:00Z&endTime=2026-10-02T00:00:00Z&stepSeconds=86400" &
get "savings_verify"       "$BASE/v1/cost-reports/clusters/$CID/savings?startTime=2026-09-02T00:00:00Z&endTime=2026-10-02T00:00:00Z&stepSeconds=86400" &
get "baseline_params"      "$BASE/reporting/v1beta/organizations/$ORG/clusters/$CID/baseline-params" &
get "resource_usage_sep26" "$BASE/v1/cost-reports/clusters/$CID/resource-usage?startTime=2026-09-01T00:00:00Z&endTime=2026-10-01T00:00:00Z&stepSeconds=86400" &
get "nodes"                "$BASE/v1/kubernetes/external-clusters/$CID/nodes?limit=500" &
get "estimated_savings"    "$BASE/v1/cost-reports/clusters/$CID/estimated-savings" &
get "audit_jul26"          "$BASE/v1/audit?clusterId=$CID&fromDate=2026-07-01T00:00:00Z&toDate=2026-08-01T00:00:00Z" &
wait

echo "DONE"
cat "$LOG"