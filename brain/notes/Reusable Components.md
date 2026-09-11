# Reusable Components

Quick reference for each major component in the workspace.

## castai-mcp-server

- Path: `castai-mcp-server/`
- Purpose: Local Node.js MCP server exposing read-only CAST AI tools.
- Security: read-only HTTP client, credential redaction, approval gate for
  writes.
- Test: `cd castai-mcp-server && npm test`
- Config: `castai-mcp-server/.env`
- Status: bound to default empty org; needs enterprise key + org allow-list
  to be useful for Siemens.

## Dashboard

- Path: `dashboard/`
- Purpose: Read-only web dashboard for Siemens CAST AI clusters.
- Stack: Express backend + vanilla JS frontend.
- Test: `cd dashboard && npm test`
- Config: `dashboard/.env`
- Note: currently configured for US region; should be EU for Siemens.

## Fleet inventory / readiness

- Path: `cluster-readiness-outputs/`
- Purpose: Enumerate all Siemens orgs/clusters; generate per-cluster
  readiness PDF/XLSX reports.
- Key scripts: `castai_cluster_inventory.py`, `run_readiness_lite.py`
- Input: `projects/castai-billing-export/.env`

## Billing export

- Path: `projects/castai-billing-export/`
- Purpose: Export enterprise billing usage across child orgs to CSV.
- Run: `./castai-billing-export.sh > billing.csv`
- Test: `./tests/run_tests.sh`

## Karpenter visualizer

- Path: `projects/karpenter-visualizer/`
- Purpose: Read-only web UI for Karpenter object graph.
- Stack: React + Vite frontend, Express backend.
- Test: `npm run test`

## Terraform modules

- Path: `terraform/modules/`
- Modules:
  - `castai-eks-readonly` — read-only observability install
  - `castai-eks-full` — full-mode onboarding with IAM resources
  - `castai-eks-platform` — platform-wide pattern
  - `castai-eks-organization` — org-level resources
- Caution: full module creates IAM roles/policies; requires human approval.

## Karpenter lab / production manifests

- Path: root + `karpenter-production/`
- Purpose: Repro environment and production-style manifests for Karpenter
  + CAST AI CLM testing.
- Key: `KARPENTER-CASTAI-CLM-LEARNINGS.md` lists gotchas and fixes.
