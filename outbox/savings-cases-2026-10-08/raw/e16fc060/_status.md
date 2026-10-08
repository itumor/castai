# API call statuses — cluster cloudcore01 (e16fc060-803a-47e2-985e-f0c15058a6c9), org IT IPS (c67df1a0-06e0-46f9-a84e-27c14958d564)
Collected 2026-10-08 (Europe/Riga). All calls sent X-API-Key + X-CastAI-Organization-Id. Read-only session.

| # | Call | Status | File | Note |
|---|------|--------|------|------|
| 01 | GET /v1/kubernetes/external-clusters/{cid} | 200 | 01-cluster.json | status=ready, eks eu-central-1, agent online |
| 02 | GET .../nodes | 200 | 02-nodes.json | 7 nodes, 0 with provisioner.cast.ai/managed-by label |
| 03 | GET /reporting/v1beta/organizations/{org}/clusters/{cid}/baseline-params | 404 | 03-baseline.json | nginx 404 Not Found (route absent) |
| 04 | GET /v1/workload-autoscaling/clusters/{cid}/workloads-summary | 400 | 04-was-summary.json | workload-autoscaler not installed |
| 05 | GET /v1/cost-reports/clusters/{cid}/savings 2026-09-08..2026-10-08 | 400 | 05-classic-savings.json | API not available: cluster is read-only |
| 06 | POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport 2026-09-05..2026-10-05 | 200 | 06-value-realization.json | items=[] (empty; no report rows) |
| 07 | GET .../workloads-summary-metrics 2026-07-10..2026-10-08 | 400 | 07-was-metrics.json | WAS not installed; retry with from/to (=07-was-metrics-from-to.json) also 400 |
