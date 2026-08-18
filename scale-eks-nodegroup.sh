#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ACCOUNT="050451381948"
CLUSTER_NAME="eks-08181-in"
REGION="us-west-2"

# Load credentials
if [[ -f awskey.env ]]; then
    # shellcheck source=/dev/null
    source awskey.env
else
    echo "Error: awskey.env not found in current directory" >&2
    exit 1
fi

# Verify AWS account before making changes
echo "Verifying AWS account..."
IDENTITY=$(aws sts get-caller-identity --output json)
ACCOUNT=$(python3 -c "import sys, json; print(json.load(sys.stdin)['Account'])" <<< "$IDENTITY")

if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
    echo "Error: expected account $EXPECTED_ACCOUNT, but got $ACCOUNT" >&2
    exit 1
fi

echo "OK: using expected account $EXPECTED_ACCOUNT"

# Discover node group name
NODEGROUP=$(aws eks list-nodegroups --cluster-name "$CLUSTER_NAME" --region "$REGION" --query 'nodegroups[0]' --output text)
echo "Scaling EKS node group: $NODEGROUP"

# Scale up to make room for the pending exporter pod
aws eks update-nodegroup-config \
    --cluster-name "$CLUSTER_NAME" \
    --nodegroup-name "$NODEGROUP" \
    --scaling-config minSize=3,maxSize=6,desiredSize=4 \
    --region "$REGION"

echo "Scale-up initiated. Watch nodes with: kubectl get nodes -w"
