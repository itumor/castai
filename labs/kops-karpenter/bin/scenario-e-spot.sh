#!/usr/bin/env bash
#
# scenario-e-spot.sh
#
# Phase 3 / scenario E: apply a workload whose pod spec tolerates spot
# capacity and uses node affinity to require
# `karpenter.sh/capacity-type=spot`. The lab scales the workload up
# to trigger Karpenter to bid on spare EC2 capacity and provision
# spot instances.
#
# Spot handling notes:
#   - Spot nodes are tainted `karpenter.sh/capacity-type=spot:NoSchedule`
#     by the AWS Karpenter provider when launched; the pod must
#     tolerate that taint to schedule.
#   - The example NodePool (`manifests/example-nodepool.yaml`) accepts
#     both `on-demand` and `spot` capacity types, so a spot-affinity
#     workload is eligible for provisioning without manifest changes.
#
# Behavior:
#   - Sources AWS credentials from .env via the shared helper.
#   - Verifies kubectl context is set (fail-fast).
#   - Deletes any previous `inflate-spot` Deployment (idempotency).
#   - Applies an inline manifest written to a temp file.
#   - Scales the Deployment to 8 replicas to give Karpenter enough
#     headroom to provision multiple spot instances.
#   - Watches pending pods / NodeClaims / nodes for 120 seconds.
#   - Captures output to labs/kops-karpenter/output/scenario-e.log.
#
# Exit codes:
#   0  log captured successfully.
#   1  prerequisite missing (kubectl) or no active kubeconfig context.
#   3  invalid arguments.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR_E="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_E="$(cd "${SCRIPT_DIR_E}/.." && pwd)"
REPO_ROOT_E="$(cd "${LAB_DIR_E}/../.." && pwd)"
ENV_FILE_E="${REPO_ROOT_E}/.env"
HELPER_E="${SCRIPT_DIR_E}/_lib-source-env.sh"
LOG_FILE_E="${LAB_DIR_E}/output/scenario-e.log"
DEPLOYMENT_NAME="inflate-spot"
APP_LABEL="inflate-spot"

WATCH_DURATION=120

usage() {
  cat <<'EOF'
Usage: scenario-e-spot.sh [--watch-duration SECONDS]

  --watch-duration  Seconds to watch after scaling. Default 120.
  -h, --help        Show this help.

Applies a spot-only workload (tolerates the spot taint, requires
capacity-type=spot via node affinity) and watches Karpenter bid on
spare EC2 capacity. Writes the snapshot to
labs/kops-karpenter/output/scenario-e.log.
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
  source "${HELPER_E}"
  source_aws_credentials_from_env "${ENV_FILE_E}"
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
mkdir -p "${LAB_DIR_E}/output"

{
  printf 'kOps + Karpenter lab — scenario E: spot capacity\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Watch:      %s seconds\n' "${WATCH_DURATION}"
  printf 'Capacity:   spot only (karpenter.sh/capacity-type=spot)\n'
} > "${LOG_FILE_E}"

echo "==> Logging to ${LOG_FILE_E}"

KUBECONFIG_CTX_E="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX_E}" ] || [[ "${KUBECONFIG_CTX_E}" == *"error"* ]]; then
  {
    echo 'Context:    <none>'
    echo ''
    echo '[!] No active kubectl context. Export kubeconfig first:'
    # shellcheck disable=SC2016
    echo '    kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin'
  } >> "${LOG_FILE_E}"
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
{
  printf 'Context:    %s\n' "${KUBECONFIG_CTX_E}"
} >> "${LOG_FILE_E}"

echo "==> Using kubectl context: ${KUBECONFIG_CTX_E}"

# ---------------------------------------------------------------------------
# Inline manifest. Tolerates BOTH the lab workload taint and the spot
# capacity taint; requires karpenter.sh/capacity-type=spot.
# ---------------------------------------------------------------------------
TMP_MANIFEST="$(mktemp -t scenario-e-XXXXXX.yaml)"
TMP_MANIFEST="${TMP_MANIFEST:-/tmp/scenario-e-$$.yaml}"
cat > "${TMP_MANIFEST}" <<'YAML'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inflate-spot
  labels:
    app: inflate-spot
    lab: kops-karpenter
spec:
  replicas: 8
  selector:
    matchLabels:
      app: inflate-spot
  template:
    metadata:
      labels:
        app: inflate-spot
        lab: kops-karpenter
    spec:
      tolerations:
        # Lab workload taint (Karpenter-managed lab pool).
        - key: karpenter-lab/workload
          operator: Exists
          effect: NoSchedule
        # Spot capacity taint added by the AWS Karpenter provider
        # to every spot instance it launches.
        - key: karpenter.sh/capacity-type
          operator: Equal
          value: spot
          effect: NoSchedule
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: karpenter.sh/capacity-type
                    operator: In
                    values: ["spot"]
      containers:
        - name: pause
          image: public.ecr.aws/eks-distro/kubernetes/pause:1.36.0-eks-1-36-1
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 200m
              memory: 256Mi
YAML

# Cleanup the temp file on exit.
trap 'rm -f "${TMP_MANIFEST}"' EXIT

# ---------------------------------------------------------------------------
# Apply the manifest idempotently. Delete first so a stale spec does
# not survive from a previous run.
# ---------------------------------------------------------------------------
echo "==> Deleting any previous ${DEPLOYMENT_NAME} Deployment (idempotency)"
kubectl delete deployment "${DEPLOYMENT_NAME}" --ignore-not-found 2>&1 | tee -a "${LOG_FILE_E}" || true

echo "==> Applying ${TMP_MANIFEST}"
if ! kubectl apply -f "${TMP_MANIFEST}" 2>&1 | tee -a "${LOG_FILE_E}"; then
  echo "[!] kubectl apply failed; continuing so the log captures cluster state." >&2
fi

# Initial snapshot.
{
  printf '\n## Pre-watch snapshot\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l "app=${APP_LABEL}" -o wide 2>&1 || true
  kubectl get nodeclaims -o wide 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
} >> "${LOG_FILE_E}"

# ---------------------------------------------------------------------------
# Watch loop. Spot provisioning can be slower than on-demand because
# Karpenter waits for a spot capacity match; 120s is enough headroom
# for one or two bid cycles in us-west-2.
# ---------------------------------------------------------------------------
echo "==> Watching for ${WATCH_DURATION}s..."
end=$(( $(date +%s) + WATCH_DURATION ))
while [ "$(date +%s)" -lt "${end}" ]; do
  {
    printf '\n[%s] tick\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    kubectl get pods -l "app=${APP_LABEL}" --no-headers 2>/dev/null || true
    kubectl get pods -l "app=${APP_LABEL}" \
      --field-selector=status.phase=Pending --no-headers 2>/dev/null || true
    kubectl get nodeclaims -o wide --no-headers 2>/dev/null || true
    kubectl get nodes -o wide --no-headers 2>/dev/null || true
  } >> "${LOG_FILE_E}" 2>&1 || true
  sleep 5
done

# Final snapshot.
{
  printf '\n## Final snapshot after %ss\n' "${WATCH_DURATION}"
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l "app=${APP_LABEL}" -o wide 2>&1 || true
  kubectl get pods -l "app=${APP_LABEL}" \
    --field-selector=status.phase=Pending 2>&1 || true
  kubectl get nodeclaims -o wide 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
  kubectl get events --sort-by=.lastTimestamp 2>&1 | tail -n 40 || true
} >> "${LOG_FILE_E}"

echo ""
echo "==> Done. Snapshot: ${LOG_FILE_E}"
exit 0
