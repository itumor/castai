#!/bin/bash
# Pull live data for the two "Remove CAST AI autoscaling" clusters.
# Read-only, EU API.
set -euo pipefail
ENV_FILE="/Users/eramadan/castai/projects/castai-billing-export/.env"
KEY=$(awk -F= '/^CASTAI_API_KEY/ {v=$2; gsub(/^[\047\042]|[\047\042]$/,"",v); gsub(/^ +| +$/,"",v); print v}' "$ENV_FILE")
BASE="https://api.eu.cast.ai"
TODAY=$(date -u +%Y-%m-%d)
FIRST_OF_MONTH=$(date -u +%Y-%m-01)
THIRTY_AGO=$(date -u -v-30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z)
NOW=$(date -u +%Y-%m-%dT00:00:00Z)

fetch() {
  local label="$1" org="$2" path="$3"
  echo ""
  echo "=== $label  [org $org] ==="
  curl -sS -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $org" \
    "$BASE$path" | python3 -m json.tool 2>/dev/null || echo "(parse error)"
}

# 1) dema-platform-services-test  (CPS)
ORG1=5e413e89-eb67-48fb-b81c-6172baa988ed
CL1=00ee8944-67f6-43d5-8517-c270951ec02c
fetch "dema-platform-services-test cluster overview" "$ORG1" "/v1/kubernetes/external-clusters/$CL1"
fetch "dema-platform-services-test overview cost" "$ORG1" "/v1/cost-reports/clusters/$CL1/overview"
fetch "dema-platform-services-test savings (30d)" "$ORG1" "/v1/cost-reports/clusters/$CL1/savings?startTime=$THIRTY_AGO&endTime=$NOW"
fetch "dema-platform-services-test estimated-savings" "$ORG1" "/v1/cost-reports/clusters/$CL1/estimated-savings"
fetch "dema-platform-services-test nodes" "$ORG1" "/v1/kubernetes/external-clusters/$CL1/nodes"

# 2) dev-cluster (DI PA MI)
ORG2=d7534e71-612b-4963-89c8-22304c7a9d3d
CL2=7e04bd70-0513-4c6b-8b38-42b6c46905d9
fetch "dev-cluster cluster overview" "$ORG2" "/v1/kubernetes/external-clusters/$CL2"
fetch "dev-cluster overview cost" "$ORG2" "/v1/cost-reports/clusters/$CL2/overview"
fetch "dev-cluster savings (30d)" "$ORG2" "/v1/cost-reports/clusters/$CL2/savings?startTime=$THIRTY_AGO&endTime=$NOW"
fetch "dev-cluster estimated-savings" "$ORG2" "/v1/cost-reports/clusters/$CL2/estimated-savings"
fetch "dev-cluster nodes" "$ORG2" "/v1/kubernetes/external-clusters/$CL2/nodes"

# 3) MTD platform-usage billable CPUs for both clusters (fee base)
fetch "platform-usage-detail (MTD) CPS phase2" "$ORG1" "/v1/billing/platform-usage-detail?period.from=$FIRST_OF_MONTH&period.to=$TODAY&feature=phase2"
fetch "platform-usage-detail (MTD) DI PA MI phase2" "$ORG2" "/v1/billing/platform-usage-detail?period.from=$FIRST_OF_MONTH&period.to=$TODAY&feature=phase2"