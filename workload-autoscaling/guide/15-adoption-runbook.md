# Chapter 15 — Step-by-Step Production Adoption Runbook

Cross-refs: install (Ch. 2), policies (Ch. 4), tuning (Ch. 5), monitoring (Ch. 12), FinOps (Ch. 13). Approvals: every phase ends with a go/no-go signed by the workload owner + platform on-call.

## Phase 0 — Preflight (1–3 days)
- **Do:** inventory workloads (kind, replicas, current requests/limits, existing HPAs/KEDA, PDBs, ResourceQuotas/LimitRanges); record SLOs per critical service; confirm K8s version (1.33/1.34 feature gates); GitOps ownership of `resources:` fields.
- **Commands:** `kubectl get deploy,sts,ds,hpa,pdb -A`; quotas: `kubectl get resourcequota,limitrange -A`; version: `kubectl version --short`.
- **Success:** inventory table exists; risky workloads (strict PDB, single-replica-no-probe) flagged.
- **Risk:** none (read-only). **Rollback:** n/a.

## Phase 1 — Visibility (day 0–1)
- **Do:** install in `readonly` or `workload-autoscaler` mode with automation OFF everywhere (Ch. 2.3); verify components, CRDs, webhook, exporter (Ch. 2.4).
- **Success:** recs (or pending state) visible for ≥90% of inventoried workloads within ~30–60 min; **no resource changes** (`resources:` diffs in GitOps — check).
- **Rollback:** `helm upgrade` back to `readonly` tags (or uninstall WAS charts); workloads retain original manifests.

## Phase 2 — Recommendations review (days 1–7)
- **Do:** let data accumulate ≥3–7 days (docs suggest ~a week before broad enable); review recommendations vs actual usage per class; check no-recommendation and low-confidence lists (Ch. 11 scenarios 1–2); classify workloads into target policies incl. exclusions; refresh baselines for weekly-seasonal apps.
- **Success:** signed policy map (workload class → policy, mode, constraints); JVM list compiled; HPA strategy chosen per workload (Ch. 7).
- **Rollback:** n/a.

## Phase 3 — Controlled rollout (week 2)
- **Do:** enable automation on **one** low-risk workload group (dev/internal service) via its own custom policy; immediate mode; watch 48h: throttling, restarts, OOMs, request deltas, event log.
- **Success:** zero Sev-2+ incidents attributable to optimization; request Δ within expected band; coverage % as expected.
- **Rollback:** policy automation off (recommendations continue; nothing applied). Pods keep last applied requests — roll back requests via GitOps if needed.

## Phase 4 — Production rollout (weeks 2–4)
- **Do:** expand in waves: standard web → high-traffic → JVM (enable heap sizing) → stateful (deferred or immediate+1-by-1 with PDB check) → batch. Per wave: 24–72h soak, Ch. 12 dashboards, defined abort = automation off on the policy.
- **Success per wave:** stable error budget consumption; no PDB-block loops unattended; costs trending per model.
- **Approvals:** wave exit by service owners.

## Phase 5 — Advanced features (weeks 4–6)
- **Eligibility gates:** K8s 1.33+ → start in-place resize for deferred workloads; enable startup recommendations for slow-boot services; evaluate predictive scaling on periodic non-HPA workloads; K8s 1.34+ → PSI stall thresholds review; early-access node-aware DS sizing on non-prod DaemonSets first.
- **Success:** reduced restart counts with in-place; startup p95 improved or unchanged; no stall-detection flapping.

## Phase 6 — Financial validation (week 6–8)
- **Do:** Ch. 13 checklist; confirm cluster appears in realized savings (≥14 days, actively managed); verify node consolidation actually happened before claiming realized WAS savings; reconcile fees; publish per-workload before/after (original vs requested).
- **Success:** report numbers reconcile with engineering rollouts within agreed tolerance; finance sign-off.

## Phase 7 — Continuous tuning (steady state)
- Monthly: review event-log warnings (PDB blocks, policy-not-found, failed CRs), coverage %, throttling/OOM regressions; quarterly: revisit percentiles/overheads vs SLOs, policy rule hygiene, new CAST AI releases (release notes) for feature floors; after big traffic changes: re-check look-back windows.

## Universal abort procedure (any phase)
1. Set affected policy automation **off** (one console toggle per policy).
2. If immediate-mode rollouts are mid-flight: add `workloads.cast.ai/apply-recommendations-not-before: "<RFC3339 future>"` to affected workloads to freeze dispatch.
3. Restore requests from GitOps for workloads that must return to known values.
4. File event-log evidence (workload events summary) with the incident.
