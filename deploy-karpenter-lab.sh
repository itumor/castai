#!/usr/bin/env bash
#
# deploy-karpenter-lab.sh
#
# Idempotent one-shot deployment for the karpenter-lab EKS cluster plus
# Karpenter NodePool / EC2NodeClass resources.
#
# - Creates the cluster only if it does not already exist.
# - Applies the Karpenter NodeClass / NodePool (kubectl apply is idempotent).
# - Waits for at least one Karpenter pod to be ready.
# - Optionally deploys a test workload to trigger Karpenter scaling.
#
# Prerequisites:
#   - eksctl, kubectl, and AWS CLI installed
#   - Valid AWS credentials (env vars, ~/.aws/credentials, or SSO)
#   - This script run from the directory containing the YAML files
#
# Usage:
#   ./deploy-karpenter-lab.sh
#   ./deploy-karpenter-lab.sh --test-workload

set -euo pipefail

CLUSTER_NAME="karpenter-lab"
REGION="eu-central-1"
CLUSTER_CONFIG="eksctl-karpenter-cluster.yaml"
NODECLASS_FILE="karpenter-nodeclass.yaml"
NODEPOOL_FILE="karpenter-nodepool.yaml"
STORAGECLASS_FILE="storageclass-gp3-default.yaml"
ENSURE_STORAGECLASS_SCRIPT="ensure-default-storageclass.sh"
ENSURE_CLICKHOUSE_CRD_SCRIPT="ensure-clickhouse-crd.sh"
# CSI driver helpers for: aws-ebs-csi-driver, aws-efs-csi-driver, aws-mountpoint-s3-csi-driver
ENSURE_EBS_CSI_SCRIPT="scripts/ensure-ebs-csi-driver.sh"
ENSURE_EFS_CSI_SCRIPT="scripts/ensure-efs-csi-driver.sh"
ENSURE_S3_CSI_SCRIPT="scripts/ensure-s3-csi-driver.sh"
TEST_WORKLOAD_FILE="test-karpenter-workload.yaml"
RUN_TEST_WORKLOAD=false

# ---------------------------------------------------------------------------
# Parse arguments.
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --test-workload)
      RUN_TEST_WORKLOAD=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--test-workload]"
      echo "  --test-workload   Deploy a sample workload and watch Karpenter scale nodes."
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helper: check if the EKS cluster already exists.
# Tries a direct lookup first, then falls back to listing clusters in the
# region. Returns 0 if the cluster exists, 1 otherwise.
# ---------------------------------------------------------------------------
cluster_exists() {
  if eksctl get cluster --name="${CLUSTER_NAME}" --region="${REGION}" >/dev/null 2>&1; then
    return 0
  fi
  # Fallback for eksctl versions that do not support --name on get cluster.
  eksctl get cluster --region="${REGION}" 2>/dev/null \
    | awk 'NR>1 {print $1}' \
    | grep -qx "${CLUSTER_NAME}"
}

# ---------------------------------------------------------------------------
# 1. Create the EKS cluster with Karpenter installed by eksctl, or skip if
#    the cluster already exists.
# ---------------------------------------------------------------------------
if cluster_exists; then
  echo "==> Cluster '${CLUSTER_NAME}' already exists in ${REGION}; skipping creation."
  echo "==> Ensuring kubeconfig context is set..."
  eksctl utils write-kubeconfig --cluster="${CLUSTER_NAME}" --region="${REGION}"
else
  echo "==> Creating EKS cluster '${CLUSTER_NAME}' with Karpenter..."
  eksctl create cluster -f "${CLUSTER_CONFIG}"
fi

# ---------------------------------------------------------------------------
# 2. Wait for at least one Karpenter pod to be ready. With a single
#    system-ng node, only one replica can run, so we do not require all
#    replicas to be ready before continuing.
# ---------------------------------------------------------------------------
echo "==> Checking Karpenter pods in namespace 'karpenter'..."
WAIT_SECONDS=60
READY=0
for (( i=0; i<WAIT_SECONDS; i+=5 )); do
  READY=$(kubectl get pods -n karpenter \
    -l app.kubernetes.io/name=karpenter \
    --field-selector=status.phase=Running \
    -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' \
    2>/dev/null | grep -c "True" || true)
  if [ "${READY}" -ge 1 ]; then
    echo "==> At least one Karpenter pod is ready (${READY} ready)."
    break
  fi
  echo "    Waiting for at least one Karpenter pod to be ready... (${i}s)"
  sleep 5
done

if [ "${READY}" -lt 1 ]; then
  echo "[!] No Karpenter pods are ready yet. Continuing anyway; the NodeClass"
  echo "    and NodePool can be applied before Karpenter fully starts."
fi

echo "==> Current Karpenter pods:"
kubectl get pods -n karpenter

# ---------------------------------------------------------------------------
# 3. Ensure CSI drivers are installed. These are AWS-managed EKS addons
#    required by CAST AI PVCs (EBS), shared filesystem workloads (EFS),
#    and object-storage mounts (S3). Each helper is idempotent: a noop if
#    the addon is already ACTIVE. Must run before the StorageClass step so
#    the default StorageClass helper can prefer gp3 + EBS CSI.
# ---------------------------------------------------------------------------
echo "==> Ensuring EBS CSI driver is installed..."
if [ -x "${ENSURE_EBS_CSI_SCRIPT}" ]; then
  ./"${ENSURE_EBS_CSI_SCRIPT}"
else
  echo "[!] ${ENSURE_EBS_CSI_SCRIPT} not found or not executable; skipping EBS CSI driver install."
  echo "    PVCs backed by EBS may fail to provision on EKS 1.23+."
fi

echo "==> Ensuring EFS CSI driver is installed..."
if [ -x "${ENSURE_EFS_CSI_SCRIPT}" ]; then
  ./"${ENSURE_EFS_CSI_SCRIPT}"
else
  echo "[!] ${ENSURE_EFS_CSI_SCRIPT} not found or not executable; skipping EFS CSI driver install."
fi

echo "==> Ensuring S3 CSI driver is installed..."
if [ -x "${ENSURE_S3_CSI_SCRIPT}" ]; then
  ./"${ENSURE_S3_CSI_SCRIPT}"
else
  echo "[!] ${ENSURE_S3_CSI_SCRIPT} not found or not executable; skipping S3 CSI driver install."
fi

# ---------------------------------------------------------------------------
# 4. Ensure a default StorageClass exists (required by CAST AI PVCs).
#    The helper prefers gp3 + EBS CSI driver when available, otherwise falls
#    back to the gp2 in-tree provisioner present on every EKS cluster.
# ---------------------------------------------------------------------------
echo "==> Ensuring a default StorageClass exists..."
if [ -x "${ENSURE_STORAGECLASS_SCRIPT}" ]; then
  ./"${ENSURE_STORAGECLASS_SCRIPT}"
else
  echo "[!] ${ENSURE_STORAGECLASS_SCRIPT} not found or not executable; falling back to static apply."
  kubectl apply -f "${STORAGECLASS_FILE}"
fi

# ---------------------------------------------------------------------------
# 5. Ensure the ClickHouseInstallation CRD is installed. CAST AI needs this
#    CRD for its ClickHouse PVC; pre-installing it avoids GitHub HTTP 429
#    rate limits hit when castctl fetches it at runtime.
# ---------------------------------------------------------------------------
echo "==> Ensuring ClickHouseInstallation CRD exists..."
if [ -x "${ENSURE_CLICKHOUSE_CRD_SCRIPT}" ]; then
  ./"${ENSURE_CLICKHOUSE_CRD_SCRIPT}"
else
  echo "[!] ${ENSURE_CLICKHOUSE_CRD_SCRIPT} not found or not executable; skipping CRD pre-install."
  echo "    castctl may fail with HTTP 429 when it tries to fetch the CRD."
fi

# ---------------------------------------------------------------------------
# 6. Apply EC2NodeClass and NodePool (idempotent).
# ---------------------------------------------------------------------------
echo "==> Applying EC2NodeClass..."
kubectl apply -f "${NODECLASS_FILE}"

echo "==> Applying NodePool..."
kubectl apply -f "${NODEPOOL_FILE}"

# ---------------------------------------------------------------------------
# 7. Confirm resources exist and are ready.
# ---------------------------------------------------------------------------
echo "==> Verifying Karpenter resources..."
kubectl get ec2nodeclass
kubectl get nodepool

echo "==> Karpenter pods:"
kubectl get pods -n karpenter

# ---------------------------------------------------------------------------
# 8. Optionally deploy a test workload and watch Karpenter scale nodes.
# ---------------------------------------------------------------------------
if [ "${RUN_TEST_WORKLOAD}" = true ]; then
  echo ""
  echo "==> Deploying test workload to trigger Karpenter scaling..."
  kubectl apply -f "${TEST_WORKLOAD_FILE}"
  echo "==> Scaling test workload to 5 replicas..."
  kubectl scale deployment inflate --replicas=5
  echo "==> Watching nodes for 60 seconds (Ctrl-C to stop early)..."
  # macOS does not ship the 'timeout' command by default, so run the watch
  # in the background and terminate it after 60 seconds.
  kubectl get nodes -w &
  WATCH_PID=$!
  sleep 60
  kill "${WATCH_PID}" >/dev/null 2>&1 || true
  wait "${WATCH_PID}" >/dev/null 2>&1 || true
else
  echo ""
  echo "==> Deployment complete. Cluster '${CLUSTER_NAME}' is ready."
  echo ""
  echo "To test Karpenter scaling, run:"
  echo "  ./deploy-karpenter-lab.sh --test-workload"
  echo ""
  echo "To delete the cluster and all resources:"
  echo "  eksctl delete cluster --region ${REGION} --name ${CLUSTER_NAME}"
fi
