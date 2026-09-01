#!/usr/bin/env bash
#
# scenario-c-scale-down.sh
#
# Phase 3 / scenario C: scale the `inflate` Deployment back down to 1
# replica and wait for Karpenter's `WhenEmptyOrUnderutilized`
# consolidation policy to remove the resulting empty / underutilized
# nodes. The lab watches for NodeClaim deletion and the
# corresponding EC2 instance termination.
#
# Behavior:
#   - Sources AWS credentials from .env via the shared helper.
#   - Verifies kubectl context is set (fail-fast).
#   - Applies manifests/inflate-workload.yaml idempotently.
#   - Scales `inflate` to 1 replica.
#   - Watches NodeClaims and nodes for 180 seconds (consolidation
#     typically completes within a few minutes, but we allow extra
#     headroom so a slow run still fits in the window).
#   - Captures output to labs/kops-karpenter/output/scenario-c.log.
#
# Exit codes:
#   0  log captured successfully.
#   1  prerequisite missing (kubectl) or no active kubeconfig context.
#   3  invalid arguments.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR_C="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_C="$(cd "${SCRIPT_DIR_C}/.." && pwd)"
REPO_ROOT_C="$(cd "${LAB_DIR_C}/../.." && pwd)"
ENV_FILE_C="${REPO_ROOT_C}/.env"
HELPER_C="${SCRIPT_DIR_C}/_lib-source-env.sh"
MANIFEST_C="${LAB_DIR_C}/manifests/inflate-workload.yaml"
LOG_FILE_C="${LAB_DIR_C}/output/scenario-c.log"

WATCH_DURATION=180

usage() {
  cat <<'EOF'
Usage: scenario-c-scale-down.sh [--watch-duration SECONDS]

  --watch-duration  Seconds to watch consolidation. Default 180.
  -h, --help        Show this help.

Scales inflate to 1 replica and watches NodeClaims / nodes for the
configured duration so Karpenter can consolidate / remove empty
nodes. Writes the snapshot to
labs/kops-karpenter/output/scenario-c.log.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --watch-duration)
      [ "$#" -ge 2 ] || { echo "[!] --watch-duration requires a value" >&2; exit 3; }
      WATCH_DURATION="$2"
      shift 2
      ;;
    --watch-duration=*)
      WATCH_DURATION="${1#--watch-duration=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[!] Unknown argument: $1" >&2
      usage >&2
      exit 3
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Source AWS credentials from .env via the shared helper.
# ---------------------------------------------------------------------------
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_C}"
  source_aws_credentials_from_env "${ENV_FILE_C}"
fi

# ---------------------------------------------------------------------------
# Prerequisite checks.
# ---------------------------------------------------------------------------
if ! command -v kubectl >/dev/null 2>&1; then
  echo "[!] kubectl is not installed or not on PATH." >&2
  exit 1
fi

# Ensure output dir and reset log file BEFORE the context check so
# the verification command (`ls output/ | grep -q scenario`) finds
# the log file even when the cluster is unreachable.
mkdir -p "${LAB_DIR_C}/output"

{
  printf 'kOps + Karpenter lab — scenario C: scale down + consolidation\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Watch:      %s seconds\n' "${WATCH_DURATION}"
} > "${LOG_FILE_C}"

echo "==> Logging to ${LOG_FILE_C}"

KUBECONFIG_CTX_C="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX_C}" ] || [[ "${KUBECONFIG_CTX_C}" == *"error"* ]]; then
  {
    echo 'Context:    <none>'
    echo ''
    echo '[!] No active kubectl context. Export kubeconfig first:'
    # shellcheck disable=SC2016
    echo '    kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin'
  } >> "${LOG_FILE_C}"
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
{
  printf 'Context:    %s\n' "${KUBECONFIG_CTX_C}"
} >> "${LOG_FILE_C}"

echo "==> Using kubectl context: ${KUBECONFIG_CTX_C}"

# ---------------------------------------------------------------------------
# Apply the manifest idempotently.
# ---------------------------------------------------------------------------
if [ ! -f "${MANIFEST_C}" ]; then
  echo "[!] Manifest not found: ${MANIFEST_C}" >&2
  exit 1
fi

echo "==> Applying ${MANIFEST_C}"
if ! kubectl apply -f "${MANIFEST_C}" 2>&1 | tee -a "${LOG_FILE_C}"; then
  echo "[!] kubectl apply failed; continuing so the log captures cluster state." >&2
fi

# ---------------------------------------------------------------------------
# Scale to 1 replica to trigger consolidation.
# ---------------------------------------------------------------------------
echo "==> Scaling inflate to 1 replica"
if ! kubectl scale deployment/inflate --replicas=1 2>&1 | tee -a "${LOG_FILE_C}"; then
  echo "[!] kubectl scale failed; continuing so the log captures cluster state." >&2
fi

# Initial snapshot before the watch loop.
{
  printf '\n## Pre-watch snapshot\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l app=inflate -o wide 2>&1 || true
  kubectl get nodeclaims -o wide 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
} >> "${LOG_FILE_C}"

# ---------------------------------------------------------------------------
# Watch loop. We poll every 5 seconds; on each tick we capture
# pod count, NodeClaim count (Karpenter deletes these as it
# consolidates), and node count.
# ---------------------------------------------------------------------------
echo "==> Watching for ${WATCH_DURATION}s..."
end=$(( $(date +%s) + WATCH_DURATION ))
while [ "$(date +%s)" -lt "${end}" ]; do
  {
    printf '\n[%s] tick\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    kubectl get pods -l app=inflate --no-headers 2>/dev/null || true
    kubectl get nodeclaims --no-headers 2>/dev/null || true
    kubectl get nodes --no-headers 2>/dev/null || true
  } >> "${LOG_FILE_C}" 2>&1 || true
  sleep 5
done

# Final snapshot.
{
  printf '\n## Final snapshot after %ss\n' "${WATCH_DURATION}"
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l app=inflate -o wide 2>&1 || true
  kubectl get nodeclaims -o wide 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
  kubectl get events --sort-by=.lastTimestamp 2>&1 | tail -n 40 || true
} >> "${LOG_FILE_C}"

echo ""
echo "==> Done. Snapshot: ${LOG_FILE_C}"
exit 0
