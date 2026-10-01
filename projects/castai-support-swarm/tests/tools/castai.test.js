// tests/tools/castai.test.js — read-only CAST AI API client (contract section 6).
// No network: every request goes to a mock fetchImpl.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCastaiClient } from '../../src/tools/castai.js';
import { assembleTools } from '../../src/tools/index.js';
import { PolicyError } from '../../src/core/policy.js';

const okResponse = (body = {}) => ({ ok: true, status: 200, json: async () => body });

test('rejects base URLs whose host does not end with cast.ai', () => {
  const fetchImpl = async () => okResponse();
  assert.throws(() => createCastaiClient({ apiKey: 'k', baseUrl: 'https://evil.example.com', fetchImpl }));
  assert.throws(() => createCastaiClient({ apiKey: 'k', baseUrl: 'https://notcast.ai', fetchImpl }));
  assert.throws(() => createCastaiClient({ apiKey: 'k', baseUrl: 'https://cast.ai.evil.example.com', fetchImpl }));
  assert.throws(() => createCastaiClient({ apiKey: 'k', baseUrl: 'not a url', fetchImpl }));
});

test('accepts real cast.ai hosts and exposes only get()', () => {
  const fetchImpl = async () => okResponse();
  for (const baseUrl of ['https://api.eu.cast.ai', 'https://api.cast.ai', 'https://cast.ai']) {
    const client = createCastaiClient({ apiKey: 'k', baseUrl, fetchImpl });
    assert.deepEqual(Object.keys(client), ['get']);
    assert.equal(typeof client.get, 'function');
  }
});

test('defaults base URL to env.CASTAI_API_BASE then https://api.eu.cast.ai', async () => {
  const saved = process.env.CASTAI_API_BASE;
  try {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return okResponse({});
    };

    process.env.CASTAI_API_BASE = 'https://api.us.cast.ai';
    await createCastaiClient({ apiKey: 'k', fetchImpl }).get('/v1/organizations');
    assert.equal(calls.pop(), 'https://api.us.cast.ai/v1/organizations');

    delete process.env.CASTAI_API_BASE;
    await createCastaiClient({ apiKey: 'k', fetchImpl }).get('/v1/organizations');
    assert.equal(calls.pop(), 'https://api.eu.cast.ai/v1/organizations');
  } finally {
    if (saved === undefined) delete process.env.CASTAI_API_BASE;
    else process.env.CASTAI_API_BASE = saved;
  }
});

test('strips trailing slashes from baseUrl before joining', async () => {
  let calledUrl;
  const client = createCastaiClient({
    apiKey: 'k',
    baseUrl: 'https://api.eu.cast.ai/',
    fetchImpl: async (url) => {
      calledUrl = url;
      return okResponse({});
    },
  });
  await client.get('/v1/organizations');
  assert.equal(calledUrl, 'https://api.eu.cast.ai/v1/organizations');
});

test('get() sends the API key header and returns the JSON body', async () => {
  const seen = [];
  const client = createCastaiClient({
    apiKey: 'test-key-123',
    baseUrl: 'https://api.eu.cast.ai',
    fetchImpl: async (url, options) => {
      seen.push([url, options]);
      return okResponse({ organizations: [{ id: 'org-1', name: 'Siemens' }] });
    },
  });
  const body = await client.get('/v1/organizations');
  assert.deepEqual(body, { organizations: [{ id: 'org-1', name: 'Siemens' }] });
  assert.equal(seen.length, 1);
  const [url, options] = seen[0];
  assert.equal(url, 'https://api.eu.cast.ai/v1/organizations');
  assert.equal(options.headers['X-API-Key'], 'test-key-123');
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.method, undefined); // GET only, never an explicit mutation verb
});

test('get() enforces the read-only path allow-list (PolicyError)', async () => {
  let fetchCalled = 0;
  const client = createCastaiClient({
    apiKey: 'k',
    baseUrl: 'https://api.eu.cast.ai',
    fetchImpl: async () => {
      fetchCalled += 1;
      return okResponse();
    },
  });
  await client.get('/v1/organizations'); // allowed
  assert.equal(fetchCalled, 1);

  await assert.rejects(() => client.get('/v1/billing/issueInvoice'), PolicyError);
  await assert.rejects(() => client.get('/v1/kubernetes/clusters'), PolicyError);
  await assert.rejects(() => client.get('/users'), PolicyError);
  assert.equal(fetchCalled, 1); // rejected paths never reach fetch
});

test('get() rejects path traversal with PolicyError', async () => {
  let fetchCalled = 0;
  const client = createCastaiClient({
    apiKey: 'k',
    baseUrl: 'https://api.eu.cast.ai',
    fetchImpl: async () => {
      fetchCalled += 1;
      return okResponse();
    },
  });
  await assert.rejects(() => client.get('/v1/organizations/../admin'), PolicyError);
  await assert.rejects(() => client.get('/v1/organizations/%2e%2e/admin'), PolicyError);
  assert.equal(fetchCalled, 0);
});

test('get() redacts sensitive keys at any depth', async () => {
  const client = createCastaiClient({
    apiKey: 'k',
    baseUrl: 'https://api.eu.cast.ai',
    fetchImpl: async () =>
      okResponse({
        name: 'visible',
        api_keyvalue: 'abc',
        nested: { access_token: 'x', list: [{ secret_ref: 'y' }] },
      }),
  });
  const body = await client.get('/v1/organizations/org-1');
  assert.deepEqual(body, {
    name: 'visible',
    api_keyvalue: '***REDACTED***',
    nested: { access_token: '***REDACTED***', list: [{ secret_ref: '***REDACTED***' }] },
  });
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('"abc"') && !serialized.includes('"x"'), 'secret values must not survive redaction');
});

test('get() throws with status on non-OK responses', async () => {
  const client = createCastaiClient({
    apiKey: 'k',
    baseUrl: 'https://api.eu.cast.ai',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'denied' }) }),
  });
  await assert.rejects(
    () => client.get('/v1/organizations'),
    (err) => {
      assert.equal(err.status, 403);
      assert.match(err.message, /403/);
      return true;
    },
  );
});

// --- assembleTools wiring (src/tools/index.js) ---------------------------------

test('assembleTools: castai is null without CASTAI_API_KEY, client with it', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'assemble-tools-'));
  const fetchImpl = async () => okResponse();

  const offline = assembleTools({ repoRoot, env: {}, fetchImpl });
  assert.equal(offline.castai, null);
  assert.equal(typeof offline.kb, 'function');
  assert.equal(typeof offline.kb.search, 'function');
  assert.equal(typeof offline.kube.kubectlRead, 'function');
  assert.equal(typeof offline.kube.parseKubejson, 'function');
  assert.equal(typeof offline.lab.createCluster, 'function');
  assert.equal(typeof offline.lab.simulateScaleDown, 'function');
  assert.equal(typeof offline.email.draftEmail, 'function');

  const online = assembleTools({
    repoRoot,
    env: { CASTAI_API_KEY: 'key-1', CASTAI_API_BASE: 'https://api.eu.cast.ai' },
    fetchImpl,
  });
  assert.notEqual(online.castai, null);
  assert.equal(typeof online.castai.get, 'function');
});

test('assembleTools: kb is bound to the given repoRoot', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'assemble-tools-kb-'));
  const tools = assembleTools({ repoRoot, env: {}, fetchImpl: async () => okResponse() });
  const results = await tools.kb('anything');
  assert.deepEqual(results, []); // no KB roots in a fresh temp dir, but it resolves repoRoot
});
