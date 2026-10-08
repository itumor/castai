# staging (ae3e22a4) — API call status, 2026-10-08T00:32+03:00 — org SMO Railigent X (f15f33b9)

- 01-cluster.json — GET /v1/kubernetes/external-clusters/{cid} — HTTP 200
- 02-nodes.json — GET /v1/kubernetes/external-clusters/{cid}/nodes — HTTP 200
- 03-baseline.json — GET /reporting/v1beta/organizations/{org}/clusters/{cid}/baseline-params — HTTP 404 (nginx; endpoint not available)
- 04-was-summary.json — GET /v1/workload-autoscaling/clusters/{cid}/workloads-summary — HTTP 200
- 05-classic-savings.json — GET /v1/cost-reports/clusters/{cid}/savings — HTTP 400 "cluster is read-only" (EXPECTED for Karpenter/read-only; body saved as evidence)
- 06-value-realization.json — POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport — HTTP 200 (first body shape `{"clusterIds":[...]}` accepted; no retry needed)
- 07-was-metrics.json — GET /v1/workload-autoscaling/clusters/{cid}/workloads-summary-metrics — HTTP 200 (data covers 2026-09-30T21:30Z to 2026-10-07T21:15Z despite 3-month request window)
