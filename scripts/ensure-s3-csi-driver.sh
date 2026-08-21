#!/usr/bin/env bash
#
# ensure-s3-csi-driver.sh
#
# Idempotently installs the AWS Mountpoint for S3 CSI driver on an EKS cluster
# as a managed addon. Required before CAST AI can provision S3-backed PVCs
# for workloads that mount object storage via Mountpoint for S3.
#
# Usage:
#   ./scripts/ensure-s3-csi-driver.sh
#
# Environment:
#   CLUSTER_NAME    - override cluster name detection (default: parsed from
#                     current kubectl context).
#   AWS_REGION      - override AWS region detection (default: parsed from
#                     current kubectl context, or AWS_REGION env).
#   TIMEOUT_SECONDS - poll timeout for ACTIVE status (default: 600).

set -euo pipefail

ADDON_NAME="aws-mountpoint-s3-csi-driver"
S3_CSI_POLICY_ARN="arn:aws:iam::aws:policy/AmazonS3CSIDriverPolicy"
SERVICE_ACCOUNT_NAMESPACE="kube-system"
SERVICE_ACCOUNT_NAME="s3-csi-controller-sa"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-600}"
POLL_INTERVAL_SECONDS=10

function log() {
  echo "==> $*"
}

function fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

command -v aws >/dev/null 2>&1 || fail "aws CLI is required but not found in PATH. Install from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
command -v eksctl >/dev/null 2>&1 || fail "eksctl is required but not found in PATH. Install from https://eksctl.io/installation/"
command -v kubectl >/dev/null 2>&1 || fail "kubectl is required but not found in PATH. Install from https://kubernetes.io/docs/tasks/tools/"
command -v jq >/dev/null 2>&1 || fail "jq is required but not found in PATH. Install from https://jqlang.github.io/jq/"

CURRENT_CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
[[ -n "${CURRENT_CONTEXT}" ]] || fail "No active kubectl context. Run 'kubectl config use-context <context>' or set CLUSTER_NAME/AWS_REGION env vars."

# Infer cluster name and region from the current context. On EKS, the
# context name is either a plain cluster name ("karpenter-lab") or the
# full ARN ("arn:aws:eks:eu-central-1:050451381948:cluster/karpenter-lab").
INFERRED_CLUSTER=""
INFERRED_REGION=""
if [[ "${CURRENT_CONTEXT}" =~ arn:aws:eks:([^:]+):[^:]+:cluster/(.+)$ ]]; then
  INFERRED_REGION="${BASH_REMATCH[1]}"
  INFERRED_CLUSTER="${BASH_REMATCH[2]}"
elif [[ "${CURRENT_CONTEXT}" =~ ^([^@]+@)?([^.]+)\.([a-z0-9-]+)\.eksctl\.io$ ]]; then
  # eksctl-generated kubeconfig contexts look like:
  #   user@cluster-name.region.eksctl.io
  INFERRED_CLUSTER="${BASH_REMATCH[2]}"
  INFERRED_REGION="${BASH_REMATCH[3]}"
else
  INFERRED_CLUSTER="${CURRENT_CONTEXT}"
fi

CLUSTER_NAME="${CLUSTER_NAME:-${INFERRED_CLUSTER}}"
[[ -n "${CLUSTER_NAME}" ]] || fail "Could not determine cluster name. Set CLUSTER_NAME or configure kubectl context."

# Trust the region embedded in the kubectl context (ARN or eksctl format) over
# a generic AWS_REGION env var, which may come from a default shell profile.
if [[ -n "${INFERRED_REGION}" ]]; then
  if [[ -n "${AWS_REGION:-}" && "${AWS_REGION}" != "${INFERRED_REGION}" ]]; then
    log "Note: AWS_REGION env var is '${AWS_REGION}'; using region '${INFERRED_REGION}' from kubectl context."
  fi
  AWS_REGION="${INFERRED_REGION}"
else
  AWS_REGION="${AWS_REGION:-}"
  if [[ -z "${AWS_REGION}" ]]; then
    SERVER="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
    if [[ "${SERVER}" =~ \.([a-z0-9-]+)\.eks\.amazonaws\.com(\.cn)?$ ]]; then
      AWS_REGION="${BASH_REMATCH[1]}"
    fi
  fi
fi
[[ -n "${AWS_REGION}" ]] || fail "Could not determine AWS region. Set AWS_REGION or configure kubectl context."

log "Targeting cluster '${CLUSTER_NAME}' in region '${AWS_REGION}'."

if ! aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null 2>&1; then
  fail "AWS credentials are missing or invalid. Run 'aws configure' or export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
fi

IRSA_ROLE_NAME="${CLUSTER_NAME}-s3-csi-driver"
CF_STACK_NAME="eksctl-${CLUSTER_NAME}-addon-iamserviceaccount-${SERVICE_ACCOUNT_NAMESPACE}-${SERVICE_ACCOUNT_NAME}"

if [[ "${#IRSA_ROLE_NAME}" -gt 64 ]]; then
  fail "Derived IRSA role name '${IRSA_ROLE_NAME}' is ${#IRSA_ROLE_NAME} characters; AWS IAM role names must be <= 64. Set a shorter CLUSTER_NAME."
fi

function get_addon_status() {
  local out
  out="$(eksctl get addon \
    --cluster "${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --name "${ADDON_NAME}" \
    --output json 2>/dev/null || true)"
  if [[ -z "${out}" || "${out}" == "null" ]]; then
    echo ""
    return 0
  fi
  echo "${out}" | jq -r --arg n "${ADDON_NAME}" '.[]? | select(.Name == $n) | .Status' 2>/dev/null || echo ""
}

function verify_pods() {
  local pods
  pods="$(kubectl get pods -n "${SERVICE_ACCOUNT_NAMESPACE}" -l app.kubernetes.io/name=aws-mountpoint-s3-csi-driver -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)"
  if [[ -z "${pods}" ]]; then
    fail "Addon is ACTIVE but no Mountpoint for S3 CSI driver pods found in ${SERVICE_ACCOUNT_NAMESPACE} with label app.kubernetes.io/name=aws-mountpoint-s3-csi-driver."
  fi
  log "Mountpoint for S3 CSI driver pods running: ${pods}"
}

function cf_stack_status() {
  aws cloudformation describe-stacks \
    --stack-name "${CF_STACK_NAME}" \
    --region "${AWS_REGION}" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo ""
}

function cf_wait_for_delete() {
  local deadline
  deadline=$(( $(date +%s) + 300 ))
  while (( $(date +%s) < deadline )); do
    local status
    status="$(cf_stack_status)"
    if [[ -z "${status}" ]]; then
      log "Stack no longer exists."
      return 0
    fi
    case "${status}" in
      DELETE_COMPLETE)
        log "Stack deleted."
        return 0
        ;;
      DELETE_FAILED)
        # Keep polling; AWS may still be retrying or may need retain-resources.
        echo "  Stack status: ${status}; still waiting..."
        ;;
      *)
        echo "  Stack status: ${status}; waiting..."
        ;;
    esac
    sleep 10
  done
  return 1
}

function cf_cleanup_failed_stack() {
  local status
  status="$(cf_stack_status)"
  case "${status}" in
    ROLLBACK_COMPLETE|ROLLBACK_FAILED|CREATE_FAILED|DELETE_FAILED|UPDATE_ROLLBACK_COMPLETE|UPDATE_FAILED)
      log "CloudFormation stack '${CF_STACK_NAME}' is in ${status}; deleting it before retry..."
      # Disable termination protection if enabled, otherwise delete-stack fails.
      aws cloudformation update-termination-protection \
        --stack-name "${CF_STACK_NAME}" \
        --no-enable-termination-protection \
        --region "${AWS_REGION}" 2>/dev/null || true
      aws cloudformation delete-stack --stack-name "${CF_STACK_NAME}" --region "${AWS_REGION}" 2>/dev/null || true
      if cf_wait_for_delete; then
        return 0
      fi
      # If still stuck in DELETE_FAILED, try retaining the IAM role resource.
      status="$(cf_stack_status)"
      if [[ "${status}" == "DELETE_FAILED" ]]; then
        log "Stack delete did not complete cleanly; attempting to retain blocking IAM role..."
        local role_resource
        # shellcheck disable=SC2016 # Backticks are JMESPath literal syntax inside the AWS query, not shell expansion.
        role_resource="$(aws cloudformation describe-stack-resources \
          --stack-name "${CF_STACK_NAME}" \
          --region "${AWS_REGION}" \
          --query 'StackResources[?ResourceType==`AWS::IAM::Role`].[LogicalResourceId]' \
          --output text 2>/dev/null | head -n1 || true)"
        if [[ -n "${role_resource}" ]]; then
          aws cloudformation delete-stack \
            --stack-name "${CF_STACK_NAME}" \
            --retain-resources "${role_resource}" \
            --region "${AWS_REGION}" 2>/dev/null || true
          cf_wait_for_delete || true
        fi
      fi
      log "WARNING: Could not fully delete CloudFormation stack '${CF_STACK_NAME}'. Continuing; eksctl may still be able to create a new stack."
      ;;
    "")
      # No stack exists; nothing to do.
      ;;
    *)
      log "CloudFormation stack '${CF_STACK_NAME}' is in ${status}."
      ;;
  esac
}

function cf_print_errors() {
  echo ""
  echo "[CLOUDFORMATION ERRORS]"
  # shellcheck disable=SC2016 # Backticks are JMESPath literal syntax inside the AWS query, not shell expansion.
  aws cloudformation describe-stack-events \
    --stack-name "${CF_STACK_NAME}" \
    --region "${AWS_REGION}" \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED` || ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
    --output table 2>/dev/null || true
}

function wait_for_addon_active() {
  local deadline
  local status
  local attempt
  deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  status=""
  attempt=0
  while (( $(date +%s) < deadline )); do
    attempt=$((attempt + 1))
    status="$(get_addon_status)"
    if [[ "${status}" == "ACTIVE" ]]; then
      log "Mountpoint for S3 CSI driver addon is ACTIVE (attempt ${attempt})."
      return 0
    fi
    echo "  Status: ${status:-UNKNOWN} (attempt ${attempt}); sleeping ${POLL_INTERVAL_SECONDS}s..."
    sleep "${POLL_INTERVAL_SECONDS}"
  done
  fail "Mountpoint for S3 CSI driver addon did not reach ACTIVE within ${TIMEOUT_SECONDS}s. Last status: ${status:-UNKNOWN}. Inspect with: aws eks describe-addon --cluster-name ${CLUSTER_NAME} --addon-name ${ADDON_NAME} --region ${AWS_REGION}"
}

# Step 1: short-circuit if the addon is already installed and ACTIVE.
ADDON_STATUS="$(get_addon_status)"

if [[ "${ADDON_STATUS}" == "ACTIVE" ]]; then
  log "Mountpoint for S3 CSI driver addon is already installed and ACTIVE."
  verify_pods
  exit 0
fi

if [[ -n "${ADDON_STATUS}" ]]; then
  log "Mountpoint for S3 CSI driver addon exists with status '${ADDON_STATUS}'."
fi

# Step 2: ensure the IRSA role for the Mountpoint for S3 CSI controller exists.
# Prefer an existing service-account annotation; otherwise check IAM; otherwise create.
ROLE_ARN="$(kubectl get sa "${SERVICE_ACCOUNT_NAME}" -n "${SERVICE_ACCOUNT_NAMESPACE}" -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}' 2>/dev/null || true)"

if [[ -n "${ROLE_ARN}" ]]; then
  log "Found existing IRSA role ARN on ${SERVICE_ACCOUNT_NAMESPACE}/${SERVICE_ACCOUNT_NAME}: ${ROLE_ARN}"
elif aws iam get-role --role-name "${IRSA_ROLE_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  ROLE_ARN="$(aws iam get-role --role-name "${IRSA_ROLE_NAME}" --region "${AWS_REGION}" --query 'Role.Arn' --output text)"
  log "IRSA role '${IRSA_ROLE_NAME}' already exists; reusing."
else
  cf_cleanup_failed_stack
  log "Creating IRSA role '${IRSA_ROLE_NAME}' for the Mountpoint for S3 CSI controller..."
  if ! eksctl create iamserviceaccount \
    --name "${SERVICE_ACCOUNT_NAME}" \
    --namespace "${SERVICE_ACCOUNT_NAMESPACE}" \
    --cluster "${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --attach-policy-arn "${S3_CSI_POLICY_ARN}" \
    --role-name "${IRSA_ROLE_NAME}" \
    --override-existing-serviceaccounts \
    --approve; then
    cf_print_errors
    fail "Failed to create IRSA role. See CloudFormation errors above."
  fi
  ROLE_ARN="$(aws iam get-role --role-name "${IRSA_ROLE_NAME}" --region "${AWS_REGION}" --query 'Role.Arn' --output text)"
fi

[[ -n "${ROLE_ARN}" && "${ROLE_ARN}" != "None" ]] || fail "Failed to resolve role ARN for '${IRSA_ROLE_NAME}'."

# Step 3: install the addon if missing, otherwise update (idempotent).
if [[ -z "${ADDON_STATUS}" ]]; then
  log "Creating Mountpoint for S3 CSI driver addon on cluster '${CLUSTER_NAME}'..."
  eksctl create addon \
    --cluster "${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --name "${ADDON_NAME}" \
    --service-account-role-arn "${ROLE_ARN}"
elif [[ "${ADDON_STATUS}" == "CREATE_FAILED" || "${ADDON_STATUS}" == "DEGRADED" ]]; then
  fail "Mountpoint for S3 CSI driver addon is in ${ADDON_STATUS} state. Repair or delete it before rerunning: aws eks delete-addon --cluster-name ${CLUSTER_NAME} --addon-name ${ADDON_NAME} --region ${AWS_REGION}"
fi

# Step 4: poll for ACTIVE status.
log "Waiting for addon to reach ACTIVE status (timeout ${TIMEOUT_SECONDS}s)..."
wait_for_addon_active

verify_pods

log "Mountpoint for S3 CSI driver is ready."
