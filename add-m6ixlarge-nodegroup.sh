#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ACCOUNT="050451381948"
CLUSTER_NAME="eks-08181-in"
REGION="us-west-2"
NEW_NODEGROUP="ng-m6ixlarge"

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

# Copy required settings from existing node group
echo "Inspecting existing node group ng-2d5016ca..."
NODEGROUP_JSON=$(aws eks describe-nodegroup \
    --cluster-name "$CLUSTER_NAME" \
    --nodegroup-name ng-2d5016ca \
    --region "$REGION" \
    --output json)

NODE_ROLE=$(echo "$NODEGROUP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['nodegroup']['nodeRole'])")
SUBNETS=$(echo "$NODEGROUP_JSON" | python3 -c "import sys,json; print(','.join(json.load(sys.stdin)['nodegroup']['subnets']))")
AMI_TYPE=$(echo "$NODEGROUP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['nodegroup']['amiType'])")
CAPACITY_TYPE=$(echo "$NODEGROUP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['nodegroup']['capacityType'])")

echo "Creating new node group $NEW_NODEGROUP with 2x m6i.xlarge..."
aws eks create-nodegroup \
    --cluster-name "$CLUSTER_NAME" \
    --nodegroup-name "$NEW_NODEGROUP" \
    --node-role "$NODE_ROLE" \
    --subnets $(echo "$SUBNETS" | tr ',' ' ') \
    --instance-types m6i.xlarge \
    --ami-type "$AMI_TYPE" \
    --capacity-type "$CAPACITY_TYPE" \
    --scaling-config minSize=2,maxSize=4,desiredSize=2 \
    --region "$REGION"

echo "Node group creation started. Waiting for it to become ACTIVE (this may take 3-5 minutes)..."
while true; do
    STATUS=$(aws eks describe-nodegroup \
        --cluster-name "$CLUSTER_NAME" \
        --nodegroup-name "$NEW_NODEGROUP" \
        --region "$REGION" \
        --output json \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['nodegroup']['status'])")
    echo "  Status: $STATUS"
    if [[ "$STATUS" == "ACTIVE" ]]; then
        break
    fi
    sleep 15
done

echo ""
echo "Node group $NEW_NODEGROUP is ACTIVE."
echo "New nodes should appear shortly. Verify with: kubectl get nodes -w"
echo ""
echo "Next step (manual): once workloads migrate to the new m6i.xlarge nodes,"
echo "drain and remove the old ng-2d5016ca node group if desired:"
echo "  aws eks delete-nodegroup --cluster-name $CLUSTER_NAME --nodegroup-name ng-2d5016ca --region $REGION"
