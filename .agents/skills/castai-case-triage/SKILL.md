---
name: castai-case-triage
description: Investigate CAST AI incidents and support tickets with evidence-based root-cause analysis. Use for unclear symptoms, failing or disconnected clusters, logs, event timelines, impact assessment, and cross-component support triage. For a clearly identified savings, API, onboarding, or autoscaler issue, prefer the matching focused CAST AI skill.
---

# CAST AI case triage and RCA

## Goal
Establish what failed, when, impact, likely cause, verification, and next owner without asserting unsupported conclusions.

## Procedure
1. **Scope the case:** Identify organization/cluster *only if safely available*, cloud/region, component, impact, start time + timezone, versions, and whether production is affected. Ask at most one essential clarification if evidence is insufficient.
2. **Construct an evidence timeline:** Separate user reports, time-stamped observations, platform telemetry, Kubernetes events, and API responses. Record provenance for each.
3. **Assess risk:** Check pending pods, node readiness, recent upgrades, autoscaler actions, admission failures, cloud permission errors, network failures, and cost symptoms as relevant.
4. **Rank hypotheses:** For each candidate root cause provide supporting observations, contradicting observations, and the next read-only discriminator. Never present a hypothesis as confirmed.
5. **Verify documentation:** Cross-check current CAST AI official docs and component compatibility before suggesting fixes. If unavailable, say product-specific details are unverified.
6. **Propose least-risk resolution:** State prerequisites, blast radius, observability signals, approval needed, and rollback. Do not execute mutations without explicit authorization.
7. **Prepare escalation:** Include time range, redacted logs, component versions, reproduction, user impact, checks already run, remaining question, and evidence links.

## Safe investigation examples
```sh
kubectl get nodes -o wide
kubectl get pods -A --field-selector=status.phase=Pending
kubectl get events -A --sort-by=.metadata.creationTimestamp
kubectl -n castai-agent get pods -o wide
kubectl -n castai-agent logs deploy/castai-agent --since=60m --tail=300
```
These commands are examples, **not executed**. Verify namespace, names, access scope, timestamps, and whether log content might contain credentials or personal information before collecting or sharing. Do not fetch Kubernetes Secret data.

## Evidence labels
- **Confirmed:** An observation directly supported by a returned log, event, API response, or authoritative documentation.
- **Likely:** Best-supported hypothesis, explicitly not proven.
- **Unknown:** Evidence absent, unavailable, or conflicting.
- **Proposed:** An unexecuted check or change.

## Response template
**Impact** → **Verified findings** → **Likely cause (confidence)** → **Next safe check** → **Resolution/rollback (approval required)** → **Escalation if unresolved**. Keep the initial customer reply concise.

## References
- [Cluster onboarding troubleshooting](https://docs.cast.ai/docs/cluster-onboarding-troubleshooting)
- [Node Autoscaler preparation checklist](https://docs.cast.ai/docs/autoscaler-checklist)
- [CAST AI documentation](https://docs.cast.ai/)
