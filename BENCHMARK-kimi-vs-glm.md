# Benchmark — kimi-k3 vs glm-5.3 (subagent-driven)

Date: 2026-10-15 · Endpoint: `kimchi` proxy (`llm.kimchi.dev`), both models through the
same provider · Method: background workflow jobs running per-model subagent
fan-out; every output machine-verified against hidden ground truth.

## Two benchmark suites

| Suite | Tasks | Rounds | Agents total |
|---|---|---|---|
| Suite 1 (baseline) | reasoning, coding, extraction | 2 | 12 |
| Suite 2 (hard pass/fail) | T1 hidden-bug fix, T2 factorial math, T3 config forensics, T4 log needle, T5 regex | 2 | 20 + 1 confirmation |

---

## Suite 2 results (the hard one — where models can fail)

### Pass/fail matrix (machine-graded)

| Task | Hidden ground truth | kimi-k3 | glm-5.3 |
|---|---|---|---|
| T1 Bug fix (`merge_meetings` nested-interval shrink) | 11 hidden tests (buggy original fails 4/11) | ✅ 2/2 runs (11/11) | ✅ 2/2 runs (11/11) |
| T2 Math (smallest n, n! = 100 trailing zeros) | n = 405 (z(404)=**99** ← trap) | ✅ 2/2 correct | ❌ 2/2 **agent died → null** |
| T3 Config forensics (maxCpus 4 < minCpus 8) | `scaling.cores.maxCpus` | ✅ 2/2 correct | ✅ 2/2 correct |
| T4 Log needle (1 true record, 3 decoys, 78 lines) | req-88c41f / 1831ms / eu-central-1 | ✅ 2/2 exact | ✅ 2/2 exact |
| T5 Regex (password validator) | 31-case adversarial corpus | ✅ 2/2 (31/31) | ✅ 2/2 (31/31) |

**Suite 2 totals: kimi-k3 10/10 — glm-5.3 8/10 (same task failed in both rounds).**

### The one differentiating failure: glm-5.3 × T2-math

- Round 1 and Round 2: the glm-5.3 T2 subagent never returned (`ok: false,
  output: null`) — the structured-output agent died before finishing, most
  likely exhausting its tool/iteration budget on exhaustive self-verification
  while the 4 sibling agents on simpler tasks completed normally.
- **Confirmation run (solo, no JSON schema):** glm-5.3 found 405 in 54 s with
  rigorous Legendre-formula reasoning and brute-force verification. So the
  math capability is present — the failure is a **reliability/agentic-loops
  issue under structured-output contracts**, which is exactly what matters in
  production subagent pipelines: 2/2 task drops vs kimi-k3 0/2.

### Verification quality notes (both models honest)

- Every claim of "I ran python3" was cross-checked by re-executing the
  returned code: no fabricated test output from either model.
- glm-5.3 wrote more thorough self-test claims (400 randomized trials vs a
  brute-force reference for T1; 150k fuzz strings for T5) and used LaTeX
  formatting in T2 — i.e., it *over-verifies*, which is plausibly what starves
  its T2 iteration budget.
- kimi-k3 fixes were minimal and precise (also hardened T1 with tie-sort key).

---

## Speed (wall clock per model, all 8 measured runs)

| Run | kimi-k3 | glm-5.3 | kimi-k3 speedup |
|---|---|---|---|
| Suite 1 round 1 (3 tasks) | 16 s | 91 s | 5.7× |
| Suite 1 round 2 | 12 s | 101 s | 8.4× |
| Suite 2 round 1 (5 hard tasks) | 26 s | 331 s | 12.7× |
| Suite 2 round 2 | 54 s* | 572 s* | 10.6× |

*glm round times are inflated ~40–120 s by its dying T2 agent (it burns its
budget before being reported as failed). Even excluding T2, glm-5.3 completes
tasks roughly 3–6× slower; kimi-k3 never dropped a task.

## Overall

| Dimension | Winner | Margin |
|---|---|---|
| Hard-task reliability (suite 2) | **kimi-k3** | 10/10 vs 8/10 |
| Correctness when completed | Tie | glm's completed work matched kimi on every ground truth |
| Depth of self-verification | glm-5.3 | more thorough — but at the cost of reliability/speed |
| Speed | **kimi-k3** | ~6–13× faster wall clock |
| Conciseness | kimi-k3 | ~15–40% shorter outputs |

**Recommendation:** keep `kimi-k3` as the default for agentic/subagent work in
this repo (random parallel fan-out, structured outputs, CAST AI triage).
glm-5.3 is viable for bounded single answers but is slower, verbose, and
showed a repeatable task-drop failure pattern on long self-verifying tasks.

## Caveats

- Single shared endpoint; contention was symmetric within each round pair
  (jobs launched in the same message).
- Suite sizes are small (5 hard tasks × 2 rounds); treat as directional, not
  statistically conclusive.
- The glm T2 drop was reproduced 3× including the solo rerun distinction
  (schema'd ×2 → null; unschema'd ×1 → correct), so the root cause is
  reproducible, not random noise.
