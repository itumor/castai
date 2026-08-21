#!/usr/bin/env bash
#
# ensure-default-storageclass.sh
#
# Idempotently ensures the current cluster has a default StorageClass.
# Required by CAST AI components that provision PVCs (e.g. ClickHouse).
#
# Usage:
#   ./ensure-default-storageclass.sh
#
# Logic:
#   1. If a default StorageClass already exists, do nothing.
#   2. Ensure the AWS EBS CSI driver is installed (fails fast if not).
#   3. Create a gp3 default class backed by ebs.csi.aws.com.
#
# Note: on EKS 1.23+ the in-tree kubernetes.io/aws-ebs provisioner is
# redirected to ebs.csi.aws.com via CSIMigrationAWS, so creating a gp2
# class without the driver installed would silently produce stuck PVCs.
# We always require the driver and create a gp3 default class.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EBS_CSI_SCRIPT="${SCRIPT_DIR}/scripts/ensure-ebs-csi-driver.sh"

DEFAULT_SC=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)

if [ -n "${DEFAULT_SC}" ]; then
  echo "==> Default StorageClass already set: ${DEFAULT_SC}"
  exit 0
fi

echo "==> No default StorageClass found."

# The AWS EBS CSI driver is required for PVCs to bind on EKS 1.23+.
# Install it (idempotently) before creating the default StorageClass.
echo "==> Ensuring AWS EBS CSI driver is installed..."
"${EBS_CSI_SCRIPT}"

echo "==> Creating gp3 default StorageClass..."
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3-default
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
parameters:
  type: gp3
  encrypted: "true"
reclaimPolicy: Delete
EOF

echo "==> Verifying default StorageClass..."
kubectl get storageclass
