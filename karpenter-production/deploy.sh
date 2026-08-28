#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# deploy.sh - Install/upgrade Karpenter v1.14.1 on karpenter-lab and apply
# the production manifests under karpenter-production/.
#
# This script does NOT modify the existing managed `system-ng` node group.
# ----------------------------------------------------------------------------

set -euo pipefail

# ----------------------------------------------------------------------------
# 0. Resolve script-relative paths.
# ----------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"
VALUES_SRC="${SCRIPT_DIR}/values.yaml"
MANIFESTS_SRC="${SCRIPT_DIR}/manifests.yaml"
VALUES_RENDERED="${SCRIPT_DIR}/values.rendered.yaml"
MANIFESTS_RENDERED="${SCRIPT_DIR}/manifests.rendered.yaml"
AWSKEY_FILE="${REPO_ROOT}/awskey.env"

# ----------------------------------------------------------------------------
# 1. Source AWS credentials from awskey.env if not already set.
# ----------------------------------------------------------------------------
if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  if [[ -f "${AWSKEY_FILE}" ]]; then
    echo "[deploy] Sourcing AWS credentials from ${AWSKEY_FILE}"
    # shellcheck disable=SC1090
    source "${AWSKEY_FILE}"
  else
    echo "[deploy] ERROR: AWS credentials not set and ${AWSKEY_FILE} not found." >&2
    exit 1
  fi
else
  echo "[deploy] Using pre-existing AWS_ACCESS_KEY_ID from environment."
fi

# AWS_REGION from awskey.env takes precedence; otherwise use our default.
export AWS_REGION="${AWS_REGION:-eu-central-1}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

# ----------------------------------------------------------------------------
# 2. Fixed target values.
# ----------------------------------------------------------------------------
export CLUSTER_NAME="${CLUSTER_NAME:-karpenter-lab}"
export KARPENTER_VERSION="${KARPENTER_VERSION:-1.14.1}"
export KARPENTER_NAMESPACE="${KARPENTER_NAMESPACE:-karpenter}"
export HELM_RELEASE_NAME="${HELM_RELEASE_NAME:-karpenter}"
export HELM_CHART="oci://public.ecr.aws/karpenter/karpenter"

echo "[deploy] Cluster:        ${CLUSTER_NAME}"
echo "[deploy] Region:         ${AWS_REGION}"
echo "[deploy] Karpenter ver:  ${KARPENTER_VERSION}"
echo "[deploy] Namespace:      ${KARPENTER_NAMESPACE}"

# ----------------------------------------------------------------------------
# 3. Discover Karpenter controller IRSA role ARN.
#    Look for `eksctl-<cluster>-karpenter-controller-role` (eksctl default),
#    then fall back to any role whose name contains `karpenter-controller`.
# ----------------------------------------------------------------------------
echo "[deploy] Discovering Karpenter controller IAM role ARN..."
KARPENTER_CONTROLLER_ROLE_ARN="${KARPENTER_CONTROLLER_ROLE_ARN:-}"

if [[ -z "${KARPENTER_CONTROLLER_ROLE_ARN}" ]]; then
  PRIMARY_NAME="eksctl-${CLUSTER_NAME}-karpenter-controller-role"
  PRIMARY_ARN="$(aws iam get-role \
      --region "${AWS_REGION}" \
      --role-name "${PRIMARY_NAME}" \
      --query 'Role.Arn' --output text 2>/dev/null || true)"

  if [[ -n "${PRIMARY_ARN}" && "${PRIMARY_ARN}" != "None" ]]; then
    KARPENTER_CONTROLLER_ROLE_ARN="${PRIMARY_ARN}"
    echo "[deploy] Found controller role via primary convention: ${KARPENTER_CONTROLLER_ROLE_ARN}"
  else
    echo "[deploy] Primary naming convention failed; falling back to name contains 'karpenter-controller'."
    FALLBACK_ARN="$(aws iam list-roles \
        --region "${AWS_REGION}" \
        --query "Roles[?contains(RoleName, 'karpenter-controller')].Arn | [0]" \
        --output text 2>/dev/null || true)"
    if [[ -n "${FALLBACK_ARN}" && "${FALLBACK_ARN}" != "None" ]]; then
      KARPENTER_CONTROLLER_ROLE_ARN="${FALLBACK_ARN}"
      echo "[deploy] Found controller role via fallback search: ${KARPENTER_CONTROLLER_ROLE_ARN}"
    fi
  fi
fi

if [[ -z "${KARPENTER_CONTROLLER_ROLE_ARN}" || "${KARPENTER_CONTROLLER_ROLE_ARN}" == "None" ]]; then
  echo "[deploy] ERROR: could not discover Karpenter controller role ARN." >&2
  echo "Set KARPENTER_CONTROLLER_ROLE_ARN manually and re-run." >&2
  exit 1
fi

export KARPENTER_CONTROLLER_ROLE_ARN

# ----------------------------------------------------------------------------
# 4. Discover Spot interruption SQS queue name.
# ----------------------------------------------------------------------------
echo "[deploy] Discovering Spot interruption SQS queue name..."
INTERRUPTION_QUEUE="${INTERRUPTION_QUEUE:-}"

if [[ -z "${INTERRUPTION_QUEUE}" ]]; then
  QUEUE_URLS="$(aws sqs list-queues \
      --region "${AWS_REGION}" \
      --query 'QueueUrls[]' --output text 2>/dev/null || true)"

  MATCHING_URL="$(printf '%s\n' ${QUEUE_URLS} \
      | grep -i "${CLUSTER_NAME}" \
      | head -n1 || true)"

  if [[ -n "${MATCHING_URL}" ]]; then
    # Last path component is the queue name.
    INTERRUPTION_QUEUE="$(basename "${MATCHING_URL}")"
    echo "[deploy] Found Spot interruption queue: ${INTERRUPTION_QUEUE}"
  else
    # Last-ditch: any queue whose name contains 'karpenter'.
    MATCHING_URL="$(printf '%s\n' ${QUEUE_URLS} \
        | grep -i 'karpenter' \
        | head -n1 || true)"
    if [[ -n "${MATCHING_URL}" ]]; then
      INTERRUPTION_QUEUE="$(basename "${MATCHING_URL}")"
      echo "[deploy] Found Spot interruption queue via generic match: ${INTERRUPTION_QUEUE}"
    fi
  fi
fi

if [[ -z "${INTERRUPTION_QUEUE}" ]]; then
  echo "[deploy] WARNING: could not discover interruption queue; Karpenter will run without SQS-based interruption handling." >&2
  INTERRUPTION_QUEUE=""
fi

export INTERRUPTION_QUEUE

# ----------------------------------------------------------------------------
# 5. Discover current recommended AL2023 AMI version.
#    Try SSM parameter first (preferred), then EC2 describe-images.
# ----------------------------------------------------------------------------
echo "[deploy] Discovering recommended AL2023 EKS-optimized AMI version..."
AL2023_AMI_VERSION="${AL2023_AMI_VERSION:-}"

if [[ -z "${AL2023_AMI_VERSION}" ]]; then
  SSM_PARAM="/aws/service/eks/optimized-ami/${KARPENTER_VERSION}/amazon-linux-2023/x86_64/standard/recommended/image_id"
  SSM_AMI_ID="$(aws ssm get-parameter \
      --region "${AWS_REGION}" \
      --name "${SSM_PARAM}" \
      --query 'Parameter.Value' --output text 2>/dev/null || true)"
  if [[ -n "${SSM_AMI_ID}" && "${SSM_AMI_ID}" != "None" ]]; then
    AL2023_AMI_ID="${SSM_AMI_ID}"
    echo "[deploy] SSM recommended AMI ID: ${AL2023_AMI_ID}"
  else
    # Fallback: pick the newest amazon-linux-2023 EKS image from EC2.
    EC2_AMI_ID="$(aws ec2 describe-images \
        --region "${AWS_REGION}" \
        --owners amazon \
        --filters \
          "Name=name,Values=amazon-eks-node-al2023-x86_64-standard-*" \
          "Name=state,Values=available" \
        --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
        --output text 2>/dev/null || true)"
    if [[ -n "${EC2_AMI_ID}" && "${EC2_AMI_ID}" != "None" ]]; then
      AL2023_AMI_ID="${EC2_AMI_ID}"
      echo "[deploy] EC2 fallback AMI ID: ${AL2023_AMI_ID}"
    fi
  fi

  if [[ -n "${AL2023_AMI_ID:-}" ]]; then
    # Derive a Karpenter-friendly AMI name pattern (al2023-ami-karpenter-v...)
    # by looking up the image's Name tag.
    AMI_NAME="$(aws ec2 describe-images \
        --region "${AWS_REGION}" \
        --image-ids "${AL2023_AMI_ID}" \
        --query 'Images[0].Name' --output text 2>/dev/null || true)"
    if [[ -n "${AMI_NAME}" && "${AMI_NAME}" != "None" ]]; then
      # Extract a vYYYYMMDD-style version from the image name if present.
      VERSION_SUFFIX="$(printf '%s' "${AMI_NAME}" \
          | grep -oE 'v[0-9]{8,}' \
          | head -n1 || true)"
      if [[ -n "${VERSION_SUFFIX}" ]]; then
        AL2023_AMI_VERSION="${VERSION_SUFFIX}"
      else
        # Fallback: use the AMI ID itself as the selector suffix.
        AL2023_AMI_VERSION="${AL2023_AMI_ID}"
      fi
      echo "[deploy] Pinned AL2023 AMI version: ${AL2023_AMI_VERSION}"
    fi
  fi
fi

if [[ -z "${AL2023_AMI_VERSION}" ]]; then
  echo "[deploy] WARNING: could not discover AL2023 AMI version; defaulting to @latest selector is NOT allowed, aborting." >&2
  exit 1
fi

export AL2023_AMI_VERSION

# ----------------------------------------------------------------------------
# 6. Render values.yaml and manifests.yaml with envsubst.
# ----------------------------------------------------------------------------
command -v envsubst >/dev/null 2>&1 || {
  echo "[deploy] ERROR: envsubst is required (apt: gettext-base / brew: gettext)." >&2
  exit 1;
}

echo "[deploy] Rendering values.yaml and manifests.yaml with envsubst..."
envsubst < "${VALUES_SRC}" > "${VALUES_RENDERED}"
envsubst < "${MANIFESTS_SRC}" > "${MANIFESTS_RENDERED}"

# Sanity: confirm critical substitutions landed.
grep -q "${KARPENTER_VERSION}" "${VALUES_RENDERED}" || {
  echo "[deploy] ERROR: KARPENTER_VERSION did not render in values.yaml." >&2; exit 1; }
grep -q "${CLUSTER_NAME}" "${MANIFESTS_RENDERED}" || {
  echo "[deploy] ERROR: CLUSTER_NAME did not render in manifests.yaml." >&2; exit 1; }
grep -q "${AL2023_AMI_VERSION}" "${MANIFESTS_RENDERED}" || {
  echo "[deploy] ERROR: AL2023_AMI_VERSION did not render in manifests.yaml." >&2; exit 1; }

# ----------------------------------------------------------------------------
# 7. Update kubeconfig and install/upgrade Karpenter via Helm.
# ----------------------------------------------------------------------------
echo "[deploy] Updating kubeconfig for ${CLUSTER_NAME}..."
aws eks update-kubeconfig \
  --region "${AWS_REGION}" \
  --name "${CLUSTER_NAME}" >/dev/null

echo "[deploy] Ensuring namespace ${KARPENTER_NAMESPACE} exists..."
kubectl get namespace "${KARPENTER_NAMESPACE}" >/dev/null 2>&1 || \
  kubectl create namespace "${KARPENTER_NAMESPACE}"

command -v helm >/dev/null 2>&1 || {
  echo "[deploy] ERROR: helm is required." >&2; exit 1; }

echo "[deploy] helm upgrade --install ${HELM_RELEASE_NAME} ${HELM_CHART} ..."
helm upgrade --install "${HELM_RELEASE_NAME}" "${HELM_CHART}" \
  --namespace "${KARPENTER_NAMESPACE}" \
  --version "${KARPENTER_VERSION}" \
  --wait \
  --values "${VALUES_RENDERED}"

# ----------------------------------------------------------------------------
# 8. Apply the rendered manifests (EC2NodeClass, NodePools, workloads).
# ----------------------------------------------------------------------------
echo "[deploy] Applying rendered manifests.yaml..."
kubectl apply -f "${MANIFESTS_RENDERED}"

# ----------------------------------------------------------------------------
# 9. Wait for Karpenter controller pods to be Ready and for NodePools/
#    EC2NodeClass to exist.
# ----------------------------------------------------------------------------
echo "[deploy] Waiting for Karpenter controller pods to be Ready..."
kubectl wait --for=condition=Ready \
  pods -l app.kubernetes.io/name=karpenter \
  -n "${KARPENTER_NAMESPACE}" \
  --timeout=300s

echo "[deploy] Waiting for NodePool/general to exist..."
kubectl wait --for=jsonpath='.metadata.name'='general' \
  nodepool.karpenter.sh/general --timeout=120s

echo "[deploy] Waiting for NodePool/critical-on-demand to exist..."
kubectl wait --for=jsonpath='.metadata.name'='critical-on-demand' \
  nodepool.karpenter.sh/critical-on-demand --timeout=120s

echo "[deploy] Waiting for EC2NodeClass/general to exist..."
kubectl wait --for=jsonpath='.metadata.name'='general' \
  ec2nodeclass.karpenter.k8s.aws/general --timeout=120s

echo "[deploy] Karpenter installation complete."
echo "[deploy] Next: run ./test.sh to validate end-to-end."
