# Status — cluster k8s (d0c7a7a5-72d2-4c09-a9f6-1b173c64d0a8), org SMO Railigent X
Collected: 2026-10-08 ~00:30 CEST (API https://api.eu.cast.ai, BOTH headers sent: X-API-Key + X-CastAI-Organization-Id)
NOTE: supersedes a stale status block from an earlier headerless run (all 404s). Current run verified with org header.

01-cluster = 200 -> 01-cluster.json
02-nodes = 200 -> 02-nodes.json
03-baseline = 404 (nginx HTML; endpoint not available — variants ?baselineType=CURRENT, :current, /v1/cost-reports/.../baseline-params also 404) -> 03-baseline.json
04-was-summary = 200 -> 04-was-summary.json
05-classic-savings = 400 "this API is not available ... cluster is read-only" (EXPECTED for this read-only cluster; body saved as evidence) -> 05-classic-savings.json
06-value-realization = 200 (POST first body accepted; no retry needed) -> 06-value-realization.json
07-was-metrics = 200 (672 points; returned window only 2026-09-30T21:15Z..2026-10-07T21:00Z, not requested 2026-07-10..2026-10-08) -> 07-was-metrics.json
