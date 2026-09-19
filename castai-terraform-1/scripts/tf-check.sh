#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Format check"
terraform fmt -check -recursive

echo "==> Validate"
terraform validate

echo "==> Test"
terraform test

echo "==> Plan"
terraform plan -out=castai.tfplan

echo "Plan written to castai.tfplan. Review and run: terraform apply castai.tfplan"
