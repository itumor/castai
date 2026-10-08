# API call statuses — cluster cf62a8e1-1f1e-40dc-bd90-1b5c84dfa9df ("k8s"), org f15f33b9 (SMO Railigent X), host https://api.eu.cast.ai, collected 2026-10-08
# THIS RUN: every call sent BOTH X-API-Key and X-CastAI-Organization-Id. Results supersede the previous headerless run below (which wrongly suggested "cluster not found").

01-cluster.json            = 200 (999 B)   GET /v1/kubernetes/external-clusters/{id}
02-nodes.json              = 200 (543160 B, 171 nodes)   GET /v1/kubernetes/external-clusters/{id}/nodes
03-baseline.json           = 404 (nginx HTML, 146 B)     GET /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params — endpoint not available for this cluster
04-was-summary.json        = 200 (508 B)   GET /v1/workload-autoscaling/clusters/{id}/workloads-summary
05-classic-savings.json    = 400 EXPECTED  GET /v1/cost-reports/clusters/{id}/savings — body: "this API is not available for cluster ...: cluster is read-only"
06-value-realization.json  = 200 (1191 B)  POST runValueRealizationReport (approved) — first body {"clusterIds":[...]} accepted; no retry needed
07-was-metrics.json        = 200 (268143 B, 672 datapoints)  GET workloads-summary-metrics — earliest datapoint 2026-09-30T21:15Z despite requesting from 2026-07-10

## Previous run (superseded — headerless / wrong-host diagnostics)
01=404, 02=404, 03=400(cluster not found), 04=200-empty, 05=404, 06=200-empty, 07=200-empty
Cause: calls without X-CastAI-Organization-Id; enterprise-scoped key sees zero clusters (nginx 404 / empty 200). Do NOT read as "cluster not found".
