# ngm-helios-eks (419c39e4-66bf-4d61-b833-4562968a61c7) — collection status 2026-10-08T00:31Z
# Org header X-CastAI-Organization-Id: 07aa3c29-3e1f-44bc-ad60-ceedb878d99a sent on every call.

01 cluster            200  GET  /v1/kubernetes/external-clusters/{id}                                             -> 01-cluster.json (2292 B)
02 nodes              200  GET  /v1/kubernetes/external-clusters/{id}/nodes                                       -> 02-nodes.json (166963 B; 55 nodes, 52 managed-by=cast.ai)
03 baseline-params    200  GET  /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params              -> 03-baseline.json (359 B; CLUSTER_HISTORY)
04 was-summary        200  GET  /v1/workload-autoscaling/clusters/{id}/workloads-summary                          -> 04-was-summary.json (496 B; 3602 workloads)
05 classic-savings    200  GET  /v1/cost-reports/clusters/{id}/savings?startTime=2026-09-08&endTime=2026-10-08    -> 05-classic-savings.json (3102 B; 30 daily items, 09-09..10-08)
06 value-realization  200  POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport (approved read-semantics query; body {"clusterIds":[...]} accepted on first attempt) -> 06-value-realization.json (1215 B)
07 was-metrics        200  GET  /v1/workload-autoscaling/clusters/{id}/workloads-summary-metrics?startTime=2026-07-10&endTime=2026-10-08 -> 07-was-metrics.json (269908 B; 672 pts, window truncated to 2026-09-30..10-07)

Hard rules respected: GET-only except approved POST #6. No mutations, no credentials echoed, no 401/403 encountered.
