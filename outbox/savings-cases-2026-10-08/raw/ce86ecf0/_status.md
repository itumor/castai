# bx-edex-prod-eu (ce86ecf0) raw pull 2026-10-08 — all calls sent X-API-Key + X-CastAI-Organization-Id
01 GET /v1/kubernetes/external-clusters/ce86ecf0-1c17-4d02-936b-dd239411ea0a -> 200 -> 01-cluster.json
02 GET /v1/kubernetes/external-clusters/ce86ecf0-1c17-4d02-936b-dd239411ea0a/nodes -> 200 -> 02-nodes.json
03 GET /reporting/v1beta/organizations/c67df1a0-06e0-46f9-a84e-27c14958d564/clusters/ce86ecf0-1c17-4d02-936b-dd239411ea0a/baseline-params -> 404 -> 03-baseline.json
04 GET /v1/workload-autoscaling/clusters/ce86ecf0-1c17-4d02-936b-dd239411ea0a/workloads-summary -> 400 -> 04-was-summary.json
05 GET /v1/cost-reports/clusters/ce86ecf0-1c17-4d02-936b-dd239411ea0a/savings?startTime=2026-09-08&endTime=2026-10-08 -> 400 -> 05-classic-savings.json
06 POST /reporting/v1beta/organizations/c67df1a0-06e0-46f9-a84e-27c14958d564/clusters:runValueRealizationReport (clusterIds body; approved read-semantics report) -> 200 -> 06-value-realization.json
07 GET /v1/workload-autoscaling/clusters/ce86ecf0-1c17-4d02-936b-dd239411ea0a/workloads-summary-metrics 2026-07-10..2026-10-08 -> 400->400 -> 07-was-metrics.json
