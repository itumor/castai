// tests/core/llm.test.js — contract section 2 (src/core/llm.js)
// No network: HttpLlm is exercised with mock fetchImpl only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HeuristicLlm, HttpLlm, defaultLlm, jsonOnly } from '../../src/core/llm.js';

// --------------------------------------------------------------------------
// HeuristicLlm — triage intent keyword rules
// --------------------------------------------------------------------------

async function triageOf(body) {
  const llm = new HeuristicLlm();
  const out = await llm.complete({
    system: 'You triage support tickets.',
    prompt: `Triage this customer thread and return JSON.\n\n${body}`,
  });
  return jsonOnly(out);
}

test('HeuristicLlm triage: "PutRolePolicy ... AccessDenied" -> iam_onboarding', async () => {
  const t = await triageOf(
    'Error: creating IAM Role Policy: AccessDenied: iam:PutRolePolicy on resource role castai-eks-dev',
  );
  assert.equal(t.category, 'iam_onboarding');
});

test('HeuristicLlm triage: "not scaling down" -> node_downscale', async () => {
  const t = await triageOf('One node is not scaling down after the workload shrank.');
  assert.equal(t.category, 'node_downscale');
});

test('HeuristicLlm triage is NEGATION-BLIND — pinned as a documented keyword-heuristic limitation', async () => {
  // The category rules are the contract-pinned keyword rules: they fire on
  // surface tokens and do not model negation. "Scale-downs stopped happening"
  // (no actual complaint) still routes to node_downscale because the words
  // appear; semantically wrong, behaviorally deterministic. This PIN records
  // the current behavior so a future smarter rule must make a deliberate
  // change, not a silent drift.
  const quietCase = await triageOf('Great news: all scale-downs are working perfectly now.');
  assert.equal(quietCase.category, 'node_downscale');
  // The guardrail against real harm is NOT triage but the downstream gates:
  // an unsupported story still ends REJECT/clarify at the verifier.
  const complaint = await triageOf('Nodes are not scaling down since Tuesday, costs keep rising.');
  assert.equal(complaint.category, 'node_downscale');
});

test('HeuristicLlm triage: "401" + "token" -> token_rotation', async () => {
  const t = await triageOf('Since rotating the cluster token our agents get 401 Authorization Required.');
  assert.equal(t.category, 'token_rotation');
});

test('HeuristicLlm triage: "savings"/"formula" -> cost_reporting', async () => {
  assert.equal((await triageOf('What is the formula behind realized savings?')).category, 'cost_reporting');
  assert.equal((await triageOf('How is the cost report baseline computed?')).category, 'cost_reporting');
  assert.equal((await triageOf('Which billing method is used?')).category, 'cost_reporting');
});

test('HeuristicLlm triage: remaining rules per contract', async () => {
  assert.equal((await triageOf('The workload autoscaler is not applying recommendations.')).category, 'workload_autoscaling');
  assert.equal((await triageOf('Do you support VPA alongside HPA?')).category, 'workload_autoscaling');
  assert.equal((await triageOf('Can we use spot instances?')).category, 'spot');
  assert.equal((await triageOf('How do I configure node templates?')).category, 'docs_question');
  assert.equal((await triageOf('Keyboard broken, please advise.')).category, 'unknown');
  // rule order: 403/onboard wins over token_rotation's 'authoriz'
  assert.equal((await triageOf('onboard fails, user not authorized (403)')).category, 'iam_onboarding');
});

test('HeuristicLlm triage: full TriageResult shape', async () => {
  const t = await triageOf([
    'From: Christoph Weber <christoph@example.com>',
    '',
    'Hi team, our AWS EKS cluster (full mode) is not scaling down.',
    'cluster id: f47ac10b-58cc',
    'Is this expected? What do we change?',
  ].join('\n'));

  assert.equal(typeof t.category, 'string');
  assert.equal(t.provider, 'aws');
  assert.equal(t.platform, 'eks');
  assert.equal(t.castaiMode, 'full');
  assert.deepEqual(t.questions, ['Is this expected?', 'What do we change?']);
  assert.ok(['low', 'medium', 'high'].includes(t.severity));
  assert.equal(t.entities.clusterId, 'f47ac10b-58cc');
  assert.ok(t.missingInfo.includes('orgId'));
  assert.ok(!t.missingInfo.includes('clusterId'));
  assert.equal(t.customerName, 'Christoph');
});

test('HeuristicLlm triage: customerName from salutation; P1 -> high severity', async () => {
  const t = await triageOf('Hi Lena,\n\nP1 urgent outage on our cluster, nodes not scaling!');
  assert.equal(t.customerName, 'Lena');
  assert.equal(t.severity, 'high');
  const t2 = await triageOf('No name anywhere here, just words.');
  assert.equal(t2.customerName, '');
});

// --------------------------------------------------------------------------
// HeuristicLlm — plan / writer / fallback intents
// --------------------------------------------------------------------------

test('HeuristicLlm plan intent returns JSON { agents: [...] }', async () => {
  const llm = new HeuristicLlm();
  const out = await llm.complete({ prompt: 'Build a plan of agents for this case.', json: true });
  const parsed = jsonOnly(out);
  assert.ok(Array.isArray(parsed.agents));
  assert.ok(parsed.agents.length > 0);
  assert.ok(parsed.agents.includes('researcher'));
  assert.ok(parsed.agents.includes('writer'));
});

test('HeuristicLlm writer intent returns a plain greeting draft', async () => {
  const llm = new HeuristicLlm();
  const out = await llm.complete({
    prompt: 'writer mode\nFrom: Lena Hartmann <lena@example.com>\n\n- PDB blocks eviction\n',
  });
  assert.equal(typeof out, 'string');
  assert.match(out, /^Hi Lena,/);
  assert.match(out, /PDB blocks eviction/);
});

test('HeuristicLlm unmatched intent returns {}', async () => {
  const llm = new HeuristicLlm();
  const out = await llm.complete({ prompt: 'just chatter with no intent keyword' });
  assert.equal(out, '{}');
});

// --------------------------------------------------------------------------
// jsonOnly — tolerant JSON extraction
// --------------------------------------------------------------------------

test('jsonOnly strips ```json fences', () => {
  assert.deepEqual(jsonOnly('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(jsonOnly('```\n{"a": 1}\n```'), { a: 1 });
});

test('jsonOnly skips leading prose and trailing text', () => {
  assert.deepEqual(jsonOnly('Sure! Here is the result:\n{"a": [1, 2]}\nHope that helps.'), { a: [1, 2] });
  assert.deepEqual(jsonOnly('prefix [1, 2, 3] suffix'), [1, 2, 3]);
});

test('jsonOnly handles braces inside strings', () => {
  assert.deepEqual(jsonOnly('{"x": "a } b", "y": 2}'), { x: 'a } b', y: 2 });
});

test('jsonOnly is OBJECT-PREFERRED: a stray array in prose never shadows the triage object', () => {
  // The triage JSON is an object; before this fix the first balanced block
  // won, so an LLM narrating "[1]" in prose would corrupt the category parse.
  const messy =
    'The answer is [1, 2] for sure, and the classification is ' +
    '{ "category": "iam_onboarding", "provider": "aws" }.';
  assert.deepEqual(jsonOnly(messy), { category: 'iam_onboarding', provider: 'aws' });
  // Array input when no object exists still works.
  assert.deepEqual(jsonOnly('prefix [1, 2, 3] suffix'), [1, 2, 3]);
  // An unbalanced object yields the array fallback rather than garbage.
  assert.deepEqual(jsonOnly('oops { and [1] done'), [1]);
});

test('jsonOnly returns {} when nothing parses', () => {
  assert.deepEqual(jsonOnly('no json here at all'), {});
  assert.deepEqual(jsonOnly(''), {});
  assert.deepEqual(jsonOnly(null), {});
});

// --------------------------------------------------------------------------
// HttpLlm — mock fetchImpl only, never network
// --------------------------------------------------------------------------

function mockFetch(payload, ok = true, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => payload };
  };
  return { calls, fetchImpl };
}

test('HttpLlm anthropic: URL, headers, default model, text extraction', async () => {
  const { calls, fetchImpl } = mockFetch({ content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] });
  const llm = new HttpLlm({ apiKey: 'test-key', fetchImpl });
  const out = await llm.complete({ system: 'S', prompt: 'P', json: true });

  assert.equal(out, 'hello world');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], 'test-key');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'claude-sonnet-4-5');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'P' }]);
  assert.match(body.system, /S/);
  assert.match(body.system, /JSON/); // json:true adds a JSON-only instruction
});

test('HttpLlm openai: URL, auth header, json mode, content extraction', async () => {
  const { calls, fetchImpl } = mockFetch({ choices: [{ message: { content: 'hi' } }] });
  const llm = new HttpLlm({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-test', fetchImpl });
  const out = await llm.complete({ system: 'S', prompt: 'P', json: true });

  assert.equal(out, 'hi');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gpt-test');
  assert.deepEqual(body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'P' }]);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('HttpLlm throws on !ok and on unsupported provider', async () => {
  const { fetchImpl } = mockFetch({ error: 'boom' }, false, 500);
  const llm = new HttpLlm({ apiKey: 'k', fetchImpl });
  await assert.rejects(() => llm.complete({ prompt: 'x' }), /HTTP 500/);
  assert.throws(() => new HttpLlm({ provider: 'bogus', apiKey: 'k' }), /provider/i);
});

// --------------------------------------------------------------------------
// defaultLlm
// --------------------------------------------------------------------------

test('defaultLlm picks HeuristicLlm without keys, HttpLlm with keys', () => {
  assert.ok(defaultLlm({}) instanceof HeuristicLlm);
  const anthropic = defaultLlm({ ANTHROPIC_API_KEY: 'k' });
  assert.ok(anthropic instanceof HttpLlm);
  assert.equal(anthropic.provider, 'anthropic');
  const openai = defaultLlm({ OPENAI_API_KEY: 'k' });
  assert.ok(openai instanceof HttpLlm);
  assert.equal(openai.provider, 'openai');
});
