# API call statuses — clo-master-eks (9cabe4ee-c3cb-4877-a6e6-a464b3dd388a), org SI GSW CLO (collected 2026-10-08)

- 01-cluster.json: GET /v1/kubernetes/external-clusters/{id} -> **200** (status=ready, eks, eu-central-1, agentStatus=online)
- 02-nodes.json: GET /v1/kubernetes/external-clusters/{id}/nodes -> **200** (2 nodes, both EKS managed-nodegroup m7a.2xlarge ON_DEMAND, zero cast.ai/karpenter labels)
- 03-baseline.json: GET /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params -> **404** (nginx 404 Not Found — endpoint/path not available for this cluster)
- 04-was-summary.json: GET /v1/workload-autoscaling/clusters/{id}/workloads-summary -> **400** ("castai-workload-autoscaler should be installed to enable workload optimization")
- 05-classic-savings.json: GET /v1/cost-reports/clusters/{id}/savings?startTime=2026-09-08&endTime=2026-10-08 -> **400** ("this API is not available for cluster ...: cluster is read-only")
- 06-value-realization.json: POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport (2026-09-05..2026-10-05, body {"clusterIds":[...]}) -> **200** but `items: []` (empty report, no data for this cluster)
- 07-was-metrics.json: GET .../workloads-summary-metrics (startTime/endTime) -> **400**; retried with ?from=&to= -> **400** (same "workload-autoscaler should be installed" message)
