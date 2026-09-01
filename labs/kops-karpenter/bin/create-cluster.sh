#!/usr/bin/env bash
#
# create-cluster.sh
#
# Idempotently provision the kOps + Karpenter lab cluster on AWS.
#
# Responsibilities:
#   1. Resolve kOps environment variables (KOPS_STATE_STORE,
#      KOPS_DISCOVERY_STORE, KOPS_CLUSTER_NAME, AWS_REGION) either from the
#      caller's environment or by sourcing them from
#      `bootstrap-state-store.sh --print-exports`.
#   2. Verify required CLI tools (kops, kubectl, aws) and AWS credentials.
#   3. Ensure the S3 state store and discovery store buckets exist
#      (delegated to the idempotent `bootstrap-state-store.sh` script).
#   4. Apply `labs/kops-karpenter/cluster-spec.yaml` via `kops create -f`
#      only if the cluster is not already registered in the state store.
#   5. Reconcile AWS resources via `kops update cluster --yes --admin`.
#   6. Wait for readiness with `kops validate cluster --wait=10m`.
#   7. Export a kubeconfig for the cluster with `kops export kubeconfig`.
#   8. Print a summary plus the next-step commands.
#
# Flags:
#   --dry-run    Run the same workflow but omit `--yes` from
#                `kops update cluster` so the change is planned but not
#                applied. Useful for review or CI smoke checks.
#
# Environment overrides (any subset is honored):
#   KOPS_STATE_STORE      S3 bucket used for kOps cluster state.
#   KOPS_DISCOVERY_STORE  S3 bucket used for cluster/service discovery.
#   KOPS_CLUSTER_NAME     Fully-qualified cluster name (must end in
#                         `.k8s.local` for the None-DNS topology used in
#                         this lab).
#   AWS_REGION            Region used for both AWS API calls and bucket
#                         creation (default: us-west-2).
#
# Exit codes:
#   0  cluster is ready and kubeconfig is exported
#   1  missing prerequisite (kops, kubectl, aws, credentials) or env
#   2  bootstrap or kops command failed
#   3  invalid arguments

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLUSTER_SPEC="${LAB_DIR}/cluster-spec.yaml"
BOOTSTRAP="${SCRIPT_DIR}/bootstrap-state-store.sh"

# ---------------------------------------------------------------------------
# Source AWS credentials from the repo-root .env when AWS_* env vars are
# not already exported. The shared helper
# (labs/kops-karpenter/bin/_lib-source-env.sh) only forwards the AWS
# allow-list variables from .env into this shell, so non-AWS secrets
# defined there (e.g. CAST AI tokens) stay out of the environment.
# ---------------------------------------------------------------------------
REPO_ROOT_CC="$(cd "${LAB_DIR}/../.." && pwd)"
ENV_FILE_CC="${REPO_ROOT_CC}/.env"
HELPER_CC="${SCRIPT_DIR}/_lib-source-env.sh"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_CC}"
  source_aws_credentials_from_env "${ENV_FILE_CC}"
fi

DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: create-cluster.sh [--dry-run]

  --dry-run    Run the workflow without `--yes` so `kops update cluster`
               only prints what it would change. All other steps still
               run (state buckets, kops create, kops export kubeconfig).

Environment variables (optional; defaults come from bootstrap-state-store.sh):
  KOPS_STATE_STORE      S3 bucket for kOps state.
  KOPS_DISCOVERY_STORE  S3 bucket for cluster/service discovery.
  KOPS_CLUSTER_NAME     Cluster fully-qualified name.
  AWS_REGION            AWS region (default: us-west-2).
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[!] Unknown argument: $arg" >&2
      usage >&2
      exit 3
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helper: run kops with --state set when KOPS_STATE_STORE is non-empty.
# Centralizes the flag plumbing so --dry-run and the production path stay
# in sync.
# ---------------------------------------------------------------------------
kops_run() {
  local args=(kops)
  if [ -n "${KOPS_STATE_STORE:-}" ]; then
    args+=(--state "${KOPS_STATE_STORE}")
  fi
  args+=("$@")
  "${args[@]}"
}

# ---------------------------------------------------------------------------
# 1. Prerequisite tool checks.
# ---------------------------------------------------------------------------
echo "==> Checking required CLI tools..."
for cmd in kops kubectl aws; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[!] Required command not found on PATH: $cmd" >&2
    case "$cmd" in
      kops)     echo "    Install kops: https://kops.sigs.k8s.io/setup/" >&2 ;;
      kubectl)  echo "    Install kubectl: https://kubernetes.io/docs/tasks/tools/" >&2 ;;
      aws)      echo "    Install aws CLI: https://aws.amazon.com/cli/" >&2 ;;
    esac
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 2. Resolve kOps environment variables.
#
# If any of the canonical kOps/AWS variables are unset, source them from
# `bootstrap-state-store.sh --print-exports`. Otherwise, export what the
# caller already set so subsequent commands can rely on them.
# ---------------------------------------------------------------------------
need_source=0
for var in KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME AWS_REGION; do
  if [ -z "${!var:-}" ]; then
    need_source=1
    break
  fi
done

if [ "${need_source}" -eq 1 ]; then
  if [ ! -x "${BOOTSTRAP}" ]; then
    echo "[!] Some kOps/AWS env vars are unset and ${BOOTSTRAP} is missing or not executable." >&2
    echo "    Set KOPS_STATE_STORE, KOPS_DISCOVERY_STORE, KOPS_CLUSTER_NAME, AWS_REGION" >&2
    echo "    manually, or fix the bootstrap script." >&2
    exit 1
  fi
  echo "==> Sourcing kOps env vars from bootstrap-state-store.sh --print-exports..."
  # shellcheck disable=SC1090
  eval "$("${BOOTSTRAP}" --print-exports)"
else
  export KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME AWS_REGION
  export AWS_DEFAULT_REGION="${AWS_REGION}"
fi

echo "    KOPS_STATE_STORE     = ${KOPS_STATE_STORE}"
echo "    KOPS_DISCOVERY_STORE = ${KOPS_DISCOVERY_STORE}"
echo "    KOPS_CLUSTER_NAME    = ${KOPS_CLUSTER_NAME}"
echo "    AWS_REGION           = ${AWS_REGION}"

# ---------------------------------------------------------------------------
# 3. Verify AWS credentials before doing anything that touches the cloud.
# ---------------------------------------------------------------------------
echo "==> Verifying AWS credentials in region '${AWS_REGION}'..."
if ! CALLER_JSON="$(aws sts get-caller-identity --region "${AWS_REGION}" --output json 2>&1)"; then
  echo "[!] aws sts get-caller-identity failed. Configure credentials or set AWS_* env vars." >&2
  echo "${CALLER_JSON}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Ensure state stores exist (idempotent).
# ---------------------------------------------------------------------------
if [ ! -x "${BOOTSTRAP}" ]; then
  echo "[!] bootstrap-state-store.sh is missing or not executable at ${BOOTSTRAP}" >&2
  exit 1
fi

echo "==> Bootstrapping S3 state/discovery stores (idempotent)..."
# bootstrap-state-store.sh wants bare bucket names; kops wants s3:// URLs.
# Strip the s3:// scheme (and any trailing slash) before calling it.
BOOTSTRAP_STATE_BUCKET="${KOPS_STATE_STORE#s3://}"
BOOTSTRAP_STATE_BUCKET="${BOOTSTRAP_STATE_BUCKET%/}"
BOOTSTRAP_DISCOVERY_BUCKET="${KOPS_DISCOVERY_STORE#s3://}"
BOOTSTRAP_DISCOVERY_BUCKET="${BOOTSTRAP_DISCOVERY_BUCKET%/}"
KOPS_STATE_STORE="${BOOTSTRAP_STATE_BUCKET}" \
KOPS_DISCOVERY_STORE="${BOOTSTRAP_DISCOVERY_BUCKET}" \
AWS_REGION="${AWS_REGION}" \
"${BOOTSTRAP}"

# ---------------------------------------------------------------------------
# 5. Apply cluster-spec.yaml if the cluster is not already registered.
# ---------------------------------------------------------------------------
echo "==> Checking if cluster '${KOPS_CLUSTER_NAME}' is already registered..."
# `kops get cluster` exits non-zero when the cluster is not registered.
# Capture that explicitly so set -e does not abort the script on the
# expected "not found" path.
cluster_exists=0
if kops_run get cluster --name "${KOPS_CLUSTER_NAME}" >/dev/null 2>&1; then
  cluster_exists=1
fi

if [ "${cluster_exists}" -eq 1 ]; then
  echo "    Cluster is already registered in the state store. Skipping 'kops create -f'."
else
  if [ ! -f "${CLUSTER_SPEC}" ]; then
    echo "[!] Cluster manifest not found at ${CLUSTER_SPEC}" >&2
    exit 2
  fi
  echo "==> Applying cluster manifest: ${CLUSTER_SPEC}"
  kops_run create -f "${CLUSTER_SPEC}" --name "${KOPS_CLUSTER_NAME}"
fi

# ---------------------------------------------------------------------------
# 6. Reconcile AWS resources via `kops update cluster`.
#    In --dry-run mode, omit --yes so the command prints a plan only.
# ---------------------------------------------------------------------------
echo "==> Running 'kops update cluster' (dry-run=${DRY_RUN})..."
if [ "${DRY_RUN}" -eq 1 ]; then
  kops_run update cluster --name "${KOPS_CLUSTER_NAME}" --admin
else
  kops_run update cluster --name "${KOPS_CLUSTER_NAME}" --yes --admin
fi

# ---------------------------------------------------------------------------
# 7. Wait for readiness.
# ---------------------------------------------------------------------------
echo "==> Waiting for cluster to become ready (kops validate cluster --wait=10m)..."
kops_run validate cluster --name "${KOPS_CLUSTER_NAME}" --wait 10m

# ---------------------------------------------------------------------------
# 8. Export kubeconfig for kubectl/kops consumers.
# ---------------------------------------------------------------------------
echo "==> Exporting kubeconfig (kops export kubeconfig --admin)..."
kops_run export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin

# ---------------------------------------------------------------------------
# 9. Apply example Karpenter NodePool / EC2NodeClass manifests.
# ---------------------------------------------------------------------------
echo "==> Applying example Karpenter EC2NodeClass and NodePool manifests..."
kubectl apply -f "${SCRIPT_DIR}/../manifests/example-ec2nodeclass.yaml"
kubectl apply -f "${SCRIPT_DIR}/../manifests/example-nodepool.yaml"

# ---------------------------------------------------------------------------
# 10. Summary and next-step commands.
# ---------------------------------------------------------------------------
KUBECONFIG_PATH="${KUBECONFIG:-${HOME}/.kube/config}"

cat <<EOF

==> Done. Cluster '${KOPS_CLUSTER_NAME}' is ready.

  KOPS_STATE_STORE     = ${KOPS_STATE_STORE}
  KOPS_DISCOVERY_STORE = ${KOPS_DISCOVERY_STORE}
  KOPS_CLUSTER_NAME    = ${KOPS_CLUSTER_NAME}
  AWS_REGION           = ${AWS_REGION}
  KUBECONFIG           = ${KUBECONFIG_PATH}

Next steps:
  1. Inspect the cluster:
       labs/kops-karpenter/bin/validate-cluster.sh
  2. Inspect the example Karpenter manifests applied above. Note:
     kOps 1.36 also generates NodePool / EC2NodeClass from the
     karpenter-nodes InstanceGroup; the example manifests are for
     exploration and documentation:
       kubectl get nodepool,ec2nodeclass
  3. Run the workload exercises (Phase 4).
  4. Tear down at the end of the lab:
       kops delete cluster --name "\${KOPS_CLUSTER_NAME}" --state "\${KOPS_STATE_STORE}" --yes
       aws s3 rb "\${KOPS_STATE_STORE}" --force
       aws s3 rb "\${KOPS_DISCOVERY_STORE}" --force

This script is idempotent: rerunning it will skip 'kops create -f' if the
cluster is already registered, and will reconcile any drift via
'kops update cluster --yes'.
EOF
