# Reply to Siemens — `agentpool` label conflict with CAST AI-managed nodes

**To:** Siemens platform team
**Subject:** `agentpool` label on CAST AI nodes — why it's reserved, and a zero-maintenance migration path

---

Hi,

Thanks for laying out the three points so clearly — your summary is accurate on all counts, and I was able to confirm each one against our documentation and the AKS platform behavior. Here is the root cause, and a way to keep your current workaround but eliminate the ongoing maintenance entirely.

## Root cause

`agentpool` (and its successor `kubernetes.azure.com/agentpool`) is on CAST AI's **reserved labels** list. From our [Autoscaler Node Labels and Taints reference](https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints):

> Cast AI reserves the labels and taints listed in this document. If you configure any of these in a Node Template, Cast AI will overwrite your values with the ones it determines.

For AKS specifically, every node must carry a pool identity — it is how AKS tracks node pool membership. CAST AI-provisioned nodes are therefore always stamped `kubernetes.azure.com/agentpool: castai`, and any value a node template sets for these keys is overwritten. This is an AKS platform requirement, not something a node template can opt out of — so we currently **cannot** let you mint CAST nodes with `agentpool=<your-pool>`.

The practical effect is what you observed: pods selecting `agentpool=<pool>` never match CAST AI nodes, and template-level use of that label silently does nothing (or schedules incorrectly).

## The supported contract: node template labels

CAST AI's placement contract is the **node template** itself. Every node provisioned from a template is automatically labeled:

```
scheduling.cast.ai/node-template: <template name>
```

Pods target a template with a plain `nodeSelector` on that label (templates also support arbitrary custom labels if you want an org-owned key). Creating one node template per former `agentpool` value — using the same names — gives you the exact pool semantics back, including per-template instance constraints, spot/on-demand policy, and min/max limits. Custom labels on templates are supported via the console, Terraform (`custom_labels`), and the API.

## Removing the maintenance burden from your workaround

The part that hurts is updating mutations for every new workload type or namespace. The Pod mutations feature (which you're already using) supports three things that collapse this into **one permanent, cluster-scoped rule**:

1. A **CEL filter** over the pod spec to detect the legacy selector.
2. A `copy` + `remove` JSON patch that rewrites it **value-agnostically** — any `agentpool: X` becomes `scheduling.cast.ai/node-template: X`.
3. **`podEviction`** — running pods that don't match the rule are evicted and recreated with the fix applied, so existing workloads migrate without manual restarts.

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

Because the value is copied, not enumerated, **new namespaces, new workload types, and new teams require zero changes** — the only contract is "your node template is named like your old pool." If some namespaces must keep landing on your classic AKS VMSS pools (where the old label contract still works), exclude them with `excludeNamespaces`, or scope the rule with a namespace regex (`filterV2.workload.namespaces` supports `type: regex`).

Two caveats to validate in a dev cluster first:
- Confirm the exact CEL dialect against your pod mutator version. If CEL is unavailable, the fallback is one PodMutation per pool value — still a handful of platform-owned rules rather than per-team work.
- Workloads using **nodeAffinity** on `agentpool` (instead of `nodeSelector`) need a separate patch path; we recommend standardizing those manifests to `nodeSelector` during migration.

## Suggested rollout

1. **Create the node templates first**, named identically to the legacy `agentpool` values — otherwise rewritten pods will sit pending.
2. Apply the PodMutation with `podEviction.enabled: false` and verify one namespace: check the `pod-mutations.cast.ai/podmutation-applied-patch` annotation on a recreated pod.
3. Enable `podEviction` (and pod mutator enforcement) to migrate running workloads automatically.
4. As teams touch their manifests, have them replace the `agentpool` selector with `scheduling.cast.ai/node-template` directly; once adoption is high you can narrow or retire the mutation.

## Longer-term ask

I can also file a feature request on your behalf: make the AKS pool label **value** configurable per node configuration (derived from the configuration name, instead of hard-coded `castai`). I can't promise a timeline — the label itself is non-negotiable on the AKS side — but it's a reasonable ask and worth tracking. Let me know and I'll open it with your cluster IDs attached.

## Verify

```bash
# CAST nodes carry the reserved labels (the conflict, live):
kubectl get nodes -l provisioner.cast.ai/managed-by=cast.ai \
  -L agentpool,kubernetes.azure.com/agentpool,scheduling.cast.ai/node-template

# A rewritten pod shows the applied patch:
kubectl get pod <pod> -n <ns> \
  -o jsonpath='{.metadata.annotations.pod-mutations\.cast\.ai/podmutation-applied-patch}'
```

Happy to walk through this on a call, or review the node template definitions before you apply them.

Best,
Ebrahim
CAST AI Support Engineering
