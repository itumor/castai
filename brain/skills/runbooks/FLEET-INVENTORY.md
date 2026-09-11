# Runbook: Refresh Siemens CAST AI fleet inventory

Use to rebuild the Excel inventory of all Siemens CAST AI organizations and
clusters.

## Preconditions

- Enterprise API key is present in
  `projects/castai-billing-export/.env`.
- Python dependencies `requests`, `pandas`, `openpyxl` are installed.

## Steps

```bash
cd /Users/eramadan/castai/cluster-readiness-outputs
python3 castai_cluster_inventory.py
```

This writes:
- `castai_cluster_inventory.xlsx` — clusters, organizations, errors sheets.

## What the columns mean

- `is_phase2` / `is_autoscaler` — true means Node Autoscaler + Workload
  Autoscaler installed.
- `is_readonly` — true means monitoring/Spot handler only.
- `agent_status` — `online`, `disconnected`, `waiting-connection`,
  `non-responding`.
- `derived_status` — convenience rollup.

## After refresh

1. Summarize: total clusters, phase2 vs readonly, top orgs by count,
   agent-status counts.
2. Update `brain/notes/[[Siemens Fleet]]` with the new numbers.
3. If running readiness reports, use the inventory as input to
   `run_readiness_lite.py`.

## Safety

- Read-only API calls only.
- Do not commit the `.xlsx` if it contains customer-identifying data you
  don't want in git; current repo keeps it.
