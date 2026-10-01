# Sources consulted

## Local files

- `/Users/eramadan/castai/castai-terraform-1/brain/notes/aks-agentpool-reserved-label.md` — verified
  research note: reserved-labels root cause on AKS, node-template contract, PodMutation bridge YAML,
  rollout order, feature-request status.
- `/Users/eramadan/castai/castai-terraform-1/support/siemens-aks-agentpool-label-conflict.md` —
  previously reviewed customer-facing reply draft for the same root cause; answer.md is adapted from
  it for the SiePortal ticket.
- `/Users/eramadan/castai/.kimchi/docs/sieportal-agent-pool-label-conflict.md` — SiePortal-specific
  investigation: confirms no alias/override exists, qualified-key and custom-key-spelling edge cases,
  rejected approaches (post-hoc relabeling, per-namespace mutations), solution options.
- `/Users/eramadan/castai/brain/skills/castai-support-engineer/lookup/knowledge-index.json` — index
  entry pointing at the sources above; confirmed the verified facts.

## URLs (referenced in the notes above; cited in answer.md)

- https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints — reserved labels/taints
  reference; AKS section lists `agentpool` and `kubernetes.azure.com/agentpool` with value `castai`,
  overwritten if set in a node template; required by AKS for node pool membership.
- https://docs.cast.ai/docs/node-templates — node templates; `scheduling.cast.ai/node-template`
  auto-label on provisioned nodes.
- https://docs.cast.ai/docs/nodetemplates-nodeconfiguration-and-labels — node template custom labels
  (console / Terraform `custom_labels` / API).
- https://docs.cast.ai/docs/pod-mutations-reference — PodMutation CRD: `filterV2.pod.celExpression`,
  `patchesV2` JSON Patch ops, `podEviction`.
- https://docs.cast.ai/docs/business-continuity — AKS rollback path (optional reassurance for the
  customer).

Note: live web search was unavailable in this session (no web-search API key configured); the URLs
above were previously verified and are cited from the dated local research notes (verification dates
2026-09). No repository files were modified; only `answer.md` and this `notes.md` were created in the
eval output directory.
