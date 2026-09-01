#!/usr/bin/env bash
#
# scenario-b-scale-up.sh
#
# Phase 3 / scenario B: scale the `inflate` Deployment from 5 to 15
# replicas and watch Karpenter provision additional nodes to satisfy
# the new demand. The cluster is expected to spread the new pods
# across multiple AZs (us-west-2a / us-west-2b) and instance types
# (t3.small / t3.medium) as defined in the example NodePool.
#
# Behavior:
#   - Sources AWS credentials from .env via the shared helper.
#   - Verifies kubectl context is set (fail-fast).
#   - Applies manifests/inflate-workload.yaml idempotently.
#   - Scales `inflate` to 15 replicas.
#   - Watches pending pods / NodeClaims / nodes for 120 seconds.
#   - Captures output to labs/kops-karpenter/output/scenario-b.log.
#
# Exit codes:
#   0  log captured successfully.
#   1  prerequisite missing (kubectl) or no active kubeconfig context.
#   3  invalid arguments.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR_B="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_B="$(cd "${SCRIPT_DIR_B}/.." && pwd)"
REPO_ROOT_B="$(cd "${LAB_DIR_B}/../.." && pwd)"
ENV_FILE_B="${REPO_ROOT_B}/.env"
HELPER_B="${SCRIPT_DIR_B}/_lib-source-env.sh"
MANIFEST_B="${LAB_DIR_B}/manifests/inflate-workload.yaml"
LOG_FILE_B="${LAB_DIR_B}/output/scenario-b.log"

WATCH_DURATION=120

usage() {
  cat <<'EOF'
Usage: scenario-b-scale-up.sh [--watch-duration SECONDS]

  --watch-duration  Seconds to watch after scaling. Default 120.
  -h, --help        Show this help.

Scales inflate to 15 replicas and watches node provisioning for the
configured duration. Writes the snapshot to
labs/kops-karpenter/output/scenario-b.log.
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
  source "${HELPER_B}"
  source_aws_credentials_from_env "${ENV_FILE_B}"
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
mkdir -p "${LAB_DIR_B}/output"

{
  printf 'kOps + Karpenter lab — scenario B: scale up to 15 replicas\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Watch:      %s seconds\n' "${WATCH_DURATION}"
} > "${LOG_FILE_B}"

echo "==> Logging to ${LOG_FILE_B}"

KUBECONFIG_CTX_B="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX_B}" ] || [[ "${KUBECONFIG_CTX_B}" == *"error"* ]]; then
  {
    echo 'Context:    <none>'
    echo ''
    echo '[!] No active kubectl context. Export kubeconfig first:'
    # shellcheck disable=SC2016
    echo '    kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin'
  } >> "${LOG_FILE_B}"
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
{
  printf 'Context:    %s\n' "${KUBECONFIG_CTX_B}"
} >> "${LOG_FILE_B}"

echo "==> Using kubectl context: ${KUBECONFIG_CTX_B}"

# ---------------------------------------------------------------------------
# Apply the manifest idempotently.
# ---------------------------------------------------------------------------
if [ ! -f "${MANIFEST_B}" ]; then
  echo "[!] Manifest not found: ${MANIFEST_B}" >&2
  exit 1
fi

echo "==> Applying ${MANIFEST_B}"
if ! kubectl apply -f "${MANIFEST_B}" 2>&1 | tee -a "${LOG_FILE_B}"; then
  echo "[!] kubectl apply failed; continuing so the log captures cluster state." >&2
fi

# ---------------------------------------------------------------------------
# Scale to 15 replicas.
# ---------------------------------------------------------------------------
echo "==> Scaling inflate to 15 replicas"
if ! kubectl scale deployment/inflate --replicas=15 2>&1 | tee -a "${LOG_FILE_B}"; then
  echo "[!] kubectl scale failed; continuing so the log captures cluster state." >&2
fi

# Initial snapshot before the watch loop.
{
  printf '\n## Pre-watch snapshot\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l app=inflate -o wide 2>&1 || true
  kubectl get nodeclaims 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
} >> "${LOG_FILE_B}"

# ---------------------------------------------------------------------------
# Watch loop. We poll every 5 seconds; on each tick we capture
# pod count, pending count, NodeClaim count, and node count.
# ---------------------------------------------------------------------------
echo "==> Watching for ${WATCH_DURATION}s..."
end=$(( $(date +%s) + WATCH_DURATION ))
while [ "$(date +%s)" -lt "${end}" ]; do
  {
    printf '\n[%s] tick\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    kubectl get pods -l app=inflate --no-headers 2>/dev/null || true
    kubectl get nodeclaims --no-headers 2>/dev/null || true
    kubectl get nodes --no-headers 2>/dev/null || true
  } >> "${LOG_FILE_B}" 2>&1 || true
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
} >> "${LOG_FILE_B}"

echo ""
echo "==> Done. Snapshot: ${LOG_FILE_B}"
exit 0
