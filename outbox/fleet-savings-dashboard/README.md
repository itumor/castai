# Siemens Fleet · CAST AI Realized-Savings Dashboard

A **live** dashboard over the CAST AI API: every number is fetched at runtime
(no snapshots, no estimates). 238 clusters · 130 organizations · case-classified
per row with filters by case, organization, and cluster name.

## Run

```bash
cd outbox/fleet-savings-dashboard
node server.mjs
# → http://127.0.0.1:3377     (CTRL+C stops; only listen on localhost)
```

The server sources the key itself, from (in order) the process env, `../../.env`,
`../../awskey.env`: candidates `Castai_mcp` → `CASTAI_API_KEY` →
`TF_VAR_castai_api_token`; at startup each candidate is probed against
`GET /v1/organizations` and the first one returning 200 wins (the chosen var
**name** is logged, never the value). `CASTAI_API_BASE` overrides the default
`https://api.eu.cast.ai`.

## What every screen element calls (provenance)

| UI number | Live API call | Field |
|---|---|---|
| Organization filter | `GET /v1/organizations` | `organizations[]` |
| Row / agent status | `GET /v1/kubernetes/external-clusters` (per org, `X-CastAI-Organization-Id`) | `items[].name / agentStatus / region` |
| WAS $ | `POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport?startTime&endTime` (report query, empty body — **query-string window**) | `items[].cost.workloadAutoscalerSavings` |
| node $ / total $ / actual $ | same call | `items[].cost.{autoscalerSavings,totalSavings,actualCost}` |
| Case badge | same call | `items[].woopAdopted × items[].autoscalerAdopted` → B/C/D; `baselineType`; missing + `agentStatus=disconnected` → F; missing + connected → A |
| Drawer: baseline | `GET …/clusters/{id}/baseline-params` | 200 = params · **404 = no baseline (signal, not error)** |
| Drawer: nodes | `GET /v1/kubernetes/external-clusters/{id}/nodes` | labels `provisioner.cast.ai/managed-by`, `karpenter.sh/*` |
| Drawer: WAS effect | `GET /v1/workload-autoscaling/clusters/{id}/workloads-summary` | `originalRequested*` vs `requested*`, `optimizedCount/totalCount` |
| Drawer: classic cross-check | `GET /v1/cost-reports/clusters/{id}/savings` | 200 = classic number · **400 "read-only" = node track OFF** |

All calls are GET plus the single read-semantics report query (POST) — no
mutations.

## Case classification (matches the verified flow)

- **B — WAS only**: `woopAdopted=true`, `autoscalerAdopted=false` (Karpenter keeps the nodes) → report WAS $ only; no baseline needed.
- **C — Node only**: `false/true` → report node $ starting at `baselinePeriodEndTime`.
- **D — Both**: `true/true` → `totalSavings` = node track; WAS $ is explanatory, **never summed** (invariant verified fleet-wide: Σ`autoscalerSavings` == Σ`totalSavings`).
- **E — transition**: a B cluster that later enables node management (timeline: WAS $ months before node $). Shown as a rule card; per-cluster rows carry the *current* state (D after transition).
- **A — connected, nothing on**: in fleet list, absent from report items, agent connected → "no data", never $0.
- **F — disconnected**: `agentStatus=disconnected` → flag, don't drop.

## Notes / known behaviors

- First full sweep ≈ 15–20 s (130 orgs × 2 calls, waves of 8; 429s retried with backoff). Result cached in memory 10 min — the UI "Refresh" reuses a warm cache.
- Orgs the key can't read are listed in the ⚠ errors panel and excluded from rows (typically 3–5 of 130).
- Org report items sometimes omit a cluster entirely → row shows case A/F via agent status.
- Negative node-savings cells are real API values (compression/upward-resizing clusters); kept as-is.
- Stop the server when done (CTRL+C); nothing is written to disk from API responses.
