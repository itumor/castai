# AKS `agentpool` label conflict with CAST AI-managed nodes

**Status:** Verified against CAST AI docs (2026). Siemens escalation — see `support/siemens-aks-agentpool-label-conflict.md` for the customer draft.

## Root cause (documented, not a bug)

CAST AI's [Autoscaler Node Labels and Taints reference](https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints) states:

> **Important: Reserved Labels and Taints** — Cast AI reserves the labels and taints listed in this document. If you configure any of these in a Node Template, Cast AI will overwrite your values with the ones it determines based on the node's instance type, cloud provider, and feature configuration.

Under **Cloud Provider Specific → AKS (Azure)**:

| Label | Value | Why |
|---|---|---|
| `kubernetes.azure.com/agentpool` | `castai` | Set to `castai` for Cast AI provisioned nodes. **Required by AKS for node pool membership.** |
| `agentpool` (deprecated) | `castai` | Deprecated AKS agent-pool label (pre k8s 1.24), still present/replaced by the qualified key. |

Consequences:
1. CAST AI provisioned nodes always carry `agentpool=castai` (and `kubernetes.azure.com/agentpool=castai`). AKS cannot run a node without pool membership, so CAST AI cannot remove or delegate this label.
2. If a node template sets `agentpool=<custom>`, CAST AI **overwrites it** with `castai`. The template's value never survives.
3. Pods with `nodeSelector`/`nodeAffinity` on `agentpool=<siemens-pool>` can **never** match CAST AI nodes. They stay pending or land only on classic AKS VMSS pools.

## The CAST AI-native placement contract

Instead of AKS pool labels, CAST AI targets workloads via **node templates**:

- Every node provisioned from a template is auto-labeled `scheduling.cast.ai/node-template: <template name>` (+ `…/node-template-version`).
- Templates also accept **custom labels** (UI, Terraform `custom_labels`, API) — multi-label supported (confirmed in the [Node Templates FAQ](https://docs.cast.ai/docs/nodetemplates-nodeconfiguration-and-labels)).
- Workloads select a template with `nodeSelector` (or nodeAffinity) on those labels; the autoscaler provisions matching nodes. A template with no taints + matching selector also still gets spot fallback behavior.

So the durable end-state is: **one node template per former "pool"**, named the same as the old `agentpool` value, and pods select `scheduling.cast.ai/node-template: <pool>`.

## Bridge: zero-maintenance selector rewrite (customer workaround, hardened)

The pain isn't mutations themselves — it's **per-workload, per-namespace maintenance**. The CAST AI [Pod mutations feature](https://docs.cast.ai/docs/pod-mutations-reference) (`PodMutation` CRD, cluster-scoped, `pod-mutations.cast.ai/v1`) supports enough to make this **one rule, forever**:

- `filterV2.pod.celExpression` — CEL over the full pod object → can detect the legacy selector.
- `patchesV2[].operations` — RFC 6902 JSON Patch → `copy` + `remove` rewrites it, **value-agnostic**.
- `podEviction.enabled: true` (plus mutator-level enforcement) → running non-conforming pods get evicted/recreated and receive the fix. No manual restarts.

Single value-agnostic PodMutation (requires a node template named identically to each legacy pool value):

```yaml
apiVersion: pod-mutations.cast.ai/v1
kind: PodMutation
metadata:
  name: rewrite-agentpool-to-node-template
spec:
  filterV2:
    workload:
      excludeNamespaces:
        - { type: exact, value: kube-system }
        - { type: exact, value: castai-agent }
    pod:
      celExpression: >-
        has(object.spec.nodeSelector) && 'agentpool' in object.spec.nodeSelector
  patchesV2:
    - operations:
        - op: copy
          from: /spec/nodeSelector/agentpool
          path: /spec/nodeSelector/scheduling.cast.ai~1node-template
        - op: remove
          path: /spec/nodeSelector/agentpool
  podEviction:
    enabled: true
```

Notes:
- `~1` is RFC 6901 escaping for `/` inside the label key — required for `scheduling.cast.ai/node-template`.
- Because the CEL filter guarantees `agentpool` exists in `nodeSelector`, both patch ops are always applicable.
- Validate the exact CEL dialect in-cluster (docs show the field exists; dialect examples are thin). Fallback without CEL: one PodMutation per pool value using pod-label or namespace regex matchers — still a handful of cluster-owned rules, not per-team work.
- Namespace scoping variant: `filterV2.workload.namespaces` accepts `type: regex` (e.g. `^(team-a|sims-.*)$`). Namespace **labels** are not supported as matchers — if the anchor must be a namespace label, use Kyverno/Gatekeeper instead (mutate rule with `namespaceSelector`).
- Edge case: workloads using **nodeAffinity** on `agentpool` instead of `nodeSelector` need a second mutation targeting the affinity sub-path, or a standardization pass on the manifests (preferred — affinity on pool labels is what got Siemens here).

## Rollout order (important)

1. Create node templates first — same names as legacy `agentpool` values. Without a matching template, rewritten pods go pending.
2. Install the PodMutation with `podEviction` disabled; verify on one namespace (`pod-mutations.cast.ai/podmutation-applied-patch` pod annotation shows the applied patch).
3. Enable `podEviction` + mutator enforcement to drag running pods onto the new contract.
4. Team-by-team, replace `agentpool` selectors in manifests with `scheduling.cast.ai/node-template`; shrink the mutation's regex scope as adoption completes.

Workloads that must stay on classic AKS VMSS pools: exclude their namespaces via `excludeNamespaces` — the legacy `agentpool` contract keeps working unchanged there because CAST AI never touches those pools.

## Escalation (feature request to CAST AI engineering)

Request: make the AKS pool label **value** configurable per node configuration (e.g. `agentpool`/VMSS pool name derived from the node configuration name instead of hard-coded `castai`). The label itself is an AKS requirement and can't be dropped, but its value could be namespaced. Track via support ticket → Jira (`castai-autoscaler` / AKS component). Not guaranteed; treat the PodMutation/template approach as the durable answer.

## Verification

```bash
# Confirm CAST nodes carry agentpool=castai (the conflict, live)
kubectl get nodes -l provisioner.cast.ai/managed-by=cast.ai \
  -L agentpool,kubernetes.azure.com/agentpool,scheduling.cast.ai/node-template

# Confirm a pod got rewritten (annotation added by the mutator)
kubectl get pod <pod> -n <ns> \
  -o jsonpath='{.metadata.annotations.pod-mutations\.cast\.ai/podmutation-applied-patch}'

# Confirm template targeting works
kubectl get nodes -l scheduling.cast.ai/node-template=<template-name>
```

## References

- [Autoscaler Node Labels and Taints (reserved list incl. AKS `agentpool`)](https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints)
- [Node Templates, Node Configuration and Labels FAQ](https://docs.cast.ai/docs/nodetemplates-nodeconfiguration-and-labels)
- [Node Templates](https://docs.cast.ai/docs/node-templates)
- [Pod mutations reference (PodMutation CRD)](https://docs.cast.ai/docs/pod-mutations-reference)
