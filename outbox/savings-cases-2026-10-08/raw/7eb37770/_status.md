# Status ledger — cluster 7eb37770 (k8s), org SMO Railigent X — 2026-10-08

**OVERWRITTEN.** A prior ledger here recorded 01=404, 02=404, 05=404, 03=400, and empty 200 payloads, concluding "cluster not visible in this org's inventory." That run was made WITHOUT the `X-CastAI-Organization-Id` header. With the org header present on every call, the cluster IS fully visible — the earlier "not found" conclusion was a header artifact, exactly as warned in the task brief.

## This run (org header on every call)

- 01-cluster = 200 — k8s, status=ready, region=ap-south-1, createdAt=2026-06-19T14:33:27Z, agentStatus=online
- 02-nodes = 200 — 13 nodes, nextCursor empty (single page)
- 03-baseline = 404 — nginx HTML 404 (endpoint-level miss; org header proven working by 01/06 same-call success)
- 04-was-summary = 200 — real payload: totalCount=98, optimizedCount=89
- 05-classic-savings = 400 — EXPECTED: {"message":"... cluster is read-only"}
- 06-value-realization = 200 — real payload, first body variant {"clusterIds":[...]} accepted, no retry needed
- 07-was-metrics = 200 — 672 points; effective window 2026-09-30T21:15Z..2026-10-07T21:00Z (~7d retention; 2026-07-10 start requested but not served)

No 401/403. No mutations beyond the approved read-semantics POST (06). API key never printed.
