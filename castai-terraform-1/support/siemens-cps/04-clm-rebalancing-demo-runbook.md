# 04 — Demo Runbook: Container Live Migration + Rebalancing (test cluster)

**Goal of the demo (meeting promise):** show (a) **node rebalancing** replacing suboptimal nodes
with zero(*) disruption, and (b) **container live migration (CLM)** preserving a stateful workload's
memory and TCP connections during those replacements.
Sources: [CLM overview](https://docs.cast.ai/docs/clm-overview),
[CLM requirements](https://docs.cast.ai/docs/clm-requirements-and-limitations),
[CLM tutorial](https://docs.cast.ai/docs/clm-getting-started),
[CLM on EKS](https://docs.cast.ai/docs/clm-cloud-providers-eks),
[Rebalancing](https://docs.cast.ai/docs/rebalancing),
[Scheduled rebalancing](https://docs.cast.ai/docs/scheduled-rebalancing).

## 0. Prerequisites checklist (verify before the call)

- [ ] Target = **test cluster** (Siemens CPS test EKS is fine; never production for first run).
- [ ] **Kubernetes ≥ 1.30**, nodes managed **by Cast AI**, runtime **containerd v2+**.
- [ ] Node image: **Amazon Linux 2023** on EKS (Bottlerocket and AL2 are **not** CLM-supported).
- [ ] TCP preservation path: on EKS the default is **AWS VPC CNI**
      → source and destination nodes must be in the **same subnet**; ensure the subnet has free IPs.
      (Traffic Control path avoids subnet constraints but needs kernel 6.6+.)
- [ ] Node template for CLM: **single architecture** (AMD64 *or* ARM64, not Any) and instance
      families from the **same generation set** (e.g. c5+r5 OK; c3 with c5 NOT OK).
- [ ] RBAC/permissions are already in place for the cluster (autoscale mode).
- [ ] Cluster autoscaler setting **Unscheduled pods policy = enabled** (required by the Rebalancer).

## 1. Enable CLM components

If onboarding with **automation enabled today**, CLM installs with phase-2 onboarding.
For an existing installation (umbrella chart, namespace `castai-agent`):

```bash
helm repo add castai-helm https://castai.github.io/helm-charts && helm repo update castai-helm
helm upgrade castai castai-helm/castai -n castai-agent \
  --set autoscaler.castai-live.daemon.install.enabled=true \
  --set autoscaler.castai-live.castai-aws-vpc-cni.enabled=true   # EKS TCP path
helm upgrade castai castai-helm/castai -n castai-agent \
  --set autoscaler.castai-evictor.liveMigration.enabled=true     # Evictor side
```

Then in the console: enable **Container live migration** on the relevant **node template**, and
perform a **full rebalancing** so all nodes become CLM-enabled ones (this step doubles as the demo's
own "replace-the-world" moment — point it out).

Verify the prereq state:

```bash
kubectl get pods -n castai-agent -l app.kubernetes.io/name=castai-live
kubectl get nodes -l live.cast.ai/migration-enabled=true
```

## 2. Deploy demo workloads

Use the ready demo apps from the tutorial (`clm-test-deployment`, `clm-test-single-replica`,
`clm-test-statefulset` with a small in-memory cache + customer-visible TCP connection).
The live controller auto-labels **eligible** workloads `live.cast.ai/migration-enabled=true` —
show the matrix of label semantics on the slide:

| `live.cast.ai/migration-enabled` | `autoscaling.cast.ai/removal-disabled` | `autoscaling.cast.ai/live-migration-disabled` | Evictor action |
|---|---|---|---|
| true | – | – | live-migrate on optimization |
| true | true | – | migrate; **recover on source node if migration fails** |
| – | – | true | traditional evict (no migration attempt) |

For the demo **StatefulSet**, highlight: without CLM a single-replica StatefulSet causes downtime on
rebalance; with CLM its memory cache survives the node move. If migration fails and the pod is not
marked `autoscaling.cast.ai/disposable=true`, the pod stays on the source node (no eviction fallback).

## 3. Trigger a rebalance (the thing Siemens will actually use)

**Console:** Rebalancer → *Prepare new plan* → scope (all nodes, or pick the nodes running the
demo workloads) → *Generate plan* → discuss the **plan preview** (new node set, cost delta) →
**Execute**.

Explain the flow while it runs (nodes are replaced one by one: create → warm → drain → delete):

- Plan statuses: *Generating → Ready → In progress → Completed* (Partial/Failed/Obsolete corners:
  drains blocked by PDBs come back as `drain-failed`; plans go Obsolete after ~1h).
- **Modes:** aggressive vs. non-aggressive — non-aggressive respects stricter drain policies;
  demonstrate non-aggressive first in the test cluster.
- During execution watch node labels `autoscaling.cast.ai/draining=rebalancing`.

**Watch migrations live:**

```bash
kubectl get migrations -A -w
kubectl describe migration <name> -n <namespace>
kubectl logs -n castai-agent -l app.kubernetes.io/name=castai-live --tail=50
```

While the migration runs, keep a client hammering the demo service — **the TCP session must not
drop**; that's the headline moment for the Siemens team.

## 4. Tie-in: the follow-up they'll care about

- Rebalancing is how the T3a-first strategy gets executed: once the T3a template schedules,
  a planned rebalance converges the cluster onto the discounted family.
- If worries about stateful workloads resurface: CLM + `disposable`/`removal-disabled` labels +
  non-aggressive rebalance is the safe combo; single-replica workloads → **deferred mode**
  (per workload-autoscaler discussion).
- Cleanup:

```bash
kubectl delete deployment clm-test-deployment clm-test-single-replica --ignore-not-found
kubectl delete statefulset clm-test-statefulset --ignore-not-found
kubectl delete service clm-test-svc --ignore-not-found
```

## 5. Scheduling note

The demo takes ~25–35 min including Q&A: 5 min prereq walkthrough, 5 min CLM enable + verify,
10 min apps + labels, 10–15 min live rebalance + client continuity check on camera.
