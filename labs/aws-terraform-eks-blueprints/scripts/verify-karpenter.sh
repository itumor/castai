#!/usr/bin/env bash
# Verifies that Karpenter-provisioned EC2 instances have registered as Kubernetes nodes.
# Usage: cd labs/aws-terraform-eks-blueprints && ./scripts/verify-karpenter.sh

set -euo pipefail

: "${CLUSTER_NAME:=$(terraform output -raw cluster_name 2>/dev/null || true)}"

if [[ -z "${CLUSTER_NAME:-}" ]]; then
  echo "ERROR: could not determine cluster name from terraform output"
  exit 1
fi

echo "Verifying Karpenter-provisioned nodes for cluster: ${CLUSTER_NAME}"

# Apply Karpenter manifests with envsubst for cluster-specific values
echo "Applying NodePool..."
kubectl apply -f k8s/karpenter-nodepool.yaml

echo "Applying EC2NodeClass (with envsubst)..."
export KARPENTER_NODE_INSTANCE_PROFILE_NAME=$(terraform output -raw karpenter_node_instance_profile_name)
envsubst < k8s/karpenter-nodeclass.yaml | kubectl apply -f -

echo "Applying inflate workload..."
kubectl apply -f k8s/inflate.yaml

echo "Scaling inflate to 10 replicas..."
kubectl scale deployment inflate --replicas=10

echo "Waiting for Karpenter to provision nodes..."
sleep 120

# Runtime assertion: at least one node labelled by the default NodePool must exist
echo "Checking for Karpenter-provisioned nodes..."
NODE_COUNT=$(kubectl get nodes -l karpenter.sh/nodepool=default -o json | jq '.items | length')

echo "Found ${NODE_COUNT} Karpenter-provisioned node(s)"

# Correlation assertion: list EC2 instances tagged by Karpenter and compare each
# InstanceId against the Kubernetes node .spec.providerID field.
REGION=$(terraform output -raw region 2>/dev/null || echo 'us-west-2')
EC2_IDS=$(aws ec2 describe-instances \
  --region "${REGION}" \
  --filters "Name=tag:karpenter.sh/nodepool,Values=default" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].InstanceId' \
  --output text 2>/dev/null || true)

NODE_PROVIDER_IDS=$(kubectl get nodes -l karpenter.sh/nodepool=default -o json | jq -r '.items[].spec.providerID // empty')

echo "EC2 InstanceIds tagged by Karpenter: ${EC2_IDS:-none}"
echo "Kubernetes node providerIDs: ${NODE_PROVIDER_IDS:-none}"

CORRELATED=0
for INSTANCE_ID in ${EC2_IDS}; do
  if echo "${NODE_PROVIDER_IDS}" | grep -q "${INSTANCE_ID}"; then
    echo "CORRELATED: EC2 ${INSTANCE_ID} maps to a Kubernetes node via providerID"
    CORRELATED=$((CORRELATED + 1))
  else
    echo "NOT YET REGISTERED: EC2 ${INSTANCE_ID} launched but not found in node providerID list"
  fi
done

if [[ "${NODE_COUNT}" -gt 0 && "${CORRELATED}" -gt 0 ]]; then
  echo "PASS: ${NODE_COUNT} Karpenter-provisioned node(s) registered and ${CORRELATED} EC2 InstanceId(s) correlate via providerID"
  exit 0
else
  echo "FAIL: node registration incomplete — ${NODE_COUNT} node(s) and ${CORRELATED} correlated instance(s)"
  echo "See docs/e2e-limitations.md for the observed node registration causes and remediation steps"
  exit 1
fi
