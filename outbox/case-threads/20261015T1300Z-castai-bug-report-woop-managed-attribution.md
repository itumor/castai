# Bug report draft — managedWorkloadCount attribution error (ngm-integ-eks)

**To:** CAST AI support/engineering (reporting/value-realization team)
**Status:** DRAFT — human review + send required (not sent by agent)
**Prepared:** 2026-10-15, org SI GSW CLO `07aa3c29-3e1f-44bc-ad60-ceedb878d99a`, cluster `ngm-integ-eks` `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f`

---

## Summary

The Workload Optimization → Impact view reports `managedWorkloadCount: 56` for this cluster — while every workload, policy, and management option in the WOOP API is `READ_ONLY`, `optimizedCount=0`, `appliedPods=0`, `scaledPodCount=0`, and `workloadAutoscalerSavings=$0` for the same window. The customer's correct reading is "nothing is managed". Audit logs show no customer action that could create this attribution. Please identify which workloads the 56 are, why they are classified managed, and correct the attribution.

## Environment

- Org: SI GSW CLO `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` (EU)
- Cluster: `ngm-integ-eks` `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` (EKS eu-central-1, CAST AI node autoscaling active)
- workoad-autoscaler component: `AGENT_STATUS_RUNNING`, `installedAt: 2026-04-27T10:30:33Z`
- Console view: Cluster → Workload Optimization → Impact, preset LAST_30_DAYS

## Reproduction

### A. The reported numbers

```bash
curl -sS -X POST "https://api.eu.cast.ai/reporting/v1beta/organizations/$ORG:runValueRealizationTimelineReport?startTime=2026-09-15T00:00:00Z&endTime=2026-10-15T00:00:00Z&step=ONE_DAY" \
 -H "X-API-Key: $KEY" -H "X-CastAI-Organization-Id: $ORG" -H 'Content-Type: application/json' \
 -d '{"clusterIds":["1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f"]}'
```

→ `summary.workloadOptimization.managedWorkloadCount: "56"`, `totalWorkloadCount: "40063"`;
per-day `workloadOptimization.managedWorkloadCount` = 57 from 2026-08-19 through 2026-10-02, then 56 (55 on 10-10).

### B. Ground truth — nothing is managed

```bash
curl -sS "https://api.eu.cast.ai/v1/workload-autoscaling/clusters/1ad1a0bf-…/workloads-summary"  (with both headers)
```
→ `totalCount: 4566, optimizedCount: 0, apiManagedCount: 4566 (assignment-rules coverage only)`

All 4,566 workloads: `vpaConfig.managementOption=READ_ONLY`, `hpaConfig.managementOption=READ_ONLY`, `recommendationStatus.appliedPods=0`, `scaledPodCount=0`. All 6 scaling policies: `recommendationPolicies.managementOption=READ_ONLY` (created 2026-04-27). VR report: `workloadAutoscalerSavings=0`, `woopAdopted=true` (flag also inconsistent with 0 managed).

### C. Historical attribution proves mis-classification

Daily `managedWorkloadCount` for this cluster (same endpoint, monthly windows):

| Window | managed/day |
|---|---|
| 2026-05-01 → 05-31 | 0 on all 31 days |
| 06-05 | 21 |
| 06-07 → 06-09 | 4 → 48 → 52 |
| **06-10** | **727** |
| 06-11 → 08-18 | 0 on all days |
| **08-19 → 10-02** | **57 constant** |
| 10-03 → 10-15 | 56 (55 on 10-10) |

### D. Counter semantics demonstrated live (June 10)

Audit (`GET /v2/audit/events`, `filter.clusters=1ad1a0bf…`, `filter.domains=workload`, `filter.search=scaling_policy`, `includeBody=true`): 2026-06-10T05:07–05:10Z, user "Winkler, Marco (SI GSW R&D CLO AS)" flipped the built-in default policies' `recommendationPolicies.managementOption` `readonly→managed` and reverted within 3 minutes — 12 events total (resiliency, balanced, etc., workloads: it902915-kafkaui, it794248-iam-rotate-fts-admin-password, it899931-sysapp-config, it897314-camunda, it831700-database-operator, it906191-solver).

That single ~3-minute test moved the counter to 727 for the whole day (union-of-managed attribution within a day), and it returned to 0 the next day. ⇒ The counter demonstrably tracks `managementOption=managed`.

### E. The current 56 contradicts those semantics

From 2026-08-19 onward the counter sits at 57/56 while `managementOption` is `READ_ONLY` **everywhere** (verified on policies and on individual workloads). By the behavior demonstrated in D, the value should be ~0.

### F. No customer action on the flip date

`GET /v2/audit/events` for all domains, 2026-08-18 → 08-21, this cluster (750 events): **zero events on 08-19**; only regular autoscaler node churn on surrounding days; zero `scaling_policy` updates Jul 1 → Oct 15 (besides 5 system-written updates on Jul 3 that left the count at 0). No workload-autoscaler INSTALLED/UNINSTALLED events in range; component `installedAt` unchanged since 2026-04-27.

## What we believe is wrong

The managed-attribution pipeline appears to have persisted (or created on 2026-08-19) a cohort of ~57 workloads for this cluster that is:
1. out of sync with `managementOption` (all READ_ONLY now), and
2. unexplained by any audit-visible customer action.

Possible interpretations: stale attribution cache/backfill, a second attribution code path that diverged from the one exercised in June, or an engine-side classification change on 2026-08-19.

## Impact

- Customer-facing Impact page claims 56 workloads "managed by Workload Optimization" on a cluster where WOOP is recommendation-only by design — creates confusion and false expectations in reporting.
- `woopAdopted=true` in value-realization reports likely shares the same attribution source (worth checking in the same fix).

## Ask

1. Identify the 56 workloads (per-workload list) and the classification reason.
2. Reconcile the Aug-19 flip with the `managementOption`-driven attribution demonstrated on Jun 10; fix the counter or explain the intended semantics and align the console label/text.

## Evidence pack (JSON artifacts retained, can share on request)

Timeline summaries for May / Jun / Jul 5–Sep 15 / last-30d (cluster-filtered); workloads-summary; full 4,566-workload dump; policies list; audit exports Aug 18–21 (all domains) and Jun 1–20 (`scaling_policy`, with base64 bodies).

---

**Draft-only note for the sender:** all data came from read-only GET/POST-report calls with the org-scoped key. No customer data (pod names/labels beyond `it-*` identifiers shown) is included above; scrub anything else before sending externally.
