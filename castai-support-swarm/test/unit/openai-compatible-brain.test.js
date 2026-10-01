// Unit tests for OpenAICompatibleBrain — chunk 4 acceptance criteria.
// Every test injects a stub fetchImpl; globalThis.fetch is sabotaged to
// guarantee no real network is touched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleBrain } from '../../src/brains/openai-compatible-brain.js';

const FAKE_KEY = 'sk-fake-1234567890abcdefghij';

// Installs a booby-trapped global fetch: any real-network attempt throws.
function sabotageGlobalFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('REAL NETWORK ACCESS attempted — tests must use injected fetchImpl only');
  };
  return () => {
    globalThis.fetch = original;
  };
}

function stubFetch(status, payload) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const bodyText = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    };
  };
  return { impl, calls };
}

function makeBrain(overrides = {}) {
  return new OpenAICompatibleBrain({
    baseUrl: 'https://stub.example/v1',
    apiKey: FAKE_KEY,
    model: 'stub-model',
    fetchImpl: async () => {
      throw new Error('no fetch wired for this test');
    },
    ...overrides,
  });
}

describe('OpenAICompatibleBrain', () => {
  test('stubbed fetch returns content; URL, method, headers correct', async () => {
    const restore = sabotageGlobalFetch();
    try {
      const { impl, calls } = stubFetch(200, {
        choices: [{ message: { content: '{"verdict":"ok"}' } }],
      });
      const brain = makeBrain({ fetchImpl: impl });

      const content = await brain.complete([{ role: 'user', content: 'hi' }]);

      assert.equal(content, '{"verdict":"ok"}');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://stub.example/v1/chat/completions');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
      assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
    } finally {
      restore();
    }
  });

  test('500 response throws redacted error; planted key never leaks', async () => {
    const restore = sabotageGlobalFetch();
    try {
      const errorBody = JSON.stringify({
        error: {
          message: `invalid credentials Bearer ${FAKE_KEY}`,
          api_key: FAKE_KEY,
        },
      });
      const { impl } = stubFetch(500, errorBody);
      const brain = makeBrain({ fetchImpl: impl });

      await assert.rejects(
        () => brain.complete([{ role: 'user', content: 'hi' }]),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message.includes(FAKE_KEY), false);
          assert.match(err.message, /HTTP 500/);
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  test('opts.json:true sets response_format json_object in request body', async () => {
    const restore = sabotageGlobalFetch();
    try {
      const { impl, calls } = stubFetch(200, {
        choices: [{ message: { content: '{}' } }],
      });
      const brain = makeBrain({ fetchImpl: impl });

      await brain.complete([{ role: 'user', content: 'hi' }], { json: true, temperature: 0.7 });

      const sent = JSON.parse(calls[0].init.body);
      assert.deepEqual(sent.response_format, { type: 'json_object' });
      assert.equal(sent.temperature, 0.7);
      assert.equal(sent.model, 'stub-model');
      assert.deepEqual(sent.messages, [{ role: 'user', content: 'hi' }]);
    } finally {
      restore();
    }
  });

  test('no apiKey (arg or env) → constructor throws', async () => {
    const restore = sabotageGlobalFetch();
    const savedEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(
        () => new OpenAICompatibleBrain({ baseUrl: 'https://stub.example/v1' }),
        /missing apiKey/
      );
    } finally {
      if (savedEnv !== undefined) process.env.OPENAI_API_KEY = savedEnv;
      restore();
    }
  });

  test('default temperature is 0.2; no opts.json → no response_format', async () => {
    const restore = sabotageGlobalFetch();
    try {
      const { impl, calls } = stubFetch(200, {
        choices: [{ message: { content: 'ok' } }],
      });
      const brain = makeBrain({ fetchImpl: impl });

      await brain.complete([{ role: 'user', content: 'hi' }]);

      const sent = JSON.parse(calls[0].init.body);
      assert.equal(sent.temperature, 0.2);
      assert.equal('response_format' in sent, false);
    } finally {
      restore();
    }
  });
});
