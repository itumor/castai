# rhx-test (35c0f9b5-25f1-49bb-aa2a-ec49915352b3) — API collection status 2026-10-08
01-cluster:            200 GET  /v1/kubernetes/external-clusters/{id} -> 01-cluster.json
02-nodes:              200 GET  /v1/kubernetes/external-clusters/{id}/nodes -> 02-nodes.json (4 nodes)
03-baseline:           404 GET  /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params -> 03-baseline.json (nginx 404 HTML body, verbatim)
04-was-summary:        400 GET  /v1/workload-autoscaling/clusters/{id}/workloads-summary -> 04-was-summary.json ("castai-workload-autoscaler should be installed to enable workload optimization")
05-classic-savings:    400 GET  /v1/cost-reports/clusters/{id}/savings?startTime=2026-09-08T00:00:00Z&endTime=2026-10-08T00:00:00Z -> 05-classic-savings.json ("cluster is read-only" — expected for read-only cluster)
06-value-realization:  200 POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport?startTime=2026-09-05T00:00:00Z&endTime=2026-10-05T00:00:00Z body {"clusterIds":[id]} -> 06-value-realization.json (HTTP 200, but {"items":[],"nextPageCursor":""} — empty report)
07-was-metrics:        400 GET  /v1/workload-autoscaling/clusters/{id}/workloads-summary-metrics?startTime=2026-07-10T00:00:00Z&endTime=2026-10-08T00:00:00Z -> 07-was-metrics.json ("castai-workload-autoscaler should be installed...")
All calls sent both X-API-Key and X-CastAI-Organization-Id: f15f33b9-20ad-4128-8289-da529844d3f0. No credentials or PII in saved bodies. Note: prior _status.md values (404/400 mix) were stale from an earlier headerless run and are superseded.
