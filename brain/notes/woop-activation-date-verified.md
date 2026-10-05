# WOOP activation date — verified against EU API (2026-10-05)

**Verdict: YES.** The CAST AI API exposes a per-cluster workload-autoscaler
activation date: `installedAt`. Verified live on `api.eu.cast.ai` across
Siemens Dev (2 clusters) and SI GSW CLO (6 clusters), and in the official
OpenAPI spec (`api.cast.ai/v1/spec/openapi.json` = EU spec paths confirmed
identical). Applies equally to clusters connected read-only/Castware —
i.e. **clusters without CAST AI node autoscaling** — since workload
autoscaling runs via the `castai-workload-autoscaler` component there.

## Primary source

`GET /v1/workload-autoscaling/clusters/{clusterId}/components/workload-autoscaler`
→ `installedAt` (date-time). Present when `status=AGENT_STATUS_RUNNING`;
ABSENT from the JSON when the component was never installed
(`AGENT_STATUS_UNKNOWN`, replicaCount 0, `updatedAt: null`).

- Fleet fan-out in ONE call (verified working on EU):
  `GET /v1/workload-autoscaling/organizations/{organizationId}/components/workload-autoscaler`
  → `clusterAgentStatuses[].installedAt` per cluster.
  (Already consumed by `castai-enterprise-dashboard/services/castai_client.py:478`.)

## Corroborating sources

| Source | What it gives | Caveats |
|---|---|---|
| `GET /v1/workload-autoscaling/clusters/{id}/workload-events?type=EVENT_TYPE_WORKLOAD_AUTOSCALER_INSTALLED` (also `_UNINSTALLED`) → `event.workloadAutoscalerInstalled.timestamp` | Recorded install/uninstall history. Live-verified: dev-vlab event 2026-09-28T15:04:49Z vs installedAt 15:04:31Z (18s later). | Rolling retention ≈ 1 year — API enforces `fromDate` ≥ ~1y ago (today: after 2025-10-10). Historical installs age out; use `installedAt`. Query param is `type` (NOT `type[]` — that 400s). |
| `GET /v1/workload-autoscaling/clusters/{id}/policies` → earliest `createdAt` of `isCastware=true` policy (named "readonly") | Castware/read-only connection enablement. Live-verified: ngm-helios "readonly" policy createdAt 2026-07-20T17:07:41Z vs installedAt 17:07:22Z (19s). Marks specifically the w/o-node-autoscaler case. | Policy creation follows install; second-granularity offset only. |
| `GET /v1/workload-autoscaling/clusters/{id}/workloads` → `min(items[].createdAt)`; `.recommendationStatus.earliestActiveRecommendationAt` | Earliest managed workload ≈ install time (matched within ~1s on validated clusters); `earliestActiveRecommendationAt` = when rightsizing first became active. | Fallbacks for edge cases (null installedAt, agent reinstalled). |

## NOT activation dates (do not use)

- `updatedAt` (same component endpoint) — moving heartbeat.
- `workloads-summary` — zero date fields (counts only).
- `GET /v1/workload-autoscaling/clusters/{id}` — 404, does not exist.
- `GET /v1/kubernetes/external-clusters/{id}`: `createdAt` = cluster onboarding;
  `firstOperationAt` = first optimization op of ANY kind (incl. node autoscaler).
  Counterexample: dev-vlab 0528411e firstOperationAt 2025-05-08 vs installedAt 2026-09-28.
- `GET /v1/kubernetes/external-clusters/{id}/events` — HTTP 501 Not Implemented.
- OpenAPI spec contains ZERO fields named `activatedAt`/`enabledAt`/`onboardingTime`.

## Live-verified samples (installedAt)

- SI GSW CLO: baseline-clo 2025-10-29T16:35:35Z · ngm-sim 2025-10-30 · ngm-kronos 2025-11-06 ·
  ngm-sim2 2026-09-07 · ngm-integ 2026-04-27 · ngm-helios 2026-07-20
- Siemens Dev: pfm-eks 2025-08-12T07:23:57Z · dev-vlab (0528411e) 2026-09-28T15:04:31Z
- Component versions where observed: v0.64.0, v1.10.4, v1.14.1 — field present on all.

## Caveats

- `installedAt` is **undocumented** in the spec (nullable, not in `required`,
  no description). Semantics = component install time; robustness across agent
  upgrades/reinstalls unverified (an uninstall+reinstall of the wops
  deployment likely resets it).
- NGM clusters show WOOP installed with optimizedCount 0 ("metrics-only") —
  installedAt exists even though rightsizing is inactive (see
  `brain/notes/SI GSW CLO NGM Clusters.md`).

## Relation to prior work

- `.kimchi/docs/woop-savings-verification-2026-09-25.md` proposed installedAt
  as the activation marker after rejecting the VR-timeline first-savings-date
  heuristic. This session CONFIRMED it empirically (8 clusters, 2 orgs) and
  added: org-level endpoint, INSTALLED/UNINSTALLED events + their ~1y
  retention, and the castware "readonly" policy corroboration.
- `woop_enabled_date` in the inventory workbook
  (`cluster-readiness-outputs/build_extended_inventory.py`) can now be
  provenance-checked against the org-level endpoint.
- Open: `outbox/case-threads/20261004T081430Z-brief.md:67` — WOOP metering on
  metrics-only clusters.
