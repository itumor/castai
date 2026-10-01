# SiePortal ticket: `agentpool` nodeSelector never matches CAST AI nodes on AKS

**Bottom line for the ticket reply:** No — CAST nodes cannot carry a custom `agentpool` value, and that
is by design, not a bug. The supported way to target CAST provisioned capacity is CAST AI **node
templates** and the `scheduling.cast.ai/node-template` label (plus template **custom labels**). For
legacy workloads that already select on `agentpool`, a single value-agnostic **PodMutation** can
rewrite those selectors automatically so teams don't have to touch their manifests.

---

## 1. Why `agentpool=<poolname>` never matches CAST nodes

`agentpool` — and its modern, qualified successor `kubernetes.azure.com/agentpool` — are on CAST AI's
**reserved labels** list for AKS
([Autoscaler Node Labels and Taints](https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints)).
CAST AI's docs are explicit:

> Cast AI reserves the labels and taints listed in this document. If you configure any of these in a
> Node Template, Cast AI will **overwrite your values** with the ones it determines.

On AKS specifically, **every node must carry a pool identity** — it is how AKS tracks node pool
membership. CAST AI provisioned nodes are therefore always stamped:

- `kubernetes.azure.com/agentpool: castai`
- `agentpool: castai` (deprecated pre-k8s-1.24 key, still present/replaced by the qualified key)

Anything a node template sets for these keys is silently overwritten with `castai` — exactly what
SiePortal is observing. Because AKS itself requires the label, CAST AI **cannot remove it, delegate
it, or let customers set its value**. There is no configuration, alias, or override — confirmed
against the reserved-labels reference and the changelog (Oct 2025 → Jul 2026); nothing ever shipped a
pool-label override.

Consequence: pods with `nodeSelector` or `nodeAffinity` on `agentpool=<their-pool>` can **never**
match CAST nodes — they stay pending or land only on classic AKS VMSS pools (which CAST AI never
touches, so the old label contract keeps working there).

**Do not propose** post-hoc relabeling (Kyverno/DaemonSet rewriting `agentpool` on nodes): AKS
reconciles that label from platform state, so it fights the control plane and is fragile.

## 2. The supported contract: node templates

CAST AI's placement contract is the **node template**, not the AKS pool label:

- Every node provisioned from a template is automatically labeled
  `scheduling.cast.ai/node-template: <template name>` (plus
  `scheduling.cast.ai/node-template-version`).
- Templates also accept arbitrary **custom labels** via the console, Terraform (`custom_labels`), or
  the API — so an org can define its own key (e.g. `sieportal/pool: <name>`).
- Pods target a template with a plain `nodeSelector` on those labels; the autoscaler provisions
  matching nodes.

**Recommended end state:** create **one node template per former `agentpool` value, named identically
to the old pool value**. That restores the exact pool semantics — per-template instance constraints,
spot/on-demand policy, min/max limits — and workloads select:

```yaml
nodeSelector:
  scheduling.cast.ai/node-template: <their-old-pool-name>
```

## 3. Zero-manifest-change bridge: one value-agnostic PodMutation

If SiePortal can't rewrite every workload's manifests now, the CAST AI
[Pod mutations feature](https://docs.cast.ai/docs/pod-mutations-reference) (`PodMutation` CRD,
cluster-scoped, GA) can rewrite their legacy selectors automatically — **one permanent rule, not
per-namespace/per-workload mutations**:

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

- The `copy` op carries the **value** over: any `agentpool: X` becomes
  `scheduling.cast.ai/node-template: X`. New namespaces, teams, and workload types need zero changes —
  the only contract is "template name = old pool value." (`~1` is the RFC 6901 escape for `/`.)
- `podEviction.enabled: true` (plus mutator-level enforcement) evicts and recreates running
  non-conforming pods with the fix applied — no manual restarts.
- Namespaces that must keep landing on classic AKS VMSS pools stay untouched via `excludeNamespaces`
  (or scope with a namespace regex) — the legacy `agentpool` contract keeps working there unchanged.

**Suggested rollout order:**

1. Create the node templates **first** (named like the legacy pool values) — otherwise rewritten pods
   sit pending.
2. Install the PodMutation with `podEviction` **disabled**; verify one namespace via the
   `pod-mutations.cast.ai/podmutation-applied-patch` pod annotation.
3. Enable `podEviction` + mutator enforcement to migrate running workloads.
4. Team-by-team, replace `agentpool` selectors in manifests with
   `scheduling.cast.ai/node-template`; shrink/retire the mutation as adoption completes.

**Caveats to validate in a dev cluster first:**

- Confirm the exact CEL dialect against the customer's pod-mutator version. Fallback: one PodMutation
  per pool value (still a handful of platform-owned rules, not per-team work).
- If some manifests select on the **qualified** key `kubernetes.azure.com/agentpool`, install a second
  identical mutation with pointer `/spec/nodeSelector/kubernetes.azure.com~1agentpool`. Same trick for
  any other custom key spelling they actually use.
- Workloads using **nodeAffinity** on `agentpool` (rather than `nodeSelector`) need a separate patch
  path; best to standardize those manifests to `nodeSelector` during migration.
- Worth one read-only check before writing YAML — confirm which selector key(s) their manifests really
  use:
  ```bash
  kubectl get nodes -l provisioner.cast.ai/managed-by=cast.ai \
    -L agentpool,kubernetes.azure.com/agentpool,scheduling.cast.ai/node-template
  kubectl get podmutations.pod-mutations.cast.ai -o yaml | grep -n agent
  ```

## 4. Longer-term

- **Custom labels**: adding an org-owned key (e.g. `sieportal/pool: <name>`) on each template is the
  cleanest collision-proof target for new workloads; teams can migrate selectors to it over time.
- **Feature request**: we can file an ask to make the AKS pool-label *value* configurable (derived
  from the node configuration name instead of hard-coded `castai`). Odds are low — the label itself is
  an AKS platform requirement — but it's worth tracking with their cluster IDs attached. Do not gate
  the fix on it.

---

### Assumptions / notes

- The ticket says `agentpool=<poolname>`; taken at face value. If SiePortal actually selects on the
  qualified `kubernetes.azure.com/agentpool` or another custom key, the root cause and strategy are
  identical — only the mutation's JSON pointer changes (checked via the commands above).
- Draft for human review before sending to the customer, per the support workflow.
