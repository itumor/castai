#!/usr/bin/env bash
#
# bootstrap-state-store.sh
#
# Idempotently create the S3 buckets that kOps uses to store cluster state
# and service/cluster discovery records for the kOps + Karpenter lab.
#
# This script does NOT create a cluster. It only prepares the state stores
# that `kops create cluster` and `kops update cluster` will read from.
#
# Bucket layout produced:
#   ${KOPS_STATE_STORE}              - kOps cluster state (kops stores
#                                      the cluster spec and secrets here)
#   ${KOPS_DISCOVERY_STORE}          - cluster/service discovery bucket
#                                      (required by None-DNS topology,
#                                      defaults to "${KOPS_STATE_STORE}-discovery")
#
# Behavior:
#   - Reads KOPS_STATE_STORE; defaults to
#     "kops-karpenter-lab-state-${AWS_REGION}-${AWS_ACCOUNT_ID}".
#   - Reads KOPS_DISCOVERY_STORE; defaults to "${KOPS_STATE_STORE}-discovery".
#   - Defaults AWS_REGION to "eu-central-1" if unset.
#   - Calls `aws sts get-caller-identity` to fail fast if credentials are
#     missing or the caller cannot reach AWS.
#   - Creates each bucket only if it does not already exist (idempotent).
#   - Disables versioning on both buckets (kOps manages its own state
#     revisions; versioning is not required for the state store).
#   - Applies a public-access block to both buckets (defence in depth -
#     neither bucket is meant to be public).
#   - Server-side encryption is left as the S3 default (SSE-S3) so the
#     script does not require KMS permissions; override after creation if
#     a customer-managed KMS key is required by your org.
#   - Exports KOPS_STATE_STORE, KOPS_DISCOVERY_STORE, and KOPS_CLUSTER_NAME
#     for the calling shell, and emits `export` lines that can be eval'd
#     by other scripts.
#
# Usage:
#   ./labs/kops-karpenter/bin/bootstrap-state-store.sh
#   KOPS_STATE_STORE=my-bucket ./labs/kops-karpenter/bin/bootstrap-state-store.sh
#   eval "$(./labs/kops-karpenter/bin/bootstrap-state-store.sh --print-exports)"
#
# Exit codes:
#   0  success (buckets now exist)
#   1  prerequisites missing (aws CLI, credentials)
#   2  bucket creation failed
#   3  invalid arguments

set -euo pipefail

# ---------------------------------------------------------------------------
# Source AWS credentials from the repo-root .env when AWS_* env vars are
# not already exported. The shared helper
# (labs/kops-karpenter/bin/_lib-source-env.sh) only forwards the AWS
# allow-list variables from .env into this shell, so non-AWS secrets
# defined there (e.g. CAST AI tokens) stay out of the environment.
# ---------------------------------------------------------------------------
SCRIPT_DIR_BS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_BS="$(cd "${SCRIPT_DIR_BS}/.." && pwd)"
REPO_ROOT_BS="$(cd "${LAB_DIR_BS}/../.." && pwd)"
ENV_FILE_BS="${REPO_ROOT_BS}/.env"
HELPER_BS="${SCRIPT_DIR_BS}/_lib-source-env.sh"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_BS}"
  source_aws_credentials_from_env "${ENV_FILE_BS}"
fi

# ---------------------------------------------------------------------------
# Defaults and argument parsing.
# ---------------------------------------------------------------------------
DEFAULT_REGION="us-west-2"
KOPS_CLUSTER_NAME_DEFAULT="kops-karpenter-lab.k8s.local"
PRINT_EXPORTS_ONLY=0

usage() {
  cat <<'EOF'
Usage: bootstrap-state-store.sh [--print-exports]

  --print-exports   Print "export KEY=VALUE" lines for KOPS_STATE_STORE,
                    KOPS_DISCOVERY_STORE, and KOPS_CLUSTER_NAME, then exit.
                    Useful with: eval "$(... --print-exports)"
EOF
}

for arg in "$@"; do
  case "$arg" in
    --print-exports) PRINT_EXPORTS_ONLY=1 ;;
    -h|--help)       usage; exit 0 ;;
    *)
      echo "[!] Unknown argument: $arg" >&2
      usage >&2
      exit 3
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Prerequisite checks.
# ---------------------------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  echo "[!] aws CLI is not installed or not on PATH." >&2
  echo "    Install it before running this script: https://aws.amazon.com/cli/" >&2
  exit 1
fi

# Region default.
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-${DEFAULT_REGION}}}"
export AWS_REGION
export AWS_DEFAULT_REGION="${AWS_REGION}"

# Fail fast on missing/invalid AWS credentials.
# Diagnostic output goes to stderr so --print-exports mode (which is
# consumed via `eval "$(... --print-exports)"`) does not pick up
# human-readable echo lines.
echo "==> Verifying AWS credentials in region '${AWS_REGION}'..." >&2
if ! CALLER_JSON="$(aws sts get-caller-identity --region "${AWS_REGION}" --output json 2>&1)"; then
  echo "[!] aws sts get-caller-identity failed. Check your credentials:" >&2
  echo "${CALLER_JSON}" >&2
  exit 1
fi

AWS_ACCOUNT_ID="$(printf '%s' "${CALLER_JSON}" | awk -F'"' '/"Account"/{for(i=1;i<=NF;i++) if($i=="Account") {print $(i+2); exit}}')"
if [ -z "${AWS_ACCOUNT_ID}" ]; then
  # Fallback: any jq available?
  if command -v jq >/dev/null 2>&1; then
    AWS_ACCOUNT_ID="$(printf '%s' "${CALLER_JSON}" | jq -r '.Account // empty')"
  fi
fi
if [ -z "${AWS_ACCOUNT_ID}" ]; then
  echo "[!] Could not determine AWS account id from STS response." >&2
  echo "${CALLER_JSON}" >&2
  exit 1
fi

echo "    AWS account: ${AWS_ACCOUNT_ID}" >&2

# ---------------------------------------------------------------------------
# Resolve bucket names.
# ---------------------------------------------------------------------------
DEFAULT_STATE_STORE="kops-karpenter-lab-state-${AWS_REGION}-${AWS_ACCOUNT_ID}"
: "${KOPS_STATE_STORE:=${DEFAULT_STATE_STORE}}"
: "${KOPS_DISCOVERY_STORE:=${KOPS_STATE_STORE}-discovery}"
: "${KOPS_CLUSTER_NAME:=${KOPS_CLUSTER_NAME_DEFAULT}}"

export KOPS_STATE_STORE
export KOPS_DISCOVERY_STORE
export KOPS_CLUSTER_NAME

if [ "${PRINT_EXPORTS_ONLY}" -eq 1 ]; then
  printf 'export KOPS_STATE_STORE=%q\n' "${KOPS_STATE_STORE}"
  printf 'export KOPS_DISCOVERY_STORE=%q\n' "${KOPS_DISCOVERY_STORE}"
  printf 'export KOPS_CLUSTER_NAME=%q\n' "${KOPS_CLUSTER_NAME}"
  printf 'export AWS_REGION=%q\n' "${AWS_REGION}"
  printf 'export AWS_DEFAULT_REGION=%q\n' "${AWS_REGION}"
  exit 0
fi

echo "==> Bucket plan:"
echo "    KOPS_STATE_STORE     = ${KOPS_STATE_STORE}"
echo "    KOPS_DISCOVERY_STORE = ${KOPS_DISCOVERY_STORE}"
echo "    KOPS_CLUSTER_NAME    = ${KOPS_CLUSTER_NAME}"

# ---------------------------------------------------------------------------
# Helper: idempotent S3 bucket creation.
#
# - Creates the bucket only if it does not exist.
# - Applies a public-access block (no public ACLs, no public policies).
# - Versioning is left disabled (kOps manages its own state revisions).
# - Bucket region is taken from AWS_REGION.
# ---------------------------------------------------------------------------
create_state_bucket() {
  local bucket="$1"

  if aws s3api head-bucket --bucket "${bucket}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    echo "    Bucket already exists: ${bucket} (skipping create)"
  else
    echo "    Creating bucket: ${bucket}"
    # us-east-1 requires the older LocationConstraint syntax; everywhere
    # else uses the region name. kOps lab is pinned to us-west-2,
    # but we handle us-east-1 too for robustness.
    if [ "${AWS_REGION}" = "us-east-1" ]; then
      aws s3api create-bucket \
        --bucket "${bucket}" \
        --region "${AWS_REGION}" >/dev/null
    else
      aws s3api create-bucket \
        --bucket "${bucket}" \
        --region "${AWS_REGION}" \
        --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
    fi
  fi

  # Public access block (idempotent).
  echo "    Applying public-access block to: ${bucket}"
  aws s3api put-public-access-block \
    --bucket "${bucket}" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
    >/dev/null
}

# ---------------------------------------------------------------------------
# Create both buckets.
# ---------------------------------------------------------------------------
echo "==> Creating kOps state store..."
create_state_bucket "${KOPS_STATE_STORE}"

echo "==> Creating kOps discovery store..."
create_state_bucket "${KOPS_DISCOVERY_STORE}"

# ---------------------------------------------------------------------------
# Summary and next-step instructions.
# ---------------------------------------------------------------------------
cat <<EOF

==> Done. State stores are ready.

  KOPS_STATE_STORE     = ${KOPS_STATE_STORE}
  KOPS_DISCOVERY_STORE = ${KOPS_DISCOVERY_STORE}
  KOPS_CLUSTER_NAME    = ${KOPS_CLUSTER_NAME}
  AWS_REGION           = ${AWS_REGION}
  AWS_ACCOUNT_ID       = ${AWS_ACCOUNT_ID}

Next steps:
  1. Review labs/kops-karpenter/cluster-spec.yaml (kOps Cluster + InstanceGroups manifest).
  2. Export the env vars in your shell, or eval the script in --print-exports mode:
       eval "\$(labs/kops-karpenter/bin/bootstrap-state-store.sh --print-exports)"
  3. Create the cluster (a later phase of this lab):
       kops create -f labs/kops-karpenter/cluster-spec.yaml
       kops create secret --name "\${KOPS_CLUSTER_NAME}" --sshpublickey admin -o json \\
         | jq '.id' -r > /tmp/ssh_secret_id  # example, only if SSH is needed
       kops update cluster --name "\${KOPS_CLUSTER_NAME}" --yes
       kops validate cluster --name "\${KOPS_CLUSTER_NAME}" --wait 10m
  4. Tear down when finished:
       kops delete cluster --name "\${KOPS_CLUSTER_NAME}" --yes
       aws s3 rb "\${KOPS_STATE_STORE}" --force
       aws s3 rb "\${KOPS_DISCOVERY_STORE}" --force

This script is idempotent: rerunning it is safe and will only create
buckets that do not yet exist.
EOF
