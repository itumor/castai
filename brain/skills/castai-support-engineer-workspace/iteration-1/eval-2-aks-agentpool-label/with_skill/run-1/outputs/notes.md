# Sources consulted — eval-2-aks-agentpool-label

## Skill routing

- `/Users/eramadan/castai/brain/skills/castai-support-engineer/SKILL.md` — skill instructions (source grounding, honesty rules, concise support style).
- `/Users/eramadan/castai/brain/skills/castai-support-engineer/lookup/knowledge-index.json` — topic routing; matched local knowledge and reply exemplar for "AKS agentpool label".

## Local knowledge (verified prior-case facts)

- `/Users/eramadan/castai/.kimchi/docs/sieportal-agent-pool-label-conflict.md` — consolidated SiePortal investigation: reserved-label root cause, no override exists, supported contract, solution options, rollout order.
- `/Users/eramadan/castai/castai-terraform-1/support/siemens-aks-agentpool-label-conflict.md` — gold-standard reviewed customer reply exemplar (structure, PodMutation YAML, caveats, rollout, verify commands).
- `/Users/eramadan/castai/castai-terraform-1/brain/notes/aks-agentpool-reserved-label.md` — prior Siemens AKS escalation note (same root cause; hardened zero-maintenance selector-rewrite pattern).

## Official sources (verified live 2026-09-25, via `.md` markdown endpoints)

- https://docs.cast.ai/docs/autoscaler-reference-node-labels-and-taints (page updated 2026-09-04) — reserved-labels warning ("overwrite your values… do not configure"); AKS: `kubernetes.azure.com/agentpool` "Set to `castai`… Required by AKS for node pool membership"; `agentpool` deprecated legacy key; `scheduling.cast.ai/node-template` label + taint entries.
- https://docs.cast.ai/docs/node-templates (updated 2026-09-23) — explicit template selector as recommended matching path; custom labels; `shouldTaint` default tainting behavior; nodeAffinity `In`-only.
- https://docs.cast.ai/docs/pod-mutations-reference (updated 2026-09-10) — `filterV2.pod.celExpression`, `patchesV2` RFC 6902 ops (copy/remove/add), `podEviction.enabled` + mutator enforcement, one-mutation-per-pod specificity rule, `podmutation-applied-patch` verification annotation, and the official "Azure agentpool migration" patch example.
- https://docs.cast.ai/changelog.md (+ https://docs.cast.ai/changelog index HTML) — monthly release-notes index Oct 2025 → Jul 2026; zero `agentpool`-related hits, confirming no pool-label override/rename/alias shipped (consistent with the 10-month changelog scan recorded in the local notes).

## Notes

- `web_search` was unavailable in this environment (missing API key); verification was done with `web_fetch` and direct `curl` of the docs' published `.md` endpoints instead.
- Disk artifacts created: only `answer.md` and `notes.md` in this output directory, plus temp fetches under `/tmp` (not in the repo).
