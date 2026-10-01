---
name: castai-support-swarm
description: >-
  Answer a CAST AI customer THREAD (an email/ticket/case a human pasted or forwarded — "answer
  this customer thread", "handle this ticket", "reply to <name>", "draft a reply", "a customer
  wrote in saying...") using the evidence-gated support swarm. ALWAYS use when the user gives
  you a customer email about CAST AI behavior — stuck nodes and scale-down/up, PDB or eviction
  blocks, 401/token rotation, IAM/onboarding (PutRolePolicy etc.), savings/cost numbers,
  workload autoscaling not applying, Terraform/Helm questions from customers, or any pasted
  support case — and you must produce the reply. A pasted From:/Subject: customer message IS
  the trigger, even when the user never says "swarm" or "support_swarm_answer". Not for generic
  CAST AI knowledge questions without a customer thread (those belong to castai-support-engineer).
---

# CAST AI Support Swarm — answering customer threads

The repo ships an evidence-gated 13-agent support pipeline
(`projects/castai-support-swarm`). Its value is the audit trail: every claim
in a reply is tied to evidence, the verifier gate decides PASS/REJECT, and the
confidence score says how far the answer can go. A hand-drafted reply skips
that gate — it can sound better while being unverifiable. So when a customer
thread lands, the swarm runs FIRST and your prose comes second.

You are not asking the swarm for permission to think — you are asking it to
prove the answer. If it can't, the honest outcome is a REJECT + clarify, and
that IS the answer to return.

## Workflow

1. **Call `support_swarm_answer` before drafting anything.** Pass the thread
   verbatim as `threadText` (it must start with `From:` and `Subject:`
   headers) or as `threadFile` when it lives in the workspace. Append the
   `;; sim:` lab seed line when the thread describes cluster state you can
   translate into the shorthand (`nodes=`, `managed=`, `pods=`, `pdb=`,
   `localstorage=`, `donotevict=`) — without it, reproduction claims have no
   backing. Use `strict: true` for enterprise/customer-facing answers.

2. **Report the gate, not just the prose.** Tell the user the triage
   category, verifier verdict (PASS/REJECT), confidence score, and gate —
   then the draft. A REJECT with a clarify draft is a success: it means the
   swarm refused to answer what it couldn't prove. Do not "push through" a
   REJECT by writing the answer yourself.

3. **Enrich AFTER the gate, never instead of it.** You may strengthen the
   swarm's draft: fetch the docs.cast.ai pages it cites to confirm they're
   current, add verification commands or YAML, improve phrasing. Keep the
   swarm's verified findings intact: if you replace a finding, you need
   evidence of your own (a docs page you actually fetched, not memory).
   Customer-facing text cites public docs.cast.ai links ONLY — internal repo
   paths and KB refs live in the draft's JSON sidecar for the human reviewer.

4. **Draft-only.** The outbox files are drafts; a human reviews and sends.
   Never claim anything was sent, and never fabricate live-cluster facts
   ("I checked your cluster") — in-session runs are offline.

5. **If `support_swarm_answer` does not exist in this session** (wrong
   preset): say so in one line, then run the engine directly —
   `node projects/castai-support-swarm/bin/support-swarm.mjs answer <thread-file>`
   (offline default; `--live` only behind the AGENTS.md preflight checks).
   Do not free-hand the answer instead.

## Evaluating changes to the swarm engine

When the user asks whether the swarm itself is working (or you changed its
code), run `support_swarm_eval` (or `npm run eval` in
projects/castai-support-swarm) and report routing accuracy, adversarial
catch rate, mean tone, and confidence-gate correctness — not a vibe check.

## Example

Input (customer thread pasted):
```
From: Lena Fischer <lena.fischer@siemens.example.com>
Subject: Realized savings API — exact methodology?
Hi, what is the exact formula behind realized savings in the cost-reports
API? Our finance team needs the methodology...
```
Expected handling:
1. `support_swarm_answer({threadText: <the paste>})`
2. Report: category cost_reporting, verdict PASS, confidence 70, gate
   UNCERTAINTY — draft answers with the documented formula; the gate flags
   which parts are partially verified.
3. Offer: "want me to verify the cited docs.cast.ai pages are current?"
