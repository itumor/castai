// tests/pipeline/e2e.test.js — contract section 11 (e2e tests).
//
// Offline end-to-end runs of the whole swarm through runCase (HeuristicLlm,
// simulated lab, real KB roots inside this repository). Everything written
// lands under os.tmpdir(); no timers, no network.
//
//   1. happy-path PDB scale-down: verdict PASS, confidence >= 80, grounded
//      reply mentioning the PodDisruptionBudget, no banned phrases, guard ok.
//   2. adversarial seeded false claim with no evidence: verifier must REJECT
//      and the output must be a clarify draft (or escalation) that never
//      repeats the false claim.
//   3. vague thread: gate NEEDS_MORE_EVIDENCE, reply asks for the org id and
//      cluster id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCase } from '../../src/pipeline/orchestrator.js';
import { HeuristicLlm } from '../../src/core/llm.js';
import { confidenceGate } from '../../src/core/model.js';
import { BANNED_PHRASES } from '../../src/core/guard.js';
import { parseThreadFile } from '../../bin/support-swarm.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

function makeDeps() {
  const outboxDir = mkdtempSync(path.join(os.tmpdir(), 'swarm-e2e-'));
  return {
    repoRoot,
    llm: new HeuristicLlm(),
    outboxDir,
    kbRoot: path.join(outboxDir, 'kb'),
    env: {}, // hermetic: no CASTAI_API_KEY from the ambient environment
  };
}

function writerMode(caseObj) {
  const entry = (caseObj.trace || []).find(
    (e) => e.actor === 'writer' && e.action === 'writer.start',
  );
  return entry && entry.detail ? entry.detail.mode : undefined;
}

// ---------------------------------------------------------------------------
// 1. Happy path: PDB blocks scale-down -> PASS, grounded reply
// ---------------------------------------------------------------------------

test('e2e: PDB scale-down fixture -> PASS, confidence >= 80, grounded reply', async () => {
  const fixtureRaw = readFileSync(path.join(packageRoot, 'fixtures', 'thread-pdb-scaledown.md'), 'utf8');
  const parsed = parseThreadFile(fixtureRaw);

  // The fixture's ";; sim:" line must map to one managed node + one PDB-protected pod.
  assert.ok(parsed.simSpec, 'fixture sim line should parse');
  assert.equal(parsed.simSpec.nodes.length, 1);
  assert.equal(parsed.simSpec.nodes[0].managed, true);
  assert.equal(parsed.simSpec.pods.length, 1);
  assert.equal(parsed.simSpec.pods[0].pdbProtected, true);
  assert.equal(parsed.simSpec.pods[0].node, 'node-1');

  const deps = makeDeps();
  const { caseObj, summary } = await runCase(parsed.thread, {
    ...deps,
    simSpec: parsed.simSpec,
  });

  // Verdict + confidence + gate.
  assert.equal(summary.verdict, 'PASS');
  assert.equal(caseObj.verdict.status, 'PASS');
  assert.ok(
    summary.confidence >= 80,
    `expected confidence >= 80, got ${summary.confidence}`,
  );
  assert.equal(summary.gate, confidenceGate(summary.confidence));

  // The full expected swarm ran (plan order for node_downscale).
  for (const agent of ['triage', 'supervisor', 'sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge']) {
    assert.ok(summary.agentsRun.includes(agent), `agentsRun missing ${agent}`);
  }

  // Reply exists, writer ran in normal mode, guard passed on the stored reply.
  assert.ok(caseObj.reply, 'reply must exist on the case');
  assert.equal(writerMode(caseObj), 'normal');
  assert.equal(caseObj.reply.guard.ok, true);
  assert.deepEqual(caseObj.reply.guard.violations, []);

  // No banned AI-ish phrases, and the reply mentions the PodDisruptionBudget.
  assert.deepEqual(caseObj.reply.guard.banned, []);
  for (const phrase of BANNED_PHRASES) {
    assert.ok(
      !caseObj.reply.body.toLowerCase().includes(phrase),
      `reply contains banned phrase: ${phrase}`,
    );
  }
  assert.match(caseObj.reply.body, /PodDisruptionBudget/);

  // Artifacts: draft email (draft-only) + trace + kb note, all under the outbox.
  assert.ok(summary.replyPath, 'summary.replyPath expected for an answered case');
  assert.equal(summary.escalationPath, undefined);
  assert.ok(summary.replyPath.startsWith(deps.outboxDir));
  assert.ok(existsSync(summary.replyPath));
  const meta = JSON.parse(readFileSync(summary.replyPath.replace(/\.md$/, '.json'), 'utf8'));
  assert.equal(meta.draftOnly, true);
  assert.equal(meta.caseId, caseObj.id);

  const tracePath = path.join(deps.outboxDir, 'traces', `${caseObj.id}.trace.jsonl`);
  assert.ok(existsSync(tracePath));
  const traceLines = readFileSync(tracePath, 'utf8').trim().split('\n');
  assert.ok(traceLines.length > 0);
  for (const line of traceLines) JSON.parse(line); // valid JSONL

  assert.ok(caseObj.kbNotes.length >= 1, 'PASS case must leave a kb note');
  for (const note of caseObj.kbNotes) assert.ok(existsSync(note));
});

// ---------------------------------------------------------------------------
// 2. Adversarial: seeded false claim with no evidence -> REJECT + clarify
// ---------------------------------------------------------------------------

test('e2e: seeded false claim with no evidence -> REJECT and clarify output', async () => {
  const thread = {
    from: 'Dana Doe <dana.doe@example.com>',
    subject: 'CAST AI evicted my pods',
    messages: [
      {
        from: 'Dana Doe <dana.doe@example.com>',
        date: '',
        body: 'Your autoscaler evicted pods despite our PodDisruptionBudget. Please explain.',
      },
    ],
  };

  const deps = makeDeps();
  const { caseObj, summary } = await runCase(thread, {
    ...deps,
    seedClaims: ['CAST AI ignores PodDisruptionBudgets when evicting pods'],
  });

  // The unverifiable seeded claim must sink the verdict (never a technical answer).
  assert.equal(summary.verdict, 'REJECT');
  assert.equal(caseObj.verdict.status, 'REJECT');
  assert.ok(
    caseObj.verdict.rejectedClaims.some(
      (r) => r.statement === 'CAST AI ignores PodDisruptionBudgets when evicting pods',
    ),
    'the seeded false claim must be listed as rejected',
  );

  // Output must be a clarify draft or an escalation — never a confident answer.
  assert.equal(caseObj.escalation, null);
  assert.ok(caseObj.reply, 'a clarify reply draft must exist');
  assert.equal(writerMode(caseObj), 'clarify');

  // The clarify draft makes no grounded false claim.
  assert.ok(!caseObj.reply.body.includes('ignores PodDisruptionBudgets'));
  assert.equal(caseObj.reply.guard.ok, true);
  assert.deepEqual(caseObj.reply.guard.violations, []);

  // Draft was still persisted for human review.
  assert.ok(summary.replyPath);
  assert.ok(existsSync(summary.replyPath));
});

// ---------------------------------------------------------------------------
// 3. Vague thread: NEEDS_MORE_EVIDENCE + reply asks for org id / cluster id
// ---------------------------------------------------------------------------

test('e2e: vague thread -> NEEDS_MORE_EVIDENCE, reply asks for org/cluster id', async () => {
  const thread = {
    from: 'Alex <alex@example.com>',
    subject: 'help',
    messages: [{ from: 'Alex <alex@example.com>', date: '', body: 'It is broken, please help.' }],
  };

  const deps = makeDeps();
  const { caseObj, summary } = await runCase(thread, deps);

  assert.ok(summary.confidence < 60, `expected low confidence, got ${summary.confidence}`);
  assert.equal(summary.gate, 'NEEDS_MORE_EVIDENCE');

  assert.ok(caseObj.reply, 'a reply draft must exist');
  assert.equal(writerMode(caseObj), 'clarify');
  assert.match(caseObj.reply.body, /organization id/);
  assert.match(caseObj.reply.body, /cluster id/);
  assert.equal(caseObj.reply.guard.ok, true);

  assert.ok(summary.replyPath);
  assert.ok(existsSync(summary.replyPath));
});

// ---------------------------------------------------------------------------
// 4. Regression (claim-set selection is NOT a pass-rule mirror): an agent-
//    emitted claim that is ON-TOPIC but cannot be grounded must REACH the
//    verifier, be rejected there, and sink the verdict to clarify — the old
//    pre-gate pruner would have removed it and silently shipped.
// ---------------------------------------------------------------------------

test('e2e: on-topic-but-ungroundable AGENT claim reaches the verifier (no pass-rule mirror)', async () => {
  // Fully hermetic repo + KB. Two rich docs form a corroborated cluster
  // (documentation + prior_ticket => the case WOULD pass on those claims),
  // while a third doc is the trap: it shares the thread SUBJECT words
  // ('realized', 'reporting', 'internal', ...) — so relevance-only selection
  // MUST keep it — yet it is single-source and shares no tokens with the
  // rich docs, so no corroboration can rescue it. The verifier must reject
  // it and sink the verdict to clarify. Under the OLD rule (selection =
  // pass-rule mirror) this exact claim was silently pruned and the case
  // shipped PASS — the defect this regression pins forever.
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'swarm-repo-regress-'));
  const tmpKb = mkdtempSync(path.join(os.tmpdir(), 'swarm-kb-regress-'));
  mkdirSync(path.join(tmpKb, 'brain', 'notes'), { recursive: true });

  writeFileSync(
    path.join(tmpKb, 'savings-methodology.md'),
    [
      '# Savings methodology',
      '',
      'The savings formula is (billing baseline minus actual spend) over the',
      'measured window. The billing baseline uses on-demand pricing for the',
      'identical shapes of machines in the same region.',
    ].join('\n'),
  );
  writeFileSync(
    path.join(tmpKb, 'brain', 'notes', 'case-savings-formula.md'),
    [
      '# case: savings formula question',
      '',
      'A customer asked what the savings formula is: billing baseline minus',
      'actual spend, on-demand baseline pricing.',
    ].join('\n'),
  );
  // The trap doc: shares the thread SUBJECT word 'realized' plus body words
  // ('internal', 'reporting', 'screenshot', 'audit', 'quarterly') but shares
  // NO token with the two corroborating docs — single-source, doomed.
  writeFileSync(
    path.join(tmpKb, 'internal-realized-reporting.md'),
    [
      '# Internal realized reporting',
      '',
      'An internal realized reporting screenshot for the quarterly audit roll-up',
      'can drift for days on the dashboard. Wait for the weekly mailing instead.',
    ].join('\n'),
  );

  const thread = {
    from: 'Lena <lena@example.com>',
    subject: 'Realized savings methodology — exact formula?',
    messages: [
      {
        from: 'Lena <lena@example.com>',
        date: '',
        body:
          'For internal reporting and a screenshot audit: what exact formula ' +
          'computes the realized savings, and which billing baseline feeds it? ' +
          'Should we trust the internal realized reporting screenshot? ' +
          'Cite the methodology docs. (case-ops: org-1/cl-1)',
      },
    ],
  };

  const outboxDir = mkdtempSync(path.join(os.tmpdir(), 'swarm-e2e-regress-'));
  const { caseObj, summary } = await runCase(thread, {
    repoRoot: tmpRepo,
    llm: new HeuristicLlm(),
    outboxDir,
    kbRoot: path.join(outboxDir, 'kb'),
    env: {},
    kbRoots: [tmpKb],
  });

  // The doomed claim must be the thing that sank the case.
  assert.equal(summary.verdict, 'REJECT');
  const rejected = caseObj.verdict.rejectedClaims.map((r) => r.statement);
  assert.ok(
    rejected.some((s) => s.includes('internal realized reporting') || s.includes('screenshot')),
    `the on-topic ungroundable claim must be REJECTED BY THE VERIFIER, got: ${JSON.stringify(rejected)}`,
  );

  // Selection must NOT have pruned it as 'off-topic' — it is topical. And no
  // pre-gate grounding judgment may exist at all (that is the verifier's job).
  const prunedStatements = (caseObj.trace || [])
    .filter((e) => e.action === 'claims.pruned')
    .flatMap((e) => (e.detail.claims || []).map((c) => c.statement));
  assert.ok(
    !prunedStatements.some((s) => s.includes('internal realized reporting')),
    'a topical claim must survive relevance-only selection',
  );
  assert.ok(
    !(caseObj.trace || []).some((e) => e.action === 'claims.ungrounded'),
    'no pre-gate grounding judgment may exist',
  );

  // And the customer still gets a clarify draft, never the doomed content.
  assert.equal(writerMode(caseObj), 'clarify');
  assert.ok(!caseObj.reply.body.includes('weekly mailing'));
});
