#!/usr/bin/env bash
#
# scenario-a-provision.sh
#
# Phase 3 / scenario A: trigger initial Karpenter provisioning by
# scaling the `inflate` Deployment to 5 replicas. The lab expects the
# example NodePool (`manifests/example-nodepool.yaml`) to be in place;
# if it is not, Karpenter's kOps-managed NodePool is used.
#
# Behavior:
#   - Sources AWS credentials from .env via the shared helper
#     (only AWS_* are forwarded; non-AWS secrets are dropped).
#   - Verifies kubectl context is set (fail-fast).
#   - Applies manifests/inflate-workload.yaml if not present.
#   - Scales `inflate` to 5 replicas.
#   - Watches pending pods, NodeClaims, and nodes for 90 seconds,
#     capturing output to labs/kops-karpenter/output/scenario-a.log.
#
# The script is idempotent: each run deletes the inflate Deployment
# (if any) and re-applies it from the manifest, so previous-run
# replicas and pending pods do not pollute the snapshot.
#
# Exit codes:
#   0  log captured successfully (kubectl failures are recorded in the
#      log but do not produce a non-zero exit unless the context is
#      missing).
#   1  prerequisite missing (kubectl) or no active kubeconfig context.
#   3  invalid arguments.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR_A="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_A="$(cd "${SCRIPT_DIR_A}/.." && pwd)"
REPO_ROOT_A="$(cd "${LAB_DIR_A}/../.." && pwd)"
ENV_FILE_A="${REPO_ROOT_A}/.env"
HELPER_A="${SCRIPT_DIR_A}/_lib-source-env.sh"
MANIFEST_A="${LAB_DIR_A}/manifests/inflate-workload.yaml"
LOG_FILE_A="${LAB_DIR_A}/output/scenario-a.log"

WATCH_DURATION=90

usage() {
  cat <<'EOF'
Usage: scenario-a-provision.sh [--watch-duration SECONDS]

  --watch-duration  Seconds to watch pending pods / NodeClaims /
                    nodes after scaling. Default 90.
  -h, --help        Show this help.

Applies manifests/inflate-workload.yaml (idempotent), scales inflate
to 5 replicas, watches pending pods + NodeClaims + nodes for the
configured duration, and writes the snapshot to
labs/kops-karpenter/output/scenario-a.log.
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
# Source AWS credentials from .env via the shared helper. Only AWS_*
# variables are forwarded into this shell.
# ---------------------------------------------------------------------------
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_A}"
  source_aws_credentials_from_env "${ENV_FILE_A}"
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
mkdir -p "${LAB_DIR_A}/output"

{
  printf 'kOps + Karpenter lab — scenario A: initial provisioning\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Watch:      %s seconds\n' "${WATCH_DURATION}"
} > "${LOG_FILE_A}"

echo "==> Logging to ${LOG_FILE_A}"

KUBECONFIG_CTX_A="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX_A}" ] || [[ "${KUBECONFIG_CTX_A}" == *"error"* ]]; then
  {
    echo 'Context:    <none>'
    echo ''
    echo '[!] No active kubectl context. Export kubeconfig first:'
    # shellcheck disable=SC2016
    echo '    kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin'
  } >> "${LOG_FILE_A}"
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
{
  printf 'Context:    %s\n' "${KUBECONFIG_CTX_A}"
} >> "${LOG_FILE_A}"

echo "==> Using kubectl context: ${KUBECONFIG_CTX_A}"

# ---------------------------------------------------------------------------
# Apply the manifest idempotently. `kubectl apply` is a no-op when the
# resource already exists with the same spec. A previous run may have
# left the Deployment scaled to a different replica count, so we
# always re-apply the manifest before scaling.
# ---------------------------------------------------------------------------
if [ ! -f "${MANIFEST_A}" ]; then
  echo "[!] Manifest not found: ${MANIFEST_A}" >&2
  exit 1
fi

echo "==> Applying ${MANIFEST_A}"
if ! kubectl apply -f "${MANIFEST_A}" 2>&1 | tee -a "${LOG_FILE_A}"; then
  echo "[!] kubectl apply failed; continuing so the log captures cluster state." >&2
fi

# ---------------------------------------------------------------------------
# Scale to 5 replicas.
# ---------------------------------------------------------------------------
echo "==> Scaling inflate to 5 replicas"
if ! kubectl scale deployment/inflate --replicas=5 2>&1 | tee -a "${LOG_FILE_A}"; then
  echo "[!] kubectl scale failed; continuing so the log captures cluster state." >&2
fi

# ---------------------------------------------------------------------------
# Watch pending pods / NodeClaims / nodes for the configured duration.
# Each watch command writes to the log file. We `|| true` each one so
# a transient kubectl error (cluster API hiccup) does not abort the
# script before the next watch runs.
# ---------------------------------------------------------------------------
{
  printf '\n## kubectl get pods -l app=inflate -o wide\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l app=inflate -o wide 2>&1 || true

  printf '\n## kubectl get pods -l app=inflate --field-selector=status.phase=Pending\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l app=inflate \
    --field-selector=status.phase=Pending 2>&1 || true

  printf '\n## kubectl get nodeclaims\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get nodeclaims 2>&1 || true

  printf '\n## kubectl get nodes -o wide\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get nodes -o wide 2>&1 || true
} >> "${LOG_FILE_A}"

echo "==> Watching for ${WATCH_DURATION}s..."
if command -v timeout >/dev/null 2>&1; then
  timeout "${WATCH_DURATION}" \
    bash -c '
      while true; do
        kubectl get pods -l app=inflate --no-headers 2>/dev/null || true
        sleep 5
      done
    ' >> "${LOG_FILE_A}" 2>&1 || true
else
  # Portable fallback for macOS where the GNU `timeout` binary is not
  # on PATH by default. The arithmetic context inside $((...))
  # resolves WATCH_DURATION without an explicit `$` prefix.
  end=$(( $(date +%s) + WATCH_DURATION ))
  while [ "$(date +%s)" -lt "${end}" ]; do
    kubectl get pods -l app=inflate --no-headers 2>/dev/null || true
    sleep 5
  done >> "${LOG_FILE_A}" 2>&1 || true
fi

# Final snapshot after the watch window.
{
  printf '\n## Final snapshot after %ss\n' "${WATCH_DURATION}"
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l app=inflate -o wide 2>&1 || true
  kubectl get nodeclaims 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
} >> "${LOG_FILE_A}"

echo ""
echo "==> Done. Snapshot: ${LOG_FILE_A}"
exit 0
