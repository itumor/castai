# Chapter 14 — API & Automation

Sources: [API reference index](https://docs.cast.ai/reference/castai-api-documentation/llms.txt) · [OpenAPI spec](https://api.cast.ai/v1/spec/) · individual reference pages (linked per row), verified 2026‑10‑17.

**Conventions:** `GET` calls here are read-only. Any `POST/PUT/DELETE/PATCH` changes production policy/behavior — require explicit change approval. Auth: CAST AI API key (`X-API-Key`) or token per [API access](https://docs.cast.ai/docs/api-access); verify the exact **path + schema** in the OpenAPI spec before scripting (reference docs list operations; the spec is authoritative).

## 14.1 Read / inspect

| Operation | Method | Purpose | Key fields | Risk |
|---|---|---|---|---|
| [GetAgentStatus](https://docs.cast.ai/reference/workloadoptimizationapi_getagentstatus) | GET | is WAS agent responding & optimization permission | agent status | none |
| [ListWorkloads](https://docs.cast.ai/reference/workloadoptimizationapi_listworkloads) | GET | workloads w/ optimization info (aggregate client-side) | id, name, namespace, kind | none |
| [GetWorkloadsFilters](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadfilters) | GET | valid filter values for ListWorkloads | values | none |
| [GetWorkloadsSummary](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadssummary) / [SummaryMetrics](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadssummarymetrics) | GET | optimization coverage, totals, time series | summary blocks | none |
| [GetWorkload](https://docs.cast.ai/reference/workloadoptimizationapi_getworkload) / [GetWorkloadSpec](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadspec) | GET | workload detail / full spec | workload, spec | none |
| [GetWorkloadNativeVpaSpec](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadnativevpaspec) | GET | compute native VPA object for a workload | vpa spec | none |
| [GetWorkloadRecommendationManifest](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadrecommendationmanifest) | GET | deployed Recommendation CR YAML | manifest | none |
| [QueryWorkloadMetrics](https://docs.cast.ai/reference/workloadoptimizationapi_queryworkloadmetrics) | GET/POST | metrics time series | series | none |
| [ListWorkloadEvents](https://docs.cast.ai/reference/workloadoptimizationapi_listworkloadevents) / [GetWorkloadEvent](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadevent) / [EventsSummary](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadeventssummary) | GET | troubleshooting timeline | event types, counts | none |
| [ListClusterHpas](https://docs.cast.ai/reference/workloadoptimizationapi_listclusterhpas) | GET | HPA inventory/analysis (client-side aggregation) | hpa list | none |
| [ListResourceQuotas](https://docs.cast.ai/reference/workloadoptimizationapi_listresourcequotas) / [ListLimitRanges](https://docs.cast.ai/reference/workloadoptimizationapi_listlimitranges) | GET | synced quota/limit data | objects | none |
| [GetWorkloadsAccessContext](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadsaccesscontext) | GET |RBAC context for workloads page | access info | none |
| [GetOrganizationAgentStatuses](https://docs.cast.ai/reference/workloadoptimizationapi_getorganizationagentstatuses) | GET | fleet-wide WAS component status | statuses | none |

## 14.2 Policies & workloads (production-changing — approval required)

| Operation | Method | Purpose |
|---|---|---|
| [ListWorkloadScalingPolicies](https://docs.cast.ai/reference/workloadoptimizationapi_listworkloadscalingpolicies) | GET | inventory |
| [CreateWorkloadScalingPolicy](https://docs.cast.ai/reference/workloadoptimizationapi_createworkloadscalingpolicy) | POST | create with settings + assignment rules |
| [GetWorkloadScalingPolicy](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadscalingpolicy) | GET | detail |
| [UpdateWorkloadScalingPolicy](https://docs.cast.ai/reference/workloadoptimizationapi_updateworkloadscalingpolicy) | PUT | modify settings/rules |
| [DeleteWorkloadScalingPolicy](https://docs.cast.ai/reference/workloadoptimizationapi_deleteworkloadscalingpolicy) | DELETE | remove (workloads fall back to default profiling) |
| [SetScalingPoliciesOrder](https://docs.cast.ai/reference/workloadoptimizationapi_setscalingpoliciesorder) | PUT | rule-matching priority order |
| [AssignScalingPolicyWorkloads](https://docs.cast.ai/reference/workloadoptimizationapi_assignscalingpolicyworkloads) | POST | manual assignment |
| [UpdateWorkloadV2](https://docs.cast.ai/reference/workloadoptimizationapi_updateworkloadv2) / [PatchWorkloadV2](https://docs.cast.ai/reference/workloadoptimizationapi_patchworkloadv2) | PUT/PATCH | per-workload settings incl. horizontal config |
| [ResetSystemOverrides](https://docs.cast.ai/reference/workloadoptimizationapi_resetsystemoverrides) | POST | return workload to policy inheritance |

## 14.3 HPA migration & custom metrics

- [GetHpaV2MigrationEligibility](https://docs.cast.ai/reference/workloadoptimizationapi_gethpav2migrationeligibility) (GET; states `Full/Partial/Blocked/None`) → [MigrateClusterToHpaV2](https://docs.cast.ai/reference/workloadoptimizationapi_migrateclustertohpav2) (POST — gated).
- Custom metric data sources: [List](https://docs.cast.ai/reference/workloadoptimizationapi_listcustommetricsdatasources) / [Create](https://docs.cast.ai/reference/workloadoptimizationapi_createcustommetricsdatasource) / [Update](https://docs.cast.ai/reference/workloadoptimizationapi_updatecustommetricsdatasource) / [Delete](https://docs.cast.ai/reference/workloadoptimizationapi_deletecustommetricsdatasource); workload custom metrics (v1beta): [raw](https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadcustommetricsv1beta) / [aggregated](https://docs.cast.ai/reference/workloadoptimizationapi_getaggregatedworkloadcustommetricsv1beta).

## 14.4 Savings-linked report APIs

[GetRightsizingSummary](https://docs.cast.ai/reference/clusterreportapi_getrightsizingsummary) · [GetClusterSavingsReport](https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport) · [GetSavingsRecommendation](https://docs.cast.ai/reference/clusterreportapi_getsavingsrecommendation) · [GetClusterAgentStatus](https://docs.cast.ai/reference/clusterreportapi_getclusteragentstatus) · workload Prom metrics: [cluster-level](https://docs.cast.ai/reference/reportmetricsapi_getclusterworkloadprommetrics) / [workload-level](https://docs.cast.ai/reference/reportmetricsapi_getworkloadprommetrics).

## 14.5 Read-only audit script pattern

```bash
#!/usr/bin/env bash
# Read-only WAS audit. Requires CASTAI_API_KEY in env; never prints it.
set -euo pipefail
API="https://api.cast.ai/v1"; CLUSTER_ID="<cluster-id>"
auth=(-H "X-API-Key: ${CASTAI_API_KEY:?set CASTAI_API_KEY}")
curl -fsS "${auth[@]}" "$API/workload-optimization/clusters/$CLUSTER_ID/agent-status"   # confirm path via OpenAPI spec
curl -fsS "${auth[@]}" "$API/workload-optimization/clusters/$CLUSTER_ID/workloads" \
  | jq '.items[] | {name: .name, namespace: .namespace, kind: .kind}'
```
*(Paths above are indicative — pull the exact paths/schemas from https://api.cast.ai/v1/spec/ before running against production.)*

## 14.6 Regional considerations

Match the API host/console region your organization was provisioned in; orgs onboarded to a regional control plane must use its endpoints. Confirm via your onboarding material/console URL.
