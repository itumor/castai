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
#   2. If the AWS EBS CSI driver is installed, create a gp3 default class.
#   3. Otherwise, fall back to the in-tree kubernetes.io/aws-ebs provisioner
#      (available on every EKS cluster) by creating a gp2 default class.

set -euo pipefail

DEFAULT_SC=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)

if [ -n "${DEFAULT_SC}" ]; then
  echo "==> Default StorageClass already set: ${DEFAULT_SC}"
  exit 0
fi

echo "==> No default StorageClass found."

# Detect whether the AWS EBS CSI driver is installed. The controller runs in
# kube-system in modern EKS clusters; the driver daemonset runs on every node.
EBS_CSI=$(kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-ebs-csi-driver --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)

if [ -n "${EBS_CSI}" ]; then
  echo "==> EBS CSI driver detected; creating gp3 default StorageClass..."
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
else
  # EBS CSI driver is not installed. Most EKS clusters already ship a gp2
  # StorageClass using the in-tree provisioner. Annotate it as default instead
  # of creating a duplicate class.
  GP2_SC=$(kubectl get storageclass gp2 -o jsonpath='{.metadata.name}' 2>/dev/null || true)
  if [ -n "${GP2_SC}" ]; then
    echo "==> EBS CSI driver not detected; annotating existing gp2 StorageClass as default..."
    kubectl patch storageclass gp2 -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
  else
    echo "==> EBS CSI driver not detected and no gp2 StorageClass found; creating gp2 default StorageClass (in-tree provisioner)..."
    kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp2-default
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/aws-ebs
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
parameters:
  type: gp2
  encrypted: "true"
reclaimPolicy: Delete
EOF
  fi
fi

echo "==> Verifying default StorageClass..."
kubectl get storageclass
