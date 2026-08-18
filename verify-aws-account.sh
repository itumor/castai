#!/usr/bin/env bash
set -euo pipefail

# Load credentials from local env file
if [[ -f awskey.env ]]; then
    # shellcheck source=/dev/null
    source awskey.env
else
    echo "Error: awskey.env not found in current directory" >&2
    exit 1
fi

EXPECTED_ACCOUNT="050451381948"

echo "Checking AWS caller identity..."
IDENTITY=$(aws sts get-caller-identity --output json)
ACCOUNT=$(python3 -c "import sys, json; print(json.load(sys.stdin)['Account'])" <<< "$IDENTITY")

echo "Authenticated account: $ACCOUNT"

if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
    echo "Error: expected account $EXPECTED_ACCOUNT, but got $ACCOUNT" >&2
    exit 1
fi

echo "OK: using expected account $EXPECTED_ACCOUNT"
echo "$IDENTITY"
