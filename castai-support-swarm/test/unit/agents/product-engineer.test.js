import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProductEngineerAgent } from '../../../src/agents/product-engineer.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { MockCastaiTools } from '../../../src/adapters/castai/mock-castai-tools.js';
import { createLedger } from '../../../src/core/ledger.js';

const KB_DOCS = {
  'runbooks/scaling.md': {
    excerpt: 'Cluster autoscaler scales node groups when pods are pending.',
    content: 'CAST AI node autoscaler reacts to pending pods by adding nodes up to the max node count.',
  },
  'kb/api-rate-limits.md': {
    excerpt: 'The public API applies rate limits per organization.',
    content: 'API requests are rate limited to 600 requests per minute per organization.',
  },
};

function makeKb() {
  return {
    async search({ query }) {
      const q = String(query ?? '').toLowerCase();
      const tokens = String(query ?? '').toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      return Object.entries(KB_DOCS)
        .filter(([p, d]) => tokens.some((t) => `${p} ${d.content}`.toLowerCase().includes(t)))
        .map(([path, d]) => ({ path, excerpt: d.excerpt, score: 1 }));
    },
    async read(path) {
      const doc = KB_DOCS[path];
      if (!doc) throw new Error(`unknown kb path ${path}`);
      return { path, content: doc.content };
    },
  };
}

const BRAIN_ANSWERS = {
  answers: [
    {
      question: 'Does the node autoscaler react to pending pods?',
      answer: 'Yes — it adds nodes up to the max node count when pods stay pending.',
      confirmed: true,
      path: 'runbooks/scaling.md',
    },
    {
      question: 'Are API requests rate limited?',
      answer: 'Yes, 600 requests per minute per organization.',
      confirmed: true,
      path: 'kb/api-rate-limits.md',
    },
    {
      question: 'What language is the autoscaler written in?',
      answer: 'Go.',
      confirmed: false,
      path: null,
    },
  ],
};

describe('ProductEngineerAgent', () => {
  test('answers questions and appends code evidence only for confirmed facts', async () => {
    const ledger = createLedger('case-product', null);
    const castai = new MockCastaiTools({});
    const agent = new ProductEngineerAgent({
      brain: new ScriptedBrain({ defaultResponse: JSON.stringify(BRAIN_ANSWERS) }),
      ledger,
      adapters: { kb: makeKb(), castai },
    });

    const result = await agent.execute({
      questions: [
        'Does the node autoscaler react to pending pods?',
        'Are API requests rate limited?',
        'What language is the autoscaler written in?',
      ],
    });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.answers.length, 3);
    assert.deepEqual(result.output.answers[0], {
      question: 'Does the node autoscaler react to pending pods?',
      answer: 'Yes — it adds nodes up to the max node count when pods stay pending.',
      evidenceIds: ['E1'],
    });
    assert.equal(result.output.answers[1].evidenceIds[0], 'E2');
    // Unconfirmed answer carries no evidence.
    assert.deepEqual(result.output.answers[2], {
      question: 'What language is the autoscaler written in?',
      answer: 'Go.',
      evidenceIds: [],
    });

    assert.equal(ledger.evidence.length, 2);
    for (const ev of ledger.evidence) {
      assert.equal(ev.type, 'code');
      assert.equal(ev.toolRun, null);
    }
    assert.equal(ledger.evidence[0].source, 'kb:runbooks/scaling.md');
    assert.equal(ledger.evidence[0].reference, 'runbooks/scaling.md');
    assert.equal(ledger.evidence[1].source, 'kb:kb/api-rate-limits.md');
    assert.equal(ledger.evidence[1].reference, 'kb/api-rate-limits.md');
    assert.deepEqual(result.evidenceIds, ['E1', 'E2']);
    // The agent never touched the castai adapter despite it being injected.
    assert.deepEqual(castai.calls, []);
  });

  test('confirmed answer with a path outside the searched material gets no evidence', async () => {
    const ledger = createLedger('case-product-2', null);
    const brain = new ScriptedBrain({
      defaultResponse: JSON.stringify({
        answers: [{
          question: 'Does the node autoscaler react to pending pods?',
          answer: 'Sure it does.',
          confirmed: true,
          path: 'kb/nonexistent.md', // never searched → not grounded
        }],
      }),
    });
    const agent = new ProductEngineerAgent({
      brain, ledger, adapters: { kb: makeKb() },
    });

    const result = await agent.execute({
      questions: ['Does the node autoscaler react to pending pods?'],
    });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.answers[0].evidenceIds.length, 0);
    assert.equal(ledger.evidence.length, 0);
  });

  test('missing or empty task.questions → ok:false', async () => {
    const agent = new ProductEngineerAgent({
      brain: new ScriptedBrain({ defaultResponse: '{}' }),
      ledger: createLedger('case-product-3', null),
      adapters: { kb: makeKb() },
    });
    const result = await agent.execute({});
    assert.equal(result.ok, false);
    assert.match(result.error, /task\.questions/);

    const resultEmpty = await agent.execute({ questions: [] });
    assert.equal(resultEmpty.ok, false);
  });

  test('missing kb adapter → ok:false', async () => {
    const agent = new ProductEngineerAgent({
      brain: new ScriptedBrain({ defaultResponse: '{}' }),
      ledger: createLedger('case-product-4', null),
      adapters: {},
    });
    const result = await agent.execute({ questions: ['anything?'] });
    assert.equal(result.ok, false);
    assert.match(result.error, /kb adapter/);
  });
});
