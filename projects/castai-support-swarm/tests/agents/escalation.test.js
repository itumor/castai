// tests/agents/escalation.test.js — engineering package markdown.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEvidence,
  addHypothesis,
  createCase,
  setHypothesisStatus,
} from '../../src/core/model.js';
import { createEscalation } from '../../src/agents/escalation.js';

function richCase() {
  const caseObj = createCase({
    id: 'ESC-1',
    thread: {
      from: 'Kai Example <kai@example.com>',
      subject: 'rebalanced node never comes back up',
      messages: [
        {
          from: 'kai@example.com',
          date: '2026-01-05',
          body: 'After a rebalance the node never rejoined and three pods stayed pending.',
        },
      ],
    },
    customer: { name: 'Kai Example', email: 'kai@example.com' },
  });
  caseObj.triage = {
    category: 'product_bug',
    provider: 'aws',
    platform: 'eks',
    castaiMode: 'full',
    questions: [],
    severity: 'high',
    missingInfo: [],
    entities: { orgId: 'org-aaa111', clusterId: 'clu-bbb222' },
    customerName: 'Kai',
  };

  const h1 = addHypothesis(caseObj, { statement: 'rebalance evicted pods faster than capacity could come up' });
  setHypothesisStatus(caseObj, h1.id, 'confirmed');
  const h2 = addHypothesis(caseObj, { statement: 'customer PDB blocked the drain' });
  setHypothesisStatus(caseObj, h2.id, 'rejected');

  addEvidence(caseObj, {
    type: 'environment',
    source: 'kube',
    ref: 'nodes/rebalanced-1',
    summary: 'Node removal event without replacement capacity.',
    agentId: 'sre',
  });
  addEvidence(caseObj, {
    type: 'reproduction',
    source: 'lab',
    ref: 'lab/rebalance',
    summary: 'Same pending-pod state reproduced in the lab.',
    agentId: 'repro',
  });

  caseObj.tests.e2e = 'passed';
  caseObj.solution = {
    status: 'proposed',
    summary: 'Throttle rebalance eviction rate until replacement capacity is confirmed.',
    steps: ['Cap rebalance eviction concurrency.', 'Rollback: restore default concurrency.'],
  };
  return caseObj;
}

function ctxFor(caseObj, params = {}) {
  return { caseObj, repoRoot: '/nonexistent', params };
}

test('writes the full engineering markdown package onto caseObj.escalation', async () => {
  const caseObj = richCase();
  const escalation = createEscalation({ llm: undefined, tools: undefined });
  const { escalation: markdown } = await escalation.run(ctxFor(caseObj));

  assert.equal(caseObj.escalation, markdown);
  assert.equal(typeof markdown, 'string');
  assert.ok(markdown.length > 400);

  for (const heading of [
    '## Problem',
    '## Expected vs observed',
    '## Environment',
    '## Hypotheses tested',
    '## Evidence index',
    '## Reproduction summary',
    '## Tests',
    '## Customer impact',
    '## Attachments',
  ]) {
    assert.ok(markdown.includes(heading), `missing heading: ${heading}`);
  }

  // Hypotheses with their statuses.
  assert.match(markdown, /H1 \(confirmed\): rebalance evicted pods/);
  assert.match(markdown, /H2 \(rejected\): customer PDB blocked the drain/);
  // Evidence index entries.
  assert.match(markdown, /E1 \[environment\/ENV_CONFIRMED\] \(sre\)/);
  assert.match(markdown, /E2 \[reproduction\/REPRODUCED\] \(repro\)/);
  // Environment facts.
  assert.match(markdown, /Platform: eks/);
  assert.match(markdown, /Cluster id: clu-bbb222/);
  // Tests and attachments.
  assert.match(markdown, /- e2e: passed/);
  assert.match(markdown, /ESC-1\.trace\.jsonl/);

  const actions = caseObj.trace.filter((t) => t.actor === 'escalation').map((t) => t.action);
  assert.ok(actions.includes('escalation.start'));
  assert.ok(actions.includes('escalation.package.written'));
});

test('empty ledger degrades gracefully: (none) placeholders, repro no, tests not_run', async () => {
  const caseObj = createCase({
    id: 'ESC-2',
    thread: {
      from: 'Lee <lee@example.com>',
      subject: 'unknown problem',
      messages: [{ from: 'lee@example.com', date: '2026-01-01', body: '' }],
    },
    customer: { name: 'Lee', email: 'lee@example.com' },
  });

  const { escalation: markdown } = await createEscalation().run(ctxFor(caseObj));
  assert.match(markdown, /## Hypotheses tested\n- \(none\)/);
  assert.match(markdown, /## Evidence index\n- \(none\)/);
  assert.match(markdown, /- Reproduced: no/);
  assert.match(markdown, /- unit: not_run/);
  assert.match(markdown, /Organization id: unknown/);
});

test('kbNotes appear in the attachments list', async () => {
  const caseObj = richCase();
  caseObj.kbNotes.push('/tmp/kb/2026-01-05-ESC-1.md');
  const { escalation: markdown } = await createEscalation().run(ctxFor(caseObj));
  assert.match(markdown, /- \/tmp\/kb\/2026-01-05-ESC-1\.md/);
});
