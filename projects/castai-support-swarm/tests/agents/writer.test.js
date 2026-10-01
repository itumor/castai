// tests/agents/writer.test.js — email drafting + guard loop.
// PDB scenario: draft mentions the PDB and passes the guard; an llm draft
// containing an ungrounded first-person claim gets sanitized; clarify mode
// never contains grounded first-person claims and asks for org/cluster ids.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addClaim,
  addEvidence,
  createCase,
  linkEvidenceToClaim,
} from '../../src/core/model.js';
import { BANNED_PHRASES } from '../../src/core/guard.js';
import { HeuristicLlm } from '../../src/core/llm.js';
import { createWriter, internalRefs } from '../../src/agents/writer.js';

/** Case matching fixtures/thread-pdb-scaledown.md with grounded evidence. */
function pdbCase() {
  const caseObj = createCase({
    id: 'W-PDB',
    thread: {
      from: 'Christoph Weber <christoph.weber@siemens.example.com>',
      subject: 'CAST AI node not scaling down after workload shrink',
      messages: [
        {
          from: 'christoph.weber@siemens.example.com',
          date: '2026-01-02',
          body: 'One node sits almost empty; remaining pods have a PodDisruptionBudget with minAvailable: 2.',
        },
      ],
    },
    customer: {
      name: 'Christoph Weber',
      email: 'christoph.weber@siemens.example.com',
      orgId: 'org-123abc',
      clusterId: 'clu-456def',
    },
  });
  caseObj.triage = {
    category: 'node_downscale',
    provider: 'aws',
    platform: 'eks',
    castaiMode: 'full',
    questions: ['Could that be related?'],
    severity: 'low',
    missingInfo: [],
    entities: { orgId: 'org-123abc', clusterId: 'clu-456def' },
    customerName: 'Christoph',
  };

  const claim = addClaim(caseObj, {
    statement:
      'The payments PodDisruptionBudget (minAvailable: 2) blocks pod eviction, so the node never empties.',
  });
  const env = addEvidence(caseObj, {
    type: 'environment',
    source: 'kube',
    ref: 'pdb/payments',
    summary: 'Node blocked by pdb-blocks-eviction.',
    agentId: 'sre',
  });
  const repro = addEvidence(caseObj, {
    type: 'reproduction',
    source: 'lab',
    ref: 'lab/pdb-scaledown',
    summary: 'Scale-down blocked until the PDB is relaxed.',
    agentId: 'repro',
  });
  linkEvidenceToClaim(caseObj, claim.id, env.id);
  linkEvidenceToClaim(caseObj, claim.id, repro.id);

  caseObj.solution = {
    status: 'proposed',
    summary: 'Remove the eviction blockers so CAST AI can drain and remove the under-utilized node.',
    steps: [
      'Relax the PodDisruptionBudget for the stuck workload (for example rewrite minAvailable: 2 as maxUnavailable: 1, or scale the deployment up so minAvailable no longer equals the replica count) so CAST AI can evict the remaining pods.',
      'Rollback: keep the previous manifest version in source control and re-apply it through your normal CI path if the change misbehaves.',
    ],
  };
  return caseObj;
}

function ctxFor(caseObj, params = {}) {
  return { caseObj, repoRoot: '/nonexistent', params };
}

test('PDB scenario: draft mentions the PDB and passes the guard', async () => {
  const caseObj = pdbCase();
  const writer = createWriter({ llm: new HeuristicLlm(), tools: undefined });
  const { reply } = await writer.run(ctxFor(caseObj));

  assert.match(reply.body, /^Hi Christoph,/);
  assert.match(reply.body, /PodDisruptionBudget|PDB/i);
  assert.match(reply.body.trimEnd(), /— CAST AI Support$/);
  assert.equal(reply.guard.ok, true);
  assert.deepEqual(reply.guard.banned, []);
  assert.deepEqual(reply.guard.violations, []);
  for (const phrase of BANNED_PHRASES) {
    assert.equal(reply.body.toLowerCase().includes(phrase), false, `banned phrase: ${phrase}`);
  }
  assert.equal(reply.guard.tone.hasGreeting, true);
  assert.match(reply.body, /n't|'re|'ll|'ve/i); // contractions
  assert.equal(caseObj.reply, reply);
});

test('PDB scenario: topic sentence engages the question; only grounded first-person claims appear', async () => {
  const caseObj = pdbCase();
  const writer = createWriter({ llm: new HeuristicLlm() });
  const { reply } = await writer.run(ctxFor(caseObj));

  // The subject becomes a natural topic sentence that replaces the generic lead.
  assert.match(reply.body, /You asked about CAST AI node not scaling down after workload shrink — here's what we found\./);
  assert.match(reply.body, /I reproduced this in our lab/); // REPRODUCED present
  assert.doesNotMatch(reply.body, /\bI ran the tests\b/i); // no TEST_CONFIRMED present
  // No subject -> fall back to the grounded generic lead.
  const noSubject = pdbCase();
  noSubject.thread.subject = '';
  const { reply: reply2 } = await writer.run(ctxFor(noSubject));
  assert.match(reply2.body, /I checked your setup and here's what we found\./);
});

test('ungrounded "I verified" from a live llm gets sanitized to hedged wording', async () => {
  const caseObj = pdbCase();
  // Strip hard evidence: only DOCUMENTED remains, so "I verified" is ungrounded.
  caseObj.evidence = caseObj.evidence.filter((e) => e.type !== 'reproduction' && e.type !== 'environment');
  caseObj.claims[0].evidenceIds = caseObj.evidence.map((e) => e.id);
  // One documentation evidence remains linked.
  const docOnly = addEvidence(caseObj, {
    type: 'documentation',
    source: 'docs',
    ref: 'docs/pdb',
    summary: 'PDB behavior documented.',
    agentId: 'researcher',
  });
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, docOnly.id);

  const badLlm = {
    async complete() {
      return [
        'Hi Christoph,',
        '',
        'I verified the PDB theory and your node will drain.',
        'Just remove the PDB and you are set.',
        '',
        '— CAST AI Support',
      ].join('\n');
    },
  };
  const writer = createWriter({ llm: badLlm });
  const { reply } = await writer.run(ctxFor(caseObj));

  assert.doesNotMatch(reply.body, /I verified/);
  assert.match(reply.body, /Based on the CAST AI documentation/); // honest hedge from DOCUMENTED
  assert.equal(reply.guard.ok, true);
  assert.deepEqual(reply.guard.violations, []);
  // The sanitize pass was recorded.
  const retryEntries = caseObj.trace.filter(
    (t) => t.actor === 'writer' && t.action === 'writer.guard.retry',
  );
  assert.equal(retryEntries.length, 1);
});

test('clarify mode: asks for org id and cluster id, no technical claims, guard passes trivially', async () => {
  const caseObj = pdbCase();
  caseObj.triage.missingInfo = ['orgId', 'clusterId'];

  const writer = createWriter({ llm: new HeuristicLlm() });
  const { reply } = await writer.run(ctxFor(caseObj, { mode: 'clarify' }));

  assert.match(reply.body, /^Hi Christoph,/);
  assert.match(reply.body, /organization id/i);
  assert.match(reply.body, /cluster id/i);
  // No technical claims from the case data.
  assert.doesNotMatch(reply.body, /PodDisruptionBudget|PDB|evict/i);
  assert.doesNotMatch(reply.body, /Rollback/);
  // Never contains grounded first-person claims.
  assert.doesNotMatch(
    reply.body,
    /\bI (?:checked|looked into|inspected|reviewed your)\b|\bI (?:reproduced|recreated) (?:this|the|it)\b|\b(?:we|I) (?:confirmed|verified)\b|\bI (?:ran|executed) (?:the )?(?:test|tests)\b/i,
  );
  assert.equal(reply.guard.ok, true);
  assert.deepEqual(reply.guard.violations, []);
  assert.deepEqual(reply.guard.banned, []);
  assert.match(reply.body.trimEnd(), /— CAST AI Support$/);
  // Trivially passing: zero sanitize retries.
  const retryEntries = caseObj.trace.filter(
    (t) => t.actor === 'writer' && t.action === 'writer.guard.retry',
  );
  assert.equal(retryEntries.length, 0);
});

test('clarify mode with explicit missingInfo still names org and cluster ids ("vague-no-info" path)', async () => {
  const caseObj = createCase({
    id: 'W-VAGUE',
    thread: {
      from: 'Lee <lee@example.com>',
      subject: 'something odd',
      messages: [{ from: 'lee@example.com', date: '2026-01-03', body: 'help' }],
    },
    customer: { name: 'Lee', email: 'lee@example.com' },
  });
  caseObj.triage = {
    category: 'unknown',
    provider: 'unknown',
    platform: 'unknown',
    castaiMode: 'unknown',
    questions: [],
    severity: 'low',
    missingInfo: ['orgId', 'clusterId'],
    entities: {},
    customerName: 'Lee',
  };

  const writer = createWriter({ llm: new HeuristicLlm() });
  const { reply } = await writer.run(ctxFor(caseObj, { mode: 'clarify' }));

  assert.match(reply.body, /^Hi Lee,/);
  assert.match(reply.body, /organization id/i);
  assert.match(reply.body, /cluster id/i);
  assert.equal(reply.guard.ok, true);
});

test('banned phrases are stripped and the retry is capped at 2 passes (final guard stored)', async () => {
  // Docs-only evidence so "I verified everything" is genuinely ungrounded.
  const caseObj = pdbCase();
  caseObj.evidence = [];
  caseObj.claims[0].evidenceIds = [];
  const docOnly = addEvidence(caseObj, {
    type: 'documentation',
    source: 'docs',
    summary: 'PDB behavior documented.',
    agentId: 'researcher',
  });
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, docOnly.id);

  const sloppyLlm = {
    async complete() {
      return 'Hi Christoph,\n\nI verified everything and it works. seamless!\n\n— CAST AI Support';
    },
  };
  const writer = createWriter({ llm: sloppyLlm });
  const { reply } = await writer.run(ctxFor(caseObj));

  assert.doesNotMatch(reply.body.toLowerCase(), /seamless/);
  assert.doesNotMatch(reply.body, /I verified everything/);
  assert.equal(reply.guard.ok, true);
  assert.equal(caseObj.reply, reply);
  const retryEntries = caseObj.trace.filter(
    (t) => t.actor === 'writer' && t.action === 'writer.guard.retry',
  );
  assert.equal(retryEntries.length, 1); // one sanitize pass fixed it; never loops past 2
});

test('FORCED CLARIFY: a draft that cannot pass within the guard budget is discarded', async () => {
  const caseObj = pdbCase();
  // Strip all hard evidence so "I verified" is genuinely ungrounded.
  caseObj.evidence = [];
  caseObj.claims[0].evidenceIds = [];
  const dirtyLlm = {
    async complete() {
      return 'Hi Christoph,\n\nI verified everything and it works.\n\n— CAST AI Support';
    },
  };
  const writer = createWriter({ llm: dirtyLlm });
  // maxGuardPasses = 0: the sanitize budget is empty, so the still-failing
  // draft triggers the contract's hard fallback deterministically.
  const { reply } = await writer.run(ctxFor(caseObj, { maxGuardPasses: 0 }));

  assert.equal(reply.forcedClarify, true);
  assert.equal(reply.guard.ok, true); // the replacement clarify draft is clean
  // The discarded draft must not leak: no 'I verified' survives.
  assert.doesNotMatch(reply.body, /I verified everything/);
  // It is the clarify template (asks for the inputs, no findings).
  assert.match(reply.body, /organization id|org id/i);
  const exhausted = caseObj.trace.filter(
    (t) => t.actor === 'writer' && t.action === 'writer.guard.exhausted',
  );
  assert.equal(exhausted.length, 1);
});

test('lead honesty: lab-derived TEST_CONFIRMED never reads as "I ran the tests"', async () => {
  const caseObj = pdbCase();
  // A lab-simulated e2e result (no real test runner executed) — the lead
  // must NOT claim a runner run.
  const ev = addEvidence(caseObj, {
    type: 'e2e_test',
    source: 'lab',
    ref: 'lab/pdb-scenario',
    summary: 'Lab-derived e2e result (lab-simulated — no external test runner executed): proposed change holds.',
    agentId: 'qa',
  });
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, ev.id);
  const writer = createWriter({ llm: new HeuristicLlm() });
  const { reply } = await writer.run(ctxFor(caseObj)); // no params.testRunner

  assert.doesNotMatch(reply.body, /I ran the tests/i);
  assert.match(reply.body, /lab simulation|reproduction lab/i);
});

test('lead honesty: runner-sourced e2e evidence DOES ground "I ran the tests"', async () => {
  const caseObj = pdbCase();
  const ev = addEvidence(caseObj, {
    type: 'e2e_test',
    source: 'test-runner',
    ref: 'tests://proposed-change',
    summary: 'Test suite passed (test runner executed).',
    agentId: 'qa',
  });
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, ev.id);
  const writer = createWriter({ llm: new HeuristicLlm() });
  const { reply } = await writer.run(ctxFor(caseObj, { testRunner: {} }));

  assert.match(reply.body, /I ran the tests for the proposed change and they pass\./);
  assert.match(reply.body, /We've verified the behavior end to end\./);
  assert.equal(reply.guard.ok, true);
});

test('findings cite only public cast.ai links; internal/absolute/non-doc refs never leak', async () => {
  const caseObj = pdbCase();
  const relEv = addEvidence(caseObj, {
    type: 'documentation',
    source: 'kb',
    ref: '.kimchi/docs/pdb-runbook.md',
    summary: 'Runbook: relax the PDB.',
    agentId: 'researcher',
  });
  const absEv = addEvidence(caseObj, {
    type: 'documentation',
    source: 'kb',
    ref: '/Users/eramadan/castai/.kimchi/docs/secret-note.md',
    summary: 'Internal note.',
    agentId: 'researcher',
  });
  const codeEv = addEvidence(caseObj, {
    type: 'code_change',
    source: 'repo',
    ref: 'src/autoscaler.js',
    summary: 'Code read.',
    agentId: 'product',
  });
  const pubEv = addEvidence(caseObj, {
    type: 'api_spec',
    source: 'docs',
    ref: 'https://docs.cast.ai/docs/node-autoscaler',
    summary: 'Public CAST AI docs page on node autoscaling.',
    agentId: 'researcher',
  });
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, relEv.id);
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, absEv.id);
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, codeEv.id);
  linkEvidenceToClaim(caseObj, caseObj.claims[0].id, pubEv.id);

  const { reply } = await createWriter({ llm: new HeuristicLlm() }).run(ctxFor(caseObj));
  assert.doesNotMatch(reply.body, /\.kimchi/); // internal KB paths never reach a customer
  assert.doesNotMatch(reply.body, /pdb-runbook\.md/);
  assert.doesNotMatch(reply.body, /\/Users\/eramadan/); // absolute path never leaks
  assert.doesNotMatch(reply.body, /secret-note\.md/);
  assert.doesNotMatch(reply.body, /autoscaler\.js/); // non-doc refs are not customer citations
  assert.match(reply.body, /https:\/\/docs\.cast\.ai\/docs\/node-autoscaler/); // public docs stay citable
  // Internal refs remain available to the human reviewer via internalRefs/meta.
  const refs = internalRefs(caseObj, caseObj.claims);
  for (const r of ['.kimchi/docs/pdb-runbook.md', '/Users/eramadan/castai/.kimchi/docs/secret-note.md', 'src/autoscaler.js']) {
    assert.ok(refs.includes(r), `internalRefs keeps ${r}`);
  }
  assert.equal(reply.guard.ok, true);
});

test('researcher provenance scaffold is stripped from customer-facing findings', async () => {
  const caseObj = pdbCase();
  const kbEv = addEvidence(caseObj, {
    type: 'documentation',
    source: 'kb',
    ref: '.kimchi/docs/pdb-runbook.md',
    summary: 'Relax minAvailable to unblock eviction.',
    agentId: 'researcher',
  });
  caseObj.claims.push({
    ...caseObj.claims[0],
    id: 'C2',
    statement:
      'Knowledge base source .kimchi/docs/pdb-runbook.md documents: Relax minAvailable to unblock eviction.',
    evidenceIds: [kbEv.id],
  });

  const { reply } = await createWriter({ llm: new HeuristicLlm() }).run(ctxFor(caseObj));
  assert.doesNotMatch(reply.body, /Knowledge base source/);
  assert.match(reply.body, /Relax minAvailable to unblock eviction/);
});

test('internal KB refs never leak into the body; public docs.cast.ai links do', async () => {
  const caseObj = pdbCase();
  const claim = caseObj.claims[0];
  const internal = addEvidence(caseObj, {
    type: 'documentation',
    source: 'kb',
    ref: '.kimchi/docs/siemens-meeting-2026-09-25-fabian-brief.md',
    summary: 'Internal note confirms PDB eviction blocking behavior.',
    agentId: 'researcher',
  });
  const pub = addEvidence(caseObj, {
    type: 'api_spec',
    source: 'docs',
    ref: 'https://docs.cast.ai/docs/node-autoscaler',
    summary: 'Public CAST AI docs page on node autoscaling.',
    agentId: 'researcher',
  });
  linkEvidenceToClaim(caseObj, claim.id, internal.id);
  linkEvidenceToClaim(caseObj, claim.id, pub.id);

  const writer = createWriter({ llm: new HeuristicLlm(), tools: undefined });
  const { reply } = await writer.run(ctxFor(caseObj));

  // No internal filenames / project names / person names in the customer body.
  assert.doesNotMatch(reply.body, /\.kimchi/i);
  assert.doesNotMatch(reply.body, /brain\/notes/i);
  assert.doesNotMatch(reply.body, /siemens-meeting|fabian|brief\.md/i);
  // Public documentation stays citable.
  assert.match(reply.body, /https:\/\/docs\.cast\.ai\/docs\/node-autoscaler/);
  // The internal ref is still available to the human reviewer via internalRefs.
  assert.ok(
    internalRefs(caseObj, caseObj.claims).includes('.kimchi/docs/siemens-meeting-2026-09-25-fabian-brief.md'),
    'internalRefs keeps the internal provenance for meta.references',
  );
});

test('near-paraphrase findings are emitted once (strongest evidence rank wins)', async () => {
  const caseObj = pdbCase();
  const claimA = caseObj.claims[0]; // env+repro backed (strongest)
  // A second claim paraphrasing the same fact with weaker (documentation) backing.
  const claimB = addClaim(caseObj, {
    statement:
      'The PodDisruptionBudget is blocking pod eviction on the stuck node, so the node cannot scale down and never empties.',
    needsVerification: true,
  });
  const docEv = addEvidence(caseObj, {
    type: 'documentation',
    source: 'kb',
    ref: 'https://docs.cast.ai/docs/node-autoscaler',
    summary: 'Public docs: PDBs block drains.',
    agentId: 'researcher',
  });
  linkEvidenceToClaim(caseObj, claimB.id, docEv.id);
  // A genuinely different finding that must survive.
  const claimC = addClaim(caseObj, {
    statement: 'The payments service requires at least two replicas running at all times for PCI reasons.',
    needsVerification: true,
  });
  linkEvidenceToClaim(caseObj, claimC.id, docEv.id);

  const { reply } = await createWriter({ llm: new HeuristicLlm() }).run(ctxFor(caseObj));
  const bullets = reply.body.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(bullets.length, 2, `expected 2 findings, got:\n${reply.body}`);
  assert.match(bullets[0], /PodDisruptionBudget|PDB/i);
  assert.match(bullets[1], /two replicas|PCI/i);
});
