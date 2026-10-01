import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact, redactDeep } from '../../src/core/redact.js';

// --- Acceptance criterion (1): castai_v1_... key is masked ---

test('redact masks castai_v1_ API key literal', () => {
  const out = redact('my key is castai_v1_abc123 please help');
  assert.equal(out, 'my key is castai_v1_[REDACTED] please help');
  assert.ok(!out.includes('abc123'));
});

// --- Acceptance criterion (2): redactDeep masks sensitive keys, nested ---

test('redactDeep masks token and nested password keys', () => {
  const out = redactDeep({ token: 'x', nested: { password: 'y' } });
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.nested.password, '[REDACTED]');
  assert.equal(out.nested.token, undefined); // sanity: structure preserved
});

// --- Acceptance criterion (3): non-string leaves pass through untouched ---

test('redactDeep leaves non-string values untouched', () => {
  const input = {
    count: 42,
    flag: false,
    nothing: null,
    when: new Date('2024-01-01T00:00:00.000Z'),
    token: 12345, // sensitive key but non-string value
    list: [1, true, null, 'plain']
  };
  const out = redactDeep(input);
  assert.equal(out.count, 42);
  assert.equal(out.flag, false);
  assert.equal(out.nothing, null);
  // Dates have no own enumerable properties, so the walker (matching the
  // mcp-server source of truth) reduces them to plain empty objects.
  assert.deepEqual(out.when, {});
  assert.equal(out.token, 12345); // number value, not masked
  assert.deepEqual(out.list, [1, true, null, 'plain']);
});

// --- Header masking ---

test('redact masks Authorization: Token header', () => {
  const out = redact('GET /v1 failed with Authorization: Token eyJhbGciOi.abc def');
  assert.ok(out.includes('Authorization: Token [REDACTED]'));
  assert.ok(!out.includes('eyJhbGciOi'));
});

test('redact masks Authorization: Bearer header', () => {
  const out = redact('Authorization: Bearer sk-proj-000111');
  assert.equal(out, 'Authorization: Bearer [REDACTED]');
});

test('redact masks bare Token/Bearer occurrences', () => {
  const out = redact('sent token: Token abc123--xyz back');
  assert.equal(out, 'sent token: Token [REDACTED] back');
});

// --- X-API-Key masking ---

test('redact masks X-API-Key header value', () => {
  // Security property: the secret value must never survive redaction. The
  // exact output spelling is an implementation detail of the pattern cascade
  // (matches the mcp-server redactErrorMessage source of truth).
  const out = redact('X-API-Key: supersecret123');
  assert.ok(!out.includes('supersecret123'));
  assert.ok(out.includes('[REDACTED]'));
});

test('redact masks X-API-Key without space', () => {
  // Same security property: secret gone, value masked, per the port behavior.
  const out = redact('X-API-Key:supersecret123');
  assert.ok(!out.includes('supersecret123'));
  assert.ok(out.includes('[REDACTED]'));
});

// --- api_key param masking ---

test('redact masks api_key= query param', () => {
  const out = redact('https://api.cast.ai/v1?api_key=deadbeef99&page=2');
  assert.equal(out, 'https://api.cast.ai/v1?api_key=[REDACTED]&page=2');
});

test('redact masks apiKey: form', () => {
  const out = redact('config apiKey: zzz-111');
  assert.equal(out, 'config api_key=[REDACTED]');
});

// --- JSON-inside-string masking ---

test('redact masks secrets inside JSON strings', () => {
  const payload = JSON.stringify({
    error: 'bad creds',
    auth: { token: 'leaky-leak', password: 'hunter2' },
    ok: 1
  });
  // Pure JSON string body: the walker parses it and masks sensitive values.
  const out = redact(payload);
  assert.ok(!out.includes('leaky-leak'));
  assert.ok(!out.includes('hunter2'));
  const parsed = JSON.parse(out);
  assert.equal(parsed.auth.token, '[REDACTED]');
  assert.equal(parsed.auth.password, '[REDACTED]');
  assert.equal(parsed.ok, 1);

  // JSON with a non-JSON prefix is not re-parsed (matches the mcp-server
  // redactErrorMessage source of truth); the message passes through as-is.
  const prefixed = `request failed: ${payload}`;
  assert.equal(redact(prefixed), prefixed);
});

test('redactDeep masks JSON string values of sensitive keys', () => {
  const out = redactDeep({ body: '{"access_token":"top-secret","n":5}' });
  const parsed = JSON.parse(out.body);
  assert.equal(parsed.access_token, '[REDACTED]');
  assert.equal(parsed.n, 5);
});

// --- Idempotence ---

test('redact is idempotent on already-redacted text', () => {
  const once = redact('Authorization: Token abc.def-ghi castai_v1_xyz789 api_key=q1w2e3');
  const twice = redact(once);
  assert.equal(twice, once);
});

test('redactDeep is idempotent', () => {
  const input = { token: 'x', nested: { api_key: 'y', note: 'castai_v1_abc123' } };
  const once = redactDeep(input);
  const twice = redactDeep(once);
  assert.deepEqual(twice, once);
});

// --- Misc edge cases ---

test('redact passes plain text through unchanged', () => {
  assert.equal(redact('nothing sensitive here'), 'nothing sensitive here');
});

test('redact handles null/undefined by returning input', () => {
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
});

test('redactDeep returns primitives as-is', () => {
  assert.equal(redactDeep(7), 7);
  assert.equal(redactDeep('plain string'), 'plain string');
  assert.equal(redactDeep(null), null);
});
