# API call status — cluster d03690cb (k8s-andreas), org SMO Railigent X — 2026-10-08
- 01-cluster.json          : 200 GET /v1/kubernetes/external-clusters/d03690cb...aba7
- 02-nodes.json            : 200 GET .../nodes (14 nodes)
- 03-baseline.json         : 200 GET reporting/v1beta .../baseline-params
- 04-was-summary.json      : 200 GET /v1/workload-autoscaling .../workloads-summary
- 05-classic-savings.json  : 400 GET /v1/cost-reports .../savings — "this API is not available for cluster: cluster is read-only"
- 06-value-realization.json: 200 POST reporting/v1beta .../clusters:runValueRealizationReport (approved POST, first body {"clusterIds":[...]} accepted, no retry needed)
- 07-was-metrics.json      : 200 GET .../workloads-summary-metrics (200 on startTime/endTime params; series only spans 2026-09-30→2026-10-08, not the requested 07-10 window)
