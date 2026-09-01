#!/usr/bin/env bash
#
# apply-karpenter-manifests.sh
#
# Optionally apply the example Karpenter NodePool and EC2NodeClass
# manifests under labs/kops-karpenter/manifests/.
#
# NOTE: kOps 1.36 generates NodePool / EC2NodeClass automatically from
# the `karpenter-nodes` InstanceGroup declared in
# labs/kops-karpenter/cluster-spec.yaml. Applying these example
# manifests is OPTIONAL and intended for manual exploration of
# alternate Karpenter configurations (custom taints, capacity types,
# AMI selectors, block device mappings, etc.).
#
# Behavior:
#   - Idempotent: `kubectl apply -f` is safe to rerun.
#   - Safe to run before or after `kops update cluster`. The example
#     NodePool is named `lab-example` so it does not collide with the
#     kOps-generated NodePool.
#
# Exit codes:
#   0  manifests applied (or already up to date)
#   1  prerequisite missing (kubectl) or kubeconfig not usable
#   2  one or more `kubectl apply` calls failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and source AWS credentials from .env when AWS_* are unset.
# The shared helper only forwards AWS_* variables, so non-AWS secrets
# in .env (e.g. CAST AI tokens) never enter this script's environment.
# ---------------------------------------------------------------------------
SCRIPT_DIR_AKM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_AKM="$(cd "${SCRIPT_DIR_AKM}/.." && pwd)"
REPO_ROOT_AKM="$(cd "${LAB_DIR_AKM}/../.." && pwd)"
ENV_FILE_AKM="${REPO_ROOT_AKM}/.env"
HELPER_AKM="${SCRIPT_DIR_AKM}/_lib-source-env.sh"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_AKM}"
  source_aws_credentials_from_env "${ENV_FILE_AKM}"
fi

MANIFESTS_DIR="${LAB_DIR_AKM}/manifests"

usage() {
  cat <<'EOF'
Usage: apply-karpenter-manifests.sh

Applies labs/kops-karpenter/manifests/example-nodepool.yaml and
example-ec2nodeclass.yaml via `kubectl apply -f`.

These manifests are EXAMPLES. kOps 1.36 already creates NodePool and
EC2NodeClass automatically from the karpenter-nodes InstanceGroup
declared in labs/kops-karpenter/cluster-spec.yaml, so applying these
is OPTIONAL and intended for manual exploration.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

# ---------------------------------------------------------------------------
# Prerequisite checks.
# ---------------------------------------------------------------------------
if ! command -v kubectl >/dev/null 2>&1; then
  echo "[!] kubectl is not installed or not on PATH." >&2
  exit 1
fi

# Confirm kubeconfig is usable. Apply requires a working cluster
# context; surface a clear error otherwise.
KUBECONFIG_CTX="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX}" ] || [[ "${KUBECONFIG_CTX}" == *"error"* ]]; then
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
echo "==> Using kubectl context: ${KUBECONFIG_CTX}"

# ---------------------------------------------------------------------------
# Apply the example manifests.
# ---------------------------------------------------------------------------
failed=0

for manifest in "${MANIFESTS_DIR}/example-ec2nodeclass.yaml" "${MANIFESTS_DIR}/example-nodepool.yaml"; do
  if [ ! -f "${manifest}" ]; then
    echo "[!] Manifest not found: ${manifest}" >&2
    failed=1
    continue
  fi
  echo "==> Applying ${manifest}"
  if ! kubectl apply -f "${manifest}"; then
    echo "[!] kubectl apply failed for ${manifest}" >&2
    failed=1
  fi
done

cat <<EOF

==> Done. Example Karpenter manifests applied.

Verify:
  kubectl get nodepool,ec2nodeclass

Cleanup (remove the example objects):
  kubectl delete -f ${MANIFESTS_DIR}/example-nodepool.yaml
  kubectl delete -f ${MANIFESTS_DIR}/example-ec2nodeclass.yaml

Note: kOps 1.36 still owns the kops-generated NodePool /
EC2NodeClass. Deleting the EXAMPLE objects does not affect the
kOps-managed capacity envelope.
EOF

if [ "${failed}" -ne 0 ]; then
  exit 2
fi
exit 0
