#!/usr/bin/env bash
set -euo pipefail

function log() {
  echo "[INFO] $*"
}

function fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

function usage() {
  cat <<'EOF'
Usage: ./scripts/ensure-eks-cluster.sh {start|stop} [--karpenter] [--test-workload] [--cred-file PATH] [--dry-run]

Commands:
  start   Create the EKS cluster
  stop    Delete the EKS cluster and clean up resources

Options:
  --karpenter       Use the Karpenter lab cluster config (eksctl-karpenter-cluster.yaml)
                    instead of the default generated-cluster.yaml
  --test-workload   (Karpenter mode only) Deploy a sample workload and watch
                    Karpenter provision new nodes after NodePool/EC2NodeClass are applied
  --cred-file       Path to credentials file (default: ./awskey.env)
  --dry-run         Print the commands/actions that would run without executing them
EOF
}

command -v aws >/dev/null 2>&1 || fail "aws CLI is required but not found in PATH. Install it from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
command -v eksctl >/dev/null 2>&1 || fail "eksctl is required but not found in PATH. Install it from https://eksctl.io/installation/"
command -v kubectl >/dev/null 2>&1 || fail "kubectl is required but not found in PATH. Install it from https://kubernetes.io/docs/tasks/tools/"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="${PROJECT_ROOT}/scripts"
AWSKEY_FILE="${PROJECT_ROOT}/awskey.env"
DEFAULT_CLUSTER_CONFIG="${PROJECT_ROOT}/generated-cluster.yaml"
KARPENTER_CLUSTER_CONFIG="${PROJECT_ROOT}/eksctl-karpenter-cluster.yaml"
KARPENTER_NODECLASS_FILE="${PROJECT_ROOT}/karpenter-nodeclass.yaml"
KARPENTER_NODEPOOL_FILE="${PROJECT_ROOT}/karpenter-nodepool.yaml"
KARPENTER_STORAGECLASS_FILE="${PROJECT_ROOT}/storageclass-gp3-default.yaml"
KARPENTER_TEST_WORKLOAD_FILE="${PROJECT_ROOT}/test-karpenter-workload.yaml"
CLUSTER_CONFIG="${DEFAULT_CLUSTER_CONFIG}"
EXPECTED_ACCOUNT_ID="050451381948"
export AWS_DEFAULT_REGION="us-west-2"
RUN_TEST_WORKLOAD=false

function load_credentials() {
  # Prefer AWS credentials already present in the shell environment. If they
  # are not set, fall back to sourcing the credentials file.
  if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    log "Using AWS credentials from environment"
    local cred_source="environment"
  elif [[ -f "${AWSKEY_FILE}" ]]; then
    log "Using AWS credentials from ${AWSKEY_FILE}"
    local cred_source="${AWSKEY_FILE}"
    # shellcheck source=/dev/null
    source "${AWSKEY_FILE}"
  else
    fail "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your environment, or create ${AWSKEY_FILE}"
  fi

  [[ -n "${AWS_ACCESS_KEY_ID:-}" ]] || fail "Could not parse AWS_ACCESS_KEY_ID from ${cred_source}"
  [[ -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || fail "Could not parse AWS_SECRET_ACCESS_KEY from ${cred_source}"
}

function run_aws() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would run: aws $*"
    return 0
  fi
  (
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    aws "$@"
  )
}

function run_eksctl() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would run: eksctl $*"
    return 0
  fi
  (
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    eksctl "$@"
  )
}

function run_kubectl() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would run: kubectl $*"
    return 0
  fi
  (
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION}" \
    kubectl "$@"
  )
}

function dry_run_guard() {
  local description="$1"
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would run: ${description}"
    return 1
  fi
  return 0
}

function inject_kubeconfig_credentials() {
  local kubeconfig_path="${1:-${HOME}/.kube/config}"
  (
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    KUBECONFIG_PATH="${kubeconfig_path}" \
    python3 - <<'PY'
import os
import sys
import yaml

kubeconfig = os.path.expanduser(os.environ.get("KUBECONFIG_PATH", os.path.join(os.environ.get("HOME", "/"), ".kube/config")))
with open(kubeconfig, "r") as f:
    config = yaml.safe_load(f) or {}

current = config.get("current-context", "")
context = next((c for c in config.get("contexts", []) if c.get("name") == current), None)
if not context:
    print("[WARN] Could not find current context to inject credentials", file=sys.stderr)
    sys.exit(0)

user_name = context["context"]["user"]
user = next((u for u in config.get("users", []) if u.get("name") == user_name), None)
if not user:
    print(f"[WARN] Could not find user {user_name} to inject credentials", file=sys.stderr)
    sys.exit(0)

exec_config = user.setdefault("user", {}).setdefault("exec", {})
env_list = exec_config.setdefault("env", [])
env_names = {e.get("name") for e in env_list}
if "AWS_ACCESS_KEY_ID" not in env_names:
    env_list.append({"name": "AWS_ACCESS_KEY_ID", "value": os.environ["AWS_ACCESS_KEY_ID"]})
if "AWS_SECRET_ACCESS_KEY" not in env_names:
    env_list.append({"name": "AWS_SECRET_ACCESS_KEY", "value": os.environ["AWS_SECRET_ACCESS_KEY"]})

with open(kubeconfig, "w") as f:
    yaml.safe_dump(config, f, default_flow_style=False)

print(f"[INFO] Injected AWS credentials into kubeconfig user {user_name}")
PY
  )
}

function cmd_start() {
log "Verifying AWS identity..."
if dry_run_guard "aws sts get-caller-identity --output json"; then
  CALLER_IDENTITY="$(run_aws sts get-caller-identity --output json)"
  echo "${CALLER_IDENTITY}"
  ACCOUNT_ID="$(echo "${CALLER_IDENTITY}" | grep -o '"Account"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)"
  [[ "${ACCOUNT_ID}" == "${EXPECTED_ACCOUNT_ID}" ]] || fail "Expected AWS account ${EXPECTED_ACCOUNT_ID}, got ${ACCOUNT_ID}"
  log "AWS identity verified for account ${ACCOUNT_ID} in region ${AWS_DEFAULT_REGION}"
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY-RUN] Would check: eksctl get cluster --name ${CLUSTER_NAME} --region ${AWS_DEFAULT_REGION}"
  log "[DRY-RUN] Would create EKS cluster '${CLUSTER_NAME}' from ${CLUSTER_CONFIG}"
  log "[DRY-RUN] Would run: eksctl create cluster -f $(basename "${CLUSTER_CONFIG}")"
else
  CLUSTER_EXISTS=false
  if run_eksctl get cluster --name "${CLUSTER_NAME}" --region "${AWS_DEFAULT_REGION}" >/dev/null 2>&1; then
    CLUSTER_EXISTS=true
    log "Cluster '${CLUSTER_NAME}' already exists; skipping creation"
  fi

  if [[ "${CLUSTER_EXISTS}" == "false" ]]; then
    log "Creating EKS cluster '${CLUSTER_NAME}' from ${CLUSTER_CONFIG}..."
    log "Running: eksctl create cluster -f $(basename "${CLUSTER_CONFIG}")"
    START_TIME=$(date +%s)
    run_eksctl create cluster -f "${CLUSTER_CONFIG}"
    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))
    MINUTES=$((ELAPSED / 60))
    SECONDS=$((ELAPSED % 60))
    log "Cluster creation completed in ${MINUTES}m ${SECONDS}s"
  fi
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY-RUN] Would run: eksctl utils write-kubeconfig --cluster=${CLUSTER_NAME} --region=${AWS_DEFAULT_REGION}"
  log "[DRY-RUN] Would run: kubectl get nodes"
else
  log "Updating kubeconfig and verifying kubectl access..."
  run_eksctl utils write-kubeconfig --cluster="${CLUSTER_NAME}" --region="${AWS_DEFAULT_REGION}" || fail "Failed to update kubeconfig for cluster '${CLUSTER_NAME}'"
  inject_kubeconfig_credentials
  if ! run_kubectl get nodes; then
    fail "kubectl get nodes failed; cannot verify cluster access"
  fi
  log "kubectl verification complete"
fi

log "Ensuring CSI driver addons are installed (aws-ebs-csi-driver, aws-efs-csi-driver, aws-mountpoint-s3-csi-driver)..."
if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY-RUN] Would run: ${SCRIPT_DIR}/ensure-ebs-csi-driver.sh"
  log "[DRY-RUN] Would run: ${SCRIPT_DIR}/ensure-efs-csi-driver.sh"
  log "[DRY-RUN] Would run: ${SCRIPT_DIR}/ensure-s3-csi-driver.sh"
else
  log "Running: ${SCRIPT_DIR}/ensure-ebs-csi-driver.sh"
  "${SCRIPT_DIR}/ensure-ebs-csi-driver.sh"
  log "Running: ${SCRIPT_DIR}/ensure-efs-csi-driver.sh"
  "${SCRIPT_DIR}/ensure-efs-csi-driver.sh"
  log "Running: ${SCRIPT_DIR}/ensure-s3-csi-driver.sh"
  "${SCRIPT_DIR}/ensure-s3-csi-driver.sh"
fi

if [[ "${KARPENTER_MODE}" == "true" ]]; then
  setup_karpenter
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY-RUN] start: would create cluster '${CLUSTER_NAME}' from $(basename "${CLUSTER_CONFIG}")"
fi
}

function setup_karpenter() {
  log "Starting Karpenter post-install configuration..."

  # Wait for at least one Karpenter pod to be ready. With a single system-ng
  # node, only one replica can run, so we do not require all replicas.
  log "Waiting for at least one Karpenter pod to be ready in namespace 'karpenter'..."
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would wait for at least one Karpenter pod to be ready"
  else
    WAIT_SECONDS=60
    READY=0
    for (( i=0; i<WAIT_SECONDS; i+=5 )); do
      READY=$(run_kubectl get pods -n karpenter \
        -l app.kubernetes.io/name=karpenter \
        --field-selector=status.phase=Running \
        -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' \
        2>/dev/null | grep -c "True" || true)
      if [ "${READY}" -ge 1 ]; then
        log "At least one Karpenter pod is ready (${READY} ready)."
        break
      fi
      log "  Waiting for at least one Karpenter pod to be ready... (${i}s)"
      sleep 5
    done
    if [ "${READY}" -lt 1 ]; then
      log "[WARN] No Karpenter pods are ready yet; continuing to apply NodeClass/NodePool anyway"
    fi
  fi

  log "Current Karpenter pods:"
  run_kubectl get pods -n karpenter

  # Apply EC2NodeClass and NodePool.
  log "Applying default StorageClass from ${KARPENTER_STORAGECLASS_FILE}..."
  run_kubectl apply -f "${KARPENTER_STORAGECLASS_FILE}"

  log "Applying EC2NodeClass from ${KARPENTER_NODECLASS_FILE}..."
  run_kubectl apply -f "${KARPENTER_NODECLASS_FILE}"

  log "Applying NodePool from ${KARPENTER_NODEPOOL_FILE}..."
  run_kubectl apply -f "${KARPENTER_NODEPOOL_FILE}"

  log "Verifying Karpenter resources..."
  run_kubectl get ec2nodeclass
  run_kubectl get nodepool

  # Optionally deploy a test workload and watch Karpenter scale nodes.
  if [[ "${RUN_TEST_WORKLOAD}" == "true" ]]; then
    log "Deploying test workload from ${KARPENTER_TEST_WORKLOAD_FILE}..."
    run_kubectl apply -f "${KARPENTER_TEST_WORKLOAD_FILE}"
    log "Scaling test workload to 5 replicas..."
    run_kubectl scale deployment inflate --replicas=5
    log "Watching nodes for 60 seconds (Ctrl-C to stop early)..."
    run_kubectl get nodes -w &
    WATCH_PID=$!
    sleep 60
    kill "${WATCH_PID}" >/dev/null 2>&1 || true
    wait "${WATCH_PID}" >/dev/null 2>&1 || true
  fi

  log "Karpenter post-install configuration complete"
}

function cmd_stop() {
  log "Verifying AWS identity..."
  if dry_run_guard "aws sts get-caller-identity --output json"; then
    CALLER_IDENTITY="$(run_aws sts get-caller-identity --output json)"
    echo "${CALLER_IDENTITY}"
    ACCOUNT_ID="$(echo "${CALLER_IDENTITY}" | grep -o '"Account"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)"
    [[ "${ACCOUNT_ID}" == "${EXPECTED_ACCOUNT_ID}" ]] || fail "Expected AWS account ${EXPECTED_ACCOUNT_ID}, got ${ACCOUNT_ID}"
    log "AWS identity verified for account ${ACCOUNT_ID} in region ${AWS_DEFAULT_REGION}"
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would check: eksctl get cluster --name ${CLUSTER_NAME} --region ${AWS_DEFAULT_REGION}"
    log "[DRY-RUN] Would delete EKS cluster '${CLUSTER_NAME}'..."
  else
    CLUSTER_EXISTS=false
    if run_eksctl get cluster --name "${CLUSTER_NAME}" --region "${AWS_DEFAULT_REGION}" >/dev/null 2>&1; then
      CLUSTER_EXISTS=true
    fi

    if [[ "${CLUSTER_EXISTS}" == "false" ]]; then
      log "Cluster '${CLUSTER_NAME}' does not exist; nothing to stop"
      exit 0
    fi
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would run: eksctl delete cluster --name ${CLUSTER_NAME} --region ${AWS_DEFAULT_REGION}"
  else
    log "Deleting EKS cluster '${CLUSTER_NAME}'..."
    START_TIME=$(date +%s)
    run_eksctl delete cluster --name "${CLUSTER_NAME}" --region "${AWS_DEFAULT_REGION}"
    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))
    MINUTES=$((ELAPSED / 60))
    SECONDS=$((ELAPSED % 60))
    log "Cluster deletion completed in ${MINUTES}m ${SECONDS}s"
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] Would run: kubectl config delete-context ${CLUSTER_NAME}"
  else
    run_kubectl config delete-context "${CLUSTER_NAME}" || true
    log "Removed kubeconfig context '${CLUSTER_NAME}'"
  fi

  log "Cleaning up orphaned resources for cluster '${CLUSTER_NAME}'..."

  # Classic ELBs
  log "Scanning for classic ELBs..."
  if dry_run_guard "aws elb describe-load-balancers"; then
    :
  else
    ELB_NAMES="$(run_aws elb describe-load-balancers --query 'LoadBalancerDescriptions[].LoadBalancerName' --output text 2>/dev/null || true)"
    if [[ -n "${ELB_NAMES:-}" ]]; then
      for elb in ${ELB_NAMES}; do
        TAGS="$(run_aws elb describe-tags --load-balancer-name "${elb}" --output json 2>/dev/null || true)"
        if echo "${TAGS}" | grep -q "kubernetes.io/cluster/${CLUSTER_NAME}"; then
          log "Deleting classic ELB: ${elb}"
          run_aws elb delete-load-balancer --load-balancer-name "${elb}" || true
        fi
      done
    fi
  fi

  # ELBv2 (ALB/NLB)
  log "Scanning for ELBv2 load balancers..."
  if dry_run_guard "aws elbv2 describe-load-balancers"; then
    :
  else
    ELBV2_ARNS="$(run_aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerArn' --output text 2>/dev/null || true)"
    if [[ -n "${ELBV2_ARNS:-}" ]]; then
      for arn in ${ELBV2_ARNS}; do
        TAGS="$(run_aws elbv2 describe-tags --resource-arns "${arn}" --output json 2>/dev/null || true)"
        if echo "${TAGS}" | grep -q "kubernetes.io/cluster/${CLUSTER_NAME}"; then
          log "Deleting ELBv2 load balancer: ${arn}"
          run_aws elbv2 delete-load-balancer --load-balancer-arn "${arn}" || true
        fi
      done
    fi
  fi

  # EBS volumes tagged for the cluster
  log "Scanning for orphaned EBS volumes..."
  if dry_run_guard "aws ec2 describe-volumes --filters Name=tag:kubernetes.io/cluster/${CLUSTER_NAME},Values=owned"; then
    :
  else
    VOLUMES="$(run_aws ec2 describe-volumes \
      --filters "Name=tag:kubernetes.io/cluster/${CLUSTER_NAME},Values=owned" \
      --query 'Volumes[].VolumeId' \
      --output text 2>/dev/null || true)"
    if [[ -n "${VOLUMES:-}" ]]; then
      for vol in ${VOLUMES}; do
        STATE="$(run_aws ec2 describe-volumes --volume-ids "${vol}" --query 'Volumes[0].State' --output text 2>/dev/null || true)"
        if [[ "${STATE}" == "available" ]]; then
          log "Deleting unattached EBS volume: ${vol}"
          run_aws ec2 delete-volume --volume-id "${vol}" || true
        fi
      done
    fi
  fi

  # IAM roles associated with the cluster
  log "Scanning for orphaned IAM roles..."
  if dry_run_guard "aws iam list-roles --path-prefix /"; then
    :
  else
    ROLE_NAMES="$(run_aws iam list-roles --path-prefix '/' --query 'Roles[].RoleName' --output text 2>/dev/null || true)"
    if [[ -n "${ROLE_NAMES:-}" ]]; then
      for role in ${ROLE_NAMES}; do
        if [[ "${role}" == eksctl-${CLUSTER_NAME}-* || "${role}" == eksctl-${CLUSTER_NAME}-nodegroup-* ]]; then
          log "Deleting IAM role: ${role}"
          if [[ "${DRY_RUN}" != "true" ]]; then
            ATTACHED_POLICIES="$(run_aws iam list-attached-role-policies --role-name "${role}" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null || true)"
            for policy in ${ATTACHED_POLICIES}; do
              run_aws iam detach-role-policy --role-name "${role}" --policy-arn "${policy}" || true
            done
            INLINE_POLICIES="$(run_aws iam list-role-policies --role-name "${role}" --query 'PolicyNames' --output text 2>/dev/null || true)"
            for policy in ${INLINE_POLICIES}; do
              run_aws iam delete-role-policy --role-name "${role}" --policy-name "${policy}" || true
            done
            PROFILES="$(run_aws iam list-instance-profiles-for-role --role-name "${role}" --query 'InstanceProfiles[].InstanceProfileName' --output text 2>/dev/null || true)"
            for profile in ${PROFILES}; do
              run_aws iam remove-role-from-instance-profile --instance-profile-name "${profile}" --role-name "${role}" || true
              run_aws iam delete-instance-profile --instance-profile-name "${profile}" || true
            done
            run_aws iam delete-role --role-name "${role}" || true
          fi
        fi
      done
    fi
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY-RUN] stop: would delete cluster '${CLUSTER_NAME}' and clean up ELBs, EBS volumes, and IAM roles"
  else
    log "Stop sequence complete"
  fi
}

SUBCOMMAND=""
DRY_RUN=false
KARPENTER_MODE=false
NEXT_ARG_IS_CRED_FILE=false
for arg in "$@"; do
  if [[ "${NEXT_ARG_IS_CRED_FILE}" == "true" ]]; then
    AWSKEY_FILE="${arg}"
    NEXT_ARG_IS_CRED_FILE=false
    continue
  fi
  case "${arg}" in
    start|stop)
      if [[ -n "${SUBCOMMAND}" ]]; then
        usage >&2
        fail "Only one subcommand (start or stop) may be specified"
      fi
      SUBCOMMAND="${arg}"
      ;;
    --karpenter)
      KARPENTER_MODE=true
      ;;
    --test-workload)
      RUN_TEST_WORKLOAD=true
      ;;
    --cred-file)
      NEXT_ARG_IS_CRED_FILE=true
      ;;
    --cred-file=*)
      AWSKEY_FILE="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    -*)
      usage >&2
      fail "Unknown option: ${arg}"
      ;;
    *)
      usage >&2
      fail "Unknown argument: ${arg}"
      ;;
  esac
done

if [[ "${NEXT_ARG_IS_CRED_FILE}" == "true" ]]; then
  usage >&2
  fail "--cred-file requires a value"
fi

if [[ "${KARPENTER_MODE}" == "true" ]]; then
  CLUSTER_CONFIG="${KARPENTER_CLUSTER_CONFIG}"
  CLUSTER_NAME="karpenter-lab"
  AWS_DEFAULT_REGION="eu-central-1"
else
  CLUSTER_CONFIG="${DEFAULT_CLUSTER_CONFIG}"
  CLUSTER_NAME="eks-08181-in"
  AWS_DEFAULT_REGION="us-west-2"
fi

[[ -f "${CLUSTER_CONFIG}" ]] || fail "Required file not found: ${CLUSTER_CONFIG}"

if [[ "${KARPENTER_MODE}" == "true" ]]; then
  [[ -f "${KARPENTER_NODECLASS_FILE}" ]] || fail "Required file not found: ${KARPENTER_NODECLASS_FILE}"
  [[ -f "${KARPENTER_NODEPOOL_FILE}" ]] || fail "Required file not found: ${KARPENTER_NODEPOOL_FILE}"
  [[ -f "${KARPENTER_STORAGECLASS_FILE}" ]] || fail "Required file not found: ${KARPENTER_STORAGECLASS_FILE}"
  if [[ "${RUN_TEST_WORKLOAD}" == "true" ]]; then
    [[ -f "${KARPENTER_TEST_WORKLOAD_FILE}" ]] || fail "Required file not found: ${KARPENTER_TEST_WORKLOAD_FILE}"
  fi
fi

load_credentials

if [[ -z "${SUBCOMMAND}" ]]; then
  usage >&2
  exit 1
fi

case "${SUBCOMMAND}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
esac
