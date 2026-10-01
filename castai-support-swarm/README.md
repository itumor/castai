# castai-support-swarm

Multi-agent support-case investigator for CAST AI customers. Reads an inbound
support email, triages it, plans and fans out specialist investigations against
read-only data sources, adversarially verifies every claim against an evidence
ledger, and produces a linted customer-reply **draft** (never sent) — or a
redacted escalation package when the evidence does not support an answer.

## Architecture

```
email ──► intake ──► triage-agent ──► supervisor (plan only, never executes)
                                        │
                        routeToAgents(issueCategory) ──► investigating (fan-out)
                                        │
   docs-researcher   sre-investigator   reproduction-engineer   qa-engineer
   product-engineer  cloud-security-engineer   solution-architect
                                        │
                          solution proposal (from confirmed hypotheses)
                                        │
                              verifier (adversarial, deterministic) ──► VERIFY_FAIL
                                        │                                    │ (max 2 loops)
                     confidence gate (scoreFromLedger, < 60 → ESCALATE)      re-plan
                                        │ VERIFY_PASS
                              support-writer ──► claim-honesty lint (max 2 retries)
                                        │
                              knowledge-agent (proposes KB text, never writes)
                                        │
                                      done ──► draft.md / ledger.json / verdict.json
                                            ──► escalation.json (redacted debug package)
```

14 agents total: triage, supervisor, 7 investigation specialists, verifier,
support-writer, escalation-agent, knowledge-agent. Gates: VERIFY_FAIL loop
guard, deterministic confidence gate, claim-honesty lint, permission matrix
(per-agent adapter access), KB symlink jail + secret refusal, redaction on all
evidence and outputs.

## Commands

```bash
npm test                     # unit + e2e + integration tests (integration auto-skip)
npm run test:evals           # eval harness self-tests (scorer math + corrupted-brain self-test)
npm run eval                 # run the 3 eval cases, write evals/report.{json,md}
node src/cli.js <email-file> # run a single email through the swarm (mock adapters)
```

Eval cases live in `evals/cases/<id>/{input.md, brain.json, expected.json}`;
per-run artifacts land in `evals/out/` (gitignored). `npm run eval` exits 1 if
any case totals below 80.

## Environment variables (all opt-in; defaults are fully mocked)

| Variable | Effect |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `SWARM_MODEL` | Real LLM brain instead of mocks (brains use raw fetch) |
| `SWARM_REPRO_ALLOW_CLUSTER` | Explicit opt-in required before any sandbox reproduction against a real cluster |
| `SWARM_INT_MCP=1` + `CASTAI_API_KEY` | Integration test: MCP roundtrip against the real castai-mcp-server |
| `SWARM_INT_KUBECTL=1` | Integration test: read-only kubectl against a reachable cluster |
| `SWARM_INT_GMAIL=1` + `GMAIL_OAUTH_TOKEN` | Integration test: creates ONE Gmail draft in the test account |

## Safety posture

- **Drafts only** — nothing is ever sent to a customer; `FileDraftSink` writes
  `draft.md` locally, and even the Gmail integration test only creates a draft.
- **Read-only** — the CastaiTools surface is the 10 read-only MCP tool names;
  the k8s client whitelist rejects any mutation (e.g. `delete pod`) without
  spawning a process; the sandbox is simulated.
- **Permission matrix** — every agent's adapter access is enforced per role;
  the support-writer has no tool access at all (verifier-passed claims only).
- **Redaction** — evidence results, errors, escalation dumps and KB reads pass
  through `redact()`; the KB reader refuses secret-named and secret-content
  files and escapes the repo via a symlink jail.
