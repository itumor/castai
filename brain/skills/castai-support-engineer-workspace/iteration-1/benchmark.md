# Skill Benchmark: castai-support-engineer

**Model**: <model-name>
**Date**: 2026-09-25T17:19:13Z
**Evals**: 1, 2, 3 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 100% ± 0% | +0.00 |
| Time | 58.0s ± 16.4s | 27.9s ± 20.6s | +30.1s |
| Tokens | 0 ± 0 | 0 ± 0 | +0 |

## Analyst notes

- INTERPRET WITH CARE — baseline contamination: the skill and its lookup/knowledge-index.json live inside the searched repo, so every baseline agent discovered and used the same verified runbooks (one even read knowledge-index.json directly). Pass-rate deltas understate the skill's value in this setup.

- All 17 assertions passed in BOTH configurations (100% vs 100%) — the assertion set saturates and cannot discriminate. The real signal is in the graders' fact-checks of claims[], not pass_rate.

- FACT-CHECK (the meaningful delta): with_skill runs produced ZERO false claims across all 3 evals; every run live-fetched official sources (OpenAPI spec, docs pages, changelog) to verify claims. Baselines produced 2 confirmed false/unsubstantiated claims: (a) eval-3 stated the India region base URL as https://api.in.cast.ai — no official source supports it; docs.cast.ai/docs/api-access documents https://api.india.cast.ai, which the with_skill run used; (b) eval-2 claimed the root cause was 'confirmed against the changelog' despite having no live web access — an overstated verification claim. Baseline eval-1 also cited a docs URL it never fetched.

- Verification behavior diverged sharply: with_skill runs fetched live official sources in 3/3 cases (spec downloads + jq, docs .md endpoints); baselines relied on repo-local snapshots and notes in 3/3 cases. Since the question set touches things that drift (APIs, labels), this is the behavior the skill is designed to force.

- Timing/tokens are unreliable in this harness (no token counts exposed; wall-clock approximated from file mtimes, which batch oddly). Directionally, with_skill runs took longer (40-73s vs 6-47s) — the cost of live verification. Treat these columns as noise.

- Grader-suggested eval improvements for iteration 2 (consistent across all 6 graders): (1) citation assertion should require the cited URL to resolve AND support the specific claim (a fabricated-but-plausible URL currently passes); (2) add accuracy assertions pinning exact facts — region URLs, exact endpoint paths, DELETE /v1/auth/tokens/{id} semantics; (3) add negative assertions against harmful advice (e.g., proposing node-level relabeling of agentpool); (4) eval-2 migration-path assertion should check PodMutation YAML field validity, not just presence.

- Non-discriminating assertions (pass 100% both sides, by design or by contamination): reserved-label identification, 401-region diagnosis, EU base URL, X-API-Key header, old-token validity window. Keep them as regression guards, not as value signals.

