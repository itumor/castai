# Chapter 10 — Production Best Practices (opinionated, evidence-linked)

Cross-references: Ch. 4 policies · Ch. 5 tuning · Ch. 6 mechanisms · Ch. 8 advanced features. **[Suggested]** marks this guide's stance, not a CAST AI default.

## 10.1 Mission-critical services (payments, auth, order APIs)

- Policy: clone `stability` or `balanced`; automation on after ≥1 week observation.
- CPU p80–p90, overhead 0.15–0.25; memory `max`, overhead 0.2–0.35; look-back 3–7d; min constraints ≥ boot requirement.
- Immediate + `rolloutBehavior: {type: NoDisruption, preferOneByOne: true, delaySeconds: 120}`; readiness probes mandatory (also unlocks zero-downtime single-replica path).
- Stall thresholds: inherit stability (5% CPU stall) so contention triggers upscales early.
- **Defer/avoid:** predictive scaling if traffic isn't periodic; node-aware sizing; aggressive `cost-savings` assignment "temporarily".

## 10.2 High-traffic web APIs

- `balanced` + automation on; sensitivity **dynamic**; immediate apply.
- If HPA-managed: let coordination own CPU; set HPA behavior (downscale stabilization 300–600s); keep memory overhead ≥0.15 so memory-HPA corrections stay rare (Ch. 7.6).
- Startup-heavy (JIT languages): "startup recommendations" mode on K8s 1.33+ prevents boot-time HPA snowballing.

## 10.3 JVM microservices

- Enable `jvm.enabled` (+ chosen collection method, Ch. 8.1) — container-level memory views lie for the JVM.
- Look-back ≥3d; memory overhead 0.15–0.25 *on heap-based recs*; keep container limit strategy `maintainRatio`/`keepLimits` when `-Xmx` fixed.
- Signs you need it: pods OOMKilled while container memory "looks fine", or internal OOMs invisible in K8s events.

## 10.4 Batch & CronJobs

- Deferred apply (jobs churn anyway); memory `max` + overhead 0.25 (a job OOM = failed run); respect `jobLikeMinCpuRequest` floor (default 50m).
- **Skip optimization** for jobs with no metrics in the last 7 days (e.g. monthly jobs) — WAS regenerates nothing; leave them read-only or annotate explicit requests.

## 10.5 Stateful services (databases, brokers)

- Start from `resiliency`; prefer **deferred**; if immediate is required: `preferOneByOne` + long `delaySeconds` (300s+) and verified PDBs (`maxUnavailable: 1` works; `maxUnavailable: 0` blocks all immediate applies — event "PDB is blocking eviction").
- Consider `vertical.downscaling.applyType: notAllowed` — upscales flow, downscales need human deploys.
- Memory limit: keep limits (data corruption risk of OOM kill mid-write beats burst flexibility).

## 10.6 Low-traffic / internal services

- `cost-savings` policy; CPU p60–p70 [Suggested]; overhead 0.05–0.10; min constraints small but sane (`cpu ≥25m`).
- Watch for min-constraint fights: don't set min lower than kubelet/metrics noise floor.

## 10.7 Dev / sandbox clusters

- Automate broadly; accept throttling; enable `downscaling` immediate; disable nothing — dev is where you validate policies before prod.

## 10.8 Workloads that already autoscale (HPA/KEDA)

- Verify metric types (Ch. 7 strategy table) BEFORE enabling automation; add the HPA converter for vertical-only mode; never let WAS take ownership of KEDA-owned HPAs (it's blocked, but design your policy so it isn't attempted).

## 10.9 Universal hygiene

1. **Read-only first**: recommendations ≥3–7 days before automation per workload class.
2. **Enable by policy, not byWorkload**; per-workload changes via annotations in Git only.
3. **Set min/max constraints everywhere** — they're the seatbelt for every other knob.
4. **Exclude infrastructure sidecars** (`excludedContainers`) — never let WAS shrink your proxy/agent.
5. **Don't optimize what you can't observe** — exporter healthy, PSP/Gatekeeper exceptions done for JVM init containers.
6. **Monthly jobs and 0-metric workloads**: out of scope (7-day metrics rule).
7. **Silence = health**: watch Event log error/warning types (PDB blocks, failed CR create) in dashboards (Ch. 11–12).

## 10.10 When NOT to optimize (documented + practical)

- Workloads with hard single-replica + strict PDB and no readiness probes → deferred-only or off.
- Performance benchmarks/load-test fixtures (you want request determinism).
- Workloads under active incident response → freeze applies via eviction-delay annotation (`workloads.cast.ai/apply-recommendations-not-before`) instead of disabling optimization.
- Anything where "request-as-billing" matters more than utilization (rare committed-rate contracts) — model first in Ch. 13.
