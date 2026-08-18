#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for at least one ready node..."
until kubectl get nodes 2>/dev/null | grep -q "Ready"; do
    sleep 5
done

echo "Applying sample-app deployment..."
kubectl apply -f sample-app-deployment.yaml

echo ""
echo "Waiting for rollout to complete..."
kubectl rollout status deployment/sample-app --timeout=120s

echo ""
echo "Sample app deployed. Check status with:"
echo "  kubectl get pods -l app=sample"
