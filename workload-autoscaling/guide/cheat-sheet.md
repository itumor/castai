# CAST AI WAS — One-Page Tuning Cheat Sheet (2026‑10‑17)

> [D] = CAST AI documented default · [S] = suggested starting point · Precedence: annotation > policy > default.

## The 10 knobs that matter

| Knob | [D]efault | [S]tart | Notes |
|---|---|---|---|
| Apply type | immediate | immediate (stateless) / deferred (stateful, strict PDB) | immediate = eviction-based, PDB-honored |
| CPU percentile | p80 | p80 (p90 critical) | **ignored when HPA active** |
| Memory target | max | **max** | lower only with JVM heap sizing |
| CPU overhead | 10% | 10–15% (20–25% critical) | max 250%; ignored under HPA (auto) |
| Memory overhead | 10% | 15–30% | OOM buffer |
| Sensitivity | 10% / dynamic | **dynamic** | too low = restart churn |
| Look-back | 1d | 3–7d for weekly patterns | 3h–7d; longer ⇒ slower confidence |
| Min/Max constraints | none | **always set** in prod | seatbelt for all other knobs |
| Startup | regular | startup-recommendations on K8s 1.33+ | CPU-only, in-place transition |
| Confidence threshold | 90% | 90% (0.5–0.8 dev) | lower = faster, noisier |

## Apply-mode quick pick
- DaemonSet → **deferred only**. Strict PDB/single-replica-no-probes → deferred. Everything else → immediate + `preferOneByOne` + `delaySeconds≥60s` for fleets.
- K8s 1.33+ deferred workloads → enable **in-place resize** (memory limits never shrink in place).

## HPA rules
- Own HPA + WAS vertical-only ⇒ add `hpaConverters: [{type: AverageValueFromOriginalRequests}]`.
- WAS-managed HPA ⇒ CPU percentile/overhead are auto — tune the HPA, not the VPA knobs.
- Predictive CPU scaling ⇒ not with HPA (auto-disabled). KEDA: ScaledObjects OK, ScaledJobs ✗.

## System policies → use for
`stability/resiliency` critical & statefuls · `balanced` default · `cost-savings` dev/batch · `burstable` spiky · `readonly` observe. All ship with automation OFF. (`default*` = deprecated.)

## Never do
- Lower memory target on a service without OOM analysis (memory overhead is the seatbelt).
- Optimize workloads w/o metrics in last 7 days (monthly jobs) — nothing regenerates.
- Let GitOps and WAS both own `resources:` fields (drift war) — Ch. 9.3.
- Claim savings as realized before node consolidation happens — modeled ≠ realized (Ch. 13).
- Use `workload-autoscaler.cast.ai/ignore` label — explicitly not supported; use whitelisting mode.

## Fast diagnosis
Recs? → Event log → `kubectl get recommendations.autoscaling.cast.ai -A` → webhook/PDB/quota → throttling/OOM metrics → savings lens (Ch. 13). Version floors: in-place 1.33 & WAS v0.53.0 · startup-recs v0.63.1 · PSI 1.34 & exporter v0.67.0 · HPA WAS v0.44.x/agent v0.60.0 · native sidecars WAS v0.56.0.

Sources: docs.cast.ai → Workload Autoscaling section (20 pages, reviewed 2026‑10‑17; full inventory in [README.md](README.md)).
