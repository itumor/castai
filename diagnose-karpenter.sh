#!/usr/bin/env bash
# Collect Karpenter pod diagnostic information.
# Run in a shell authenticated to the karpenter-lab cluster.

set -euo pipefail

echo "==> Karpenter pod status"
kubectl get pods -n karpenter -o wide

echo ""
echo "==> Karpenter pod descriptions (events)"
for pod in $(kubectl get pods -n karpenter -o name); do
  echo "--- $pod ---"
  kubectl describe -n karpenter "$pod" | sed -n '/Events:/,$p'
done

echo ""
echo "==> Karpenter logs"
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter --tail=100 || true

echo ""
echo "==> Nodes and their taints"
kubectl get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints[*].key' | sed 's/<none>/none/'
