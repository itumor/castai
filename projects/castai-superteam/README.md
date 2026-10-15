# CAST AI Superteam

The supervisor-led agent team for Siemens CAST AI operations: one mission in,
one merged report out. Read-only by contract (AGENTS.md), parallel by law
(cluster-fanout), with a single dedicated role for live API access.

```
human → Lead (session) → supervisor → cost-analyst · cluster-health
                                    · support-triage · docs-keeper · mcp-ops
```

## Layout

| Path | Purpose |
|---|---|
| `TEAM.md` | Team manifest: charter, roster, routing, protocols, safety |
| `agents/*.md` | Self-contained role files — the canonical spawn prompts |
| `dsh-preset/` | DSH agent-preset templates (`preset.yml`, `agent.cordis.yml`) |
| `scripts/install-dsh-preset.mjs` | Idempotent installer → `$DSH_HOME/.agent-presets/castai-superteam/` |
| `scripts/check-blueprint.mjs` | Blueprint self-check (`npm test`) |

## Install the preset (once per checkout)

```bash
cd projects/castai-superteam
npm run install:dsh        # add --dry-run to preview
```

Then pick the **CAST AI Superteam** preset when creating a session on this
workspace. The preset session leads the team itself.

## Launch a live team in ANY session

Spawn six teammates (background, one message), telling each to read its role
file first:

| Teammate | Spawn prompt seed |
|---|---|
| `supervisor` | Read `AGENTS.md`, `brain/BRAIN.md`, `TEAM.md`, `agents/supervisor.md`; you decompose, dispatch, merge, escalate |
| `cost-analyst` | Read `agents/cost-savings-analyst.md` (+ skills listed there) |
| `cluster-health` | Read `agents/cluster-health.md` (+ skills) |
| `support-triage` | Read `agents/support-triage.md` + load `castai-support-swarm` skill |
| `docs-keeper` | Read `agents/docs-memory-keeper.md` + `brain/BRAIN.md` |
| `mcp-ops` | Read `agents/mcp-api-ops-runner.md` + AGENTS.md §1 preflight rules |

Then hand missions to `supervisor`; it runs the board and reports back one
merged report. Specialists never talk to the human directly.

## Safety contract

Inherited from AGENTS.md and restated in every role file: read-only posture
(GET-only APIs, kubectl reads on karpenter-lab only, no terraform apply, no
customer sends — drafts land in `outbox/`), preflight before any live call
(only `mcp-ops` makes them), and never guess org/cluster/account ids.
Anything needing an approval token is an escalation to the human.

## Test

```bash
npm test                 # node scripts/check-blueprint.mjs
```
