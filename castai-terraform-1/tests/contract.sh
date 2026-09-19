#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

required_files=(
  .gitignore
  README.md
  backend.hcl.example
  data.tf
  main.tf
  outputs.tf
  providers.tf
  terraform.tfvars.example
  variables.tf
  versions.tf
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "missing required file: $file" >&2
    exit 1
  fi
done

rg -F 'version = "14.6.1"' main.tf >/dev/null
rg -F 'version = "2.0.4"' main.tf >/dev/null
rg -F 'version = "~> 8.53"' versions.tf >/dev/null
rg -F 'backend "s3"' versions.tf >/dev/null

if rg -q 'castai_api_token' terraform.tfvars.example; then
  echo "terraform.tfvars.example must not contain CAST AI token input" >&2
  exit 1
fi

terraform fmt -check -recursive
terraform init -backend=false -input=false
terraform validate
terraform test -no-color
