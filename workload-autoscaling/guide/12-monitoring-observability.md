# Chapter 12 — Monitoring & Observability

Sources: [Prometheus & Grafana](https://docs.cast.ai/docs/prometheus-and-grafana) · [Event log](https://docs.cast.ai/docs/event-log) · [Optimization constraints](https://docs.cast.ai/docs/optimization-constraints) · [ReportMetricsAPI](https://docs.cast.ai/reference/reportmetricsapi_getworkloadprommetrics)

## 12.1 Signal sources

| Source | What it gives | How to consume |
|---|---|---|
| CAST AI **Report metrics API** (`/v1/metrics/...`) | cluster (`/prom`), nodes (`/nodes`), **workloads** (`/workloads`), allocation groups, workload network | scrape directly from Prometheus (bearer auth); workload labels: `cluster_id, namespace, workload_name, workload_type` (+ `additionalLabels` param) |
| **Event log** | 15 event types: recommendation generated/applied, surge, OOM reaction, CPU stall detected, PDB blocking eviction, optimization disabled, failed CR create, policy not found, etc. | console / `ListWorkloadEvents` API / OpsPilot |
| **Optimization constraints** (Cluster Score) | missing probes, PDB issues, spread-constraint gaps per workload | console advisory; suppressible via pod-template annotation |
| Kubernetes + your monitoring | throttling, OOM events, HPA status, probe failures (exporter `node-probes`), PSI (`node-psi`, K8s 1.34) | your existing Prometheus/Grafana |
| Console dashboards | optimization coverage, request trends, costs, savings | console |

Example scrape config (from the docs — adapt auth):
```yaml
- job_name: 'castai_workload_metrics'
  metrics_path: '/v1/metrics/workloads'
  # params: additionalLabels: [...], clusterID filter supported
```

## 12.2 Dashboard specification

**Panel group A — Rightsizing state**
- CPU: actual usage vs requested vs recommended (per workload; CAST AI workload metrics + `kubelet` usage)
- Memory: actual vs requested vs recommended
- Container limits vs requests (ratio drift after optimization)
- Recommendation confidence distribution

**Panel group B — Automation health**
- Managed vs read-only workload count (optimization coverage %)
- Recommendation generate→apply lag
- Event-log error/warning rate (PDB blocks, failed CR creates, policy-not-found)
- WAS deployment replicas ready (expect 2), exporter DS coverage = node count
- Webhook latency/failures (apiserver metrics: `apiserver_admission_webhook_admission_duration_seconds{name=~".*castai.*"}`, rejection counts)

**Panel group C — Workload safety**
- OOMKilled events (`kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}`)
- CPU throttling: `rate(container_cpu_cfs_throttled_seconds_total[5m])` per container
- PSI stall (`node-psi` exporter feed) vs stall thresholds
- Pod restarts by reason; probe-failure rate (`node-probes` feed)
- HPA desired vs current replicas; `PodResizePending` count (K8s 1.33+)

**Panel group D — Money**
- Original requested vs current requested (rightsizing Δ)
- Cluster requested vs provisioned (packing headroom)
- Realized/available savings (Ch. 13) — weekly cadence, not per-minute

## 12.3 PromQL examples

```promql
# Throttling ratio per workload (external K8s metrics)
sum by (namespace, pod) (rate(container_cpu_cfs_throttled_seconds_total[5m]))
  / sum by (namespace, pod) (rate(container_cpu_usage_seconds_total[5m]))

# Request utilization (needs kube-state-metrics)
sum by (namespace, pod) (container_cpu_usage_seconds_total)
  / sum by (namespace, pod) (kube_pod_container_resource_requests{resource="cpu"})

# Restarts spike
increase(kube_pod_container_status_restarts_total[30m]) > 3
```
CAST AI-side current-vs-recommended series come from the CAST AI `/v1/metrics/workloads` scrape (exact metric names via your Prometheus metric browser after enabling the scrape job, per the official guide).

## 12.4 Alerting rules (starting set)

| Alert | Condition concept | Severity |
|---|---|---|
| WAS down | `castai-workload-autoscaler` ready replicas < 2 for 10m | critical |
| Exporter gaps | exporter DS ready < desired for 15m | warning |
| Webhook failing | admission webhook error/reject rate > 0 for 5m | critical |
| OOM loop | OOMKilled on same workload ≥3 in 1h | warning/critical |
| Throttle regression | throttling ratio > 20% for 30m after a recommendation apply | warning |
| PDB blocking | repeated "PDB is blocking eviction" events for a workload > 6h | info |
| Resize stuck | `PodResizePending` > 30m | warning |
| Optimization auto-disabled | "Optimization disabled" events > 0 | warning (someone must re-enable) |
| Event-log errors | "Failed to create recommendation CR" > 0 | critical |
| Coverage regression | optimized workload share drops >10% week-over-week | info |

## 12.5 Where things are NOT available

- Per-recommendation simulation internals: only in the event-log JSON view (`"Calibrating for HPA"` step) — not in Prometheus.
- Claimed-vs-modeled savings: console/API reports only (Ch. 13).
- JVM heap series: only after JVM optimization is enabled with a collection method (Ch. 8.1).
