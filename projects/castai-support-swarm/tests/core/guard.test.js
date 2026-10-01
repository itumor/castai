// tests/core/guard.test.js — contract section 4 (src/core/guard.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCase,
  addEvidence,
  addClaim,
  linkEvidenceToClaim,
} from '../../src/core/model.js';
import {
  BANNED_PHRASES,
  CLAIM_REQUIREMENTS,
  caseClaimClasses,
  evaluateReply,
  sanitizeReply,
} from '../../src/core/guard.js';

function makeCase(id = 'guard-1') {
  return createCase({
    id,
    thread: { from: 'A <a@example.com>', subject: 's', messages: [] },
    customer: { name: 'A', email: 'a@example.com' },
  });
}

/** Ground the case with one evidence of `type` linked to one non-rejected claim. */
function ground(caseObj, type, claimOpts = {}) {
  const ev = addEvidence(caseObj, { type, source: 'test', summary: 's', agentId: 'tester' });
  const claim = addClaim(caseObj, { statement: `claim for ${type}`, ...claimOpts });
  linkEvidenceToClaim(caseObj, claim.id, ev.id);
  return { ev, claim };
}

test('BANNED_PHRASES and CLAIM_REQUIREMENTS match the contract', () => {
  assert.equal(BANNED_PHRASES.length, 11);
  assert.ok(BANNED_PHRASES.includes('delve'));
  assert.ok(BANNED_PHRASES.includes('rest assured'));
  // Contract section 4: six first-person claim patterns (tenses, hedge
  // adverbs and confirm/observe/find synonyms included, so a live LLM cannot
  // evade the guard by rephrasing).
  assert.equal(CLAIM_REQUIREMENTS.length, 6);
  assert.ok(CLAIM_REQUIREMENTS.every((r) => r.pattern instanceof RegExp && Array.isArray(r.needs)));
});

test('caseClaimClasses unions non-rejected claims and sorts by ladder', () => {
  const c = makeCase();
  // linked in reverse ladder order on purpose
  ground(c, 'reproduction');
  ground(c, 'documentation');

  // rejected claim's evidence is excluded
  const rejected = addClaim(c, { statement: 'bad' });
  rejected.status = 'rejected';
  const env = addEvidence(c, { type: 'environment', source: 'kube', summary: 's', agentId: 'sre' });
  linkEvidenceToClaim(c, rejected.id, env.id);

  assert.deepEqual(caseClaimClasses(c), ['DOCUMENTED', 'REPRODUCED']);
  assert.deepEqual(caseClaimClasses(makeCase()), []);
});

test('evaluateReply flags "I reproduced this" without REPRODUCED evidence', () => {
  const c = makeCase();
  const draft = 'Hi Jane,\n\nI reproduced this in our lab and it failed the same way.\n\nCan you confirm?';
  const res = evaluateReply({ caseObj: c, draft });
  assert.equal(res.ok, false);
  assert.equal(res.violations.length, 1);
  assert.match(res.violations[0].sentence, /I reproduced this/);
  assert.deepEqual(res.violations[0].needs, ['REPRODUCED']);
  assert.deepEqual(res.violations[0].present, []);

  // grounded: reproduction evidence satisfies the claim
  ground(c, 'reproduction');
  const res2 = evaluateReply({ caseObj: c, draft });
  assert.equal(res2.violations.length, 0);
  assert.equal(res2.ok, true);
});

test('evaluateReply grounds "I checked" against ENV/DOCUMENTED/CODE classes', () => {
  const c = makeCase();
  const draft = 'Hi Jane,\n\nI checked your cluster and the PDB blocks eviction.\n\nCan you confirm the namespace?';
  assert.equal(evaluateReply({ caseObj: c, draft }).violations.length, 1);

  for (const type of ['environment', 'documentation', 'source_code']) {
    const c2 = makeCase(`g-${type}`);
    ground(c2, type);
    assert.equal(evaluateReply({ caseObj: c2, draft }).violations.length, 0, type);
  }

  // prior_ticket (SUPPORTING) is not enough
  const c3 = makeCase('g-weak');
  ground(c3, 'prior_ticket');
  assert.equal(evaluateReply({ caseObj: c3, draft }).violations.length, 1);
});

test('evaluateReply: "we confirmed" needs VERIFIED/TEST_CONFIRMED/REPRODUCED', () => {
  const draft = 'Hi Jane,\n\nWe confirmed the fix works.\n\nCan you try it?';
  const c = makeCase();
  assert.equal(evaluateReply({ caseObj: c, draft }).violations.length, 1);

  ground(c, 'e2e_test');
  assert.equal(evaluateReply({ caseObj: c, draft }).violations.length, 0);
});

test('evaluateReply: "I ran the tests" needs TEST_CONFIRMED', () => {
  const draft = 'Hi Jane,\n\nI ran the tests and they all pass.\n\nCan you deploy?';
  const c = makeCase();
  const res = evaluateReply({ caseObj: c, draft });
  assert.equal(res.violations.length, 1);
  assert.deepEqual(res.violations[0].needs, ['TEST_CONFIRMED']);

  ground(c, 'e2e_test');
  assert.equal(evaluateReply({ caseObj: c, draft }).ok, true);
});

test('evaluateReply detects banned phrases case-insensitively with index', () => {
  const c = makeCase();
  const draft = 'Hello. REST ASSURED it works. Please Do Not Hesitate to reply.';
  const res = evaluateReply({ caseObj: c, draft });
  assert.equal(res.ok, false);
  assert.deepEqual(res.banned, [
    { phrase: 'rest assured', index: 7, indices: [7] },
    { phrase: 'please do not hesitate', index: 30, indices: [30] },
  ]);
});

test('banned-phrase matching is word-bounded and reports every occurrence', () => {
  const c = makeCase();
  // 'delved' and 'as an aid' must NOT trip the guard on 'delve'/'an aid'.
  const clean = evaluateReply({ caseObj: c, draft: 'We delved into it, as an aid to triage.' });
  assert.equal(clean.banned.length, 0, `false positives: ${JSON.stringify(clean.banned)}`);
  // Multiple occurrences report all indices.
  const twice = evaluateReply({ caseObj: c, draft: 'Rest assured. And again, rest assured!' });
  assert.deepEqual(twice.banned, [
    { phrase: 'rest assured', index: 0, indices: [0, 25] },
  ]);
});

test('tone: perfect draft scores 100 with no issues', () => {
  const c = makeCase();
  const draft = [
    'Hi Jane,',
    '',
    "We can't reproduce that on our side, so we'll need a bit more detail.",
    '',
    'Can you share your cluster id?',
  ].join('\n');
  const res = evaluateReply({ caseObj: c, draft });
  assert.equal(res.tone.score, 100);
  assert.deepEqual(res.tone.issues, []);
  assert.equal(res.tone.hasGreeting, true);
  assert.equal(res.tone.hasNextStep, true);
  assert.equal(res.tone.wordsPerSentence, 11);
  assert.equal(res.ok, true);
});

test('tone: bare factual sentence scores 55 (no greeting/contraction/next step)', () => {
  const c = makeCase();
  const res = evaluateReply({ caseObj: c, draft: 'The system behaves differently.' });
  assert.equal(res.tone.score, 55);
  assert.equal(res.tone.hasGreeting, false);
  assert.equal(res.tone.hasNextStep, false);
  assert.equal(res.tone.wordsPerSentence, 4);
  assert.equal(res.tone.issues.length, 3);
});

test('tone: long sentences lose the conversational 15 points', () => {
  const c = makeCase();
  const blob = [...Array(59).fill('word'), "we're"].join(' ');
  const draft = `Hi Jane,\n\n${blob}.\n\nPlease reply?`;
  const res = evaluateReply({ caseObj: c, draft });
  // 64 words / 2 sentences = 32 > 24 -> no +15; everything else present
  assert.equal(res.tone.wordsPerSentence, 32);
  assert.equal(res.tone.score, 85);
  assert.equal(res.tone.issues.length, 1);
  assert.match(res.tone.issues[0], /24/);
});

test('tone is deterministic: same input -> same output object', () => {
  const c = makeCase();
  const draft = 'Hi Jane,\n\nThe PDB blocks eviction.\n\nCan you confirm?';
  assert.deepEqual(evaluateReply({ caseObj: c, draft }), evaluateReply({ caseObj: c, draft }));
});

test('sanitizeReply rewrites ungrounded claims using available classes', () => {
  const c = makeCase();
  // DOCUMENTED satisfies "I checked" but not "we confirmed" (needs hard proof)
  ground(c, 'documentation');
  const draft = 'Hi Jane,\n\nWe confirmed the fix works on your cluster.\n\nCan you apply it?';
  const res = evaluateReply({ caseObj: c, draft });
  assert.equal(res.ok, false);
  assert.equal(res.violations.length, 1);

  const out = sanitizeReply({ caseObj: c, draft, violations: res.violations });
  assert.doesNotMatch(out, /We confirmed/i);
  assert.match(out, /Based on the CAST AI documentation/i);
  assert.match(out, /the fix works on your cluster/); // factual remainder kept

  // sanitized draft passes the guard cleanly
  const re = evaluateReply({ caseObj: c, draft: out });
  assert.equal(re.violations.length, 0);
  assert.equal(re.banned.length, 0);
  assert.equal(re.ok, true);
});

test('sanitizeReply hedges with the honest fallback when no classes exist', () => {
  const c = makeCase();
  const draft = 'Hi Jane,\n\nI reproduced this in the lab.\n\nCan you confirm?';
  const res = evaluateReply({ caseObj: c, draft });
  const out = sanitizeReply({ caseObj: c, draft, violations: res.violations });
  assert.doesNotMatch(out, /I reproduced/i);
  assert.match(out, /Based on our current understanding/i);
  assert.equal(evaluateReply({ caseObj: c, draft: out }).ok, true);
});

test('sanitizeReply strips banned phrases regardless of case', () => {
  const c = makeCase();
  const draft = 'Hi Jane,\n\nREST ASSURED, this is safe. Please Do Not Hesitate to write back.\n\nCan you confirm?';
  const out = sanitizeReply({ caseObj: c, draft, violations: [] });
  assert.doesNotMatch(out, /rest assured/i);
  assert.doesNotMatch(out, /please do not hesitate/i);
  assert.match(out, /this is safe/);
  assert.equal(evaluateReply({ caseObj: c, draft: out }).banned.length, 0);
});

test('sanitizeReply rewrites every violating sentence, not just the first', () => {
  const c = makeCase(); // no grounding at all: every first-person claim violates
  const draft = [
    'Hi Jane,',
    '',
    'I checked your cluster and found the PDB.',
    'I reproduced this exact behaviour too.',
    '',
    'Can you confirm?',
  ].join('\n');
  const res = evaluateReply({ caseObj: c, draft });
  assert.equal(res.violations.length, 2);

  const out = sanitizeReply({ caseObj: c, draft, violations: res.violations });
  assert.doesNotMatch(out, /I checked/i);
  assert.doesNotMatch(out, /I reproduced/i);
  assert.equal(evaluateReply({ caseObj: c, draft: out }).ok, true);
});

test('sanitizeReply computes violations itself when not provided', () => {
  const c = makeCase();
  const draft = 'Hi Jane,\n\nI checked your cluster.\n\nCan you confirm?';
  const out = sanitizeReply({ caseObj: c, draft });
  assert.equal(evaluateReply({ caseObj: c, draft: out }).ok, true);
});
