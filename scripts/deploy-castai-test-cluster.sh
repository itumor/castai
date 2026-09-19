#!/usr/bin/env bash
#
# deploy-castai-test-cluster.sh
#
# Idempotent one-shot deployment for the disposable CAST AI Terraform E2E
# test cluster. Creates a plain EKS cluster in account 050451381948 that
# both CAST AI Terraform examples (read-only and read-write) can target.
#
# Behavior:
#   - Sources repo-root .env for CAST AI / Terraform variables (NOT AWS
#     credentials) and awskey.env for AWS credentials.
#   - Refuses to run unless the AWS caller identity matches account
#     050451381948.
#   - Creates the cluster only if it does not already exist; tolerates
#     missing resources (account is regularly tidied up).
#   - Ensures kubeconfig context, a default StorageClass, and waits for
#     at least 3 Ready nodes (5 minute timeout).
#   - Prints the exact commands to run next.
#
# Prerequisites:
#   - eksctl, kubectl, and AWS CLI installed
#   - Valid AWS credentials for account 050451381948 (in awskey.env)
#   - This script run from the repository root (it expects ../*.env,
#     ../awskey.env, ../eksctl-castai-test-cluster.yaml,
#     ../ensure-default-storageclass.sh when invoked as
#     ./scripts/deploy-castai-test-cluster.sh)
#
# Usage:
#   AWS_REGION=eu-west-1 ./scripts/deploy-castai-test-cluster.sh
#

set -euo pipefail

CLUSTER_NAME="castai-terraform-e2e"
CLUSTER_CONFIG="eksctl-castai-test-cluster.yaml"
EXPECTED_ACCOUNT="050451381948"
ENSURE_STORAGECLASS_SCRIPT="ensure-default-storageclass.sh"
AWS_REGION="${AWS_REGION:-eu-west-1}"

# ---------------------------------------------------------------------------
# Resolve repo root (parent of the scripts/ directory) so relative paths
# to .env, awskey.env, the eksctl YAML, and the storageclass helper are
# stable regardless of where the script is invoked from.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Unset any AWS credentials inherited from the environment or a previous
# shell so awskey.env is the sole source of AWS credentials for this run.
# ---------------------------------------------------------------------------
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
unset AWS_PROFILE

# ---------------------------------------------------------------------------
# Source credentials. .env holds CAST AI / Terraform variables only
# (notably TF_VAR_castai_api_token); awskey.env holds AWS credentials.
# ---------------------------------------------------------------------------
echo "==> Sourcing credentials from repo root (${REPO_ROOT})..."

if [ ! -f "${REPO_ROOT}/.env" ]; then
  echo "[ERROR] ${REPO_ROOT}/.env not found." >&2
  echo "        Create .env with TF_VAR_castai_api_token (and other" >&2
  echo "        non-AWS vars) before running." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a
. "${REPO_ROOT}/.env"
set +a
echo "    Loaded ${REPO_ROOT}/.env (CAST AI / Terraform vars)"

if [ ! -f "${REPO_ROOT}/awskey.env" ]; then
  echo "[ERROR] ${REPO_ROOT}/awskey.env not found." >&2
  echo "        Create awskey.env with AWS_ACCESS_KEY_ID /" >&2
  echo "        AWS_SECRET_ACCESS_KEY before running." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a
. "${REPO_ROOT}/awskey.env"
set +a
echo "    Loaded ${REPO_ROOT}/awskey.env (AWS credentials)"

# Drop any AWS_SESSION_TOKEN that may have been sourced from .env. .env
# currently contains an empty/invalid AWS_SESSION_TOKEN that overrides the
# valid long-lived credentials in awskey.env and breaks STS, so explicitly
# unset it before the caller-identity check below.
unset AWS_SESSION_TOKEN

# ---------------------------------------------------------------------------
# Account guard. This script is intentionally single-account: it only
# touches the disposable E2E test account. Refuse to run anywhere else.
# ---------------------------------------------------------------------------
echo "==> Verifying AWS caller identity is account ${EXPECTED_ACCOUNT} in ${AWS_REGION}..."
ACTUAL_ACCOUNT="$(aws sts get-caller-identity --query Account --output text --region "${AWS_REGION}" 2>/dev/null || true)"
if [ -z "${ACTUAL_ACCOUNT}" ]; then
  echo "[ERROR] AWS account mismatch: unable to determine caller identity." >&2
  echo "        Check that AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are set" >&2
  echo "        and that 'aws sts get-caller-identity' succeeds." >&2
  exit 1
fi
if [ "${ACTUAL_ACCOUNT}" != "${EXPECTED_ACCOUNT}" ]; then
  echo "[ERROR] AWS account mismatch: expected ${EXPECTED_ACCOUNT}, got ${ACTUAL_ACCOUNT}." >&2
  echo "        Refusing to create the test cluster in the wrong account." >&2
  exit 1
fi
echo "    Caller identity OK (account ${ACTUAL_ACCOUNT})."

# ---------------------------------------------------------------------------
# Helper: check if the EKS cluster already exists.
# Tries a direct lookup first, then falls back to listing clusters in the
# region. Returns 0 if the cluster exists, 1 otherwise. The test account
# is regularly tidied up, so missing resources are expected and tolerated.
# ---------------------------------------------------------------------------
cluster_exists() {
  if eksctl get cluster --name="${CLUSTER_NAME}" --region="${AWS_REGION}" >/dev/null 2>&1; then
    return 0
  fi
  # Fallback for eksctl versions that do not support --name on get cluster.
  eksctl get cluster --region="${AWS_REGION}" 2>/dev/null \
    | awk 'NR>1 {print $1}' \
    | grep -qx "${CLUSTER_NAME}"
}

# ---------------------------------------------------------------------------
# 1. Create the EKS cluster with eksctl, or skip if it already exists.
# ---------------------------------------------------------------------------
if cluster_exists; then
  echo "==> Cluster '${CLUSTER_NAME}' already exists in ${AWS_REGION}; skipping creation."
else
  echo "==> Creating EKS cluster '${CLUSTER_NAME}' in ${AWS_REGION}..."
  if [ ! -f "${REPO_ROOT}/${CLUSTER_CONFIG}" ]; then
    echo "[ERROR] Cluster config not found: ${REPO_ROOT}/${CLUSTER_CONFIG}" >&2
    exit 1
  fi
  eksctl create cluster -f "${REPO_ROOT}/${CLUSTER_CONFIG}"
fi

# ---------------------------------------------------------------------------
# 2. Ensure kubeconfig context is set so subsequent kubectl / castctl
#    calls target the right cluster. Idempotent: rewrites the context.
# ---------------------------------------------------------------------------
echo "==> Ensuring kubeconfig context for '${CLUSTER_NAME}'..."
eksctl utils write-kubeconfig --cluster="${CLUSTER_NAME}" --region="${AWS_REGION}"

# ---------------------------------------------------------------------------
# 3. Ensure a default StorageClass exists. CAST AI workloads depend on a
#    default StorageClass for PVCs; the helper prefers gp3 + EBS CSI
#    driver when available and falls back to the in-tree gp2 provisioner.
# ---------------------------------------------------------------------------
echo "==> Ensuring a default StorageClass exists..."
if [ -x "${REPO_ROOT}/${ENSURE_STORAGECLASS_SCRIPT}" ]; then
  "${REPO_ROOT}/${ENSURE_STORAGECLASS_SCRIPT}"
else
  echo "[!] ${ENSURE_STORAGECLASS_SCRIPT} not found or not executable at" >&2
  echo "    ${REPO_ROOT}/${ENSURE_STORAGECLASS_SCRIPT}; skipping." >&2
fi

# ---------------------------------------------------------------------------
# 4. Wait for at least 3 nodes to be Ready. With a small nodegroup this
#    is normally well under a minute; we allow up to 5 minutes to absorb
#    AMI pull / kubelet registration latency on cold start.
# ---------------------------------------------------------------------------
echo "==> Waiting for at least 3 nodes to be Ready (timeout 5 minutes)..."
WAIT_SECONDS=300
READY=0
for (( i=0; i<WAIT_SECONDS; i+=10 )); do
  READY=$(kubectl get nodes \
    --field-selector=status.conditions[0].type=Ready,status.conditions[0].status=True \
    --no-headers 2>/dev/null | wc -l | tr -d ' ')
  # Field-selector form above is not portable across kubectl versions; fall
  # back to a JSONPath query that works on every supported version.
  if [ -z "${READY}" ] || [ "${READY}" = "0" ]; then
    READY=$(kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' \
      2>/dev/null | grep -c "True" || true)
  fi
  if [ "${READY}" -ge 3 ]; then
    echo "==> ${READY} nodes Ready."
    break
  fi
  echo "    ${READY}/3 nodes Ready (${i}s elapsed)..."
  sleep 10
done

if [ "${READY}" -lt 3 ]; then
  echo "[!] Only ${READY} node(s) Ready after ${WAIT_SECONDS}s." >&2
  echo "    Continuing anyway; the Terraform example may still come up." >&2
fi

echo "==> Current nodes:"
kubectl get nodes

# ---------------------------------------------------------------------------
# 5. Done. Print the exact next commands for the CAST AI Terraform
#    read-only example.
# ---------------------------------------------------------------------------
cat <<EOF

==> Deployment complete. Cluster '${CLUSTER_NAME}' is ready in ${AWS_REGION}.

Next steps (CAST AI Terraform read-only example):

  cd castai-terraform-example
  terraform init
  terraform apply

The provider will use AWS credentials from your environment and
TF_VAR_castai_api_token (sourced from .env).

To delete the cluster and all resources:

  eksctl delete cluster --region ${AWS_REGION} --name ${CLUSTER_NAME}
EOF
