#!/usr/bin/env bash
#
# ensure-clickhouse-crd.sh
#
# Idempotently installs the ClickHouseInstallation CRD required by CAST AI.
# CAST AI's installer fetches this CRD from GitHub raw content at runtime,
# which frequently hits HTTP 429 rate limits. This script works around that
# by using the Altinity Helm chart (https://helm.altinity.com) as the primary
# install path and falling back to direct GitHub downloads only when Helm is
# unavailable.
#
# Usage:
#   ./ensure-clickhouse-crd.sh
#
# Environment:
#   CH_VERSION   - operator chart version to install (default: 0.27.3).
#   GITHUB_TOKEN - optional PAT used in the curl fallback path.

set -euo pipefail

CH_VERSION="${CH_VERSION:-0.27.3}"
CRD_NAME="clickhouseinstallations.clickhouse.altinity.com"
HELM_REPO="https://helm.altinity.com"
HELM_CHART="altinity/altinity-clickhouse-operator"

if kubectl get crd "${CRD_NAME}" >/dev/null 2>&1; then
  echo "==> ClickHouseInstallation CRD already exists; nothing to do."
  exit 0
fi

echo "==> ClickHouseInstallation CRD not found; installing version ${CH_VERSION}..."

# ---------------------------------------------------------------------------
# Primary path: Helm. The Altinity chart installs CRDs via pre-install hooks
# and pulls from helm.altinity.com, avoiding raw.githubusercontent.com 429s.
# ---------------------------------------------------------------------------
if command -v helm >/dev/null 2>&1; then
  echo "==> Helm detected; installing operator chart (CRDs installed via hooks)..."
  helm repo add altinity "${HELM_REPO}" >/dev/null 2>&1 || true
  helm repo update altinity >/dev/null 2>&1 || true

  if helm upgrade --install clickhouse-operator "${HELM_CHART}" \
       --version "${CH_VERSION}" \
       --namespace clickhouse \
       --create-namespace; then
    echo "==> Operator chart installed; waiting for CRD hooks to complete..."
    for _ in {1..12}; do
      if kubectl get crd "${CRD_NAME}" >/dev/null 2>&1; then
        echo "==> ClickHouseInstallation CRD installed successfully."
        exit 0
      fi
      sleep 5
    done
    echo "[!] Helm install succeeded but CRD is not visible yet; falling back to direct download."
  else
    echo "[!] Helm install failed; falling back to direct CRD download."
  fi
else
  echo "[!] Helm not found; falling back to direct CRD download from GitHub."
fi

# ---------------------------------------------------------------------------
# Fallback path: download CRD directly from GitHub raw with retries.
# ---------------------------------------------------------------------------
CRD_URL="https://raw.githubusercontent.com/Altinity/clickhouse-operator/${CH_VERSION}/deploy/operator/parts/crd.yaml"
BUNDLE_URL="https://raw.githubusercontent.com/Altinity/clickhouse-operator/${CH_VERSION}/deploy/operator/clickhouse-operator-install-bundle.yaml"
MAX_RETRIES=5
RETRY_DELAY=15

CURL_FLAGS=( -fsSL --retry 3 --retry-delay 10 )
if [ -n "${GITHUB_TOKEN:-}" ]; then
  CURL_FLAGS+=( -H "Authorization: Bearer ${GITHUB_TOKEN}" )
fi

install_from_url() {
  local url="$1"
  echo "==> Fetching ${url}..."
  curl "${CURL_FLAGS[@]}" "${url}" | kubectl apply -f -
}

for (( i=1; i<=MAX_RETRIES; i++ )); do
  if install_from_url "${CRD_URL}"; then
    echo "==> ClickHouseInstallation CRD installed successfully."
    exit 0
  fi

  if [ "${i}" -eq 1 ]; then
    echo "[!] CRD-only URL failed; falling back to full operator bundle on next retry."
    CRD_URL="${BUNDLE_URL}"
  fi

  echo "[!] Attempt ${i}/${MAX_RETRIES} failed. Waiting ${RETRY_DELAY}s before retry..."
  sleep "${RETRY_DELAY}"
done

echo "[✗] Failed to install ClickHouse CRD after ${MAX_RETRIES} attempts."
echo "    GitHub may be rate-limiting your IP. Try one of:"
echo "      1. Ensure Helm is installed and rerun (uses https://helm.altinity.com)."
echo "      2. Export GITHUB_TOKEN and rerun."
echo "      3. Apply the CRD manually from:"
echo "         https://github.com/Altinity/clickhouse-operator/releases"
exit 1
