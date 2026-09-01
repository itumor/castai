#!/usr/bin/env bash
#
# scenario-d-constraints.sh
#
# Phase 3 / scenario D: apply a workload whose pod spec narrows
# Karpenter's candidate set via hard scheduling constraints:
#
#   - Instance family: t3 (t3.small, t3.medium)
#   - CPU architecture: amd64
#   - Availability zone: us-west-2a
#   - Capacity type:   on-demand (no spot)
#
# The example NodePool (`manifests/example-nodepool.yaml`) already
# restricts to t3.small / t3.medium / amd64 / linux / us-west-2a or
# us-west-2b / on-demand or spot, so this workload simply narrows
# the eligible subset to a single AZ and capacity type. Karpenter
# will only launch instances that satisfy every constraint.
#
# Behavior:
#   - Sources AWS credentials from .env via the shared helper.
#   - Verifies kubectl context is set (fail-fast).
#   - Deletes any previous `constrained` Deployment (idempotency).
#   - Applies an inline manifest written to a temp file.
#   - Scales the Deployment to 6 replicas.
#   - Watches pending pods / NodeClaims / nodes for 90 seconds.
#   - Captures output to labs/kops-karpenter/output/scenario-d.log.
#
# Exit codes:
#   0  log captured successfully.
#   1  prerequisite missing (kubectl) or no active kubeconfig context.
#   3  invalid arguments.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR_D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_D="$(cd "${SCRIPT_DIR_D}/.." && pwd)"
REPO_ROOT_D="$(cd "${LAB_DIR_D}/../.." && pwd)"
ENV_FILE_D="${REPO_ROOT_D}/.env"
HELPER_D="${SCRIPT_DIR_D}/_lib-source-env.sh"
LOG_FILE_D="${LAB_DIR_D}/output/scenario-d.log"
DEPLOYMENT_NAME="constrained"
APP_LABEL="constrained"

WATCH_DURATION=90

usage() {
  cat <<'EOF'
Usage: scenario-d-constraints.sh [--watch-duration SECONDS]

  --watch-duration  Seconds to watch after scaling. Default 90.
  -h, --help        Show this help.

Applies a workload with hard scheduling constraints (t3 / amd64 /
us-west-2a / on-demand) and watches the resulting provisioning.
Writes the snapshot to labs/kops-karpenter/output/scenario-d.log.
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
  source "${HELPER_D}"
  source_aws_credentials_from_env "${ENV_FILE_D}"
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
mkdir -p "${LAB_DIR_D}/output"

{
  printf 'kOps + Karpenter lab — scenario D: scheduling constraints\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Watch:      %s seconds\n' "${WATCH_DURATION}"
  printf 'Constraints: t3 / amd64 / us-west-2a / on-demand\n'
} > "${LOG_FILE_D}"

echo "==> Logging to ${LOG_FILE_D}"

KUBECONFIG_CTX_D="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX_D}" ] || [[ "${KUBECONFIG_CTX_D}" == *"error"* ]]; then
  {
    echo 'Context:    <none>'
    echo ''
    echo '[!] No active kubectl context. Export kubeconfig first:'
    # shellcheck disable=SC2016
    echo '    kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin'
  } >> "${LOG_FILE_D}"
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
{
  printf 'Context:    %s\n' "${KUBECONFIG_CTX_D}"
} >> "${LOG_FILE_D}"

echo "==> Using kubectl context: ${KUBECONFIG_CTX_D}"

# ---------------------------------------------------------------------------
# Write the inline manifest to a temp file so the scenario is
# self-contained (no separate manifest file is required).
# ---------------------------------------------------------------------------
TMP_MANIFEST="$(mktemp -t scenario-d-XXXXXX.yaml)"
TMP_MANIFEST="${TMP_MANIFEST:-/tmp/scenario-d-$$.yaml}"
cat > "${TMP_MANIFEST}" <<'YAML'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: constrained
  labels:
    app: constrained
    lab: kops-karpenter
spec:
  replicas: 6
  selector:
    matchLabels:
      app: constrained
  template:
    metadata:
      labels:
        app: constrained
        lab: kops-karpenter
    spec:
      tolerations:
        - key: karpenter-lab/workload
          operator: Exists
          effect: NoSchedule
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node.kubernetes.io/instance-type
                    operator: In
                    values: ["t3.small", "t3.medium"]
                  - key: kubernetes.io/arch
                    operator: In
                    values: ["amd64"]
                  - key: topology.kubernetes.io/zone
                    operator: In
                    values: ["us-west-2a"]
                  - key: karpenter.sh/capacity-type
                    operator: In
                    values: ["on-demand"]
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

# Cleanup the temp file on exit (success or failure).
trap 'rm -f "${TMP_MANIFEST}"' EXIT

# ---------------------------------------------------------------------------
# Apply the manifest idempotently. Delete first so a stale spec does
# not survive from a previous run, then re-apply.
# ---------------------------------------------------------------------------
echo "==> Deleting any previous ${DEPLOYMENT_NAME} Deployment (idempotency)"
kubectl delete deployment "${DEPLOYMENT_NAME}" --ignore-not-found 2>&1 | tee -a "${LOG_FILE_D}" || true

echo "==> Applying ${TMP_MANIFEST}"
if ! kubectl apply -f "${TMP_MANIFEST}" 2>&1 | tee -a "${LOG_FILE_D}"; then
  echo "[!] kubectl apply failed; continuing so the log captures cluster state." >&2
fi

# Initial snapshot.
{
  printf '\n## Pre-watch snapshot\n'
  printf -- '------------------------------------------------------------\n'
  kubectl get pods -l "app=${APP_LABEL}" -o wide 2>&1 || true
  kubectl get nodeclaims -o wide 2>&1 || true
  kubectl get nodes -o wide 2>&1 || true
} >> "${LOG_FILE_D}"

# ---------------------------------------------------------------------------
# Watch loop. 6 replicas at 200m / 256Mi should fit on a single t3
# node, so we expect Karpenter to provision at least one node in
# us-west-2a. The watch is short because there is no scale-out
# pressure that needs to play out.
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
  } >> "${LOG_FILE_D}" 2>&1 || true
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
} >> "${LOG_FILE_D}"

echo ""
echo "==> Done. Snapshot: ${LOG_FILE_D}"
exit 0
