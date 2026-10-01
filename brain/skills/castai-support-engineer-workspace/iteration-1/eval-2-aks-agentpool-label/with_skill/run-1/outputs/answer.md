# SiePortal (AKS) — `agentpool` label on CAST AI nodes: what to tell them

**Short answer:** No — there is no way to make CAST AI-provisioned nodes carry SiePortal's own `agentpool` value on AKS, and this is documented, intended behavior (not a bug). The supported way to target CAST node pools is the node template label `scheduling.cast.ai/node-template` (or template custom labels). If they can't rewrite selectors yet, one cluster-scoped, value-agnostic **PodMutation** can bridge every existing `agentpool` selector to the matching node template with zero per-team work.

**Assumptions made:** the selector key is the legacy unqualified `agentpool` exactly as written in the ticket (not `kubernetes.azure.com/agentpool`); they run CAST AI node templates already; the pod-mutations mutator is (or can be) installed. One `kubectl` check below confirms the key spelling before writing YAML.

---

## 1. Root cause — why their template value never survives

`agentpool` (and its successor `kubernetes.azure.com/agentpool`) are on CAST AI's **reserved labels** list. From the [Autoscaler Node Labels and Taints reference](https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints) (verified live, page updated 2026-09-04):

> Cast AI reserves the labels and taints listed in this document. If you configure any of these in a Node Template, Cast AI will **overwrite your values** with the ones it determines. … **Do not configure these reserved labels or taints in Node Templates.** Doing so will not produce the expected result, and may cause pods to not be scheduled correctly.

The AKS section of the same page lists `kubernetes.azure.com/agentpool` as "**Set to `castai` for Cast AI provisioned nodes. Required by AKS for node pool membership**" and `agentpool` as the deprecated pre-k8s-1.24 equivalent. On AKS every node must carry a pool identity — that is how AKS tracks node pool membership — so CAST AI **cannot remove, rename, or delegate this label**, and no Node Template value for it will ever survive. This is an AKS platform requirement, not something a template can opt out of.

Practical effect (exactly what they observed): pods with `nodeSelector: agentpool=<pool>` never match CAST nodes, and setting `agentpool` in a node template silently does nothing.

## 2. The supported targeting contract: node templates

CAST AI's placement contract is the **node template** itself, per the [Node Templates doc](https://docs.cast.ai/docs/node-templates) (verified live, updated 2026-09-23):

- Every node provisioned from a template is automatically labeled `scheduling.cast.ai/node-template: <template name>`.
- Pods select a template with a plain `nodeSelector` (or `nodeAffinity`, operator `In` only) on that label. This is the **explicit, recommended** matching path: the autoscaler does a direct name lookup and ignores fuzzy custom-label matching.
- Templates additionally accept **arbitrary custom labels** (console, Terraform `custom_labels`, API) if they want an org-owned key — but they cannot rename or alias CAST AI's keys.
- One template per former `agentpool` value, **named identically to the old pool value**, reproduces the exact pool semantics (per-template instance constraints, spot/on-demand policy, limits).

So "the supported way to target CAST node pools" = `nodeSelector: scheduling.cast.ai/node-template: <pool>` (plus template custom labels if desired), not the AKS `agentpool` key.

## 3. Zero-rewrite bridge: one value-agnostic PodMutation

If updating every manifest is the blocker, the [Pod mutations feature](https://docs.cast.ai/docs/pod-mutations-reference) (verified live, updated 2026-09-10) supports a single permanent, cluster-scoped rewrite — the official reference even ships an "**Azure agentpool migration**" patch example, so this is a known, supported pattern:

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
        # needed only if the templates are tainted (shouldTaint: true, the default);
        # Exists tolerates any template value, so this stays value-agnostic:
        - op: add
          path: /spec/tolerations/-
          value:
            key: scheduling.cast.ai/node-template
            operator: Exists
            effect: NoSchedule
  podEviction:
    enabled: true
```

Because the value is **copied, not enumerated**, any `agentpool: X` becomes `scheduling.cast.ai/node-template: X` — new namespaces, workloads, and teams need zero new rules. The only contract is "template name = old pool value." `podEviction.enabled: true` (plus enforcement enabled at the mutator level) migrates already-running pods without manual restarts; otherwise existing pods only pick up the rewrite on recreation.

## 4. Caveats to flag before they apply it

- **Template taints.** Templates taint nodes by default with `scheduling.cast.ai/node-template: <name>:NoSchedule`. Either create the templates untainted (`shouldTaint: false`) or keep the toleration op in the mutation above (or both).
- **One mutation per pod.** If other PodMutations already match these pods, only the most specific one is applied (specificity scoring: workload name > pod labels > namespace). Check existing mutations first: `kubectl get podmutations.pod-mutations.cast.ai`.
- **CEL dialect.** Docs confirm `celExpression` exists but dialect examples are thin — validate in a dev cluster. Fallback: one PodMutation per pool value with plain matchers (still cluster-owned, not per-team).
- **nodeAffinity users.** Workloads selecting on `agentpool` via `nodeAffinity` (not `nodeSelector`) need a second patch path; better to standardize those manifests to `nodeSelector` during migration.
- **Key spelling.** If some teams use the qualified key, install a second identical mutation with JSON pointer `/spec/nodeSelector/kubernetes.azure.com~1agentpool`.
- **Namespaces that must stay on classic AKS VMSS pools.** Keep them untouched via `excludeNamespaces` — CAST AI never relabels non-CAST pools, so the legacy contract keeps working there.
- **Feature request.** Offer to file one (configurable pool-label *value*, e.g. derived from the node configuration name). Low odds — the label itself is an AKS platform requirement — and they shouldn't gate progress on it.

## 5. Suggested rollout

1. **Create the node templates first**, named identically to the legacy `agentpool` values — otherwise rewritten pods sit pending.
2. Apply the PodMutation with `podEviction.enabled: false` and verify one namespace (annotation check below).
3. Enable `podEviction` + mutator enforcement to migrate running workloads automatically.
4. As teams touch manifests, replace `agentpool` selectors with `scheduling.cast.ai/node-template` natively; shrink/retire the mutation once adoption is high.

## 6. Verify

```bash
# CAST nodes carry agentpool=castai + their template label (the conflict, live):
kubectl get nodes -l provisioner.cast.ai/managed-by=cast.ai \
  -L agentpool,kubernetes.azure.com/agentpool,scheduling.cast.ai/node-template

# A rewritten pod shows the applied patch:
kubectl get pod <pod> -n <ns> \
  -o jsonpath='{.metadata.annotations.pod-mutations\.cast\.ai/podmutation-applied-patch}'

# Template targeting works:
kubectl get nodes -l scheduling.cast.ai/node-template=<template-name>
```

---

### Sources (for the ticket reply)

- [Autoscaler Node Labels and Taints — reserved labels, AKS section](https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints)
- [Node Templates — template label, custom labels, explicit selector, taints](https://docs.cast.ai/docs/node-templates)
- [Pod mutations reference — filterV2/CEL, patchesV2, podEviction, Azure agentpool migration example](https://docs.cast.ai/docs/pod-mutations-reference)

All three verified live today; behavior matches repo notes from the prior identical Siemens AKS escalation (Sep 2026). No override/alias/rename for the AKS pool label exists in docs or in the changelog (scan Oct 2025 → Jul 2026, plus zero `agentpool` hits on the changelog index today).
