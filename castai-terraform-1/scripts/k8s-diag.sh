#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${1:-castai-agent}"

echo "==> Pods in ${NAMESPACE}"
kubectl get pods -n "${NAMESPACE}" -o wide

echo "==> Recent events"
kubectl get events -n "${NAMESPACE}" --sort-by='.lastTimestamp' | tail -20

echo "==> Agent logs"
kubectl logs -n "${NAMESPACE}" deployment/castai-agent --tail=100 || true

echo "==> Cluster autoscaler logs"
kubectl logs -n "${NAMESPACE}" deployment/castai-cluster-controller --tail=100 || true

echo "==> Evictor logs"
kubectl logs -n "${NAMESPACE}" deployment/castai-evictor --tail=100 || true
