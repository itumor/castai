---
name: case-triage
description: >-
  Triage a PASTED raw customer email, meeting invite, or Teams transcript into a structured
  case — people, asks, dates, clusters, and a draft reply. Trigger whenever the user drops a
  raw thread into the session: messages with mail headers (From:/Sent:/To:/Subject:),
  @siemens.com senders ("SI GSW CLO", "SI GSW R&D"), Microsoft Teams invite blocks, or
  "Cast.ai Exchange" content — ESPECIALLY when wrapped in a vague imperative like "do what
  you can (", "give me fast answer (", or "take a look on (" — or when the user asks for
  customer-thread analysis, an asks/action-item list, or a drafted reply. Runs the
  evidence-gated support swarm first, then enriches with read-only facts. Not for generic
  CAST AI knowledge questions without a customer thread (use castai-support-engineer), and
  not when the thread is already normalized and only the gated verdict is wanted (use
  castai-support-swarm directly).
---

# Case Triage — raw paste in, case brief + draft reply out

Customers (Siemens "SI GSW" in particular) arrive as raw pastes: a full email
with headers, a Teams-meeting invite, or a transcript, usually preceded by a
vague wrapper like `do what you can (` with no explicit question. This skill
turns that paste into two files: a case brief and a draft customer reply. The
evidence-gated swarm always runs first — its verdict/confidence/gate bound what
the reply may claim.

## Playbook

1. **Capture.** Save the raw paste verbatim to a temp file and normalize it:

   ```bash
   THREAD="$(/Users/eramadan/castai/.deepseek/scripts/case-normalize.sh /tmp/case-raw.txt)"
   ```

   The script synthesizes `From:`/`Subject:` when the paste lacks them, strips
   leading vague-wrapper lines, and writes
   `outbox/case-threads/<UTC-timestamp>-case.md` at the repo root (override with
   `--out <dir>`). It prints only the output path.

2. **Gate.** Run the swarm OFFLINE and read the whole summary line set
   (`category`, `plan`, `verdict`, `confidence`, `gate`, `reply`, `trace`):

   ```bash
   cd /Users/eramadan/castai/projects/castai-support-swarm \
     && node bin/support-swarm.mjs answer "$THREAD"
   ```

   A REJECT verdict with a clarify draft is a valid outcome — never push an
   unverifiable answer past the gate.

3. **Merge.** Combine the swarm output with any CAST AI API facts the agent
   gathers READ-ONLY (GETs only, per repo `AGENTS.md` preflight: sourced env,
   EU API base, read-scoped key). Label every claim as swarm-verified, API
   fact, or hypothesis — no silent blending.

4. **Write.** Produce two files next to the normalized thread under
   `outbox/case-threads/`:
   - `<UTC-timestamp>-brief.md` — people (names, roles, addresses), asks
     (bulleted, one per line so `case-tasks.py` can lift them), dates &
     deadlines, clusters mentioned, org hypothesis, swarm verdict line.
   - `<UTC-timestamp>-draft-reply.md` — the customer reply, starting from the
     swarm draft at the printed `reply:` path; public docs.cast.ai links only
     in customer-facing text.
   If the user asked for a task sheet, extract the brief's `## Asks` section
   and run `python3 /Users/eramadan/castai/.deepseek/scripts/case-tasks.py asks.md out.xlsx`.

5. **Present** both files (use `present`) and summarize: category, verdict,
   confidence, gate, open questions.

6. **State the boundary.** Say plainly: the reply is a DRAFT for a human to
   review and send. Nothing was sent to the customer.

## Safety

- **Never sends email** or any customer-facing message. Outbox files are
  drafts; a human sends.
- **Never prints API keys** or other secrets; credentials stay in env vars and
  are referenced by name only.
- **GET-only API.** Live CAST AI calls are read-only; no POST/PUT/PATCH/DELETE,
  no `castctl cluster connect`, no `--live` swarm runs without the `AGENTS.md`
  preflight checks.
- **Never fabricates live-cluster facts.** Offline runs must not claim "I
  checked your cluster"; clearly mark any live data as fetched at a timestamp.
