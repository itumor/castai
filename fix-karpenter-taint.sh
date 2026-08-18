#!/usr/bin/env bash
# Remove the CriticalAddonsOnly taint from system-ng nodes so Karpenter pods
# can schedule. Run in a shell authenticated to the karpenter-lab cluster.

set -euo pipefail

echo "==> Current taints on system-ng nodes:"
kubectl get nodes -l alpha.eksctl.io/nodegroup-name=system-ng -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.taints}{"\n"}{end}'

echo ""
echo "==> Removing CriticalAddonsOnly taint from system-ng nodes..."
kubectl taint nodes -l alpha.eksctl.io/nodegroup-name=system-ng CriticalAddonsOnly:NoSchedule-

echo ""
echo "==> Wait a few seconds, then check Karpenter pods:"
echo "  kubectl get pods -n karpenter -w"
