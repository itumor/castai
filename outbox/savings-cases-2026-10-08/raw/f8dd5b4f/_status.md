01-cluster.json GET /v1/kubernetes/external-clusters/f8dd5b4f-3cf4-48e2-b453-7be4562e36cb -> HTTP 200
02-nodes.json GET /v1/kubernetes/external-clusters/f8dd5b4f-3cf4-48e2-b453-7be4562e36cb/nodes -> HTTP 200
03-baseline.json GET /reporting/v1beta/organizations/f15f33b9-20ad-4128-8289-da529844d3f0/clusters/f8dd5b4f-3cf4-48e2-b453-7be4562e36cb/baseline-params -> HTTP 404
04-was-summary.json GET /v1/workload-autoscaling/clusters/f8dd5b4f-3cf4-48e2-b453-7be4562e36cb/workloads-summary -> HTTP 200
05-classic-savings.json GET /v1/cost-reports/clusters/f8dd5b4f-3cf4-48e2-b453-7be4562e36cb/savings?startTime=2026-09-08T00:00:00Z&endTime=2026-10-08T00:00:00Z -> HTTP 400
06-value-realization.json POST /reporting/v1beta/organizations/f15f33b9-20ad-4128-8289-da529844d3f0/clusters:runValueRealizationReport -> HTTP 200
07-was-metrics.json GET /v1/workload-autoscaling/clusters/f8dd5b4f-3cf4-48e2-b453-7be4562e36cb/workloads-summary-metrics -> HTTP 200
