01-cluster: GET /v1/kubernetes/external-clusters/6d20eb8e-a1e5-4411-b4c8-5346ac3291b0 -> 200
02-nodes: GET .../nodes -> 200 (3 nodes, no pagination)
03-baseline: GET /reporting/v1beta/organizations/$ORG/clusters/6d20eb8e-a1e5-4411-b4c8-5346ac3291b0/baseline-params -> 200
04-was-summary: GET /v1/workload-autoscaling/clusters/6d20eb8e-a1e5-4411-b4c8-5346ac3291b0/workloads-summary -> 200
05-classic-savings: GET /v1/cost-reports/clusters/6d20eb8e-a1e5-4411-b4c8-5346ac3291b0/savings?startTime=2026-09-08T00:00:00Z&endTime=2026-10-08T00:00:00Z -> 200
06-value-realization: POST /reporting/v1beta/organizations/$ORG/clusters:runValueRealizationReport?startTime=2026-09-05T00:00:00Z&endTime=2026-10-05T00:00:00Z body={"clusterIds":[...]} -> 200 (read-semantics report query, approved this session)
07-was-metrics: GET /v1/workload-autoscaling/clusters/6d20eb8e-a1e5-4411-b4c8-5346ac3291b0/workloads-summary-metrics?startTime=2026-07-10T00:00:00Z&endTime=2026-10-08T00:00:00Z -> 200 (672 datapoints; returned window actually 2026-09-30..2026-10-07)
