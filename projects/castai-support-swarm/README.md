# CAST AI Support Swarm

A 13-agent autonomous support engineering organization for CAST AI tickets:
email in → triage → evidence-based investigation → reproduction lab →
independent verification gate → human-sounding, claim-grounded draft out
(draft-only; a human sends).

**Core principle: the system does not answer when it thinks it knows — it
answers when it can show why the answer is correct.** If the verifier cannot
ground the answer in the evidence ledger, the customer gets an honest
"we're missing X" reply or an engineering escalation package, never a guess.

## Quick start

```bash
cd projects/castai-support-swarm

npm test                 # 243 unit + e2e tests (node:test, no network)
npm run eval             # evaluation harness: 7 real ticket scenarios
npm run demo             # answer fixtures/thread-pdb-scaledown.md
node bin/support-swarm.mjs answer <thread.md> [--live] [--strict] [--out <dir>]
```

Offline by default: `HeuristicLlm` (deterministic) + a simulated cluster lab.
`--live` uses an LLM provider (ANTHROPIC_API_KEY / OPENAI_API_KEY) and a
read-only CAST AI API client (CASTAI_API_KEY, base `CASTAI_API_BASE` —
this repo's default is `https://api.eu.cast.ai`).

Outputs land in `outbox/`: `*.md` reply drafts (draftOnly), JSON sidecars with
internal references for the human reviewer, JSONL agent traces, KB notes.

## Using it inside the DeepSeek Harness

```bash
npm run install:dsh        # installs the agent preset into ~/.dsh (idempotent;
                           # --dry-run to preview, --preset-root for custom roots)
```

That renders the `dsh-preset/` templates against this checkout and writes the
**CAST AI Support Swarm** agent preset to
`$DSH_HOME/.agent-presets/castai-support-swarm/` (or `~/.dsh/...`). The running
harness discovers it without a restart: create a session on this workspace,
pick **CAST AI Support Swarm** in the preset selector, paste a customer thread
— the session calls `support_swarm_answer` (thread → triage, plan, verdict,
confidence, draft reply) or `support_swarm_eval` (7-case harness). Runs are
OFFLINE in-session (HeuristicLlm + simulated lab); `--live` stays on the CLI.
The workspace skill `.agents/skills/castai-support-swarm/` routes pasted
threads to the tool in any session that discovers workspace skills.

## The organization

| # | Agent | Role |
|---|-------|------|
| 1 | Supervisor | Plans the case from the triage category; template-clamped plan (never the full 13 for a docs question) |
| 2 | Triage | Email → structured facts: category, provider, mode, questions, missing info |
| 3 | Researcher | KB/docs/prior-ticket research; quotable claims only (snippet hygiene) |
| 4 | SRE | Cluster/Runtime investigation checklist → environment evidence + hypotheses |
| 5 | Reproduction | Simulated lab: reproduces the blocker and proves the fix |
| 6 | QA | Test evidence (runner-backed vs lab-derived, honestly marked) |
| 7 | Product/Code | Local CAST AI source scan → code-confirmed evidence |
| 8 | Architect | Solution composition (cause-scoped vs customer-scoped rule corpora) |
| 9 | Security | Least-privilege IAM reasoning, grounded in real KB reads only |
| 10 | Verifier | The strict gate: hard proof OR ≥2 independent evidence classes; can send the case back |
| 11 | Writer | Human-style email; every first-person claim must be ledger-grounded (guard) |
| 12 | Escalation | Engineering package when the swarm can't resolve it |
| 13 | Knowledge | KB note so the next similar ticket starts smarter |

## The gates that keep it honest

- **Evidence ledger + confidence score**: deterministic points per distinct
  evidence type (doc 20 · code 25 · reproduced 25 · e2e 20 · environment 10);
  confidence gates: <60 needs-more-evidence → 80+ answer-with-evidence → 95+ verified.
- **Verifier**: claims with one DOCUMENTED source do not pass; seeded false
  claims are rejected and can never leak into the reply (adversarial eval case).
- **Writer guard**: "I checked / I reproduced / we verified / I ran the tests"
  each require matching evidence classes; ungrounded drafts are sanitized or
  discarded to a clarify reply.
- **No internal leaks**: customer bodies cite public docs.cast.ai links only;
  internal KB paths live in the draft's JSON sidecar for the reviewer.
- **Read-only posture**: CAST AI client exposes GET-only behind an allowlist,
  kubectl wrapper blocks mutations/secrets/impersonation, emails are drafts.

## Layout

```
src/core/     model (evidence ledger), llm, policy, guard, trace
src/agents/   the 13 agents + registry + base
src/tools/    castai (GET-only), kube (read-only), kb, email (draft-only), lab (sim)
src/pipeline/ runCase orchestrator (plan → fan-out → verify loop → gate → draft)
bin/          CLI          fixtures/   sample tickets
tests/        node --test  evals/      dataset, runner, EVALUATION.md
```

`CONTRACTS.md` is the binding module spec; `evals/EVALUATION.md` holds the
evaluation report (method, metrics, defects found, limitations).
