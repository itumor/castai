#!/usr/bin/env bash
#
# install-castai.sh
#
# One-command wrapper that runs the CAST AI prerequisites and then
# invokes `castctl install`, passing through any extra arguments.
#
# Usage:
#   ./scripts/install-castai.sh [castctl install args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

command -v castctl >/dev/null 2>&1 || {
  echo "[ERROR] castctl is required but not found in PATH. Install from https://docs.cast.ai/developer-experience/castcli" >&2
  exit 1
}

echo "==> Step 1/3: Ensuring AWS EBS CSI driver..."
"${SCRIPT_DIR}/ensure-ebs-csi-driver.sh"

echo "==> Step 2/3: Ensuring default StorageClass..."
"${PROJECT_ROOT}/ensure-default-storageclass.sh"

echo "==> Step 3/3: Running castctl install..."
castctl install "$@"

echo "==> castctl install complete."
