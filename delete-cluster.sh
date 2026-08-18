#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ACCOUNT="050451381948"

# Load credentials
if [[ -f awskey.env ]]; then
    # shellcheck source=/dev/null
    source awskey.env
else
    echo "Error: awskey.env not found in current directory" >&2
    exit 1
fi

# Verify AWS account before deleting anything
echo "Verifying AWS account..."
IDENTITY=$(aws sts get-caller-identity --output json)
ACCOUNT=$(python3 -c "import sys, json; print(json.load(sys.stdin)['Account'])" <<< "$IDENTITY")

if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
    echo "Error: expected account $EXPECTED_ACCOUNT, but got $ACCOUNT" >&2
    exit 1
fi

echo "OK: using expected account $EXPECTED_ACCOUNT"

echo "Deleting EKS cluster eks-08181-in..."
eksctl delete cluster --name eks-08181-in --region us-west-2 --wait

echo "Cluster deletion complete."
