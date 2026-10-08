# 4952c4ce k8s — API call statuses (2026-10-08)
- 01-cluster.json GET /v1/kubernetes/external-clusters/{cid} -> 200
- 02-nodes.json GET /v1/kubernetes/external-clusters/{cid}/nodes -> 200
- 03-baseline.json GET /reporting/v1beta/organizations/{org}/clusters/{cid}/baseline-params -> 404 (nginx; endpoint not found)
- 04-was-summary.json GET /v1/workload-autoscaling/clusters/{cid}/workloads-summary -> 200
- 05-classic-savings.json GET /v1/cost-reports/clusters/{cid}/savings -> 400 "cluster is read-only" (expected)
- 06-value-realization.json POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport -> 200
- 07-was-metrics.json GET /v1/workload-autoscaling/clusters/{cid}/workloads-summary-metrics -> 200 (672 buckets, 2026-09-30→2026-10-07 only)
