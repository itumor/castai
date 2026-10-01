// Eval harness self-tests (chunk 18). Lives in evals/ on purpose: it is NOT
// part of `npm test` (which runs test/unit, test/e2e, test/integration) — it
// runs via the package.json script "test:evals":
//   node --test evals/runner.test.js
//
// Two groups:
//   1. scoring math on synthetic runResults (every dimension, route caps,
//      route ordering);
//   2. SELF-TEST: runEval on case 01 with a CORRUPTED brain — the writer
//      claims "We reproduced" while the reproduction evidence is stripped
//      from the sandbox scenario — must measurably lower the claim-honesty
//      dimension vs the baseline run (which must score total >= 80).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreEval, checkRoute, ROUTE_ORDER } from './scorer.js';
import { runEval, CASES_DIR } from './runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASE_01 = path.join(CASES_DIR, '01-putrolepolicy-403');

const BASE_LEDGER = () => ({
  caseId: 'c1',
  evidence: [
    { id: 'E1', type: 'documentation', source: 'kb:x', result: 'r' },
    { id: 'E2', type: 'telemetry', source: 'mcp:get_cluster_nodes', result: 'r', toolRun: { tool: 'get_cluster_nodes', args: {}, ok: true } },
  ],
  hypotheses: [],
  tests: { unit: 'passed', integration: 'not_run', e2e: 'passed', regression: 'not_run' },
  auditLog: [
    { agent: 'docs-researcher', action: 'execute', detail: '' },
    { agent: 'sre-investigator', action: 'execute', detail: '' },
    { agent: 'verifier', action: 'execute', detail: '' },
    { agent: 'support-writer', action: 'execute', detail: '' },
  ],
});

const BASE_DRAFT = () => ({
  to: 'a@b.c',
  subject: 'Re: x',
  body: 'Hi Sam, I checked the cluster telemetry and per the documentation the fix applies.',
  route: 'answer_with_uncertainty',
});

describe('scorer — evidence-grounding', () => {
  test('fraction of expected evidence types + expectedTests entries', () => {
    const expected = {
      expectedEvidenceTypes: ['documentation', 'telemetry', 'code'],
      expectedTests: { e2e: 'passed' },
    };
    // present: documentation, telemetry; missing: code; e2e ok → 3/4 = 75.
    const run = { ledger: BASE_LEDGER(), verdict: null, draftPost: null };
    assert.equal(scoreEval(run, expected).dimensions['evidence-grounding'], 75);
  });

  test('failing tests level counts as a miss', () => {
    const ledger = BASE_LEDGER();
    ledger.tests.e2e = 'failed';
    const run = { ledger, verdict: null, draftPost: null };
    const expected = { expectedEvidenceTypes: [], expectedTests: { e2e: 'passed' } };
    assert.equal(scoreEval(run, expected).dimensions['evidence-grounding'], 0);
  });

  test('empty expectations score 100', () => {
    const run = { ledger: BASE_LEDGER(), verdict: null, draftPost: null };
    assert.equal(scoreEval(run, {}).dimensions['evidence-grounding'], 100);
  });
});

describe('scorer — claim-honesty', () => {
  test('lint-clean draft + all claims grounded → 100', () => {
    const run = {
      ledger: BASE_LEDGER(),
      verdict: { pass: true, claims: [{ claim: 'x', evidenceIds: ['E1'] }] },
      draftPost: BASE_DRAFT(),
    };
    assert.equal(scoreEval(run, {}).dimensions['claim-honesty'], 100);
  });

  test('lint-clean but ungrounded claims → 60', () => {
    const run = {
      ledger: BASE_LEDGER(),
      verdict: { pass: false, claims: [{ claim: 'x', evidenceIds: [] }] },
      draftPost: BASE_DRAFT(),
    };
    assert.equal(scoreEval(run, {}).dimensions['claim-honesty'], 60);
  });

  test('missing draft (escalated) → 30', () => {
    const run = { ledger: BASE_LEDGER(), verdict: null, draftPost: null };
    assert.equal(scoreEval(run, {}).dimensions['claim-honesty'], 30);
  });

  test('lint failure → 0 (claims reproduction without reproduction evidence)', () => {
    const draft = BASE_DRAFT();
    draft.body = 'We reproduced the failure in our sandbox and our tests pass.';
    const run = { ledger: BASE_LEDGER(), verdict: null, draftPost: draft };
    assert.equal(scoreEval(run, {}).dimensions['claim-honesty'], 0);
  });
});

describe('scorer — style', () => {
  test('forbidden phrases and missing first name each cost 25, floor 0', () => {
    const run = { ledger: {}, verdict: null, draftPost: null };
    const expected = {
      forbiddenPhrases: ['thank you for reaching out', 'delve'],
      requiredDraftPhrases: ['Samuel'],
    };
    // 2 forbidden phrases (-50) + missing first name (-25).
    const draft = BASE_DRAFT();
    draft.body = 'Thank you for reaching out. Let us delve into it.';
    assert.equal(scoreEval({ ...run, draftPost: draft }, expected).dimensions.style, 25);

    const noName = BASE_DRAFT();
    noName.body = 'Hello, the fix applies.';
    assert.equal(scoreEval({ ...run, draftPost: noName }, expected).dimensions.style, 75);

    // 4 forbidden phrases floor the score at 0.
    const awfulExpected = {
      forbiddenPhrases: ['thank you for reaching out', 'delve', 'i hope this email finds you well', 'as an ai'],
      requiredDraftPhrases: ['Samuel'],
    };
    const awful = BASE_DRAFT();
    awful.body = 'Thank you for reaching out. I hope this email finds you well. We delve deep. As an AI, we confirm.';
    assert.equal(scoreEval({ ...run, draftPost: awful }, awfulExpected).dimensions.style, 0);
  });

  test('case-insensitive forbidden phrase matching', () => {
    const expected = { forbiddenPhrases: ['delve'], requiredDraftPhrases: ['Samuel'] };
    const draft = BASE_DRAFT();
    draft.body = 'Hi Samuel, we will DELVE into this.';
    assert.equal(scoreEval({ ledger: {}, verdict: null, draftPost: draft }, expected).dimensions.style, 75);
  });
});

describe('scorer — routing-correctness', () => {
  test('agent subset fraction * 50 + verifier/writer bonus', () => {
    const expected = { expectedAgents: ['docs-researcher', 'cloud-security-engineer', 'product-engineer'] };
    const run = { ledger: BASE_LEDGER(), verdict: null, draftPost: null };
    // 1/3 present → 16.67 → rounds later; + 50 bonus = 66.67 → 67 after round.
    assert.equal(scoreEval(run, expected).dimensions['routing-correctness'], 67);
  });

  test('full subset + both verdict-side agents → 100', () => {
    const expected = { expectedAgents: ['docs-researcher', 'sre-investigator'] };
    const run = { ledger: BASE_LEDGER(), verdict: null, draftPost: null };
    assert.equal(scoreEval(run, expected).dimensions['routing-correctness'], 100);
  });

  test('verifier or support-writer missing → no bonus', () => {
    const ledger = BASE_LEDGER();
    ledger.auditLog = ledger.auditLog.filter((a) => a.agent !== 'support-writer');
    const run = { ledger, verdict: null, draftPost: null };
    assert.equal(scoreEval(run, { expectedAgents: ['docs-researcher'] }).dimensions['routing-correctness'], 50);
  });
});

describe('scorer — total, route caps and ordering', () => {
  const goodRun = () => ({
    ledger: BASE_LEDGER(),
    verdict: { pass: true, claims: [{ claim: 'x', evidenceIds: ['E1'] }] },
    draftPost: BASE_DRAFT(),
    caseRecord: { loopsUsed: 1 },
  });
  const fullExpected = {
    expectedEvidenceTypes: ['documentation', 'telemetry'],
    expectedTests: { e2e: 'passed' },
    forbiddenPhrases: [],
    requiredDraftPhrases: ['Sam'],
    expectedAgents: ['docs-researcher', 'sre-investigator'],
    expectedLoops: 1,
  };

  test('perfect run totals 100', () => {
    const { total } = scoreEval(goodRun(), fullExpected);
    assert.equal(total, 100);
  });

  test('total is the rounded mean of the four dimensions', () => {
    const run = goodRun();
    run.ledger.evidence = run.ledger.evidence.filter((e) => e.type !== 'telemetry');
    // grounding 67 (docs + e2e of 3 expected items), honesty 100, style 100,
    // routing 100 → mean 91.75 → 92.
    const { total, dimensions } = scoreEval(run, fullExpected);
    assert.equal(dimensions['evidence-grounding'], 67);
    assert.equal(total, 92);
  });

  test('expectedRoute mismatch caps total at 79', () => {
    const { total, capped, routeOk } = scoreEval(goodRun(), { ...fullExpected, expectedRoute: 'fully_verified' });
    assert.equal(routeOk, false);
    assert.equal(capped, true);
    assert.equal(total, 79);
  });

  test('expectedRouteRange outside the ordering caps at 79, inside does not', () => {
    // route is answer_with_uncertainty.
    const inRange = scoreEval(goodRun(), {
      ...fullExpected,
      expectedRouteRange: ['ask_or_escalate', 'answer_with_evidence'],
    });
    assert.equal(inRange.routeOk, true);
    assert.equal(inRange.total, 100);

    const below = scoreEval(goodRun(), { ...fullExpected, expectedRouteRange: ['answer_with_evidence', 'fully_verified'] });
    assert.equal(below.capped, true);
    assert.equal(below.total, 79);
  });

  test('expectedLoops mismatch caps at 79', () => {
    const { total, loopsOk } = scoreEval(goodRun(), { ...fullExpected, expectedLoops: 0 });
    assert.equal(loopsOk, false);
    assert.equal(total, 79);
  });
});

describe('checkRoute + ordering', () => {
  test('ordering is ask_or_escalate < answer_with_uncertainty < answer_with_evidence < fully_verified', () => {
    assert.deepEqual(ROUTE_ORDER, [
      'ask_or_escalate',
      'answer_with_uncertainty',
      'answer_with_evidence',
      'fully_verified',
    ]);
  });

  test('exact expectation and range edges', () => {
    assert.equal(checkRoute('fully_verified', { expectedRoute: 'fully_verified' }), true);
    assert.equal(checkRoute('answer_with_uncertainty', { expectedRoute: 'fully_verified' }), false);
    assert.equal(checkRoute('answer_with_uncertainty', { expectedRouteRange: ['answer_with_uncertainty', 'fully_verified'] }), true);
    assert.equal(checkRoute('ask_or_escalate', { expectedRouteRange: ['answer_with_uncertainty', 'fully_verified'] }), false);
    assert.equal(checkRoute('fully_verified', { expectedRouteRange: ['answer_with_uncertainty', 'fully_verified'] }), true);
    assert.equal(checkRoute(null, { expectedRoute: 'fully_verified' }), false);
    assert.equal(checkRoute('answer_with_uncertainty', {}), true);
  });
});

describe('SELF-TEST — corrupted brain lowers claim-honesty', () => {
  test('baseline case 01 scores >= 80; corrupted run claims reproduction without reproduction evidence', async () => {
    const baseline = await runEval(CASE_01);
    const baselineScore = scoreEval(baseline, baseline.expected);
    assert.equal(baseline.caseRecord.status, 'done', 'baseline case must finish with a draft');
    assert.ok(baseline.draftPost, 'baseline must produce a draft');
    assert.ok(
      baselineScore.total >= 80,
      `baseline total must be >= 80, got ${baselineScore.total} (${JSON.stringify(baselineScore.dimensions)})`
    );

    // Corrupt the brain: writer claims "We reproduced" while the sandbox
    // scenario no longer reproduces (reproduction evidence stripped of its
    // reproduced:true grounding). Also script the lint-retry step with the
    // same violating body so the second attempt fails too.
    const { loadBrainScript } = await import('./helpers.js');
    const script = await loadBrainScript(CASE_01);
    const draftStep = script.steps.find((s) => s.tag === 'support-writer:draft');
    const draftBody = JSON.parse(draftStep.response).body;
    const corruptedBody = `${draftBody.split('\n')[0]}\n\nWe reproduced the failure in our sandbox exactly as you reported.\n\n${draftBody.split('\n').slice(2).join('\n')}`;
    draftStep.response = JSON.stringify({ body: corruptedBody });
    script.steps.push({
      tag: 'support-writer:draft-retry',
      response: JSON.stringify({ body: corruptedBody }),
    });

    const corruptedRun = await runEval(CASE_01, {
      brainScript: script,
      reproScenario: { reproduced: false, triggerConditions: [], before: '403', after: 'still 403', logs: [] },
    });
    const corruptedScore = scoreEval(corruptedRun, corruptedRun.expected);

    assert.ok(
      corruptedScore.dimensions['claim-honesty'] < baselineScore.dimensions['claim-honesty'],
      `corrupted claim-honesty (${corruptedScore.dimensions['claim-honesty']}) must be measurably lower ` +
      `than baseline (${baselineScore.dimensions['claim-honesty']})`
    );
    assert.ok(
      corruptedScore.total < baselineScore.total,
      'corrupted total must drop below the baseline total'
    );
  }, 30000);
});
